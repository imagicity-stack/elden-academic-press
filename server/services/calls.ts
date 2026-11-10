// Calls by the AI voice agents (Admin → Calls). Who gets called and when is decided here:
//
// - Cart recovery: someone typed a phone number at checkout and ticked "you may call or WhatsApp
//   me about this order" (a checkout lead), then didn't pay. After the delay in the settings, a
//   call is queued; if they pay first, it's skipped.
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
import { callSettings, calls, checkoutLeads, doNotCall, orderItems, orders, products, productVariants } from '../db/schema.js';
import { esc, inr } from '../lib/format.js';
import { addressList, sendSafely } from '../lib/mail.js';
import { callResultFrom, type CallResult } from '../lib/callProvider.js';
import {
  callableNumber, DEFAULT_CALL_SETTINGS, inCallingHours, nextCallingTime, OUTCOME_LABEL, type CallKind, type CallSettings,
} from '../../src/shared/calls.js';
import { getSettings } from './catalog.js';
import { button, layout, p, section } from './emails.js';

export type Call = typeof calls.$inferSelect;
export type Lead = typeof checkoutLeads.$inferSelect;

/* ---------------- Settings ---------------- */

export async function getCallSettings(db: Q): Promise<CallSettings> {
  const [row] = await db.select().from(callSettings).where(eq(callSettings.id, 1));
  const d = (row?.data ?? {}) as Partial<CallSettings>;
  return {
    ...DEFAULT_CALL_SETTINGS, ...d,
    cart: { ...DEFAULT_CALL_SETTINGS.cart, ...d.cart },
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

  if (s.feedback.enabled) {
    // Paid `daysAfter` days ago (looking back a week), whose checkout had the consent.
    const to = new Date(t.getTime() - s.feedback.daysAfter * 86_400_000);
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const due = await db.select({ order: orders, lead: checkoutLeads }).from(orders)
      .innerJoin(checkoutLeads, and(eq(checkoutLeads.orderId, orders.id), eq(checkoutLeads.consent, true)))
      .where(and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), isNull(orders.cancelledAt), gte(orders.paidAt, from), lte(orders.paidAt, to),
        sql`not exists (select 1 from ${calls} where ${calls.orderId} = ${orders.id} and ${calls.kind} = 'feedback')`)).limit(200);
    const newBooks = s.feedback.newBookIds.length
      ? await db.select({ title: products.title, blurb: products.blurb }).from(products).where(and(inArray(products.id, s.feedback.newBookIds), eq(products.status, 'active')))
      : [];
    for (const { order, lead } of due) {
      if (await isDoNotCall(db, lead.phone)) continue;
      // A printed order that hasn't arrived yet waits for delivery.
      if (order.requiresShipping && order.fulfillmentStatus !== 'delivered' && !order.deliveredAt && order.fulfillmentStatus !== 'shipped') continue;
      const items = await db.select({ title: orderItems.title, kind: orderItems.variantKind }).from(orderItems).where(eq(orderItems.orderId, order.id));
      const kinds = new Set(items.map((i) => (i.kind === 'digital' ? 'ebook' : 'print')));
      const res = await db.insert(calls).values({
        kind: 'feedback', phone: lead.phone, name: order.name, leadId: lead.id, orderId: order.id, dueAt: nextCallingTime(s, t),
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

export async function dialDueCalls(deps: Deps, s: CallSettings, limit = 10) {
  const { db, now } = deps;
  const t = now();
  // Calls that never reported back.
  const stale = await db.select().from(calls).where(and(eq(calls.status, 'dialling'), lte(calls.startedAt, new Date(t.getTime() - STALE_MS))));
  for (const c of stale) await notAnswered(deps, s, c, 'No result from the provider');

  if (!s.enabled || !deps.calls || !inCallingHours(s, t)) return 0;
  const kinds = (['cart', 'feedback'] as CallKind[]).filter((k) => s[k].enabled);
  if (!kinds.length) return 0;
  const due = await db.select().from(calls).where(and(eq(calls.status, 'queued'), lte(calls.dueAt, t), inArray(calls.kind, kinds)))
    .orderBy(asc(calls.dueAt)).limit(limit);
  let dialled = 0;
  for (const c of due) {
    if (await isDoNotCall(db, c.phone)) { await db.update(calls).set({ status: 'skipped', note: 'On the do-not-call list', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
    if (c.kind === 'cart' && c.leadId) {
      const [lead] = await db.select({ orderId: checkoutLeads.orderId, consent: checkoutLeads.consent }).from(checkoutLeads).where(eq(checkoutLeads.id, c.leadId));
      if (lead?.orderId) { await db.update(calls).set({ status: 'skipped', note: 'Paid before the call', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
      if (lead && !lead.consent) { await db.update(calls).set({ status: 'cancelled', note: 'Consent withdrawn', updatedAt: t }).where(eq(calls.id, c.id)); continue; }
    }
    // Claim it first, so two runs never dial the same call.
    const [claimed] = await db.update(calls).set({ status: 'dialling', attempts: sql`${calls.attempts} + 1`, startedAt: t, updatedAt: t })
      .where(and(eq(calls.id, c.id), eq(calls.status, 'queued'))).returning();
    if (!claimed) continue;
    try {
      const r = await deps.calls.start({ callId: c.id, kind: c.kind, phone: c.phone, variables: c.variables });
      await db.update(calls).set({ providerCallId: r.providerCallId, updatedAt: now() }).where(eq(calls.id, c.id));
      dialled++;
    } catch (e) {
      await notAnswered(deps, s, claimed, `Couldn't start the call: ${(e as Error).message}`.slice(0, 300), 'failed');
    }
  }
  return dialled;
}

/** No answer (or a failed start): try again later while attempts remain, else give up. */
async function notAnswered(deps: Deps, s: CallSettings, c: Call, note: string, finalStatus: 'no_answer' | 'failed' = 'no_answer') {
  const { db, now } = deps;
  const retry = c.attempts <= s.maxRetries;
  await db.update(calls).set(retry
    ? { status: 'queued', dueAt: nextCallingTime(s, new Date(now().getTime() + s.retryAfterMinutes * 60_000)), note, updatedAt: now() }
    : { status: finalStatus, endedAt: now(), note, updatedAt: now() }).where(eq(calls.id, c.id));
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
  if (!where) return null;
  const [c] = await db.select().from(calls).where(where);
  if (!c) return null;
  const s = await getCallSettings(db);
  if (r.status !== 'answered') {
    await notAnswered(deps, s, c, r.status === 'failed' ? 'The call failed' : 'No answer');
    return (await db.select().from(calls).where(eq(calls.id, c.id)))[0];
  }
  const v = r.variables;
  const outcome = String(v.call_outcome ?? '').trim();
  const issue = c.kind === 'feedback' && truthy(v.issue_reported);
  const [updated] = await db.update(calls).set({
    status: 'done', endedAt: now(), durationSeconds: r.durationSeconds, outcome: outcome in OUTCOME_LABEL ? outcome : outcome.slice(0, 40),
    result: v, transcript: r.transcript, recordingUrl: r.recordingUrl, issueOpen: issue, note: '', updatedAt: now(),
  }).where(eq(calls.id, c.id)).returning();
  await act(deps, s, updated, v, issue);
  return updated;
}

/** What the outcome asks for. Each step is independent: one failing doesn't stop the others. */
async function act(deps: Deps, s: CallSettings, c: Call, v: Record<string, unknown>, issue: boolean) {
  const { db, now } = deps;
  const tryStep = async (what: string, run: () => Promise<unknown>) => { try { await run(); } catch (e) { console.error('[calls]', what, (e as Error).message); } };
  if (c.outcome === 'do_not_call') await tryStep('do not call', () => addDoNotCall(db, c.phone, 'Asked on a call', 'customer'));
  if (c.outcome === 'callback') {
    // Call again on the next working day at the start of the hours (the admin sees the time they asked for).
    await tryStep('callback', () => db.update(calls).set({
      status: 'queued', dueAt: nextCallingTime(s, new Date(now().getTime() + 20 * 3600_000)),
      note: `Asked to be called back${v.callback_time ? `: ${String(v.callback_time).slice(0, 120)}` : ''}`, updatedAt: now(),
    }).where(eq(calls.id, c.id)));
  }
  if (c.kind === 'cart' && (truthy(v.wants_link) || c.outcome === 'will_order') && c.leadId) await tryStep('link email', () => sendResumeLink(deps, c));
  if (issue) await tryStep('issue alert', () => sendIssueAlert(deps, c, v));
}

async function sendResumeLink(deps: Deps, c: Call) {
  const [lead] = await deps.db.select().from(checkoutLeads).where(eq(checkoutLeads.id, c.leadId!));
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

/* ---------------- Numbers for the admin ---------------- */

export async function callStats(db: Q, since: Date) {
  const rows = await db.select({
    kind: calls.kind, status: calls.status, outcome: calls.outcome, n: sql<number>`count(*)::int`,
  }).from(calls).where(gte(calls.createdAt, since)).groupBy(calls.kind, calls.status, calls.outcome);
  const byKind = (k: CallKind) => {
    const r = rows.filter((x) => x.kind === k);
    const sum = (f: (x: (typeof r)[number]) => boolean) => r.filter(f).reduce((n, x) => n + x.n, 0);
    const attempted = sum((x) => ['done', 'no_answer', 'failed'].includes(x.status));
    const answered = sum((x) => x.status === 'done');
    return {
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
    placed: sql<number>`count(*) filter (where ${calls.status} in ('done', 'no_answer', 'failed'))::int`,
    answered: sql<number>`count(*) filter (where ${calls.status} = 'done')::int`,
  }).from(calls).where(gte(calls.createdAt, since)).groupBy(sql`1`).orderBy(sql`1`);
  const [leads] = await db.select({ n: sql<number>`count(*)::int`, paid: sql<number>`count(${checkoutLeads.orderId})::int` })
    .from(checkoutLeads).where(and(eq(checkoutLeads.consent, true), gte(checkoutLeads.createdAt, since)));
  return {
    cart: byKind('cart'), feedback: byKind('feedback'),
    recovered: { orders: recovered?.n ?? 0, revenue: recovered?.revenue ?? 0 },
    couponsGiven: coupon?.n ?? 0,
    rating: { average: rating?.avg ?? null, count: rating?.n ?? 0 },
    openIssues: issues?.n ?? 0,
    leads: { total: leads?.n ?? 0, paid: leads?.paid ?? 0 },
    daily,
  };
}

export const callsNewestFirst = desc(calls.createdAt);
