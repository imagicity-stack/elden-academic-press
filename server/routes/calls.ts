// Calls: the public side (saving a checkout someone is filling in, the "finish your order" link,
// the provider's call-end webhook) and Admin → Calls. The rules are in services/calls.ts.
import { Hono } from 'hono';
import { and, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import type { Deps } from '../deps.js';
import { calls, checkoutLeads, doNotCall, orders, products } from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { body, HttpError, notFound, rateLimit } from '../lib/http.js';
import { audit } from './admin/auth.js';
import {
  addDoNotCall, callBlockers, callStats, dialDueCalls, getCallSettings, leadByToken, recordCallResult, saveCallSettings, saveLead,
} from '../services/calls.js';
import { callableNumber, DAYS, DEFAULT_CALL_SETTINGS, inCallingHours, nextCallingTime, type CallSettings } from '../../src/shared/calls.js';

/* ---------------- Public ---------------- */

export const publicCalls = new Hono<AppEnv>();

/** Save the checkout being filled in (only with consent and a mobile number). Called by the checkout page as they type. */
publicCalls.post('/checkout/lead', async (c) => {
  const deps = c.get('deps');
  await rateLimit(deps.db, `lead:${c.get('ip')}`, 60, 3600);
  const input = await body(c, z.object({
    clientKey: z.string().regex(/^[\w-]{16,64}$/),
    name: z.string().max(120).default(''),
    email: z.string().max(200).default(''),
    phone: z.string().max(20).default(''),
    consent: z.boolean(),
    items: z.array(z.object({ productId: z.string().uuid(), kind: z.enum(['print', 'digital', 'bundle']), quantity: z.number().int().min(1).max(50) })).max(60),
  }));
  return c.json(await saveLead(deps, input));
});

/** The cart behind a "finish your order" link (from the email after a call). */
publicCalls.get('/checkout/resume/:token', async (c) => {
  const deps = c.get('deps');
  await rateLimit(deps.db, `resume:${c.get('ip')}`, 60, 3600);
  const lead = await leadByToken(deps.db, c.req.param('token'));
  if (!lead) throw notFound('This link has expired. Your books are still in the store.');
  if (lead.orderId) throw new HttpError(410, 'This order has already been paid. Thank you!', 'paid');
  return c.json({ items: lead.items.map(({ productId, kind, quantity }) => ({ productId, kind, quantity })), name: lead.name, email: lead.email, phone: lead.phone.replace(/^\+91/, '') });
});

/** The provider reports how a call went. The secret in the address keeps others out. */
publicCalls.post('/calls/webhook/:secret', async (c) => {
  const deps = c.get('deps');
  const secret = deps.env.CALLS_WEBHOOK_SECRET;
  if (!secret || !safeEqual(c.req.param('secret'), secret)) throw new HttpError(401, 'Unauthorised');
  const payload = await c.req.json().catch(() => null);
  if (!payload) throw new HttpError(400, 'Expected JSON');
  const call = await recordCallResult(deps, payload);
  // 200 either way: an unknown call isn't worth the provider retrying.
  return c.json({ ok: true, matched: Boolean(call) });
});

/* ---------------- Admin → Calls ---------------- */

export const adminCalls = new Hono<AppEnv>();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const zSettings = z.object({
  enabled: z.boolean(),
  cart: z.object({
    enabled: z.boolean(), delayMinutes: z.number().int().min(15).max(4320),
    discountCode: z.string().trim().toUpperCase().max(40), discountOffer: z.string().trim().max(120),
  }).partial(),
  cod_confirm: z.object({ enabled: z.boolean(), delayMinutes: z.number().int().min(0).max(1440) }).partial(),
  feedback: z.object({
    enabled: z.boolean(), daysAfter: z.number().int().min(1).max(30), newBookIds: z.array(z.string().uuid()).max(5),
    allBuyers: z.boolean(), lookbackDays: z.number().int().min(7).max(90),
  }).partial(),
  hours: z.object({ start: hhmm, end: hhmm, days: z.array(z.enum(DAYS)).min(1) }).refine((h) => h.start < h.end, 'The start must be before the end'),
  maxRetries: z.number().int().min(0).max(5),
  retryAfterMinutes: z.number().int().min(30).max(1440),
}).partial();

adminCalls.get('/settings', async (c) => {
  const deps = c.get('deps');
  const s = await getCallSettings(deps.db);
  const books = await deps.db.select({ id: products.id, title: products.title }).from(products).where(eq(products.status, 'active')).orderBy(products.title);
  return c.json({
    settings: s, defaults: DEFAULT_CALL_SETTINGS, books,
    status: {
      connected: Boolean(deps.calls), provider: deps.calls?.name ?? null, webhook: Boolean(deps.env.CALLS_WEBHOOK_SECRET),
      inHours: inCallingHours(s, deps.now()), nextWindow: nextCallingTime(s, deps.now()),
      blockers: callBlockers(deps, s),
      // Queued calls whose time has passed by more than two cron runs: the scheduled job isn't dialling them.
      overdue: await overdueCalls(deps),
    },
  });
});

adminCalls.put('/settings', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zSettings);
  const cur = await getCallSettings(db);
  const next: CallSettings = {
    ...cur, ...input,
    cart: { ...cur.cart, ...input.cart }, cod_confirm: { ...cur.cod_confirm, ...input.cod_confirm }, feedback: { ...cur.feedback, ...input.feedback }, hours: { ...cur.hours, ...input.hours },
  };
  if (next.cart.discountCode && !next.cart.discountOffer) throw new HttpError(400, 'Say what the coupon gives (for example, 10 percent off the whole order).');
  await saveCallSettings(db, next, c.get('admin').email);
  await audit(c, 'calls.settings', 'calls', null, input);
  return c.json({ settings: next });
});

adminCalls.get('/stats', async (c) => {
  const days = Math.min(365, Math.max(1, Number(c.req.query('days')) || 30));
  return c.json(await callStats(c.get('deps').db, new Date(c.get('deps').now().getTime() - days * 86_400_000)));
});

const LIST_FIELDS = {
  id: calls.id, kind: calls.kind, status: calls.status, phone: calls.phone, name: calls.name, outcome: calls.outcome,
  dueAt: calls.dueAt, attempts: calls.attempts, startedAt: calls.startedAt, endedAt: calls.endedAt, durationSeconds: calls.durationSeconds,
  note: calls.note, issueOpen: calls.issueOpen, createdBy: calls.createdBy, createdAt: calls.createdAt,
  rating: sql<string | null>`${calls.result}->>'rating'`,
};

adminCalls.get('/', async (c) => {
  const { db } = c.get('deps');
  const q = c.req.query();
  const where: SQL[] = [];
  if (q.kind === 'cart' || q.kind === 'cod_confirm' || q.kind === 'feedback') where.push(eq(calls.kind, q.kind));
  if (q.status) where.push(inArray(calls.status, q.status.split(',') as (typeof calls.status._.data)[]));
  if (q.outcome) where.push(eq(calls.outcome, q.outcome));
  if (q.issues === '1') where.push(eq(calls.issueOpen, true));
  if (q.q?.trim()) { const like = `%${q.q.trim()}%`; where.push(or(ilike(calls.name, like), ilike(calls.phone, like))!); }
  const page = Math.max(1, Number(q.page) || 1);
  const cond = where.length ? and(...where) : undefined;
  const [items, [{ n }]] = await Promise.all([
    db.select(LIST_FIELDS).from(calls).where(cond).orderBy(q.status === 'queued' ? calls.dueAt : desc(calls.createdAt)).limit(50).offset((page - 1) * 50),
    db.select({ n: count() }).from(calls).where(cond),
  ]);
  return c.json({ items, total: n, page });
});

adminCalls.get('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const [call] = await db.select().from(calls).where(eq(calls.id, c.req.param('id')));
  if (!call) throw notFound('Call not found');
  const [lead] = call.leadId ? await db.select().from(checkoutLeads).where(eq(checkoutLeads.id, call.leadId)) : [];
  const history = await db.select(LIST_FIELDS).from(calls).where(and(eq(calls.phone, call.phone), sql`${calls.id} <> ${call.id}`)).orderBy(desc(calls.createdAt)).limit(10);
  const [dnc] = await db.select().from(doNotCall).where(eq(doNotCall.phone, call.phone));
  const [order] = call.orderId ? await db.select({
    id: orders.id, number: orders.number, total: orders.total, codAmount: orders.codAmount, paymentMode: orders.paymentMode,
    codConfirmation: orders.codConfirmation, cancelledAt: orders.cancelledAt,
  }).from(orders).where(eq(orders.id, call.orderId)) : [];
  return c.json({ call, lead: lead ? { email: lead.email, items: lead.items, total: lead.total, orderId: lead.orderId, createdAt: lead.createdAt } : null, order: order ?? null, history, doNotCall: Boolean(dnc) });
});

/**
 * Test the Sarvam connection without calling anyone: which key the live site is using (its length
 * and a few characters, never the key), the ids, and whether Sarvam accepts the key and each campaign.
 */
adminCalls.get('/connection-test', async (c) => {
  const deps = c.get('deps');
  const raw = (deps.env.SARVAM_API_KEY ?? '').replace(/^\s*["']|["']\s*$/g, '').trim();
  const key = raw ? { length: raw.length, start: raw.slice(0, 3), end: raw.slice(-4) } : null;
  const ids = { org: deps.env.SARVAM_ORG_ID ?? '', workspace: deps.env.SARVAM_WORKSPACE_ID ?? '', cart: deps.env.SARVAM_CART_CAMPAIGN_ID ?? '', feedback: deps.env.SARVAM_FEEDBACK_CAMPAIGN_ID ?? '' };
  if (!deps.calls?.check) return c.json({ connected: false, key, ids, campaigns: [] });
  return c.json({ connected: true, key, ids, campaigns: await deps.calls.check() });
});

/** Queued calls more than 25 minutes past their time (the scheduled job runs every 10). */
async function overdueCalls(deps: Deps) {
  const [r] = await deps.db.select({ n: count(), oldest: sql<string | null>`min(${calls.dueAt})` }).from(calls)
    .where(and(eq(calls.status, 'queued'), lte(calls.dueAt, new Date(deps.now().getTime() - 25 * 60_000))));
  return { count: r?.n ?? 0, oldest: r?.oldest ?? null };
}

/** Call now (dial it in the next run, hours permitting), skip it, or mark an issue handled. */
adminCalls.post('/:id{[0-9a-f-]{36}}/:action{call-now|skip|resolve}', async (c) => {
  const deps = c.get('deps');
  const id = c.req.param('id');
  const action = c.req.param('action');
  const [call] = await deps.db.select().from(calls).where(eq(calls.id, id));
  if (!call) throw notFound('Call not found');
  if (action === 'resolve') {
    await deps.db.update(calls).set({ issueOpen: false, updatedAt: deps.now() }).where(eq(calls.id, id));
  } else if (action === 'skip') {
    if (call.status !== 'queued') throw new HttpError(409, 'Only a queued call can be skipped.');
    await deps.db.update(calls).set({ status: 'skipped', note: `Skipped by ${c.get('admin').email}`, updatedAt: deps.now() }).where(eq(calls.id, id));
  } else {
    if (!['queued', 'no_answer', 'failed', 'skipped'].includes(call.status)) throw new HttpError(409, 'This call has already been made.');
    await deps.db.update(calls).set({ status: 'queued', dueAt: deps.now(), note: `Queued by ${c.get('admin').email}`, updatedAt: deps.now() }).where(eq(calls.id, id));
    // Straight away when it can go out now; if it can't, say why (it stays queued for when it can).
    const s = await getCallSettings(deps.db);
    const blockers = callBlockers(deps, s, call.kind).filter((b) => !b.startsWith('CRON_SECRET'));
    await audit(c, `calls.${action}`, 'call', id);
    if (blockers.length) throw new HttpError(409, `Not dialled: ${blockers.join(' ')}`);
    await dialDueCalls(deps, s, 1, id);
    const [after] = await deps.db.select().from(calls).where(eq(calls.id, id));
    if (after.status === 'queued') throw new HttpError(502, `Not dialled: ${after.note || 'the call could not be started'}`);
    return c.json({ call: after });
  }
  await audit(c, `calls.${action}`, 'call', id);
  const [after] = await deps.db.select().from(calls).where(eq(calls.id, id));
  return c.json({ call: after });
});

adminCalls.get('/do-not-call', async (c) => {
  const rows = await c.get('deps').db.select().from(doNotCall).orderBy(desc(doNotCall.createdAt)).limit(500);
  return c.json({ items: rows });
});

adminCalls.post('/do-not-call', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ phone: z.string().max(20), reason: z.string().trim().max(200).default('') }));
  const phone = callableNumber(input.phone);
  if (!phone) throw new HttpError(400, 'Enter a 10-digit Indian mobile number.');
  await addDoNotCall(db, phone, input.reason, 'admin');
  await audit(c, 'calls.dnc_add', 'phone', phone);
  return c.json({ ok: true, phone });
});

adminCalls.delete('/do-not-call/:phone', async (c) => {
  const { db } = c.get('deps');
  const phone = callableNumber(decodeURIComponent(c.req.param('phone')));
  if (!phone) throw notFound('Not on the list');
  await db.delete(doNotCall).where(eq(doNotCall.phone, phone));
  await audit(c, 'calls.dnc_remove', 'phone', phone);
  return c.json({ ok: true });
});

/** Checkouts saved with consent, newest first (who may be called). */
adminCalls.get('/leads', async (c) => {
  const { db } = c.get('deps');
  const rows = await db.select({
    id: checkoutLeads.id, name: checkoutLeads.name, phone: checkoutLeads.phone, email: checkoutLeads.email, total: checkoutLeads.total,
    items: checkoutLeads.items, paid: isNotNull(checkoutLeads.orderId), consent: checkoutLeads.consent, updatedAt: checkoutLeads.updatedAt,
  }).from(checkoutLeads).where(gte(checkoutLeads.updatedAt, new Date(c.get('deps').now().getTime() - 30 * 86_400_000)))
    .orderBy(desc(checkoutLeads.updatedAt)).limit(200);
  return c.json({ items: rows });
});
