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
import { parseWebhook, type WaComponent, type WaIncoming, type WaStatusUpdate, type WaTemplateInfo } from '../lib/whatsapp.js';
import { callableNumber } from '../../src/shared/calls.js';
import {
  DEFAULT_WA_SETTINGS, WA_DAY, WA_REPLY_WINDOW_MS, WA_START, WA_STOP, WA_TEMPLATES, type WaKind, type WaStatus, type WaTemplateDef, type WaTemplateKey, type WhatsAppSettings,
} from '../../src/shared/whatsapp.js';
import { orderLink, type Order } from './orders.js';
import { libraryPath } from './ebooks.js';

export type WaMessage = typeof whatsappMessages.$inferSelect;

/* ---------------- Settings ---------------- */

export async function getWhatsAppSettings(db: Q): Promise<WhatsAppSettings> {
  const [row] = await db.select().from(whatsappSettings).where(eq(whatsappSettings.id, 1));
  const d = (row?.data ?? {}) as Partial<WhatsAppSettings>;
  return { ...DEFAULT_WA_SETTINGS, ...d, templates: { ...DEFAULT_WA_SETTINGS.templates, ...d.templates }, languages: { ...d.languages } };
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

/** The template filled in (header, text, button): what the inbox shows. */
export function preview(key: WaTemplateKey, params: string[], link = '') {
  const t = templateOf(key);
  const text = t.text.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
  return `*${t.header}*\n${text}\n_${t.footer}_\n[${t.button.label}]${link ? ` ${link}` : ''}${t.quickReply ? ` [${t.quickReply}]` : ''}`;
}

/** A link on our site → the path its template's button adds to the site address ("order/1042?t=…"). */
export function linkPath(deps: Deps, url: string) {
  const base = `${deps.env.SITE_URL}/`;
  return url.startsWith(base) ? url.slice(base.length) : url.replace(/^https?:\/\/[^/]+\/?/, '');
}

interface Queue { kind: WaTemplateKey; phone: string; name: string; params: string[]; link: string; leadId?: string | null; orderId?: string | null; broadcastId?: string | null; dueAt?: Date; createdBy?: string }

/**
 * Queue one template message. params holds the body variables, then the button's path last.
 * Returns false when it was already queued (same order, lead, send or call).
 */
async function enqueue(deps: Deps, s: WhatsAppSettings, m: Queue): Promise<boolean> {
  const rows = await deps.db.insert(whatsappMessages).values({
    phone: m.phone, name: m.name, direction: 'out', kind: m.kind, status: 'queued', template: s.templates[m.kind], params: [...m.params, linkPath(deps, m.link)],
    body: preview(m.kind, m.params, m.link), leadId: m.leadId ?? null, orderId: m.orderId ?? null, broadcastId: m.broadcastId ?? null,
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
  const tracking = o.trackingNumber
    ? `Courier: ${o.courier ?? 'our courier'} · Tracking number: ${o.trackingNumber}${o.trackingUrl ? ` · Track it at ${o.trackingUrl}` : ''}`
    : 'We will share the tracking details soon.';
  const params = kind === 'order_confirmed' ? [name, String(o.number), inr(o.total)]
    : kind === 'shipped' ? [name, String(o.number), tracking]
      // E-books open only in the account of the order's email: say which one, and link to the Library.
      : [name, String(o.number), o.email];
  const queued = await enqueue(deps, s, { kind, phone: lead.phone, name: o.name, params, link: kind === 'ebook_ready' ? `${deps.env.SITE_URL}${libraryPath}` : link, orderId: o.id, leadId: lead.id });
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
    if (await enqueue(deps, s, { kind: 'cart', phone: lead.phone, name: lead.name, leadId: lead.id, params: [firstName(lead.name) || 'there', items, inr(lead.total)], link, dueAt: nextDaytime(t) })) n++;
  }
  return n;
}

/* ---------------- After an AI voice call (Sarvam) ---------------- */

interface CallInfo { id: string; kind: 'cart' | 'cod_confirm' | 'feedback'; phone: string; name: string; leadId: string | null; orderId: string | null; outcome: string; result: Record<string, unknown>; variables: Record<string, string> }

/**
 * A WhatsApp after a call by the voice agents: "thank you, here's your link" when they talked,
 * "we tried to call you" when nobody answered after the last try. Only to someone whose checkout
 * had the call/WhatsApp tick, never after "don't call me" or a wrong number, once per call.
 */
export async function callWhatsApp(deps: Deps, c: CallInfo, answered: boolean) {
  const s = await getWhatsAppSettings(deps.db);
  if (!s.enabled || !s.callFollowup) return false;
  if (['do_not_call', 'wrong_person'].includes(c.outcome)) return false;
  if (c.kind === 'cod_confirm') return codCallWhatsApp(deps, s, c, answered);
  const leadId = c.leadId ?? c.variables.lead_id ?? null;
  const [lead] = leadId ? await deps.db.select().from(checkoutLeads).where(eq(checkoutLeads.id, leadId)) : [];
  if (!lead?.consent) return false;
  const orderId = c.orderId ?? lead.orderId ?? null;
  const [order] = orderId ? await deps.db.select().from(orders).where(eq(orders.id, orderId)) : [];
  const name = firstName(c.name || lead.name) || 'there';
  let kind: 'call_followup' | 'missed_call';
  let params: string[];
  let link: string;
  if (c.kind === 'cart') {
    if (lead.orderId && !answered) return false; // paid meanwhile: nothing to chase
    const coupon = truthy(c.result.discount_offered) && c.variables.discount_code ? c.variables.discount_code : '';
    link = lead.orderId && order ? orderLink(deps, order) : `${deps.env.SITE_URL}/checkout?resume=${lead.resumeToken}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ''}`;
    if (!answered) {
      kind = 'missed_call';
      params = [name, 'the books in your cart'];
    } else {
      if (['not_interested', 'declined'].includes(c.outcome)) return false;
      kind = 'call_followup';
      const next = lead.orderId ? 'Your order is confirmed: tap the button below to see it.'
        : truthy(c.result.wants_link) || c.outcome === 'will_order' ? `Your cart is saved: tap the button below to finish your order.${coupon ? ` Use code *${coupon}* at checkout.` : ''}`
          : 'Your cart is saved for whenever you are ready: tap the button below to see it.';
      params = [name, next];
    }
  } else {
    link = order ? orderLink(deps, order) : `${deps.env.SITE_URL}/books`;
    if (!answered) {
      kind = 'missed_call';
      params = [name, order ? `your order #${order.number}` : 'your recent order'];
    } else {
      kind = 'call_followup';
      const issue = truthy(c.result.issue_reported);
      const books = truthy(c.result.wants_details) && !issue;
      const next = issue ? 'We have passed the problem you mentioned to our team, and they will get back to you soon.'
        : books ? 'As promised, our new books are a tap away below.' : 'Thank you for your feedback, it helps us a lot.';
      params = [name, next];
      if (books) link = `${deps.env.SITE_URL}/books`;
    }
  }
  // One per call: broadcast_id + phone is unique.
  const queued = await enqueue(deps, s, { kind, phone: lead.phone, name: c.name || lead.name, params, link, broadcastId: `call-${c.id}` });
  if (queued) await kickWhatsApp(deps);
  return queued;
}

/**
 * After a cash-on-delivery confirmation call: "your order is confirmed" when they said yes, "we
 * tried to call you" after the last unanswered try. Nothing when they said no (the team emails
 * them once it's cancelled) or the call was unclear. Only with the order's call/WhatsApp tick.
 */
async function codCallWhatsApp(deps: Deps, s: WhatsAppSettings, c: CallInfo, answered: boolean) {
  if (!c.orderId) return false;
  const [order] = await deps.db.select().from(orders).where(eq(orders.id, c.orderId));
  if (!order || order.cancelledAt) return false;
  if (answered && c.outcome !== 'order_confirmed') return false;
  const lead = await consentedLead(deps.db, order.id);
  if (!lead) return false;
  const name = firstName(order.name) || 'there';
  const kind = answered ? 'call_followup' as const : 'missed_call' as const;
  const params = answered
    ? [name, `Your order *#${order.number}* is confirmed and will be dispatched within 1 to 3 working days. Please keep *${inr(order.codAmount)}* ready to pay when it arrives.`]
    : [name, `confirming your cash on delivery order #${order.number}`];
  const queued = await enqueue(deps, s, { kind, phone: lead.phone, name: order.name, params, link: orderLink(deps, order), orderId: order.id, broadcastId: `call-${c.id}` });
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
    if (await enqueue(deps, s, { kind: 'new_books', phone: r.phone, name: r.name, broadcastId, dueAt, createdBy: by, params: [firstName(r.name) || 'there', input.message], link: input.link })) queued++;
  }
  await kickWhatsApp(deps);
  return { broadcastId, queued };
}

/* ---------------- Sending ---------------- */

/** The language a template is sent in: the one it was found approved in, else the settings' language. */
const languageOf = (s: WhatsAppSettings, key: WaTemplateKey) => s.languages[key] || s.language;

/**
 * Why Meta answered 132001 ("template name does not exist in the translation") for this template,
 * asked from Meta with the site's own keys: is the sending number in the templates' account, does
 * the template exist there, in which languages and with what status. Returns the explanation, an
 * approved language to use instead (if there is one), and whether trying again later can work.
 */
export async function explainMissingTemplate(deps: Deps, s: WhatsAppSettings, key: WaTemplateKey, name: string): Promise<{ text: string; useLanguage?: string; retryLater: boolean }> {
  const t = deps.whatsappTemplates;
  const waba = deps.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  const phoneId = deps.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
  const lang = languageOf(s, key);
  if (!t) return { text: `Meta has no approved "${name}" in "${lang}" for this number's account. See Admin → WhatsApp → Settings → Templates, and set WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel so the site can check why.`, retryLater: false };
  let numbers: { id: string; number: string }[] | null = null;
  try { numbers = await t.phoneNumbers(); } catch { /* shown as unknown */ }
  if (numbers && !numbers.some((n) => n.id === phoneId)) {
    return {
      text: `The sending number (WHATSAPP_PHONE_NUMBER_ID ${phoneId}) is not in WhatsApp account ${waba}, where the templates are. Numbers in that account: ${numbers.map((n) => `${n.number} (id ${n.id})`).join(', ') || 'none'}. Fix one of the two ids in Vercel and redeploy.`,
      retryLater: false,
    };
  }
  let all: WaTemplateInfo[];
  try { all = await t.list(); } catch (e) { return { text: `Meta has no approved "${name}" in "${lang}", and listing the templates failed: ${(e as Error).message}`, retryLater: true }; }
  const mine = all.filter((x) => x.name === name);
  const same = mine.find((x) => x.language === lang);
  const otherApproved = mine.find((x) => x.language !== lang && x.status === 'APPROVED');
  const list = mine.map((x) => `${x.language} ${x.status.toLowerCase()}`).join(', ');
  if (same?.status === 'APPROVED') {
    return { text: `Meta lists "${name}" as approved in "${lang}" in account ${waba}, and the number is in that account, but refused it. A template approved or edited in the last hour can take a while before it can be sent: the site tries again by itself.`, retryLater: true };
  }
  if (same && ['PENDING', 'IN_APPEAL'].includes(same.status)) {
    if (otherApproved) return { text: `"${name}" in "${lang}" is still being reviewed by Meta; it is approved in "${otherApproved.language}", so that one is used.`, useLanguage: otherApproved.language, retryLater: false };
    return { text: `"${name}" in "${lang}" is still being reviewed by Meta (status ${same.status.toLowerCase()}, e.g. after "Update all templates" changed it). It can't be sent until it's approved: the site tries again by itself.`, retryLater: true };
  }
  if (otherApproved) return { text: `"${name}" is approved in "${otherApproved.language}", not "${lang}": the site uses ${otherApproved.language} for it from now on.`, useLanguage: otherApproved.language, retryLater: false };
  if (same) {
    return { text: `"${name}" in "${lang}" is ${same.status.toLowerCase()}${same.rejectedReason ? ` (${same.rejectedReason})` : ''} in Meta, so it can't be sent. See Admin → WhatsApp → Settings → Templates.`, retryLater: false };
  }
  return {
    text: `There is no template "${name}" in account ${waba}${list ? ` in "${lang}" (only: ${list})` : ''}. Press "Update all templates in Meta" in Admin → WhatsApp → Settings, or fix the name under Template names.`,
    retryLater: false,
  };
}

export class TemplateSendError extends Error {
  constructor(message: string, readonly retryLater: boolean) { super(message); }
}

/**
 * Send one template. On 132001 the site finds out why: if Meta approved it in another language,
 * it is sent again in that one straight away (and remembered); otherwise the error says why.
 */
export async function sendTemplate(deps: Deps, s: WhatsAppSettings, key: WaTemplateKey, name: string, phone: string, params: string[], buttonPath?: string) {
  const wa = deps.whatsapp;
  if (!wa) throw new TemplateSendError('WhatsApp is not connected yet.', false);
  const lang = languageOf(s, key);
  try {
    return { ...(await wa.sendTemplate(phone, name, lang, params, buttonPath)), language: lang };
  } catch (e) {
    const msg = (e as Error).message;
    if (!/132001/.test(msg)) throw new TemplateSendError(msg, false);
    const why = await explainMissingTemplate(deps, s, key, name);
    if (why.useLanguage && why.useLanguage !== lang) {
      try {
        const r = await wa.sendTemplate(phone, name, why.useLanguage, params, buttonPath);
        s.languages = { ...s.languages, [key]: why.useLanguage };
        await saveWhatsAppSettings(deps.db, s, 'system');
        return { ...r, language: why.useLanguage };
      } catch (e2) {
        throw new TemplateSendError(`${msg}. Also refused in "${why.useLanguage}": ${(e2 as Error).message}`, false);
      }
    }
    throw new TemplateSendError(`${msg} — ${why.text}`, why.retryLater);
  }
}

/** A message refused because its template isn't usable yet is tried again this often, for a day. */
const TEMPLATE_RETRY_MS = 20 * 60_000;
const TEMPLATE_RETRY_FOR_MS = 24 * 3600_000;

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
      // Body variables first, then the button's path (see enqueue).
      const def = templateOf(m.kind as WaTemplateKey);
      const n = def?.vars.length ?? m.params.length;
      const r = await sendTemplate(deps, s, m.kind as WaTemplateKey, m.template, m.phone, m.params.slice(0, n), m.params[n]);
      await db.update(whatsappMessages).set({ waId: r.id, error: '', updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
      sent++;
    } catch (e) {
      const msg = (e as Error).message;
      // The template isn't usable yet (in review, or just approved): wait and try again, for up to a day.
      if (e instanceof TemplateSendError && e.retryLater && now().getTime() - m.createdAt.getTime() < TEMPLATE_RETRY_FOR_MS) {
        await db.update(whatsappMessages).set({ status: 'queued', sentAt: null, dueAt: new Date(now().getTime() + TEMPLATE_RETRY_MS), error: `Waiting to try again: ${msg}`.slice(0, 500), updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
        continue;
      }
      await db.update(whatsappMessages).set({ status: 'failed', error: msg.slice(0, 500), updatedAt: now() }).where(eq(whatsappMessages.id, m.id));
    }
  }
  return sent;
}

/**
 * Admin → WhatsApp → Settings → Templates → Test: send one template now, with its sample values,
 * to a number (yours), and say exactly what Meta answered. Not recorded as a customer message.
 */
export async function testTemplate(deps: Deps, key: WaTemplateKey, phone: string) {
  const s = await getWhatsAppSettings(deps.db);
  const def = templateOf(key);
  const name = s.templates[key];
  try {
    const r = await sendTemplate(deps, s, key, name, phone, def.samples, def.button.sample);
    return { ok: true as const, name, language: r.language, waId: r.id, detail: `Meta accepted it (message id ${r.id}). It should arrive on WhatsApp in a few seconds.` };
  } catch (e) {
    return { ok: false as const, name, language: languageOf(s, key), detail: (e as Error).message };
  }
}

/** Put failed template messages from the last few days back in the queue (after fixing the cause). */
export async function retryFailed(deps: Deps, days = 3) {
  const rows = await deps.db.update(whatsappMessages).set({ status: 'queued', dueAt: deps.now(), sentAt: null, updatedAt: deps.now() })
    .where(and(eq(whatsappMessages.status, 'failed'), eq(whatsappMessages.direction, 'out'), sql`${whatsappMessages.template} <> ''`,
      gte(whatsappMessages.createdAt, new Date(deps.now().getTime() - days * 86_400_000)))).returning({ id: whatsappMessages.id });
  if (rows.length) await processWhatsApp(deps, 60);
  return rows.length;
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

/* ---------------- The templates in Meta ---------------- */

/** A template as Meta wants it: header, body (with examples), footer, link button and quick reply. */
export function templateComponents(t: WaTemplateDef, siteUrl: string): WaComponent[] {
  return [
    { type: 'HEADER', format: 'TEXT', text: t.header },
    { type: 'BODY', text: t.text, example: { body_text: [t.samples] } },
    { type: 'FOOTER', text: t.footer },
    {
      type: 'BUTTONS',
      buttons: [
        { type: 'URL', text: t.button.label, url: `${siteUrl}/{{1}}`, example: [`${siteUrl}/${t.button.sample}`] },
        ...(t.quickReply ? [{ type: 'QUICK_REPLY', text: t.quickReply }] : []),
      ],
    },
  ];
}

/** Meta's copy of a template differs from the site's design (or can't be compared). */
export function needsUpdate(t: WaTemplateDef, existing: WaTemplateInfo, siteUrl: string) {
  return !existing.components?.length || fingerprint(existing.components) !== fingerprint(templateComponents(t, siteUrl));
}

/** The parts that matter, to tell whether Meta's copy already matches ours (so it isn't edited needlessly). */
function fingerprint(components: WaComponent[]) {
  const by = (type: string) => components.find((c) => String(c.type).toUpperCase() === type) as Record<string, any> | undefined;
  const buttons = (by('BUTTONS')?.buttons ?? []) as Record<string, unknown>[];
  return JSON.stringify([by('HEADER')?.text ?? '', by('BODY')?.text ?? '', by('FOOTER')?.text ?? '', buttons.map((b) => [String(b.type).toUpperCase(), b.text ?? '', b.url ?? ''])]);
}

/**
 * Bring the WhatsApp account's templates in line with the site's designs: edit those that differ
 * (Meta reviews them again), create those that are missing, leave matching ones alone.
 */
export async function syncTemplates(deps: Deps) {
  if (!deps.whatsappTemplates) throw new Error('Set WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID first.');
  const s = await getWhatsAppSettings(deps.db);
  const found: WaTemplateInfo[] = await deps.whatsappTemplates.list();
  const results: { key: string; name: string; result: string; ok: boolean }[] = [];
  for (const t of WA_TEMPLATES) {
    const name = s.templates[t.key];
    const components = templateComponents(t, deps.env.SITE_URL);
    const existing = found.find((x) => x.name === name && x.language === s.language);
    try {
      if (!existing) {
        const r = await deps.whatsappTemplates.create({ name, language: s.language, category: t.category, components });
        results.push({ key: t.key, name, ok: true, result: `created, Meta is reviewing it (${r.status.toLowerCase()})` });
      } else if (existing.components && fingerprint(existing.components) === fingerprint(components)) {
        results.push({ key: t.key, name, ok: true, result: 'already up to date' });
      } else if (!existing.id) {
        results.push({ key: t.key, name, ok: false, result: 'Meta did not return its id, so it cannot be edited from here' });
      } else {
        await deps.whatsappTemplates.edit(existing.id, components);
        results.push({ key: t.key, name, ok: true, result: 'updated, Meta is reviewing it again' });
      }
    } catch (e) {
      results.push({ key: t.key, name, ok: false, result: (e as Error).message });
    }
  }
  return results;
}
