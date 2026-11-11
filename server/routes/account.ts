// Customer accounts: Google sign-in through Supabase Auth. Orders and e-books
// belong to an account through the verified email address used at checkout.
// Staff access is separate (admin_users allow-list), so a customer account
// never reaches the admin.
import { createHash } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { zSource } from './store.js';
import { orderChannel } from '../../src/shared/attribution.js';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { accounts, competitionSignups, orderItems, orders, subscribers, teamApplications, teamMembers } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit, zPhone } from '../lib/http.js';
import { isStateCode, stateName } from '../lib/states.js';
import { findCompetition, personName } from '../../src/shared/competitions.js';
import { missingFields, todayIST } from '../../src/shared/profile.js';
import { ageOn, applicationCode, STATUS_TEXT } from '../../src/shared/teams.js';
import { getSettings } from '../services/catalog.js';
import { subscribe, subscribeNewAccount, unsubscribe } from '../services/newsletter.js';
import { orderToken } from '../services/orders.js';
import { metaAllowed, report, visitOf } from '../services/tracking.js';
import { verifySupabaseToken } from './admin/auth.js';
import { orderStatusLabel } from './orders.js';
import { downloadLimit, downloadName, ebookAwaitsDelivery, fileLabel, filesForItems } from '../services/ebooks.js';
import { SIGNUP_EVENT, signupEventId, signupParams } from '../../src/shared/metaEvents.js';

export interface Customer { userId: string; email: string; name: string; avatar: string | null }

/** Local development only (never on Vercel): "Bearer dev-customer:someone@example.com". */
const DEV_PREFIX = 'dev-customer:';

/** The signed-in customer, or null when the request carries no sign-in at all. Throws for a bad one. */
export async function readCustomer(c: Context<AppEnv>): Promise<Customer | null> {
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) return null;
  await requireCustomer(c, async () => {});
  return c.get('customer');
}

export const requireCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { env } = c.get('deps');
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  if (env.devAdmin && token.startsWith(DEV_PREFIX)) {
    const email = token.slice(DEV_PREFIX.length).toLowerCase();
    const h = createHash('sha256').update(email).digest('hex');
    c.set('customer', { userId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, email, name: 'Developer', avatar: null });
    return next();
  }
  if (!env.SUPABASE_URL) throw new HttpError(503, 'Sign-in is not configured.', 'auth_unconfigured');
  let claims: Awaited<ReturnType<typeof verifySupabaseToken>>;
  try {
    claims = await verifySupabaseToken(token, env.SUPABASE_URL, env.SUPABASE_JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated');
  }
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const app = (claims.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  // Orders are matched by email, so the address must be proven: Google accounts are, others once confirmed.
  const verified = app.provider === 'google' || Boolean(app.providers?.includes('google')) || meta.email_verified === true;
  const email = String(claims.email ?? '').toLowerCase();
  if (!email || !verified) throw new HttpError(403, 'Please confirm your email address first.', 'email_unverified');
  c.set('customer', {
    userId: String(claims.sub),
    email,
    name: String(meta.full_name ?? meta.name ?? ''),
    avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : typeof meta.picture === 'string' ? meta.picture : null,
  });
  await next();
};

export const account = new Hono<AppEnv>();

/** A first visit that is a real sign-up (not an older account opening the page for the first time). */
async function justSignedUp(deps: AppEnv['Variables']['deps'], userId: string) {
  const user = deps.authUser ? await deps.authUser(userId).catch(() => null) : null;
  return !user || deps.now().getTime() - user.createdAt.getTime() < 24 * 3600_000;
}
account.use('*', requireCustomer);

const OWNED = ['paid', 'partially_refunded', 'refunded'] as const;

/** The X-Visit-Source header: the browser's remembered visit (JSON), or null if missing or malformed. */
function visitHeader(raw: string | undefined) {
  if (!raw || raw.length > 4000) return null;
  try {
    const v = zSource.parse(JSON.parse(raw));
    return v && (v.first || v.last) ? v : null;
  } catch { return null; }
}

/** Everything for the account page: profile, orders and the e-book / journal library. */
account.get('/', async (c) => {
  const deps = c.get('deps');
  const { db, env, now } = deps;
  const me = c.get('customer');
  // Remember everyone who signs in (with the mobile number they add below).
  const [known] = await db.select({ userId: accounts.userId }).from(accounts).where(eq(accounts.userId, me.userId));
  // How they reached the site (their browser sends what it remembered): kept from the first time it's known.
  const visit = visitHeader(c.req.header('x-visit-source'));
  const origin = visit ? { source: visit, channel: orderChannel(visit).channel, channelDetail: orderChannel(visit).detail.slice(0, 120) } : {};
  const [profile] = await db.insert(accounts).values({ userId: me.userId, email: me.email, name: me.name, avatarUrl: me.avatar, ...origin })
    .onConflictDoUpdate({
      target: accounts.userId,
      set: {
        email: me.email, name: me.name, avatarUrl: me.avatar, lastSeenAt: now(),
        ...(visit ? { source: sql`coalesce(${accounts.source}, ${JSON.stringify(visit)}::jsonb)`, channel: sql`case when ${accounts.channel} = '' then ${origin.channel} else ${accounts.channel} end`, channelDetail: sql`case when ${accounts.channel} = '' then ${origin.channelDetail} else ${accounts.channelDetail} end` } : {}),
      },
    })
    .returning();
  // First sign-in: a new account also joins the newsletter (the sign-in page says so). Meta's
  // AccountSignup isn't sent here: it waits for the profile (PUT /profile), so a student's age is
  // known first. Competition registrations are the CompleteRegistration events, not sign-ups.
  const newAccount = !known && await justSignedUp(deps, me.userId);
  // Every account is on the newsletter from sign-up (unless they unsubscribed).
  await subscribeNewAccount(deps, me, c.get('ip'), visit);
  const [sub] = await db.select({ status: subscribers.status }).from(subscribers).where(eq(subscribers.email, me.email));
  const s = await getSettings(db);
  const mine = await db.select().from(orders).where(and(ownedBy(me.email), inArray(orders.paymentStatus, OWNED)))
    .orderBy(desc(orders.createdAt)).limit(200);
  const items = mine.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, mine.map((o) => o.id))) : [];
  const files = await filesForItems(db, items);
  const token = (id: string) => orderToken(env.ORDER_LINK_SECRET, id);

  const library = new Map<string, unknown>();
  for (const o of mine) {
    if (o.paymentStatus === 'refunded' || o.cancelledAt || !o.paidAt) continue;
    const expiresAt = s.downloadExpiryDays > 0 ? new Date(o.paidAt.getTime() + s.downloadExpiryDays * 86400_000) : null;
    for (const i of items.filter((x) => x.orderId === o.id && (files.get(x.id)?.length ?? 0) > 0)) {
      const key = i.productId ?? i.id;
      if (library.has(key)) continue; // newest purchase of a title wins (orders are newest first)
      // Cash on delivery: the free e-book unlocks once the books are delivered.
      const awaitingDelivery = ebookAwaitsDelivery(o);
      const open = !awaitingDelivery && (!expiresAt || expiresAt > now());
      const fs = files.get(i.id) ?? [];
      const limit = downloadLimit(s, fs.length);
      const canDownload = open && i.downloadsUsed < limit;
      library.set(key, {
        itemId: i.id, productId: i.productId, title: i.title, format: i.formatLabel,
        orderNumber: o.number, purchasedAt: o.paidAt, expiresAt,
        downloadsLeft: Math.max(0, limit - i.downloadsUsed),
        canRead: open && fs.length > 0,
        awaitingDelivery,
        // Downloads go through POST /account/library/:itemId/download (signed in), never a shareable link.
        canDownload: canDownload && fs.length > 0,
        files: fs.map((f, k) => ({ index: k, label: fileLabel(f, k, fs.length), canDownload })),
      });
    }
  }

  const signups = await db.select().from(competitionSignups).where(eq(competitionSignups.userId, me.userId))
    .orderBy(desc(competitionSignups.createdAt)).limit(100);
  // Teams this person registered, or is a member of (by their Google email).
  const asMember = await db.selectDistinct({ id: teamMembers.applicationId }).from(teamMembers).where(eq(teamMembers.email, me.email.toLowerCase()));
  const teamApps = await db.select().from(teamApplications)
    .where(or(eq(teamApplications.userId, me.userId), asMember.length ? inArray(teamApplications.id, asMember.map((x) => x.id)) : sql`false`))
    .orderBy(desc(teamApplications.createdAt)).limit(50);

  return c.json({
    customer: me,
    newAccount,
    profile: profileOf(profile, now()),
    // Whether this account may be sent to Meta at all (a student under META_MIN_AGE, or with no date of birth: no).
    meta: { allowed: metaAllowed(deps, profile) },
    competitions: signups.map((x) => ({
      id: x.id, slug: x.competitionSlug, title: findCompetition(x.competitionSlug)?.title ?? x.competitionSlug, mode: x.mode, groupName: x.groupName,
      people: x.participants.map(personName), createdAt: x.createdAt,
    })),
    teams: teamApps.map((x) => {
      const comp = findCompetition(x.competitionSlug);
      return {
        id: x.id, slug: x.competitionSlug, title: comp?.title ?? x.competitionSlug, teamName: x.teamName, status: x.status, statusText: STATUS_TEXT[x.status] ?? x.status,
        code: comp?.team ? applicationCode(comp.team, x.applicationNo) : String(x.applicationNo), createdAt: x.createdAt,
      };
    }),
    newsletter: sub?.status ?? null,
    orders: mine.map((o) => ({
      number: o.number, createdAt: o.createdAt, status: orderStatusLabel(o), total: o.total, invoice: o.invoiceNumber,
      requiresShipping: o.requiresShipping, token: token(o.id),
      items: items.filter((i) => i.orderId === o.id).map((i) => ({ title: i.title, format: i.formatLabel, quantity: i.quantity })),
    })),
    library: [...library.values()],
  });
});

/** Orders this account may see: placed with its email, or given to it by staff (ebook_email). */
const ownedBy = (email: string) => or(sql`lower(${orders.email}) = ${email.toLowerCase()}`, sql`lower(${orders.ebookEmail}) = ${email.toLowerCase()}`)!;

/** One purchased e-book of this account, checked: paid, not cancelled, unlocked, not expired. */
async function libraryFile(c: Context<AppEnv>) {
  const { db, now } = c.get('deps');
  const me = c.get('customer');
  const s = await getSettings(db);
  const [row] = await db.select({ item: orderItems, order: orders }).from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, c.req.param('itemId') ?? ''), ownedBy(me.email), inArray(orders.paymentStatus, ['paid', 'partially_refunded'])));
  if (!row || row.order.cancelledAt || !row.order.paidAt) throw notFound('This e-book isn’t in your library.');
  if (ebookAwaitsDelivery(row.order)) throw new HttpError(403, 'Your free e-book unlocks once your books are delivered.', 'awaiting_delivery');
  if (s.downloadExpiryDays > 0 && row.order.paidAt.getTime() + s.downloadExpiryDays * 86400_000 < now().getTime()) {
    throw new HttpError(410, 'Access to this e-book has expired. Please contact us.');
  }
  // ?f= picks one of the e-book's files (0 = the first).
  const fs = (await filesForItems(db, [row.item])).get(row.item.id) ?? [];
  const index = Math.max(0, Number.parseInt(c.req.query('f') ?? '0', 10) || 0);
  const file = fs[index];
  if (!file) throw new HttpError(404, 'This e-book file is not available. Please contact us.');
  return { ...row, fs, file, index, s };
}

/** Open a purchased e-book in the browser's reader: a short-lived link, not counted as a download. */
account.post('/library/:itemId/read', async (c) => {
  const { db, storage } = c.get('deps');
  await rateLimit(db, `read:${c.get('customer').email}`, 60, 3600);
  const { file } = await libraryFile(c);
  return c.json({ url: await storage.signedDownloadUrl('ebooks', file.path, 300) });
});

/**
 * Download a purchased e-book: only here, signed in to the account the order belongs to.
 * Counts towards the download limit; the link it returns works for five minutes.
 */
account.post('/library/:itemId/download', async (c) => {
  const { db, storage } = c.get('deps');
  await rateLimit(db, `download:${c.get('customer').email}`, 30, 3600);
  const { item: found, fs, file, index, s } = await libraryFile(c);
  const [item] = await db.update(orderItems)
    .set({ downloadsUsed: sql`${orderItems.downloadsUsed} + 1` })
    .where(and(eq(orderItems.id, found.id), sql`${orderItems.downloadsUsed} < ${downloadLimit(s, fs.length)}`))
    .returning();
  if (!item) throw new HttpError(403, 'Download limit reached for this e-book. Please contact us if you need more.');
  return c.json({ url: await storage.signedDownloadUrl('ebooks', file.path, 300, downloadName(file, index, fs.length, item.title)) });
});

const ACCOUNT_TYPES = ['student', 'parent', 'teacher', 'other'] as const;
type AccountRow = typeof accounts.$inferSelect;
/** The profile, with what's still missing for this kind of person (see src/shared/profile.ts). */
export function profileOf(a: AccountRow, now = new Date()) {
  const values = {
    type: a.accountType, fullName: a.fullName, phone: a.phone, city: a.city, state: a.state, dob: a.dob,
    institutionType: a.institutionType, institutionName: a.institutionName, grade: a.grade,
    guardianName: a.guardianName, guardianPhone: a.guardianPhone, instagram: a.instagram,
  };
  const missing = missingFields(values, todayIST(now));
  return { ...values, stateName: stateName(a.state), missing, completed: missing.length === 0 };
}

const optional = (max: number) => z.string().trim().max(max).optional();
/** Save the profile: just the mobile number (the quick prompt), some fields, or all of them. Empty values aren't saved over details already given. */
account.put('/profile', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const me = c.get('customer');
  const input = await body(c, z.object({
    phone: zPhone.optional(),
    fullName: z.string().trim().min(2, 'Add your full name').max(80).optional(),
    city: z.string().trim().min(2, 'Add your city or town').max(60).optional(),
    state: z.string().refine(isStateCode, 'Choose your state').optional(),
    type: z.enum(ACCOUNT_TYPES, { error: 'Choose who you are' }).optional(),
    dob: z.iso.date('Add a real date of birth').refine((d) => { const a = ageOn(d, todayIST(now())); return a !== null && a >= 4 && a <= 100; }, 'Check the date of birth').optional(),
    institutionType: z.enum(['school', 'college', 'other'], { error: 'Choose school, college or other' }).optional(),
    institutionName: optional(120),
    grade: optional(40),
    guardianName: optional(80),
    guardianPhone: z.union([z.literal(''), zPhone]).optional(),
    instagram: z.union([z.literal(''), z.string().trim().regex(/^@?[A-Za-z0-9._]{1,30}$/, 'Check the Instagram username')]).optional(),
  }));
  const [before] = await db.select().from(accounts).where(eq(accounts.userId, me.userId));
  const set: Partial<typeof accounts.$inferInsert> = { updatedAt: now() };
  for (const k of ['phone', 'fullName', 'city', 'state', 'dob', 'institutionType', 'institutionName', 'grade', 'guardianName', 'guardianPhone'] as const) {
    if (input[k] !== undefined && input[k] !== '') (set as Record<string, unknown>)[k] = input[k];
  }
  if (input.instagram !== undefined) set.instagram = input.instagram.replace(/^@/, '');
  if (input.type !== undefined) set.accountType = input.type;
  const [row] = await db.update(accounts).set(set).where(eq(accounts.userId, me.userId)).returning();
  if (!row) throw notFound('Account not found');
  const p = profileOf(row, now());
  if (p.completed && !row.onboardingCompletedAt) await db.update(accounts).set({ onboardingCompletedAt: now() }).where(eq(accounts.userId, me.userId));
  if (input.phone) await db.update(subscribers).set({ phone: input.phone, updatedAt: sql`now()` }).where(eq(subscribers.email, me.email));
  // Meta AccountSignup: once, on the save that first says who this is (the account type, and a
  // student's date of birth), and only if the account may be sent to Meta (metaAllowed). The
  // page fires the Pixel's twin with the id returned here.
  const allowed = metaAllowed(deps, row);
  const signup = Boolean(before) && !identified(before) && identified(row) && allowed;
  if (signup) {
    const visit = visitOf(c);
    await report(deps, visit.consent, {
      name: SIGNUP_EVENT, eventId: signupEventId(me.userId), time: now(), url: `${deps.env.SITE_URL}/account`,
      user: { ...visit, email: me.email, phone: row.phone || null, name: row.fullName || me.name, externalId: me.email }, custom: signupParams(),
    });
  }
  return c.json({ ...p, meta: { allowed, signupEventId: signup ? signupEventId(me.userId) : null } });
});

/** Has the account said who it is: its type, and for a student their date of birth (needed for the Meta rule)? */
const identified = (a: AccountRow) => a.accountType !== null && (a.accountType !== 'student' || Boolean(a.dob));

/** Newsletter on / off. A signed-in Google account has a proven email, so no confirmation email is needed. */
account.put('/newsletter', async (c) => {
  const deps = c.get('deps');
  const me = c.get('customer');
  const input = await body(c, z.object({ subscribed: z.boolean() }));
  if (input.subscribed) {
    const [profile] = await deps.db.select().from(accounts).where(eq(accounts.userId, me.userId));
    await subscribe(deps, { email: me.email, name: me.name, phone: profile?.phone, source: 'account', ip: c.get('ip') });
  } else {
    await unsubscribe(deps, me.email);
  }
  return c.json({ newsletter: input.subscribed ? 'subscribed' : 'unsubscribed' });
});
