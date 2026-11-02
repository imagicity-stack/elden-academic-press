// Admin: newsletter subscribers, signed-up accounts and email campaigns.
import { Hono, type Context } from 'hono';
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { accounts, campaignSends, campaigns, products, productVariants, subscribers } from '../../db/schema.js';
import { parseCsv, toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound, query, zEmail, zPhone, zText } from '../../lib/http.js';
import { getSettings, loadCatalog } from '../../services/catalog.js';
import { kickSender, processNewsletter, renderCampaign, sendCampaignTo, startCampaign, subscribe } from '../../services/newsletter.js';
import { audit, requireRole } from './auth.js';

const likeOf = (q: string) => `%${q.replace(/[%_]/g, '\\$&')}%`;
const zPage = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) };
const csvResponse = (csv: string, name: string) => new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` } });

export const adminNewsletter = new Hono<AppEnv>();

/**
 * Copy customers from Supabase Auth into `accounts`, so everyone who ever signed in with
 * Google is listed, not only those who opened their account page since. Staff logins
 * (email and password) are left out. At most once a minute; never breaks the page.
 */
const lastSync = new WeakMap<object, { at: number; run: Promise<void> }>();
function syncAccounts(deps: AppEnv['Variables']['deps']): Promise<void> {
  if (!deps.authUsers) return Promise.resolve();
  const prev = lastSync.get(deps);
  if (prev && Date.now() - prev.at < 60_000) return prev.run; // a sync that's running waits for it to finish
  const run = copyCustomers(deps).catch((e) => {
    lastSync.delete(deps);
    console.error('[accounts] sync from Supabase failed:', (e as Error).message);
  });
  lastSync.set(deps, { at: Date.now(), run });
  return run;
}

async function copyCustomers(deps: AppEnv['Variables']['deps']) {
  const customers = (await deps.authUsers!()).filter((u) => u.email && u.providers.includes('google'));
  // A few hundred rows per statement, instead of one round trip per person.
  for (let i = 0; i < customers.length; i += 500) {
    const rows = customers.slice(i, i + 500).map((u) => ({ userId: u.id, email: u.email, name: u.name, avatarUrl: u.avatar, createdAt: u.createdAt, lastSeenAt: u.lastSignInAt ?? u.createdAt }));
    await deps.db.insert(accounts).values(rows).onConflictDoUpdate({
      target: accounts.userId,
      set: {
        email: sql`excluded.email`,
        name: sql`case when excluded.name <> '' then excluded.name else ${accounts.name} end`,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${accounts.avatarUrl})`,
        lastSeenAt: sql`greatest(${accounts.lastSeenAt}, excluded.last_seen_at)`,
      },
    });
  }
}

adminNewsletter.get('/summary', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  // Copying new Google sign-ups from Supabase can take a moment: on the live site it runs after the reply.
  if (deps.defer) deps.defer(syncAccounts(deps)); else await syncAccounts(deps);
  const s = await getSettings(db);
  const [byStatus, [{ n: accountsCount }], [{ n: accountsNotSubscribed }], [{ n: sentToday }]] = await Promise.all([
    db.select({ status: subscribers.status, n: count() }).from(subscribers).groupBy(subscribers.status),
    db.select({ n: count() }).from(accounts),
    // Signed in with Google but not on the list (and never unsubscribed): they don't get campaigns.
    db.select({ n: count() }).from(accounts).leftJoin(subscribers, eq(subscribers.email, accounts.email))
      .where(or(isNull(subscribers.id), eq(subscribers.status, 'pending'))),
    db.select({ n: count() }).from(campaignSends).where(and(eq(campaignSends.status, 'sent'), gte(campaignSends.sentAt, new Date(now().getTime() - 86400_000)))),
  ]);
  const by = Object.fromEntries(byStatus.map((r) => [r.status, r.n]));
  return c.json({
    subscribed: by.subscribed ?? 0, pending: by.pending ?? 0, unsubscribed: by.unsubscribed ?? 0,
    accounts: accountsCount, accountsNotSubscribed, sentToday, dailyLimit: s.newsletterDailyLimit,
  });
});

/**
 * People who filled in the sign-up form while it still asked them to confirm by email, and
 * never clicked the link. The form now subscribes straight away, so they join the list too.
 */
adminNewsletter.post('/subscribers/add-unconfirmed', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const rows = await db.update(subscribers)
    .set({ status: 'subscribed', consentAt: sql`coalesce(${subscribers.consentAt}, ${subscribers.createdAt})`, updatedAt: sql`now()` })
    .where(eq(subscribers.status, 'pending')).returning({ email: subscribers.email });
  await audit(c, 'subscriber.add_unconfirmed', 'subscriber', `${rows.length} people`);
  return c.json({ added: rows.length });
});

/* ---------------- Subscribers ---------------- */

const subscriberWhere = (q?: string, status?: string) => and(
  q ? or(ilike(subscribers.email, likeOf(q)), ilike(subscribers.name, likeOf(q)), ilike(subscribers.phone, likeOf(q))) : undefined,
  status ? eq(subscribers.status, status as 'subscribed') : undefined,
);

adminNewsletter.get('/subscribers', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, z.object({ q: z.string().trim().max(100).optional(), status: z.enum(['subscribed', 'pending', 'unsubscribed']).optional(), ...zPage }));
  const where = subscriberWhere(f.q, f.status);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(subscribers).where(where).orderBy(desc(subscribers.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(subscribers).where(where),
  ]);
  return c.json({ items: rows, total, page: f.page, limit: f.limit });
});

adminNewsletter.get('/subscribers/export.csv', async (c) => {
  const { db } = c.get('deps');
  const rows = await db.select().from(subscribers).orderBy(desc(subscribers.createdAt)).limit(100_000);
  return csvResponse(toCsv(rows, [['Email', (r) => r.email], ['Name', (r) => r.name], ['Mobile', (r) => r.phone], ['Status', (r) => r.status],
    ['Source', (r) => r.source], ['Consent', (r) => r.consentAt], ['Unsubscribed', (r) => r.unsubscribedAt], ['Added', (r) => r.createdAt]]), 'subscribers.csv');
});

adminNewsletter.post('/subscribers', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ email: zEmail, name: zText(120).default(''), phone: z.union([z.literal(''), zPhone]).default(''), consent: z.literal(true, { error: 'Confirm that this person agreed to receive emails' }) }));
  const r = await subscribe(deps, { email: input.email, name: input.name, phone: input.phone, source: 'admin', confirmed: true });
  await audit(c, 'subscriber.add', 'subscriber', input.email);
  return c.json(r.row, 201);
});

adminNewsletter.put('/subscribers/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db, now } = c.get('deps');
  // Status is optional: staff can unsubscribe someone, never subscribe them.
  const input = await body(c, z.object({ name: zText(120), phone: z.union([z.literal(''), zPhone]), status: z.enum(['subscribed', 'unsubscribed']).optional() }));
  const [before] = await db.select().from(subscribers).where(eq(subscribers.id, c.req.param('id')));
  if (!before) throw notFound();
  if (input.status === 'subscribed' && before.status !== 'subscribed') {
    throw new HttpError(400, 'Only the person can subscribe again (from the website), so their consent is on record.', 'needs_consent');
  }
  const [row] = await db.update(subscribers).set({
    name: input.name, phone: input.phone,
    ...(input.status === 'unsubscribed' && before.status !== 'unsubscribed' ? { status: 'unsubscribed' as const, unsubscribedAt: now() } : {}),
    updatedAt: sql`now()`,
  }).where(eq(subscribers.id, before.id)).returning();
  await audit(c, 'subscriber.update', 'subscriber', row.email, input);
  return c.json(row);
});

adminNewsletter.delete('/subscribers/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const [row] = await db.delete(subscribers).where(eq(subscribers.id, c.req.param('id'))).returning();
  if (!row) throw notFound();
  await audit(c, 'subscriber.delete', 'subscriber', row.email);
  return c.json({ ok: true });
});

/** CSV with an email column (and optional name, mobile). People who unsubscribed are never re-added. */
adminNewsletter.post('/subscribers/import', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ csv: z.string().max(5_000_000), consent: z.literal(true, { error: 'Confirm that everyone on the list agreed to receive emails' }) }));
  const rows = parseCsv(input.csv);
  let added = 0; let skipped = 0; let invalid = 0;
  for (const r of rows.slice(0, 20_000)) {
    const get = (...keys: string[]) => keys.map((k) => Object.entries(r).find(([h]) => h.trim().toLowerCase() === k)?.[1]).find(Boolean) ?? '';
    const email = zEmail.safeParse(get('email', 'email address', 'e-mail'));
    if (!email.success) { invalid++; continue; }
    const phone = zPhone.safeParse(get('mobile', 'phone', 'mobile number', 'phone number'));
    const [existing] = await deps.db.select({ status: subscribers.status }).from(subscribers).where(eq(subscribers.email, email.data));
    if (existing?.status === 'unsubscribed' || existing?.status === 'subscribed') { skipped++; continue; }
    await subscribe(deps, { email: email.data, name: get('name', 'full name'), phone: phone.success ? phone.data : '', source: 'import', confirmed: true });
    added++;
  }
  await audit(c, 'subscriber.import', 'subscriber', `${added} added`, { added, skipped, invalid });
  return c.json({ added, skipped, invalid });
});

/* ---------------- Signed-up accounts ---------------- */

adminNewsletter.get('/accounts', async (c) => {
  const { db } = c.get('deps');
  await syncAccounts(c.get('deps'));
  const f = query(c, z.object({ q: z.string().trim().max(100).optional(), ...zPage }));
  const where = f.q ? or(ilike(accounts.email, likeOf(f.q)), ilike(accounts.name, likeOf(f.q)), ilike(accounts.phone, likeOf(f.q))) : undefined;
  const [rows, [{ total }]] = await Promise.all([
    db.select({ a: accounts, newsletter: subscribers.status }).from(accounts).leftJoin(subscribers, eq(subscribers.email, accounts.email))
      .where(where).orderBy(desc(accounts.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(accounts).where(where),
  ]);
  return c.json({ items: rows.map((r) => ({ ...r.a, newsletter: r.newsletter ?? null })), total, page: f.page, limit: f.limit });
});

adminNewsletter.get('/accounts/export.csv', async (c) => {
  const { db } = c.get('deps');
  await syncAccounts(c.get('deps'));
  const rows = await db.select().from(accounts).orderBy(desc(accounts.createdAt)).limit(100_000);
  return csvResponse(toCsv(rows, [['Email', (r) => r.email], ['Name', (r) => r.name], ['Mobile', (r) => r.phone], ['Signed up', (r) => r.createdAt], ['Last seen', (r) => r.lastSeenAt]]), 'accounts.csv');
});

/* ---------------- Campaigns ---------------- */

const zCampaign = z.object({
  subject: z.string().trim().min(3, 'Add a subject line').max(150),
  preheader: zText(200).default(''),
  heading: zText(150).default(''),
  body: zText(20_000).default(''),
  ctaLabel: zText(60).default(''),
  ctaUrl: z.union([z.literal(''), z.url({ protocol: /^https?$/, error: 'Enter a full link starting with https://' })]).default(''),
  productIds: z.array(z.uuid()).max(12).default([]),
});

adminNewsletter.get('/campaigns', async (c) => {
  const { db } = c.get('deps');
  return c.json({ items: await db.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(200) });
});

adminNewsletter.post('/campaigns', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zCampaign);
  const [row] = await db.insert(campaigns).values({ ...input, createdBy: c.get('admin').email }).returning();
  await audit(c, 'campaign.create', 'campaign', row.subject);
  return c.json(row, 201);
});

/** A draft announcing a book, filled in from its product page. */
adminNewsletter.post('/campaigns/from-product/:productId{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const [p] = await db.select().from(products).where(eq(products.id, c.req.param('productId')));
  if (!p) throw notFound('Product not found');
  const kinds = (await db.select({ kind: productVariants.kind }).from(productVariants)
    .where(and(eq(productVariants.productId, p.id), eq(productVariants.active, true)))).map((v) => v.kind);
  const formats = kinds.includes('print') && kinds.includes('digital') ? 'as a printed book and an e-book'
    : kinds.includes('digital') ? 'as an e-book, ready to read straight away' : 'as a printed book, delivered across India';
  const [row] = await db.insert(campaigns).values({
    subject: `New from Elden: ${p.title}`,
    preheader: p.blurb.slice(0, 140),
    heading: `Just published: ${p.title}`,
    body: `${p.blurb}\n\nAvailable now ${formats}.`,
    ctaLabel: 'See the book', ctaUrl: `${c.get('deps').env.SITE_URL.replace(/\/$/, '')}/books/${p.slug}`,
    productIds: [p.id], createdBy: c.get('admin').email,
  }).returning();
  await audit(c, 'campaign.create', 'campaign', row.subject);
  return c.json(row, 201);
});

async function loadCampaign(c: Context<AppEnv>) {
  const [row] = await c.get('deps').db.select().from(campaigns).where(eq(campaigns.id, c.req.param('id') ?? ''));
  if (!row) throw notFound('Campaign not found');
  return row;
}

adminNewsletter.get('/campaigns/:id{[0-9a-f-]{36}}', async (c) => c.json(await loadCampaign(c)));

adminNewsletter.put('/campaigns/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const before = await loadCampaign(c);
  if (!['draft', 'scheduled'].includes(before.status)) throw new HttpError(409, 'This campaign has been sent and can’t be changed.', 'locked');
  const input = await body(c, zCampaign);
  const [row] = await db.update(campaigns).set({ ...input, updatedAt: sql`now()` }).where(eq(campaigns.id, before.id)).returning();
  return c.json(row);
});

adminNewsletter.delete('/campaigns/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const row = await loadCampaign(c);
  if (row.status === 'sending' || row.status === 'sent') throw new HttpError(409, 'Sent campaigns are kept for your records.', 'locked');
  await db.delete(campaigns).where(eq(campaigns.id, row.id));
  await audit(c, 'campaign.delete', 'campaign', row.subject);
  return c.json({ ok: true });
});

/** The email as a subscriber will see it, from the editor's unsaved content (live preview). */
adminNewsletter.post('/campaigns/preview', async (c) => {
  const input = await body(c, zCampaign.extend({ subject: z.string().max(150).default('') }));
  const { html } = await renderCampaign(c.get('deps'), input, { email: 'preview@example.com', name: c.get('admin').name || 'Asha Verma' });
  return c.json({ html });
});

adminNewsletter.post('/campaigns/:id{[0-9a-f-]{36}}/test', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const row = await loadCampaign(c);
  const input = await body(c, z.object({ to: zEmail.optional() }));
  const to = input.to ?? c.get('admin').email;
  const s = await getSettings(deps.db);
  const catalog = row.productIds.length ? (await loadCatalog(deps.db, deps.storage)).items : [];
  await sendCampaignTo(deps, row, { email: to, name: c.get('admin').name || '' }, s, catalog, true);
  return c.json({ ok: true, to });
});

adminNewsletter.post('/campaigns/:id{[0-9a-f-]{36}}/schedule', requireRole('manager'), async (c) => {
  const { db, now } = c.get('deps');
  const row = await loadCampaign(c);
  const input = await body(c, z.object({ at: z.iso.datetime({ offset: true }) }));
  if (!['draft', 'scheduled'].includes(row.status)) throw new HttpError(409, 'This campaign has already been sent.', 'locked');
  if (new Date(input.at) <= now()) throw new HttpError(400, 'Pick a time in the future.');
  const [updated] = await db.update(campaigns).set({ status: 'scheduled', scheduledAt: new Date(input.at), updatedAt: sql`now()` }).where(eq(campaigns.id, row.id)).returning();
  await audit(c, 'campaign.schedule', 'campaign', row.subject, input);
  return c.json(updated);
});

adminNewsletter.post('/campaigns/:id{[0-9a-f-]{36}}/send', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const row = await loadCampaign(c);
  const [{ n }] = await deps.db.select({ n: count() }).from(subscribers).where(eq(subscribers.status, 'subscribed'));
  if (!n) throw new HttpError(400, 'There are no subscribers yet.', 'no_recipients');
  const started = await startCampaign(deps, row.id);
  if (!started) throw new HttpError(409, 'This campaign has already been sent.', 'locked');
  await audit(c, 'campaign.send', 'campaign', row.subject, { recipients: started.recipients });
  await kickSender(deps);
  return c.json(started);
});

/** Send the next batch now. The cron does this every 5 minutes; an open campaign page also calls it. */
adminNewsletter.post('/process', requireRole('manager'), async (c) => c.json(await processNewsletter(c.get('deps'))));

/** Stop a scheduled campaign (back to draft) or a campaign that is still sending. */
adminNewsletter.post('/campaigns/:id{[0-9a-f-]{36}}/cancel', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const row = await loadCampaign(c);
  if (row.status === 'scheduled') {
    const [u] = await db.update(campaigns).set({ status: 'draft', scheduledAt: null, updatedAt: sql`now()` }).where(eq(campaigns.id, row.id)).returning();
    return c.json(u);
  }
  if (row.status !== 'sending') throw new HttpError(409, 'Only scheduled or sending campaigns can be stopped.');
  await db.update(campaignSends).set({ status: 'skipped' }).where(and(eq(campaignSends.campaignId, row.id), inArray(campaignSends.status, ['queued'])));
  const [u] = await db.update(campaigns).set({ status: 'cancelled', updatedAt: sql`now()` }).where(eq(campaigns.id, row.id)).returning();
  await audit(c, 'campaign.cancel', 'campaign', row.subject);
  return c.json(u);
});
