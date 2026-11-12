// Calls by the AI voice agents (Admin → Calls). Who gets called and when is decided here:
//
// - Cart recovery: someone typed a phone number at checkout and ticked "you may call or WhatsApp
//   me about this order" (a checkout lead), then didn't pay. After the delay in the settings, a
//   call is queued; if they pay first, it's skipped.
// - Cash-on-delivery confirmation: every COD order, a few minutes after the advance is paid. The
//   cart agent asks whether they want the order: yes confirms it; no flags it and emails the owner
//   (MAIL_TO) to cancel it by hand, the advance being non-refundable; no answer after every try,
//   or no clear answer, flags it and emails too. The team can confirm it by hand at any time,
//   which stops the call.
// - Order feedback: a paid order whose checkout had that consent, the set number of days later.
//
// Calls go out only inside the calling hours, only while the master switch and that kind are on,
// never to a number on the do-not-call list, and only through a connected provider (deps.calls).
// The provider reports each call's end to the webhook, and the outcome is acted on:
// "do not call" joins the list, "send me the link" emails the finish-your-order link, "call me
// later" queues it again, and a reported problem is flagged for the team and emailed to them.
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q } from '../db/client.js';
import { callSettings, calls, checkoutLeads, doNotCall, orderItems, orders, products, productVariants, subscribers } from '../db/schema.js';
import { HttpError } from '../lib/http.js';
import { esc, inr } from '../lib/format.js';
import { addressList, sendSafely } from '../lib/mail.js';
import { callResultFrom, type CallResult } from '../lib/callProvider.js';
import {
  CALL_KINDS, callableNumber, CONFIRMED_BY_CALL, DEFAULT_CALL_SETTINGS, inCallingHours, nextCallingTime, INBOUND, OUTCOME_LABEL, type CallKind, type CallSettings,
} from '../../src/shared/calls.js';
import { getSettings } from './catalog.js';
import { button, layout, p, section, sendCodConfirmationAlert, type CodAlertDetails } from './emails.js';
import { logEvent, type Order } from './orders.js';
import { callWhatsApp } from './whatsapp.js';

export type Call = typeof calls.$inferSelect;
export type Lead = typeof checkoutLeads.$inferSelect;

/* ---------------- Settings ---------------- */

export async function getCallSettings(db: Q): Promise<CallSettings> {
  const [row] = await db.select().from(callSettings).where(eq(callSettings.id, 1));
  const d = (row?.data ?? {}) as Partial<CallSettings>;
  return {
    ...DEFAULT_CALL_SETTINGS, ...d,
    cart: { ...DEFAULT_CALL_SETTINGS.cart, ...d.cart },
    cod_confirm: { ...DEFAULT_CALL_SETTINGS.cod_confirm, ...d.cod_confirm },
    feedback: { ...DEFAULT_CALL_SETTINGS.feedback, ...d.feedback },
    hours: { ...DEFAULT_CALL_SETTINGS.hours, ...d.hours },
  };
}

export async function saveCallSettings(db: Q, next: CallSettings, by: string) {
  await db.insert(callSettings).values({ id: 1, data: next, updatedBy: by })
    .onConflictDoUpdate({ target: callSettings.id, set: { data: next, updatedBy: by, updatedAt: sql`now()` } });
}

export async function isDoNotCall(db: Q, phone: string) {
  const [row] = await db.select({ phone: doNotCall.phone }).from(doNotCall).where(eq(doNotCall.phone, phone));
  return Boolean(row);
}

export async function addDoNotCall(db: Q, phone: string, reason: string, source: 'customer' | 'admin') {
  await db.insert(doNotCall).values({ phone, reason, source }).onConflictDoNothing();
  // Anything still waiting for this number is dropped.
  await db.update(calls).set({ status: 'skipped', note: 'On the do-not-call list', updatedAt: sql`now()` })
    .where(and(eq(calls.phone, phone), inArray(calls.status, ['queued'])));
}

/* ---------------- Checkout leads ---------------- */

export interface LeadInput {
  clientKey: string;
  name: string;
  email: string;
  phone: string;
  consent: boolean;
  items: { productId: string; kind: 'print' | 'digital' | 'bundle'; quantity: number }[];
}

/**
 * Save (or update) the checkout someone is filling in. Only with consent and an Indian mobile
 * number: without them nothing is stored, and a lead whose consent is withdrawn is removed from
 * calling. Returns whether it was kept.
 */
export async function saveLead(deps: Deps, input: LeadInput): Promise<{ saved: boolean }> {
  const { db, now } = deps;
  const phone = callableNumber(input.phone);
  const [existing] = await db.select().from(checkoutLeads).where(eq(checkoutLeads.clientKey, input.clientKey));
  if (!phone || !input.consent) {
    if (existing && !existing.orderId) {
      await db.update(checkoutLeads).set({ consent: false, updatedAt: now() }).where(eq(checkoutLeads.id, existing.id));
      await db.update(calls).set({ status: 'cancelled', note: 'Consent withdrawn at checkout', updatedAt: now() })
        .where(and(eq(calls.leadId, existing.id), eq(calls.status, 'queued')));
    }
    return { saved: false };
  }
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const rows = ids.length ? await db.select({ id: products.id, title: products.title, kind: productVariants.kind, price: productVariants.price })
    .from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(inArray(products.id, ids), eq(productVariants.active, true))) : [];
  const items = input.items.flatMap((i) => {
    const r = rows.find((x) => x.id === i.productId && x.kind === i.kind);
    return r ? [{ productId: i.productId, kind: i.kind, quantity: i.quantity, title: r.title, price: r.price }] : [];
  });
  if (!items.length) return { saved: false };
  const total = items.reduce((n, i) => n + i.price * i.quantity, 0);
  const values = {
    name: input.name.trim().slice(0, 120), email: input.email.trim().toLowerCase().slice(0, 200), phone, consent: true,
    items: items.map(({ price: _p, ...i }) => i), total, updatedAt: now(),
  };
  if (existing) {
    if (existing.orderId) return { saved: false }; // already paid
    await db.update(checkoutLeads).set(values).where(eq(checkoutLeads.id, existing.id));
  } else {
    await db.insert(checkoutLeads).values({ ...values, clientKey: input.clientKey, resumeToken: randomBytes(18).toString('base64url') });
  }
  return { saved: true };
}

/** The cart behind a "finish your order" link. */
export async function leadByToken(db: Q, token: string) {
  if (!/^[\w-]{10,60}$/.test(token)) return null;
  const [lead] = await db.select().from(checkoutLeads).where(eq(checkoutLeads.resumeToken, token));
  return lead ?? null;
}

/** An order was paid: its checkout lead (same phone or email, recent) is converted, and waiting cart calls stop. */
export async function leadPaid(deps: Deps, order: { id: string; phone: string; email: string }) {
  const { db, now } = deps;
  const phone = callableNumber(order.phone);
  const since = new Date(now().getTime() - 14 * 86_400_000);
  const match = or(...[phone ? eq(checkoutLeads.phone, phone) : undefined, order.email ? eq(checkoutLeads.email, order.email.toLowerCase()) : undefined].filter((x) => x !== undefined));
  if (!match) return;
  const leads = await db.update(checkoutLeads).set({ orderId: order.id, updatedAt: now() })
    .where(and(isNull(checkoutLeads.orderId), gte(checkoutLeads.updatedAt, since), match)).returning({ id: checkoutLeads.id });
  if (!leads.length) return;
  await db.update(calls).set({ status: 'skipped', note: 'Paid before the call', updatedAt: now() })
    .where(and(inArray(calls.leadId, leads.map((l) => l.id)), eq(calls.kind, 'cart'), eq(calls.status, 'queued')));
}

/* ---------------- Planning: who to call ---------------- */

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? '';
const spokenRupees = (paise: number) => `${inr(paise).replace('₹', '')} rupees`;
const joinSpoken = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const formatWord = (kind: string) => (kind === 'digital' ? 'e-book' : 'printed');

/** Queue the calls that are due to be made: cart recovery for left checkouts, feedback for paid orders. */
export async function planCalls(deps: Deps, s: CallSettings) {
  const { db, now } = deps;
  const t = now();
  const store = await getSettings(db);
  let queued = 0;

  if (s.cart.enabled) {
    // Left at least `delay` ago, at most three days ago, not paid, no cart call yet.
    const leads = await db.select().from(checkoutLeads).where(and(
      eq(checkoutLeads.consent, true), isNull(checkoutLeads.orderId),
      lte(checkoutLeads.updatedAt, new Date(t.getTime() - s.cart.delayMinutes * 60_000)),
      gte(checkoutLeads.updatedAt, new Date(t.getTime() - 3 * 86_400_000)),
      sql`not exists (select 1 from ${calls} where ${calls.leadId} = ${checkoutLeads.id} and ${calls.kind} = 'cart')`,
    )).limit(200);
    for (const lead of leads) {
      if (await isDoNotCall(db, lead.phone)) continue;
      // Paid since under another checkout? Then there's nothing to recover.
      const [paid] = await db.select({ id: orders.id }).from(orders)
        .where(and(eq(orders.phone, lead.phone.slice(3)), inArray(orders.paymentStatus, ['paid', 'partially_refunded']), gte(orders.paidAt, lead.createdAt))).limit(1);
      if (paid) continue;
      const res = await db.insert(calls).values({
        kind: 'cart', phone: lead.phone, name: lead.name, leadId: lead.id, dueAt: nextCallingTime(s, t),
        variables: {
          call_purpose: 'cart_recovery',
          customer_name: firstName(lead.name),
          cart_items: joinSpoken(lead.items.map((i) => `${i.title} (${formatWord(i.kind)}${i.quantity > 1 ? `, ${i.quantity} copies` : ''})`)),
          cart_total: spokenRupees(lead.total),
          cod_available: store.codEnabled ? 'yes' : 'no',
          discount_code: s.cart.discountCode,
          discount_offer: s.cart.discountCode ? s.cart.discountOffer : '',
        },
      }).onConflictDoNothing().returning({ id: calls.id });
      queued += res.length;
    }
  }

  if (s.cod_confirm.enabled) {
    // COD orders still waiting for their confirmation call (e.g. placed while this was off), up to three days old.
    const waiting = await db.select().from(orders).where(and(
      eq(orders.paymentMode, 'cod'), eq(orders.codConfirmation, 'pending'), isNull(orders.cancelledAt),
      inArray(orders.paymentStatus, ['paid', 'partially_refunded']), gte(orders.paidAt, new Date(t.getTime() - 3 * 86_400_000)),
      sql`not exists (select 1 from ${calls} where ${calls.orderId} = ${orders.id} and ${calls.kind} = 'cod_confirm')`,
    )).limit(100);
    for (const o of waiting) if (await queueCodConfirmation(deps, o, s)) queued++;
  }

  if (s.feedback.enabled) {
    // Paid `daysAfter` days ago (looking back a week), whose checkout had the consent. With
    // allBuyers, also orders with no saved checkout (before the call box, or never typed in), looking
    // further back; someone who unticked the box is never called.
    const to = new Date(t.getTime() - s.feedback.daysAfter * 86_400_000);
    const from = new Date(to.getTime() - (s.feedback.allBuyers ? Math.max(7, s.feedback.lookbackDays) : 7) * 86_400_000);
    const due = await db.select({ order: orders, lead: checkoutLeads }).from(orders)
      .leftJoin(checkoutLeads, eq(checkoutLeads.orderId, orders.id))
      .where(and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), isNull(orders.cancelledAt), gte(orders.paidAt, from), lte(orders.paidAt, to),
        s.feedback.allBuyers ? or(isNull(checkoutLeads.id), eq(checkoutLeads.consent, true)) : eq(checkoutLeads.consent, true),
        sql`not exists (select 1 from ${calls} where ${calls.orderId} = ${orders.id} and ${calls.kind} = 'feedback')`))
      .orderBy(asc(orders.paidAt)).limit(200);
    const newBooks = s.feedback.newBookIds.length
      ? await db.select({ title: products.title, blurb: products.blurb }).from(products).where(and(inArray(products.id, s.feedback.newBookIds), eq(products.status, 'active')))
      : [];
    for (const { order, lead } of due) {
      const phone = lead?.phone ?? callableNumber(order.phone);
      if (!phone || await isDoNotCall(db, phone)) continue;
      // Several orders: one feedback call a month is enough.
      const [recent] = await db.select({ id: calls.id }).from(calls)
        .where(and(eq(calls.phone, phone), eq(calls.kind, 'feedback'), gte(calls.createdAt, new Date(t.getTime() - 30 * 86_400_000)))).limit(1);
      if (recent) continue;
      // A printed order that hasn't arrived yet waits for delivery.
      if (order.requiresShipping && order.fulfillmentStatus !== 'delivered' && !order.deliveredAt && order.fulfillmentStatus !== 'shipped') continue;
      const items = await db.select({ title: orderItems.title, kind: orderItems.variantKind }).from(orderItems).where(eq(orderItems.orderId, order.id));
      const kinds = new Set(items.map((i) => (i.kind === 'digital' ? 'ebook' : 'print')));
      const res = await db.insert(calls).values({
        kind: 'feedback', phone, name: order.name, leadId: lead?.id ?? null, orderId: order.id, dueAt: nextCallingTime(s, t),
        variables: {
          customer_name: firstName(order.name),
          books_bought: joinSpoken([...new Set(items.map((i) => i.title))]),
          order_type: kinds.size > 1 ? 'both' : [...kinds][0] ?? 'print',
          new_books: newBooks.map((b) => `${b.title}${b.blurb ? `: ${b.blurb.slice(0, 120)}` : ''}`).join('; '),
        },
      }).onConflictDoNothing().returning({ id: calls.id });
      queued += res.length;
    }
  }
  return queued;
}

/* ---------------- Dialling ---------------- */

/** A call handed to the provider with no result for this long is counted as not answered. */
const STALE_MS = 60 * 60_000;

/** Dial the calls that are due (oldest first), or just the one `only` names ("Call now"). */
export async function dialDueCalls(deps: Deps, s: CallSettings, limit = 10, only?: string) {
  const { db, now } = deps;
  const t = now();
  // Calls that never reported back.
  const stale = await db.select().from(calls).where(and(eq(calls.status, 'dialling'), lte(calls.startedAt, new Date(t.getTime() - STALE_MS))));
  for (const c of stale) await notAnswered(deps, s, c, 'No result from the provider');

  if (!s.enabled || !deps.calls || !inCallingHours(s, t)) return 0;
  const kinds = (['cart', 'cod_confirm', 'feedback'] as CallKind[]).filter((k) => s[k].enabled);
  if (!kinds.length) return 0;
  const due = await db.select().from(calls).where(and(eq(calls.status, 'queued'), lte(calls.dueAt, t), inArray(calls.kind, kinds), only ? eq(calls.id, only) : undefined))
    .orderBy(asc(calls.dueAt)).limit(limit);
  let dialled = 0;
  for (const c of due) {
    if (await isDoNotCall(db, c.phone)) { await db.update(calls).set({ status: 'skipped', note: 'On the do-not-call list', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
    if (c.kind === 'cart' && c.leadId) {
      const [lead] = await db.select({ orderId: checkoutLeads.orderId, consent: checkoutLeads.consent }).from(checkoutLeads).where(eq(checkoutLeads.id, c.leadId));
      if (lead?.orderId) { await db.update(calls).set({ status: 'skipped', note: 'Paid before the call', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
      if (lead && !lead.consent) { await db.update(calls).set({ status: 'cancelled', note: 'Consent withdrawn', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
    }
    if (c.kind === 'cod_confirm') {
      // Confirmed by the team, or cancelled, since it was queued: nothing to ask.
      const [o] = c.orderId ? await db.select({ codConfirmation: orders.codConfirmation, cancelledAt: orders.cancelledAt, by: orders.codConfirmedBy }).from(orders).where(eq(orders.id, c.orderId)) : [];
      const why = !o ? 'The order no longer exists' : o.cancelledAt ? 'The order was cancelled' : o.codConfirmation === 'confirmed' ? `Already confirmed${o.by && o.by !== CONFIRMED_BY_CALL ? ` by ${o.by}` : ''}`
        : o.codConfirmation === 'cancel_requested' ? 'The customer already said no' : '';
      if (why) { await db.update(calls).set({ status: 'skipped', note: why, updatedAt: t }).where(eq(calls.id, c.id)); continue; }
    }
    // Claim it first, so two runs never dial the same call.
    const [claimed] = await db.update(calls).set({ status: 'dialling', attempts: sql`${calls.attempts} + 1`, startedAt: t, updatedAt: t })
      .where(and(eq(calls.id, c.id), eq(calls.status, 'queued'))).returning();
    if (!claimed) continue;
    try {
      const r = await deps.calls.start({ callId: c.id, kind: c.kind, phone: c.phone, variables: c.variables });
      // Handed to Sarvam: an error from an earlier try no longer applies.
      await db.update(calls).set({ providerCallId: r.providerCallId, note: '', updatedAt: now() }).where(eq(calls.id, c.id));
      dialled++;
    } catch (e) {
      await notAnswered(deps, s, claimed, `Couldn't start the call (${istTime(now())}): ${(e as Error).message}`.slice(0, 300), 'failed');
    }
  }
  return dialled;
}

/** No answer (or a failed start): try again later while attempts remain, else give up. */
async function notAnswered(deps: Deps, s: CallSettings, c: Call, note: string, finalStatus: 'no_answer' | 'failed' = 'no_answer') {
  const { db, now } = deps;
  // An incoming call is never dialled back on its own.
  const retry = c.createdBy !== INBOUND && c.attempts <= s.maxRetries;
  await db.update(calls).set(retry
    ? { status: 'queued', dueAt: nextCallingTime(s, new Date(now().getTime() + s.retryAfterMinutes * 60_000)), note, updatedAt: now() }
    : { status: finalStatus, endedAt: now(), note, updatedAt: now() }).where(eq(calls.id, c.id));
  // The last try of a confirmation call: the order is flagged and the owner emailed.
  if (!retry && c.kind === 'cod_confirm' && c.orderId) {
    await codNotConfirmed(deps, c.orderId, 'unreachable', { kind: 'unreachable', note: `${c.attempts} ${c.attempts === 1 ? 'try' : 'tries'}: ${note}`, callId: c.id })
      .catch((e) => console.error('[calls] COD unreachable', (e as Error).message));
  }
}

const SARVAM_VARS = ['SARVAM_API_KEY', 'SARVAM_ORG_ID', 'SARVAM_WORKSPACE_ID', 'SARVAM_CART_CAMPAIGN_ID', 'SARVAM_FEEDBACK_CAMPAIGN_ID'] as const;
const istTime = (d: Date) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Why calls aren't going out right now, in words (empty when nothing is stopping them). With a
 * kind, only what stops that kind. Shown on Calls → Overview and when "Call now" can't dial.
 */
export function callBlockers(deps: Deps, s: CallSettings, kind?: CallKind): string[] {
  const out: string[] = [];
  if (!s.enabled) out.push('All calls are paused: switch on “All calls” at the top of Calls → Overview.');
  const label = (k: CallKind) => CALL_KINDS.find((x) => x.key === k)?.label ?? k;
  for (const k of kind ? [kind] : (['cart', 'cod_confirm', 'feedback'] as CallKind[])) {
    if (!s[k].enabled) out.push(`${label(k)} calls are switched off in Calls → Overview.`);
  }
  if (!deps.calls) {
    const missing = SARVAM_VARS.filter((v) => !deps.env[v]);
    out.push(`Outgoing calls aren’t connected to Sarvam: ${missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} missing in Vercel (Production)` : 'the Sarvam settings in Vercel are incomplete'}. Add ${missing.length === 1 ? 'it' : 'them'}, then redeploy.`);
  }
  const t = deps.now();
  if (!inCallingHours(s, t)) out.push(`It’s outside the calling hours (${s.hours.start}–${s.hours.end}, ${s.hours.days.join(', ')}, India time). Calls go out from ${istTime(nextCallingTime(s, t))}.`);
  if (!deps.env.CRON_SECRET) out.push('CRON_SECRET isn’t set in Vercel, so the 10-minute job that dials queued calls is refused: only “Call now” dials. Set it (a long random string) and redeploy.');
  return out;
}

/** The cron job: queue what's due, then dial what's due. */
export async function runCalls(deps: Deps) {
  const s = await getCallSettings(deps.db);
  const queued = await planCalls(deps, s);
  const dialled = await dialDueCalls(deps, s);
  return { queued, dialled, connected: Boolean(deps.calls), inHours: inCallingHours(s, deps.now()), enabled: s.enabled };
}

/* ---------------- Results ---------------- */

const truthy = (v: unknown) => v === true || /^(true|yes|1)$/i.test(String(v ?? ''));

/** A call-end report from the provider. Returns the call it updated, or null if none matched. */
export async function recordCallResult(deps: Deps, raw: unknown): Promise<Call | null> {
  const r: CallResult = callResultFrom(raw);
  const { db, now } = deps;
  const where = r.callId && /^[0-9a-f-]{36}$/i.test(r.callId) ? eq(calls.id, r.callId) : r.providerCallId ? eq(calls.providerCallId, r.providerCallId) : null;
  let [c] = where ? await db.select().from(calls).where(where) : [];
  // The same report delivered again: already handled.
  if (c && c.status === 'done' && c.endedAt) return c;
  if (!c && r.direction === 'inbound') c = await inboundCall(deps, r);
  if (!c) return null;
  const s = await getCallSettings(db);
  if (r.status !== 'answered') {
    await notAnswered(deps, s, c, r.status === 'failed' ? 'The call failed' : 'No answer');
    const [after] = await db.select().from(calls).where(eq(calls.id, c.id));
    // The last try went unanswered: a WhatsApp says we tried, with their link (if switched on).
    if (after && after.status !== 'queued' && after.createdBy !== INBOUND) {
      await callWhatsApp(deps, after, false).catch((e) => console.error('[calls] missed-call WhatsApp', (e as Error).message));
    }
    return after;
  }
  const v = r.variables;
  const outcome = c.kind === 'cod_confirm' ? codOutcome(v) : String(v.call_outcome ?? '').trim();
  const issue = c.kind === 'feedback' && truthy(v.issue_reported);
  const [updated] = await db.update(calls).set({
    status: 'done', endedAt: now(), durationSeconds: r.durationSeconds, outcome: outcome in OUTCOME_LABEL ? outcome : outcome.slice(0, 40),
    result: v, transcript: r.transcript, recordingUrl: r.recordingUrl, issueOpen: issue, note: '', updatedAt: now(),
  }).where(eq(calls.id, c.id)).returning();
  if (c.kind === 'cod_confirm') await codCallResult(deps, updated, v).catch((e) => console.error('[calls] COD result', (e as Error).message));
  await act(deps, s, updated, v, issue);
  return updated;
}

/**
 * A customer rang one of our numbers. There is no call of ours to match, so one is recorded,
 * linked by their number to their latest saved checkout (and its order, if paid). The agent is
 * told apart by the metadata.purpose set on each Sarvam number, else by what it recorded.
 */
async function inboundCall(deps: Deps, r: CallResult): Promise<Call> {
  const { db, now } = deps;
  const phone = callableNumber(r.phone) ?? r.phone;
  const v = r.variables;
  const kind: CallKind = /feedback/i.test(r.purpose) ? 'feedback' : /cart/i.test(r.purpose) ? 'cart'
    : 'books_bought' in v || 'issue_reported' in v || 'feedback_summary' in v ? 'feedback' : 'cart';
  const [lead] = phone ? await db.select().from(checkoutLeads).where(eq(checkoutLeads.phone, phone)).orderBy(desc(checkoutLeads.updatedAt)).limit(1) : [];
  const t = now();
  const [row] = await db.insert(calls).values({
    kind, status: 'dialling', phone: phone.slice(0, 20), name: lead?.name ?? '',
    // Not leadId/orderId: those hold our own call for that checkout (one per kind).
    variables: lead ? { lead_id: lead.id, ...(lead.orderId ? { order_id: lead.orderId } : {}) } : {},
    dueAt: t, attempts: 1, providerCallId: r.providerCallId, startedAt: r.durationSeconds ? new Date(t.getTime() - r.durationSeconds * 1000) : t,
    createdBy: INBOUND, note: 'Incoming call',
  }).returning();
  return row;
}

/** The checkout behind a call: ours, or for an incoming call the one matched by number. */
const leadIdOf = (c: Call) => c.leadId ?? (c.variables.lead_id || null);

/** What the outcome asks for. Each step is independent: one failing doesn't stop the others. */
async function act(deps: Deps, s: CallSettings, c: Call, v: Record<string, unknown>, issue: boolean) {
  const { db, now } = deps;
  const tryStep = async (what: string, run: () => Promise<unknown>) => { try { await run(); } catch (e) { console.error('[calls]', what, (e as Error).message); } };
  if (c.outcome === 'do_not_call') await tryStep('do not call', () => addDoNotCall(db, c.phone, 'Asked on a call', 'customer'));
  if (c.outcome === 'callback') {
    // Call again on the next working day at the start of the hours (the admin sees the time they asked for).
    // An incoming call has nothing of ours to dial back with; our own call for that checkout is used.
    const note = `Asked to be called back${v.callback_time ? `: ${String(v.callback_time).slice(0, 120)}` : ''}`;
    await tryStep('callback', async () => {
      let target: Call | undefined = c;
      if (c.createdBy === INBOUND) {
        const leadId = leadIdOf(c);
        [target] = leadId ? await db.select().from(calls).where(and(eq(calls.leadId, leadId), eq(calls.kind, c.kind))) : [];
        if (!target) { await db.update(calls).set({ note: `${note} (no earlier call to repeat: call them yourself)`, updatedAt: now() }).where(eq(calls.id, c.id)); return; }
      }
      await db.update(calls).set({ status: 'queued', dueAt: nextCallingTime(s, new Date(now().getTime() + 20 * 3600_000)), note, updatedAt: now() }).where(eq(calls.id, target.id));
    });
  }
  const leadId = leadIdOf(c);
  if (c.kind === 'cart' && (truthy(v.wants_link) || c.outcome === 'will_order') && leadId) await tryStep('link email', () => sendResumeLink(deps, c, leadId));
  if (issue) await tryStep('issue alert', () => sendIssueAlert(deps, c, v));
  // A WhatsApp with the link and what happens next (Admin → WhatsApp → "After a call").
  await tryStep('WhatsApp', () => callWhatsApp(deps, c, true));
}

async function sendResumeLink(deps: Deps, c: Call, leadId: string) {
  const [lead] = await deps.db.select().from(checkoutLeads).where(eq(checkoutLeads.id, leadId));
  if (!lead?.email || lead.orderId) return;
  const s = await getSettings(deps.db);
  const coupon = truthy(c.result.discount_offered) && c.variables.discount_code ? c.variables.discount_code : '';
  const url = `${deps.env.SITE_URL}/checkout?resume=${lead.resumeToken}${coupon ? `&coupon=${encodeURIComponent(coupon)}` : ''}`;
  await sendSafely(deps.mailer, {
    to: lead.email, replyTo: s.supportEmail, subject: 'Your books are waiting: finish your order',
    html: layout(deps, s, {
      preheader: 'Your cart is saved', kicker: s.storeName, title: 'Your books are waiting',
      intro: `Thank you for speaking with us${lead.name ? `, ${esc(firstName(lead.name))}` : ''}. Your cart is saved: ${esc(joinSpoken(lead.items.map((i) => i.title)))}.`,
      body: (coupon ? section(p(`Use the code <strong>${esc(coupon)}</strong> at checkout.`)) : '') + section(button(url, 'Finish your order'), '4px 32px 32px'),
    }),
  });
}

async function sendIssueAlert(deps: Deps, c: Call, v: Record<string, unknown>) {
  const s = await getSettings(deps.db);
  const to = s.notifyEmails.length ? s.notifyEmails : addressList(deps.env.MAIL_TO).length ? addressList(deps.env.MAIL_TO) : [s.supportEmail];
  await sendSafely(deps.mailer, {
    to, subject: `Customer reported a problem on a feedback call: ${c.name || c.phone}`,
    html: layout(deps, s, {
      preheader: 'A problem was reported', kicker: 'Calls', title: 'A customer reported a problem',
      intro: `${esc(c.name || 'A customer')} (${esc(c.phone)}) said: ${esc(String(v.issue_detail ?? 'a problem with the order'))}`,
      body: section(button(`${deps.env.SITE_URL}/admin/calls/${c.id}`, 'Open the call'), '4px 32px 32px'),
    }),
  });
}

/* ---------------- Cash on delivery: the confirmation call ---------------- */

/** Attention reasons set here start with this, so confirming by hand can clear them. */
const COD_ATTENTION = 'COD confirmation:';

const str = (v: unknown) => (v == null ? '' : String(v).trim());

/**
 * A cash-on-delivery order was paid (its advance): it waits for confirmation, and the cart agent
 * calls a few minutes later (inside the calling hours). Returns whether a call was queued.
 */
export async function queueCodConfirmation(deps: Deps, o: Order, settings?: CallSettings): Promise<boolean> {
  const { db, now } = deps;
  if (o.paymentMode !== 'cod' || o.cancelledAt) return false;
  if (!o.codConfirmation) {
    await db.update(orders).set({ codConfirmation: 'pending', updatedAt: now() }).where(and(eq(orders.id, o.id), eq(orders.codConfirmation, '')));
    o = { ...o, codConfirmation: 'pending' };
  }
  if (o.codConfirmation !== 'pending') return false;
  const s = settings ?? await getCallSettings(db);
  if (!s.cod_confirm.enabled) return false; // the team confirms by hand
  const phone = callableNumber(o.phone);
  const blocked = !phone ? 'The phone number isn’t an Indian mobile number.' : await isDoNotCall(db, phone) ? 'The number is on the do-not-call list.' : '';
  if (blocked) {
    // Recorded once, so the owner is emailed once.
    const [row] = await db.insert(calls).values({
      kind: 'cod_confirm', status: 'skipped', phone: (phone ?? o.phone).slice(0, 20), name: o.name, orderId: o.id, dueAt: now(), note: blocked,
    }).onConflictDoNothing().returning({ id: calls.id });
    if (row) await codNotConfirmed(deps, o.id, 'pending', { kind: 'not_callable', note: blocked, callId: row.id });
    return false;
  }
  const items = await db.select({ title: orderItems.title, kind: orderItems.variantKind, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, o.id));
  const res = await db.insert(calls).values({
    kind: 'cod_confirm', phone: phone!, name: o.name, orderId: o.id,
    dueAt: nextCallingTime(s, new Date(now().getTime() + s.cod_confirm.delayMinutes * 60_000)),
    variables: {
      call_purpose: 'cod_confirmation',
      customer_name: firstName(o.name),
      order_number: String(o.number),
      order_items: joinSpoken(items.map((i) => `${i.title}${i.kind === 'digital' ? ' (e-book)' : ''}${i.quantity > 1 ? `, ${i.quantity} copies` : ''}`)),
      order_total: spokenRupees(o.total),
      advance_paid: spokenRupees(o.total - o.codAmount),
      cash_due: spokenRupees(o.codAmount),
      // The cart-recovery variables, empty: the same agent makes both calls.
      cart_items: '', cart_total: '', cod_available: 'yes', discount_code: '', discount_offer: '',
    },
  }).onConflictDoNothing().returning({ id: calls.id });
  return res.length > 0;
}

/** The call's outcome for the log: what they said about the order, or why it ended without an answer. */
function codOutcome(v: Record<string, unknown>) {
  const answer = str(v.order_confirmation).toLowerCase();
  if (answer === 'confirmed') return 'order_confirmed';
  if (answer === 'cancel_requested') return 'cancel_requested';
  const said = str(v.call_outcome);
  return ['callback', 'do_not_call', 'wrong_person'].includes(said) ? said : 'not_confirmed';
}

/** A confirmation call ended with someone on the line: act on their answer. */
async function codCallResult(deps: Deps, c: Call, v: Record<string, unknown>) {
  const { db, now } = deps;
  if (!c.orderId) return;
  const [o] = await db.select().from(orders).where(eq(orders.id, c.orderId));
  if (!o || o.cancelledAt) return;
  const detail = { transcript: c.transcript, recordingUrl: c.recordingUrl, callId: c.id };
  const change = str(v.change_request);
  if (c.outcome === 'order_confirmed') {
    // Already confirmed by the team: their confirmation stands.
    if (o.codConfirmation !== 'confirmed') {
      await db.update(orders).set({
        codConfirmation: 'confirmed', codConfirmedAt: now(), codConfirmedBy: CONFIRMED_BY_CALL,
        ...(o.needsAttention && o.attentionReason?.startsWith(COD_ATTENTION) ? { needsAttention: false } : {}), updatedAt: now(),
      }).where(eq(orders.id, o.id));
      await logEvent(db, o.id, 'cod_confirmed', 'Confirmed by the customer on the confirmation call', 'call', { callId: c.id });
    }
    if (change) {
      const reason = `${COD_ATTENTION} confirmed on the call, but asked for a change: ${change}`.slice(0, 500);
      await db.update(orders).set({ needsAttention: true, attentionReason: reason, updatedAt: now() }).where(eq(orders.id, o.id));
      await logEvent(db, o.id, 'attention', reason, 'call');
      await sendCodConfirmationAlert(deps, o, { kind: 'change', changeRequest: change, ...detail }, await getSettings(db));
    }
    return;
  }
  if (c.outcome === 'cancel_requested') {
    const reason = str(v.cancel_reason);
    const told = v.advance_refund_told === undefined || v.advance_refund_told === '' ? null : truthy(v.advance_refund_told);
    const attention = `${COD_ATTENTION} customer said no on the call${reason ? ` (${reason})` : ''}. Cancel it by hand; the advance isn’t refunded.`.slice(0, 500);
    await db.update(orders).set({ codConfirmation: 'cancel_requested', codConfirmedAt: null, codConfirmedBy: null, needsAttention: true, attentionReason: attention, updatedAt: now() }).where(eq(orders.id, o.id));
    await logEvent(db, o.id, 'cod_declined', `Customer said no on the confirmation call${reason ? `: ${reason}` : ''}`, 'call', { callId: c.id, refundTold: told });
    await sendCodConfirmationAlert(deps, o, { kind: 'said_no', reason, refundTold: told, changeRequest: change, ...detail }, await getSettings(db));
    return;
  }
  // They asked to be called back: the call is queued again (act), and the order keeps waiting.
  if (c.outcome === 'callback') return;
  // Already confirmed by the team: a muddled call changes nothing.
  if (o.codConfirmation === 'confirmed') return;
  const note = c.outcome === 'do_not_call' ? 'They asked not to be called.' : c.outcome === 'wrong_person' ? 'The person who answered said it was the wrong number.' : '';
  await codNotConfirmed(deps, o.id, 'unclear', { kind: 'unclear', note, changeRequest: change, ...detail });
}

/** Not confirmed (no answer, no clear answer, or can't be called): flag the order and email the owner, once per state. */
async function codNotConfirmed(deps: Deps, orderId: string, state: 'unreachable' | 'unclear' | 'pending', a: CodAlertDetails) {
  const { db, now } = deps;
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o || o.cancelledAt || o.codConfirmation === 'confirmed' || o.codConfirmation === 'cancel_requested') return;
  const what = { unreachable: 'no answer after every try', unclear: 'the call didn’t confirm it', not_callable: a.note ?? 'it can’t be called', said_no: '', change: '' }[a.kind];
  const reason = `${COD_ATTENTION} not confirmed (${what}). Confirm or cancel it by hand.`.slice(0, 500);
  await db.update(orders).set({ codConfirmation: state, needsAttention: true, attentionReason: reason, updatedAt: now() }).where(eq(orders.id, o.id));
  await logEvent(db, o.id, 'attention', reason, 'call', a.callId ? { callId: a.callId } : undefined);
  await sendCodConfirmationAlert(deps, o, a, await getSettings(db));
}

/** The team confirms a COD order by hand: any waiting confirmation call stops. */
export async function confirmCodByStaff(deps: Deps, orderId: string, actor: string, how = 'Confirmed by hand') {
  const { db, now } = deps;
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.paymentMode !== 'cod') throw new HttpError(409, 'Only cash-on-delivery orders are confirmed.');
  if (o.cancelledAt) throw new HttpError(409, 'This order is cancelled.');
  if (o.codConfirmation === 'confirmed') return o;
  const [u] = await db.update(orders).set({
    codConfirmation: 'confirmed', codConfirmedAt: now(), codConfirmedBy: actor,
    ...(o.needsAttention && o.attentionReason?.startsWith(COD_ATTENTION) ? { needsAttention: false } : {}), updatedAt: now(),
  }).where(eq(orders.id, o.id)).returning();
  const stopped = await db.update(calls).set({ status: 'cancelled', note: `Order confirmed by ${actor}`, updatedAt: now() })
    .where(and(eq(calls.orderId, o.id), eq(calls.kind, 'cod_confirm'), eq(calls.status, 'queued'))).returning({ id: calls.id });
  await logEvent(db, o.id, 'cod_confirmed', `${how}${stopped.length ? '; the confirmation call was stopped' : ''}`, actor);
  return u;
}

/** Have the agent call again to confirm (after no answer or an unclear call), as soon as the hours allow. */
export async function recallCodConfirmation(deps: Deps, orderId: string, actor: string) {
  const { db, now } = deps;
  const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw new HttpError(404, 'Order not found');
  if (o.paymentMode !== 'cod' || o.cancelledAt) throw new HttpError(409, 'Only active cash-on-delivery orders are confirmed by a call.');
  if (o.codConfirmation === 'confirmed') throw new HttpError(409, 'This order is already confirmed.');
  const phone = callableNumber(o.phone);
  if (!phone) throw new HttpError(409, 'The phone number isn’t an Indian mobile number.');
  if (await isDoNotCall(db, phone)) throw new HttpError(409, 'The number is on the do-not-call list.');
  const s = await getCallSettings(db);
  const [existing] = await db.select().from(calls).where(and(eq(calls.orderId, o.id), eq(calls.kind, 'cod_confirm')));
  if (existing?.status === 'dialling') throw new HttpError(409, 'The agent is on the call right now.');
  const reason = o.attentionReason?.startsWith(COD_ATTENTION) ? { needsAttention: false } : {};
  await db.update(orders).set({ codConfirmation: 'pending', ...reason, updatedAt: now() }).where(eq(orders.id, o.id));
  if (existing) {
    await db.update(calls).set({ status: 'queued', phone, attempts: 0, endedAt: null, dueAt: nextCallingTime(s, now()), note: `Queued again by ${actor}`, updatedAt: now() }).where(eq(calls.id, existing.id));
  } else {
    await queueCodConfirmation(deps, { ...o, codConfirmation: 'pending' }, { ...s, cod_confirm: { ...s.cod_confirm, enabled: true, delayMinutes: 0 } });
  }
  await logEvent(db, o.id, 'note', 'The agent will call again to confirm the order', actor);
  // Straight away when it can go out now (this call, not an older one in the queue).
  const [queued] = await db.select({ id: calls.id }).from(calls).where(and(eq(calls.orderId, o.id), eq(calls.kind, 'cod_confirm')));
  if (queued) await dialDueCalls(deps, s, 1, queued.id).catch((e) => console.error('[calls] dial', (e as Error).message));
  const [after] = await db.select().from(calls).where(and(eq(calls.orderId, o.id), eq(calls.kind, 'cod_confirm')));
  return after;
}

/** The order was cancelled: a waiting confirmation call stops. */
export async function stopCodConfirmation(deps: Deps, orderId: string, why: string) {
  await deps.db.update(calls).set({ status: 'cancelled', note: why, updatedAt: deps.now() })
    .where(and(eq(calls.orderId, orderId), eq(calls.kind, 'cod_confirm'), eq(calls.status, 'queued')));
}

/* ---------------- Numbers for the admin ---------------- */

export async function callStats(db: Q, since: Date) {
  const rows = await db.select({
    kind: calls.kind, status: calls.status, outcome: calls.outcome, inbound: sql<boolean>`${calls.createdBy} = ${INBOUND}`, n: sql<number>`count(*)::int`,
  }).from(calls).where(gte(calls.createdAt, since)).groupBy(calls.kind, calls.status, calls.outcome, sql`4`);
  const byKind = (k: CallKind) => {
    const all = rows.filter((x) => x.kind === k);
    const r = all.filter((x) => !x.inbound); // our own calls; incoming ones are counted apart
    const sum = (f: (x: (typeof r)[number]) => boolean) => r.filter(f).reduce((n, x) => n + x.n, 0);
    const attempted = sum((x) => ['done', 'no_answer', 'failed'].includes(x.status));
    const answered = sum((x) => x.status === 'done');
    return {
      incoming: all.filter((x) => x.inbound).reduce((n, x) => n + x.n, 0),
      total: sum(() => true), queued: sum((x) => x.status === 'queued'), dialling: sum((x) => x.status === 'dialling'),
      attempted, answered, answerRate: attempted ? answered / attempted : 0,
      outcomes: Object.fromEntries(r.filter((x) => x.status === 'done' && x.outcome).map((x) => [x.outcome, x.n])),
    };
  };
  // Recovered: a cart call answered, and that checkout paid afterwards.
  const [recovered] = await db.select({ n: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${orders.total}), 0)::int` })
    .from(calls).innerJoin(checkoutLeads, eq(checkoutLeads.id, calls.leadId)).innerJoin(orders, eq(orders.id, checkoutLeads.orderId))
    .where(and(eq(calls.kind, 'cart'), eq(calls.status, 'done'), gte(calls.createdAt, since), gte(orders.paidAt, calls.endedAt)));
  const [coupon] = await db.select({ n: sql<number>`count(*)::int` }).from(calls)
    .where(and(eq(calls.kind, 'cart'), gte(calls.createdAt, since), sql`${calls.result}->>'discount_offered' in ('true', 'yes', '1')`));
  const [rating] = await db.select({ avg: sql<number | null>`avg(nullif(${calls.result}->>'rating', '')::numeric)::float`, n: sql<number>`count(nullif(${calls.result}->>'rating', ''))::int` })
    .from(calls).where(and(eq(calls.kind, 'feedback'), eq(calls.status, 'done'), gte(calls.createdAt, since)));
  const [issues] = await db.select({ n: sql<number>`count(*)::int` }).from(calls).where(eq(calls.issueOpen, true));
  const daily = await db.select({
    day: sql<string>`((${calls.createdAt} at time zone 'Asia/Kolkata')::date)::text`,
    placed: sql<number>`count(*) filter (where ${calls.status} in ('done', 'no_answer', 'failed') and ${calls.createdBy} <> ${INBOUND})::int`,
    answered: sql<number>`count(*) filter (where ${calls.status} = 'done' and ${calls.createdBy} <> ${INBOUND})::int`,
    incoming: sql<number>`count(*) filter (where ${calls.createdBy} = ${INBOUND})::int`,
  }).from(calls).where(gte(calls.createdAt, since)).groupBy(sql`1`).orderBy(sql`1`);
  const [leads] = await db.select({ n: sql<number>`count(*)::int`, paid: sql<number>`count(${checkoutLeads.orderId})::int` })
    .from(checkoutLeads).where(and(eq(checkoutLeads.consent, true), gte(checkoutLeads.createdAt, since)));
  // Cash-on-delivery orders placed in the period, by where their confirmation stands.
  const codOrders = await db.select({ state: orders.codConfirmation, n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.paymentMode, 'cod'), sql`${orders.codConfirmation} <> ''`, gte(orders.createdAt, since))).groupBy(orders.codConfirmation);
  const [callable] = await db.select({ n: sql<number>`count(*)::int` }).from(subscribers)
    .where(and(eq(subscribers.status, 'subscribed'), eq(subscribers.callConsent, true)));
  return {
    subscribersCallable: callable?.n ?? 0,
    cart: byKind('cart'), cod: byKind('cod_confirm'), feedback: byKind('feedback'),
    codOrders: Object.fromEntries(codOrders.map((r) => [r.state, r.n])) as Record<string, number>,
    recovered: { orders: recovered?.n ?? 0, revenue: recovered?.revenue ?? 0 },
    couponsGiven: coupon?.n ?? 0,
    rating: { average: rating?.avg ?? null, count: rating?.n ?? 0 },
    openIssues: issues?.n ?? 0,
    leads: { total: leads?.n ?? 0, paid: leads?.paid ?? 0 },
    daily,
  };
}

export const callsNewestFirst = desc(calls.createdAt);
