// The newsletter: double opt-in subscriptions, campaigns, and a batch sender
// that works within the mailbox's daily limit. Every email carries a personal
// unsubscribe link and one-click unsubscribe headers (RFC 8058).
import { and, asc, count, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { PAL } from '../../src/data.js';
import type { Deps } from '../deps.js';
import { campaigns, campaignSends, subscribers } from '../db/schema.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';
import { esc, inr } from '../lib/format.js';
import { sendSafely } from '../lib/mail.js';
import { getSettings, loadCatalog, type CatalogItem, type Settings } from './catalog.js';
import { ACCENT, FONT, INK, LINE, MUTED, button, label, layout, p, section } from './emails.js';

export type Subscriber = typeof subscribers.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;

/** Recipients handled per run of the sender (it runs every few minutes). */
export const BATCH = 40;

export const newsletterToken = (secret: string, email: string) =>
  Buffer.from(hmacHex(secret, 'newsletter:' + email.toLowerCase()), 'hex').toString('base64url');
export const checkNewsletterToken = (secret: string, email: string, token: string | undefined) =>
  Boolean(token) && safeEqual(newsletterToken(secret, email), token!);

const site = (deps: Deps) => deps.env.SITE_URL.replace(/\/$/, '');
const qs = (deps: Deps, email: string) => `e=${encodeURIComponent(email)}&t=${newsletterToken(deps.env.ORDER_LINK_SECRET, email)}`;
export const unsubscribePage = (deps: Deps, email: string) => `${site(deps)}/newsletter?unsubscribe=1&${qs(deps, email)}`;
const oneClickUrl = (deps: Deps, email: string) => `${site(deps)}/api/newsletter/unsubscribe?${qs(deps, email)}`;

/**
 * Add someone to the list. `confirmed` (signed-in Google account, or a paid
 * order with the box ticked) subscribes at once; otherwise they get an email
 * with a confirmation link first.
 */
export async function subscribe(deps: Deps, input: { email: string; name?: string; phone?: string; source: string; ip?: string | null; confirmed: boolean }) {
  const { db, now } = deps;
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select().from(subscribers).where(eq(subscribers.email, email));
  const details = {
    ...(input.name ? { name: input.name } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    updatedAt: sql`now()`,
  };
  if (existing?.status === 'subscribed') {
    await db.update(subscribers).set(details).where(eq(subscribers.id, existing.id));
    return { status: 'subscribed' as const, row: existing };
  }
  const status = input.confirmed ? 'subscribed' as const : 'pending' as const;
  const values = {
    ...details,
    status,
    source: input.source,
    consentAt: input.confirmed ? now() : null,
    consentIp: input.ip ?? null,
    unsubscribedAt: null,
  };
  const [row] = existing
    ? await db.update(subscribers).set(values).where(eq(subscribers.id, existing.id)).returning()
    : await db.insert(subscribers).values({ email, name: input.name ?? '', phone: input.phone ?? '', ...values }).returning();
  if (status === 'pending') await sendConfirmation(deps, row, await getSettings(db));
  return { status, row };
}

export async function confirmSubscription(deps: Deps, email: string, token: string, ip: string | null) {
  if (!checkNewsletterToken(deps.env.ORDER_LINK_SECRET, email, token)) return false;
  const [row] = await deps.db.update(subscribers)
    .set({ status: 'subscribed', consentAt: deps.now(), consentIp: ip, unsubscribedAt: null, updatedAt: sql`now()` })
    .where(and(eq(subscribers.email, email.toLowerCase()), inArray(subscribers.status, ['pending', 'subscribed'])))
    .returning();
  return Boolean(row);
}

export async function unsubscribe(deps: Deps, email: string) {
  await deps.db.update(subscribers)
    .set({ status: 'unsubscribed', unsubscribedAt: deps.now(), updatedAt: sql`now()` })
    .where(and(eq(subscribers.email, email.toLowerCase()), inArray(subscribers.status, ['pending', 'subscribed'])));
}

async function sendConfirmation(deps: Deps, sub: Subscriber, s: Settings) {
  const link = `${site(deps)}/newsletter?confirm=1&${qs(deps, sub.email)}`;
  await sendSafely(deps.mailer, {
    to: sub.email,
    subject: `Confirm your subscription to ${s.storeName}`,
    replyTo: s.supportEmail,
    html: layout(deps, s, {
      preheader: 'One click to start getting new books, free papers and offers.',
      kicker: 'Almost there',
      title: 'Confirm your email.',
      intro: 'Tap the button to start getting news of new books, free study material and offers, once or twice a month.',
      body: section(`${button(link, 'Yes, subscribe me')}${p('<br>If you didn’t ask for this, ignore this email and you won’t hear from us.', 'font-size:13px')}`, '4px 32px 32px'),
    }),
  });
}

/**
 * A new customer account (first Google sign-in; the caller checks it's really new) joins the newsletter, as the sign-in page
 * says, and gets a welcome email with an unsubscribe link. Anyone who unsubscribed
 * before stays unsubscribed. Never throws: the account page must always load.
 */
export async function subscribeNewAccount(deps: Deps, who: { email: string; name: string }, ip: string | null) {
  try {
    const email = who.email.toLowerCase();
    const [existing] = await deps.db.select({ status: subscribers.status }).from(subscribers).where(eq(subscribers.email, email));
    if (existing?.status === 'subscribed' || existing?.status === 'unsubscribed') return;
    const { row } = await subscribe(deps, { email, name: who.name, source: 'signup', ip, confirmed: true });
    const welcome = sendWelcome(deps, row, await getSettings(deps.db));
    if (deps.defer) deps.defer(welcome); else await welcome;
  } catch (e) {
    console.error('[newsletter] sign-up subscription failed', (e as Error).message);
  }
}

async function sendWelcome(deps: Deps, sub: Subscriber, s: Settings) {
  const first = sub.name.split(' ')[0];
  const unsubscribe = unsubscribePage(deps, sub.email);
  await sendSafely(deps.mailer, {
    to: sub.email,
    subject: `Welcome to ${s.storeName}`,
    replyTo: s.supportEmail,
    headers: {
      'List-Unsubscribe': `<${oneClickUrl(deps, sub.email)}>, <mailto:${s.supportEmail}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    html: layout(deps, s, {
      preheader: 'Your account is ready, and you’ll hear about new books first.',
      kicker: 'Welcome',
      title: 'Your account is ready.',
      intro: first ? `Hi ${esc(first)}, thanks for signing up.` : 'Thanks for signing up.',
      body: section(
        p('E-books and journals you buy are in your account, ready to read or download, along with your orders and invoices.')
        + p('You’re also on our newsletter: new books the week they’re published, free sample papers before exams, and the occasional offer, a few times a month. '
          + `Not for you? <a href="${unsubscribe}" style="color:${INK}">Unsubscribe</a> in one click, or turn it off in your account.`)
        + button(`${site(deps)}/account`, 'Go to your account'),
        '4px 32px 32px',
      ),
      unsubscribeUrl: unsubscribe,
    }),
  });
}

/* ---------------- Campaign emails ---------------- */

/** Paragraphs from plain text, with **bold** and [label](https://link). Everything else is escaped. */
export function richText(text: string) {
  return text.trim().split(/\n{2,}/).filter(Boolean).map((para) => {
    const html = esc(para)
      .replace(/\*\*(.+?)\*\*/g, `<strong style="color:${INK}">$1</strong>`)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t: string, u: string) => `<a href="${u}" style="color:${INK};text-decoration:underline">${t}</a>`)
      .replace(/\n/g, '<br>');
    return p(html, `font-size:16px;color:${INK}`);
  }).join('');
}

function bookBlock(deps: Deps, b: CatalogItem) {
  const prices = (['print', 'digital'] as const).map((k) => b.formats[k]).filter((f) => f?.available).map((f) => f!.price);
  const from = prices.length ? Math.min(...prices) : null;
  const url = `${site(deps)}/books/${b.slug}`;
  const c = PAL[b.palette] ?? PAL[0];
  const cover = b.coverUrl
    ? `<img src="${esc(b.coverUrl.startsWith('http') ? b.coverUrl : site(deps) + b.coverUrl)}" width="110" alt="" style="display:block;width:110px;height:auto;border:0">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" width="110"><tr><td style="background:${c.bg};color:${c.fg};height:150px;padding:12px;vertical-align:top;font:800 14px/1.1 ${FONT}">${esc(b.title)}</td></tr></table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE}"><tr>
<td width="126" style="padding:18px 16px 18px 0;vertical-align:top"><a href="${esc(url)}">${cover}</a></td>
<td style="padding:18px 0;vertical-align:top">
${b.category ? label(esc(b.category.name)) : ''}
<div style="margin:6px 0 4px;font:700 19px/1.2 ${FONT};color:${INK}">${esc(b.title)}</div>
${b.author ? `<div style="font:400 14px/1.4 ${FONT};color:${MUTED}">${esc(b.author)}</div>` : ''}
${b.blurb ? `<div style="margin-top:8px;font:400 14px/1.5 ${FONT};color:${MUTED}">${esc(b.blurb)}</div>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
${from !== null ? `<td style="padding-right:14px;font:700 16px/1 ${FONT};color:${INK}">${prices.length > 1 ? 'from ' : ''}${inr(from)}</td>` : ''}
<td style="background:${ACCENT}"><a href="${esc(url)}" style="display:inline-block;padding:10px 16px;font:700 13px/1 ${FONT};color:#FFFFFF;text-decoration:none">View &amp; buy &rarr;</a></td>
</tr></table></td></tr></table>`;
}

/** The campaign email for one recipient (or a preview when `to` is null). */
export type CampaignContent = Pick<Campaign, 'subject' | 'preheader' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'productIds'>;

export async function renderCampaign(deps: Deps, c: CampaignContent, to: { email: string; name: string } | null, s?: Settings, catalog?: CatalogItem[]) {
  s ??= await getSettings(deps.db);
  const items = catalog ?? (c.productIds.length ? (await loadCatalog(deps.db, deps.storage)).items : []);
  const books = c.productIds.map((id) => items.find((b) => b.id === id)).filter((b): b is CatalogItem => Boolean(b));
  const first = to?.name.split(' ')[0];
  const body = [
    c.body.trim() ? section(richText(c.body)) : '',
    books.length ? section(books.map((b) => bookBlock(deps, b)).join('') + `<div style="border-top:1px solid ${LINE}"></div>`) : '',
    c.ctaLabel && c.ctaUrl ? section(button(c.ctaUrl, c.ctaLabel), '4px 32px 32px') : '',
  ].join('');
  return {
    subject: c.subject,
    html: layout(deps, s, {
      preheader: c.preheader || c.subject,
      kicker: 'From Elden Academic Press',
      title: c.heading || c.subject,
      intro: first ? `Hi ${esc(first)},` : '',
      body,
      unsubscribeUrl: to ? unsubscribePage(deps, to.email) : `${site(deps)}/newsletter`,
    }),
  };
}

export async function sendCampaignTo(deps: Deps, c: Campaign, to: { email: string; name: string }, s: Settings, catalog: CatalogItem[], test = false) {
  const { subject, html } = await renderCampaign(deps, c, to, s, catalog);
  await deps.mailer.send({
    to: to.email,
    subject: test ? `[Test] ${subject}` : subject,
    html,
    replyTo: s.supportEmail,
    headers: test ? undefined : {
      'List-Unsubscribe': `<${oneClickUrl(deps, to.email)}>, <mailto:${s.supportEmail}?subject=unsubscribe>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      Precedence: 'bulk',
    },
  });
}

/* ---------------- Sending ---------------- */

/** Freeze the recipient list (everyone subscribed right now) and start sending. */
export async function startCampaign(deps: Deps, id: string) {
  return deps.db.transaction(async (tx) => {
    const [c] = await tx.update(campaigns).set({ status: 'sending', startedAt: deps.now(), updatedAt: sql`now()` })
      .where(and(eq(campaigns.id, id), inArray(campaigns.status, ['draft', 'scheduled']))).returning();
    if (!c) return null;
    await tx.execute(sql`insert into campaign_sends (campaign_id, subscriber_id)
      select ${id}::uuid, id from subscribers where status = 'subscribed' on conflict do nothing`);
    const [{ n }] = await tx.select({ n: count() }).from(campaignSends).where(eq(campaignSends.campaignId, id));
    const [row] = await tx.update(campaigns).set({ recipients: n }).where(eq(campaigns.id, id)).returning();
    return row;
  });
}

/**
 * One run of the sender (cron every 5 minutes, and right after "Send now"):
 * starts due scheduled campaigns, then sends the next batch within the daily limit.
 */
export async function processNewsletter(deps: Deps, batch = BATCH, timeBudgetMs = 20_000) {
  const { db, now } = deps;
  const started = Date.now();
  const due = await db.select({ id: campaigns.id }).from(campaigns)
    .where(and(eq(campaigns.status, 'scheduled'), sql`${campaigns.scheduledAt} <= ${now()}`));
  for (const c of due) await startCampaign(deps, c.id);

  const s = await getSettings(db);
  const [{ sentToday }] = await db.select({ sentToday: count() }).from(campaignSends)
    .where(and(eq(campaignSends.status, 'sent'), gte(campaignSends.sentAt, new Date(now().getTime() - 86400_000))));
  const budget = Math.max(0, Math.min(batch, s.newsletterDailyLimit - sentToday));
  let sent = 0;
  let failed = 0;

  // People who unsubscribed after a campaign started don't get it.
  await db.update(campaignSends).set({ status: 'skipped' }).where(and(eq(campaignSends.status, 'queued'),
    inArray(campaignSends.subscriberId, db.select({ id: subscribers.id }).from(subscribers).where(ne(subscribers.status, 'subscribed')))));

  if (budget > 0) {
    const queue = await db.select({ send: campaignSends, sub: subscribers, campaign: campaigns }).from(campaignSends)
      .innerJoin(campaigns, eq(campaigns.id, campaignSends.campaignId))
      .innerJoin(subscribers, eq(subscribers.id, campaignSends.subscriberId))
      .where(and(eq(campaignSends.status, 'queued'), eq(campaigns.status, 'sending'), eq(subscribers.status, 'subscribed')))
      .orderBy(asc(campaignSends.createdAt)).limit(budget);
    const catalog = queue.some((q) => q.campaign.productIds.length) ? (await loadCatalog(db, deps.storage)).items : [];
    for (const { send, sub, campaign } of queue) {
      // Stay well inside the function's time limit; the next run picks up the rest.
      if (Date.now() - started > timeBudgetMs) break;
      if (sub.status !== 'subscribed') {
        await db.update(campaignSends).set({ status: 'skipped' }).where(eq(campaignSends.id, send.id));
        continue;
      }
      // Claim the row first, so an overlapping run (cron + "Send now") never emails anyone twice.
      const [claimed] = await db.update(campaignSends).set({ status: 'sent', sentAt: now() })
        .where(and(eq(campaignSends.id, send.id), eq(campaignSends.status, 'queued'))).returning({ id: campaignSends.id });
      if (!claimed) continue;
      try {
        await sendCampaignTo(deps, campaign, sub, s, catalog);
        sent++;
      } catch (e) {
        await db.update(campaignSends).set({ status: 'failed', error: (e as Error).message.slice(0, 500) }).where(eq(campaignSends.id, send.id));
        failed++;
      }
    }
  }

  // Refresh totals and close campaigns with nothing left to send.
  const active = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.status, 'sending'));
  for (const { id } of active) {
    const rows = await db.select({ status: campaignSends.status, n: count() }).from(campaignSends).where(eq(campaignSends.campaignId, id)).groupBy(campaignSends.status);
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n])) as Partial<Record<'queued' | 'sent' | 'failed' | 'skipped', number>>;
    await db.update(campaigns).set({
      sentCount: by.sent ?? 0, failedCount: by.failed ?? 0, updatedAt: sql`now()`,
      ...(by.queued ? {} : { status: 'sent' as const, sentAt: now() }),
    }).where(eq(campaigns.id, id));
  }
  return { sent, failed, budgetLeft: Math.max(0, s.newsletterDailyLimit - sentToday - sent) };
}

/** Background "Send now": the first batch goes out straight away. */
export function kickSender(deps: Deps) {
  const run = processNewsletter(deps).catch((e) => console.error('[newsletter] send failed', (e as Error).message));
  if (deps.defer) deps.defer(run); else return run;
}

