// WhatsApp messages (Admin → WhatsApp), sent from the business number through Meta's Cloud API.
//
// Only to people who agreed: a checkout with "Elden Academic Press may call or WhatsApp me about
// this order" ticked (cart reminder, order updates, after a voice call), or a newsletter
// subscriber who ticked "Subscribe to calls" (new books). Never to a number that replied STOP,
// and never while the master switch is off. Every message is a row in whatsapp_messages: queued
// here, sent by processWhatsApp (right away, and by the cron every 10 minutes), and updated by
// Meta's webhook (delivered, read, failed). Customers' own messages land in the same table: the inbox.
import { randomBytes } from 'node:crypto';
import { and, asc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q } from '../db/client.js';
import { checkoutLeads, orders, subscribers, whatsappMessages, whatsappOptOuts, whatsappSettings } from '../db/schema.js';
import { inr } from '../lib/format.js';
import { parseWebhook, type WaIncoming, type WaStatusUpdate } from '../lib/whatsapp.js';
import { callableNumber } from '../../src/shared/calls.js';
import {
  DEFAULT_WA_SETTINGS, WA_DAY, WA_REPLY_WINDOW_MS, WA_START, WA_STOP, WA_TEMPLATES, type WaKind, type WaStatus, type WaTemplateKey, type WhatsAppSettings,
} from '../../src/shared/whatsapp.js';
import { orderLink, type Order } from './orders.js';

export type WaMessage = typeof whatsappMessages.$inferSelect;

/* ---------------- Settings ---------------- */

export async function getWhatsAppSettings(db: Q): Promise<WhatsAppSettings> {
  const [row] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.id, 1));
  const d = (row?.data ?? {}) as Partial<WhatsAppSettings>;
  return { ...DEFAULT_WA_SETTINGS, ...d, templates: { ...DEFAULT_WA_SETTINGS.templates, ...d.templates } };
}

export async function saveWhatsAppSettings(db: Q, next: WhatsAppSettings, by: string) {
  await db.insert(whatsappSettings).values({ id: 1, data: next, updatedBy: by })
    .onConflictDoUpdate({ target: whatsappSettings.id, set: { data: next, updatedBy: by, updatedAt: sql`now()` } });
}

export async function isOptedOut(db: Q, phone: string) {
  const [row] = await db.select({ phone: whatsappOptOuts.phone }).from(whatsappOptOuts).where(eq(whatsappOptOuts.phone, phone));
  return Boolean(row);
}

/* ---------------- Time of day ---------------- */

const IST = 5.5 * 3600_000;
/** Now if it's daytime in India (WA_DAY), else the next morning's start. */
export function nextDaytime(t: Date): Date {
  const local = new Date(t.getTime() + IST);
  const h = local.getUTCHours();
  if (h >= WA_DAY.start && h < WA_DAY.end) return t;
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (h >= WA_DAY.end ? 1 : 0), WA_DAY.start) - IST);
}

/* ---------------- Queueing ---------------- */

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const join = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const templateOf = (key: WaTemplateKey) => WA_TEMPLATES.find((t) => t.key === key)!;
const truthy = (v: unknown) => v === true || /^(true|yes|1)$/i.test(String(v ?? ''));

/** The template's text with the variables filled in: what the inbox shows. */
export function preview(key: WaTemplateKey, params: string[]) {
  return templateOf(key).text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}

interface Queue { kind: WaTemplateKey; phone: string; name: string; params: string[]; leadId?: string | null; orderId?: string | null; broadcastId?: string | null; dueAt?: Date; createdBy?: string }

/** Queue one template message. Returns false when it was already queued (same order, lead, send or call). */
async function enqueue(deps: Deps, s: WhatsAppSettings, m: Queue): Promise<boolean> {
  const rows = await deps.db.insert(whatsappMessages).values({
    phone: m.phone, name: m.name, direction: 'out', kind: m.kind, status: 'queued', template: s.templates[m.kind], params: m.params,
    body: preview(m.kind, m.params), leadId: m.leadId ?? null, orderId: m.orderId ?? null, broadcastId: m.broadcastId ?? null,
    dueAt: m.dueAt ?? deps.now(), createdBy: m.createdBy ?? 'system',
  }).onConflictDoNothing().returning({ id: whatsappMessages.id });
  return rows.length > 0;
}

/** Send what's queued now, after the response on Vercel. */
export function kickWhatsApp(deps: Deps) {
  const run = processWhatsApp(deps, 20).catch((e) => { console.error('[whatsapp]', (e as Error).message); return 0; });
  if (deps.defer) deps.defer(run); else return run;
}

/** The order's checkout, if it had the call/WhatsApp tick. */
async function consentedLead(db: Q, orderId: string) {
  const [lead] = await db.select().from(checkoutLeads).where(and(eq(checkoutLeads.orderId, orderId), eq(checkoutLeads.consent, true))).limit(1);
  return lead ?? null;
}

/** An order event: queue its WhatsApp if that message is on and the buyer agreed at checkout. */
export async function orderWhatsApp(deps: Deps, kind: 'order_confirmed' | 'shipped' | 'ebook_ready', o: Order) {
  const s = await getWhatsAppSettings(deps.db);
  const on = { order_confirmed: s.orderConfirmed, shipped: s.shipped, ebook_ready: s.ebookReady }[kind];
  if (!s.enabled || !on) return false;
  const lead = await consentedLead(deps.db, o.id);
  if (!lead) return false;
  const name = firstName(o.name) || 'there';
  const link = orderLink(deps, o);
  const params = kind === 'order_confirmed' ? [name, String(o.number), inr(o.total), link]
    : kind === 'shipped' ? [name, String(o.number), o.trackingNumber ? `${o.courier ?? 'Courier'} tracking number ${o.trackingNumber}${o.trackingUrl ? ` (${o.trackingUrl})` : ''}` : 'We will share the tracking details soon', link]
    : [name, String(o.number), link];
  const queued = await enqueue(deps, s, { kind, phone: lead.phone, name: o.name, params, orderId: o.id, leadId: lead.id });
  if (queued) await kickWhatsApp(deps);
  return queued;
}

/** Cart reminders for checkouts left at least the set delay ago (at most two days), not paid, with consent. */
export async function planCartMessages(deps: Deps, s: WhatsAppSettings) {
  if (!s.enabled || !s.cart) return 0;
  const { db, now } = deps;
  const t = now();
  const leads = await db.select().from(checkoutLeads).where(and(
    eq(checkoutLeads.consent, true), isNull(checkoutLeads.orderId),
    lte(checkoutLeads.updatedAt, new Date(t.getTime() - s.cartDelayMinutes * 60_000)),
    gte(checkoutLeads.updatedAt, new Date(t.getTime() - 2 * 86_400_000)),
    sql`not exists (select 1 from ${whatsappMessages} where ${whatsappMessages.leadId} = ${checkoutLeads.id} and ${whatsappMessages.kind} = 'cart')`,
  )).limit(200);
  let n = 0;
  for (const lead of leads) {
    // Paid since under another checkout? Nothing to remind them of.
    const [paid] = await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.phone, lead.phone.slice(3)), inArray(orders.paymentStatus, ['paid', 'partially_refunded']), gte(orders.paidAt, lead.createdAt))).limit(1);
    if (paid) continue;
    const items = join(lead.items.map((i) => `${i.title}${i.quantity > 1 ? ` x${i.quantity}` : ''}`));
    const link = `${deps.env.SITE_URL}/checkout?resume=${lead.resumeToken}`;
    if (await enqueue(deps, s, { kind: 'cart', phone: lead.phone, name: lead.name, leadId: lead.id, params: [firstName(lead.name) || 'there', items, inr(lead.total), link], dueAt: nextDaytime(t) })) n++;
  }
  return n;
}

/* ---------------- After an AI voice call (Sarvam) ---------------- */

interface CallInfo { id: string; kind: 'cart' | 'feedback'; phone: string; name: string; leadId: string | null; orderId: string | null; outcome: string; result: Record<string, unknown>; variables: Record<string, string> }

/**
 * A WhatsApp after a call by the voice agents: "thank you, here's your link" when they talked,
 * "we tried to call you" when nobody answered after the last try. Only to someone whose checkout
 * had the call/WhatsApp tick, never after "don't call me" or a wrong number, once per call.
 */
export async function callWhatsApp(deps: Deps, c: CallInfo, answered: boolean) {
  const s = await getWhatsAppSettings(deps.db);
  if (!s.enabled || !s.callFollowup) return false;
  if (['do_not_call', 'wrong_person'].includes(c.outcome)) return false;
  const leadId = c.leadId ?? c.variables.lead_id ?? null;
  const [lead] = leadId ? await deps.db.select().from(checkoutLeads).where(eq(checkoutLeads.id, leadId)) : [];
  if (!lead?.consent) return false;
  const orderId = c.orderId ?? lead.orderId ?? null;
  const [order] = orderId ? await deps.db.select().from(orders).where(eq(orders.id, orderId)) : [];
  const name = firstName(c.name || lead.name) || 'there';
  let kind: 'call_followup' | 'missed_call';
  let params: string[];
  if (c.kind === 'cart') {
    if (lead.orderId && !answered) return false; // paid meanwhile: nothing to chase
    const coupon = truthy(c.result.discount_offered) && c.variables.discount_code ? c.variables.discount_code : '';
    const link = lead.orderId && order ? orderLink(deps, order) : `${deps.env.SITE_URL}/checkout?resume=${lead.resumeToken}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ''}`;
    if (!answered) {
      kind = 'missed_call';
      params = [name, 'the books in your cart', link];
    } else {
      if (['not_interested', 'declined'].includes(c.outcome)) return false;
      kind = 'call_followup';
      const next = lead.orderId ? 'Your order is confirmed; you can see it here.'
        : truthy(c.result.wants_link) || c.outcome === 'will_order' ? `Here is the link to finish your order${coupon ? `; use code ${coupon} at checkout` : ''}.`
          : 'Your cart is saved for whenever you are ready.';
      params = [name, next, link];
    }
  } else {
    const link = order ? orderLink(deps, order) : `${deps.env.SITE_URL}/books`;
    if (!answered) {
      kind = 'missed_call';
      params = [name, order ? `your order #${order.number}` : 'your recent order', link];
    } else {
      kind = 'call_followup';
      const issue = truthy(c.result.issue_reported);
      const books = truthy(c.result.wants_details) && !issue;
      const next = issue ? 'We have passed the problem you mentioned to our team, and they will get back to you soon.'
        : books ? 'Here are our new books, as promised.' : 'Thank you for your feedback, it helps us a lot.';
      params = [name, next, books ? `${deps.env.SITE_URL}/books` : link];
    }
  }
  // One per call: broadcast_id + phone is unique.
  const queued = await enqueue(deps, s, { kind, phone: lead.phone, name: c.name || lead.name, params, broadcastId: `call-${c.id}` });
  if (queued) await kickWhatsApp(deps);
  return queued;
}

/* ---------------- New books ---------------- */

/** Subscribers who allow calls/WhatsApp, have a mobile number and haven't replied STOP. */
export async function newBooksAudience(db: Q) {
  const rows = await db.select({ name: subscribers.name, phone: subscribers.phone }).from(subscribers)
    .where(and(eq(subscribers.status, 'subscribed'), eq(subscribers.callConsent, true)));
  const out = await db.select({ phone: whatsappOptOuts.phone }).from(whatsappOptOuts);
  const stopped = new Set(out.map((r) => r.phone));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const phone = callableNumber(r.phone);
    if (!phone || stopped.has(phone) || seen.has(phone)) return [];
    seen.add(phone);
    return [{ phone, name: r.name }];
  });
}

/** Queue a new-books message to every subscriber in the audience (or one test number). */
export async function queueNewBooks(deps: Deps, input: { message: string; link: string; testPhone?: string | null }, by: string) {
  const s = await getWhatsAppSettings(deps.db);
  const broadcastId = `${input.testPhone ? 'test' : 'nb'}-${deps.now().toISOString().slice(0, 10)}-${randomBytes(4).toString('hex')}`;
  const to = input.testPhone ? [{ phone: input.testPhone, name: '' }] : await newBooksAudience(deps.db);
  const dueAt = input.testPhone ? deps.now() : nextDaytime(deps.now());
  let queued = 0;
  for (const r of to) {
    if (await enqueue(deps, s, { kind: 'new_books', phone: r.phone, name: r.name, broadcastId, dueAt, createdBy: by, params: [firstName(r.name) || 'there', input.message, input.link] })) queued++;
  }
  await kickWhatsApp(deps);
  return { broadcastId, queued };
}

/* ---------------- Sending ---------------- */

/** Send queued messages that are due. Order updates go any time; reminders and new books wait for daytime (their due time). */
export async function processWhatsApp(deps: Deps, limit = 60) {
  const { db, now } = deps;
  const s = await getWhatsAppSettings(db);
  if (!s.enabled || !deps.whatsapp) return 0;
  const due = await db.select().from(whatsappMessages)
    .where(and(eq(whatsappMessages.status, 'queued'), eq(whatsappMessages.direction, 'out'), lte(whatsappMessages.dueAt, now())))
    .orderBy(asc(whatsappMessages.dueAt)).limit(limit);
  let sent = 0;
  for (const m of due) {
    // Claim it first, so two runs never send the same message.
    const [claimed] = await db.update(whatsappMessages).set({ status: 'sent', sentAt: now(), updatedAt: now() })
      .where(and(eq(whatsappMessages.id, m.id), eq(whatsappMessages.status, 'queued'))).returning();
    if (!claimed) continue;
    const skip = (why: string) => db.update(whatsappMessages).set({ status: 'skipped', sentAt: null, error: why, updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
    if (await isOptedOut(db, m.phone)) { await skip('Replied STOP'); continue; }
    if (m.kind === 'cart' && m.leadId) {
      const [lead] = await db.select({ orderId: checkoutLeads.orderId, consent: checkoutLeads.consent }).from(checkoutLeads).where(eq(checkoutLeads.id, m.leadId));
      if (lead?.orderId) { await skip('Paid before the reminder'); continue; }
      if (lead && !lead.consent) { await skip('Consent withdrawn'); continue; }
    }
    try {
      const r = await deps.whatsapp.sendTemplate(m.phone, m.template, s.language, m.params);
      await db.update(whatsappMessages).set({ waId: r.id, updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
      sent++;
    } catch (e) {
      const msg = (e as Error).message;
      // 132001: no approved template with this name in this language, in the sending number's account.
      const hint = /132001/.test(msg) ? ` (Meta has no approved "${m.template}" in "${s.language}" for this number's account: see Admin → WhatsApp → Settings → Templates)` : '';
      await db.update(whatsappMessages).set({ status: 'failed', error: (msg + hint).slice(0, 500), updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
    }
  }
  return sent;
}

/** The cron job: queue cart reminders, then send what's due. */
export async function runWhatsApp(deps: Deps) {
  const s = await getWhatsAppSettings(deps.db);
  const queued = await planCartMessages(deps, s);
  const sent = await processWhatsApp(deps);
  return { queued, sent, connected: Boolean(deps.whatsapp), enabled: s.enabled };
}

/* ---------------- The inbox ---------------- */

/** When the customer last wrote to us (replies are free-form only within 24 hours of it). */
export async function lastIncoming(db: Q, phone: string) {
  const [row] = await db.select({ at: whatsappMessages.createdAt }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.direction, 'in'))).orderBy(sql`${whatsappMessages.createdAt} desc`).limit(1);
  return row?.at ?? null;
}

export async function canReply(deps: Deps, phone: string) {
  const last = await lastIncoming(deps.db, phone);
  return Boolean(last && deps.now().getTime() - last.getTime() < WA_REPLY_WINDOW_MS);
}

/** A reply typed in Admin → WhatsApp: sent now (inside the 24-hour window). */
export async function sendReply(deps: Deps, phone: string, text: string, by: string) {
  if (!deps.whatsapp) throw new Error('WhatsApp is not connected yet.');
  const r = await deps.whatsapp.sendText(phone, text);
  const [row] = await deps.db.insert(whatsappMessages).values({
    phone, direction: 'out', kind: 'reply', status: 'sent', body: text, waId: r.id, sentAt: deps.now(), createdBy: by,
  }).returning();
  return row;
}

const RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

/** One webhook delivery from Meta: customers' messages, and how ours are doing. */
export async function recordWebhook(deps: Deps, body: unknown) {
  const { messages, statuses } = parseWebhook(body);
  for (const m of messages) await incoming(deps, m);
  for (const s of statuses) await statusUpdate(deps, s);
  return { messages: messages.length, statuses: statuses.length };
}

async function incoming(deps: Deps, m: WaIncoming) {
  const { db, now } = deps;
  const [row] = await db.insert(whatsappMessages).values({
    phone: m.from, name: m.name, direction: 'in', kind: 'inbound', status: 'received', body: m.text, waId: m.waId, createdAt: m.at, updatedAt: now(),
  }).onConflictDoNothing().returning();
  if (!row) return; // the same message delivered again
  if (WA_STOP.test(m.text)) {
    await db.insert(whatsappOptOuts).values({ phone: m.from, reason: `Replied "${m.text.trim().slice(0, 40)}"` }).onConflictDoNothing();
    await db.update(whatsappMessages).set({ status: 'skipped', error: 'Replied STOP', updatedAt: now() })
      .where(and(eq(whatsappMessages.phone, m.from), eq(whatsappMessages.status, 'queued')));
    await confirm(deps, m.from, 'You will not get any more WhatsApp messages from Elden Academic Press. Reply START to get them again.');
  } else if (WA_START.test(m.text) && await isOptedOut(db, m.from)) {
    await db.delete(whatsappOptOuts).where(eq(whatsappOptOuts.phone, m.from));
    await confirm(deps, m.from, 'Welcome back! You will get WhatsApp messages from Elden Academic Press again. Reply STOP any time to stop them.');
  }
}

/** An automatic answer to STOP / START (inside the 24-hour window, since they just wrote). */
async function confirm(deps: Deps, phone: string, text: string) {
  if (!deps.whatsapp) return;
  try { await sendReply(deps, phone, text, 'system'); } catch (e) { console.error('[whatsapp] confirm', (e as Error).message); }
}

async function statusUpdate(deps: Deps, s: WaStatusUpdate) {
  const { db, now } = deps;
  const [m] = await db.select().from(whatsappMessages).where(eq(whatsappMessages.waId, s.waId));
  if (!m) return;
  if (s.status === 'failed') {
    await db.update(whatsappMessages).set({ status: 'failed', error: s.error || 'Failed', updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
  } else if (s.status in RANK && (RANK[s.status] ?? 0) > (RANK[m.status] ?? -1)) {
    // Updates can arrive out of order: never move backwards (read → delivered).
    await db.update(whatsappMessages).set({ status: s.status as WaStatus, updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
  }
}

/* ---------------- Numbers for the admin ---------------- */

export async function whatsappStats(db: Q, since: Date) {
  const rows = await db.select({ kind: whatsappMessages.kind, status: whatsappMessages.status, n: sql<number>`count(*)::int` })
    .from(whatsappMessages).where(gte(whatsappMessages.createdAt, since)).groupBy(whatsappMessages.kind, whatsappMessages.status);
  const byKind: Partial<Record<WaKind, Partial<Record<WaStatus, number>>>> = {};
  for (const r of rows) (byKind[r.kind] ??= {})[r.status] = r.n;
  const [unread] = await db.select({ n: sql<number>`count(*)::int` }).from(whatsappMessages)
    .where(and(eq(whatsappMessages.direction, 'in'), isNull(whatsappMessages.seenAt)));
  const [stopped] = await db.select({ n: sql<number>`count(*)::int` }).from(whatsappOptOuts);
  return { byKind, unread: unread?.n ?? 0, optedOut: stopped?.n ?? 0, audience: (await newBooksAudience(db)).length };
}
