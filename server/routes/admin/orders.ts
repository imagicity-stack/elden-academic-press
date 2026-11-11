import { Hono, type Context } from 'hono';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { calls, customers, orderEvents, orderItems, orders, payments, refunds } from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound, query, zText } from '../../lib/http.js';
import { stateName } from '../../lib/states.js';
import { getSettings } from '../../services/catalog.js';
import { sendCodCancelled, sendEbookUnlocked, sendOrderConfirmation, sendRefundNotice, sendShipped } from '../../services/emails.js';
import { renderPackingSlip } from '../../services/invoice.js';
import { invoiceFileName, renderInvoicePdf } from '../../services/invoicePdf.js';
import { cancelCodOrder, cancelUnpaid, logEvent, orderLink, refundOrder } from '../../services/orders.js';
import { confirmCodByStaff, recallCodConfirmation, stopCodConfirmation } from '../../services/calls.js';
import { orderWhatsApp } from '../../services/whatsapp.js';
import { orderStatusLabel } from '../orders.js';
import { CHANNELS, channelLabel, classify, orderChannel, type Channel, type Touch } from '../../../src/shared/attribution.js';
import { audit, requireRole } from './auth.js';

export const adminOrders = new Hono<AppEnv>();

const zList = z.object({
  q: z.string().trim().max(100).optional(),
  view: z.enum(['orders', 'abandoned', 'all']).default('orders'),
  payment: z.enum(['pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'expired']).optional(),
  fulfillment: z.enum(['unfulfilled', 'packed', 'shipped', 'delivered', 'not_required']).optional(),
  attention: z.enum(['1']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Where the order came from (a channel key, see src/shared/attribution.ts). */
  source: z.enum(CHANNELS.map((x) => x.key) as [Channel, ...Channel[]]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function filters(f: z.infer<typeof zList>): SQL | undefined {
  const w: (SQL | undefined)[] = [];
  if (f.view === 'orders') w.push(inArray(orders.paymentStatus, ['paid', 'partially_refunded', 'refunded']));
  if (f.view === 'abandoned') w.push(inArray(orders.paymentStatus, ['pending', 'expired', 'failed']));
  if (f.payment) w.push(eq(orders.paymentStatus, f.payment));
  if (f.fulfillment) w.push(eq(orders.fulfillmentStatus, f.fulfillment));
  if (f.attention) w.push(eq(orders.needsAttention, true));
  if (f.source) w.push(eq(orders.channel, f.source));
  // Dates are IST calendar days.
  if (f.from) w.push(gte(orders.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to) w.push(lte(orders.createdAt, new Date(`${f.to}T23:59:59.999+05:30`)));
  if (f.q) {
    const term = f.q.replace(/^#/, '');
    const like = `%${term.replace(/[%_]/g, '\\$&')}%`;
    w.push(or(
      /^\d+$/.test(term) ? eq(orders.number, Number(term)) : undefined,
      ilike(orders.name, like), ilike(orders.email, like), ilike(orders.phone, like), ilike(orders.invoiceNumber, like),
    ));
  }
  return and(...w);
}

adminOrders.get('/', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, zList);
  const where = filters(f);
  const itemCount = db.select({ orderId: orderItems.orderId, n: sql<number>`sum(${orderItems.quantity})::int`.as('n') }).from(orderItems).groupBy(orderItems.orderId).as('ic');
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: orders.id, number: orders.number, createdAt: orders.createdAt, name: orders.name, email: orders.email, phone: orders.phone,
      total: orders.total, paymentStatus: orders.paymentStatus, fulfillmentStatus: orders.fulfillmentStatus, cancelledAt: orders.cancelledAt,
      requiresShipping: orders.requiresShipping, needsAttention: orders.needsAttention, items: itemCount.n, shipState: orders.shipState,
      paymentMode: orders.paymentMode, codAmount: orders.codAmount, codCollectedAt: orders.codCollectedAt, codConfirmation: orders.codConfirmation,
      channel: orders.channel, source: orders.source,
    }).from(orders).leftJoin(itemCount, eq(itemCount.orderId, orders.id)).where(where)
      .orderBy(desc(orders.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(orders).where(where),
  ]);
  return c.json({
    items: rows.map(({ source, ...r }) => ({ ...r, status: orderStatusLabel(r), sourceLabel: channelLabel(r.channel), sourceDetail: source ? orderChannel(source).detail : '' })),
    total, page: f.page, limit: f.limit,
  });
});

/**
 * Where paid orders came from, in the chosen dates (the last 30 days if none): orders and revenue
 * (after refunds) per channel, and the campaigns that sold most.
 */
adminOrders.get('/sources', async (c) => {
  const { db, now } = c.get('deps');
  const f = query(c, zList);
  const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const range = f.from || f.to ? { from: f.from, to: f.to } : { from: ist(new Date(now().getTime() - 29 * 86_400_000)), to: ist(now()) };
  const where = filters({ ...f, ...range, view: 'orders', source: undefined, q: undefined, payment: undefined, fulfillment: undefined, attention: undefined });
  const revenue = sql<number>`coalesce(sum(${orders.total} - ${orders.refundedAmount}), 0)::int`;
  const campaign = sql<string>`${orders.source}->'last'->>'campaign'`;
  const [byChannel, byCampaign] = await Promise.all([
    db.select({ channel: orders.channel, orders: sql<number>`count(*)::int`, revenue }).from(orders).where(where).groupBy(orders.channel),
    db.select({ channel: orders.channel, campaign, orders: sql<number>`count(*)::int`, revenue }).from(orders)
      .where(and(where, sql`${campaign} is not null`)).groupBy(orders.channel, campaign).orderBy(desc(revenue)).limit(8),
  ]);
  const totals = { orders: byChannel.reduce((n, x) => n + x.orders, 0), revenue: byChannel.reduce((n, x) => n + x.revenue, 0) };
  return c.json({
    ...range, totals,
    channels: byChannel.map((x) => ({ ...x, label: channelLabel(x.channel), hint: CHANNELS.find((k) => k.key === x.channel)?.hint ?? '' }))
      // Older orders without a source go last, whatever their total.
      .sort((a, b) => Number(a.channel === 'unknown') - Number(b.channel === 'unknown') || b.revenue - a.revenue || b.orders - a.orders),
    campaigns: byCampaign.map((x) => ({ ...x, label: channelLabel(x.channel) })),
  });
});

adminOrders.get('/export.csv', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, zList);
  const rows = await db.select().from(orders).where(filters(f)).orderBy(desc(orders.createdAt)).limit(10_000);
  const rupees = (p: number) => (p / 100).toFixed(2);
  const csv = toCsv(rows, [
    ['Order', (r) => r.number], ['Date', (r) => r.createdAt], ['Invoice', (r) => r.invoiceNumber], ['Customer', (r) => r.name],
    ['Email', (r) => r.email], ['Phone', (r) => r.phone], ['Status', (r) => orderStatusLabel(r)], ['Payment', (r) => r.paymentStatus],
    ['Fulfilment', (r) => r.fulfillmentStatus], ['Subtotal', (r) => rupees(r.subtotal)], ['Discount', (r) => rupees(r.discount)],
    ['Coupon', (r) => r.couponCode], ['Shipping', (r) => rupees(r.shipping)], ['GST included', (r) => rupees(r.tax)], ['Total', (r) => rupees(r.total)],
    ['Refunded', (r) => rupees(r.refundedAmount)], ['Method', (r) => r.paymentMethod], ['Razorpay payment', (r) => r.razorpayPaymentId],
    ['City', (r) => r.shipCity], ['State', (r) => stateName(r.shipState ?? r.billingState)], ['PIN', (r) => r.shipPincode],
    ['Courier', (r) => r.courier], ['Tracking', (r) => r.trackingNumber],
    ['Source', (r) => channelLabel(r.channel)], ['Source detail', (r) => (r.source ? orderChannel(r.source).detail : '')],
    ['Campaign', (r) => r.source?.last?.campaign ?? ''], ['Landing page', (r) => r.source?.last?.landing ?? r.source?.first?.landing ?? ''],
  ]);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="orders.csv"' });
});

async function loadOrder(c: Context<AppEnv>) {
  const [o] = await c.get('deps').db.select().from(orders).where(eq(orders.id, c.req.param('id')!));
  if (!o) throw notFound('Order not found');
  return o;
}

adminOrders.get('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const [items, events, pays, refs, cust, codCalls] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt)),
    db.select().from(payments).where(eq(payments.orderId, o.id)).orderBy(asc(payments.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, o.id)).orderBy(asc(refunds.createdAt)),
    o.customerId ? db.select().from(customers).where(eq(customers.id, o.customerId)) : Promise.resolve([]),
    o.paymentMode === 'cod' ? db.select({
      id: calls.id, status: calls.status, outcome: calls.outcome, dueAt: calls.dueAt, attempts: calls.attempts, endedAt: calls.endedAt,
      note: calls.note, result: calls.result, transcript: calls.transcript, recordingUrl: calls.recordingUrl,
    }).from(calls).where(and(eq(calls.orderId, o.id), eq(calls.kind, 'cod_confirm'))) : Promise.resolve([]),
  ]);
  const visit = (t?: Touch) => t && { ...t, ...classify(t), label: channelLabel(classify(t).channel) };
  return c.json({
    order: { ...o, status: orderStatusLabel(o), shipStateName: stateName(o.shipState), billingStateName: stateName(o.billingState) },
    source: { channel: o.channel, label: channelLabel(o.channel), detail: o.source ? orderChannel(o.source).detail : '', first: visit(o.source?.first), last: visit(o.source?.last) },
    items, events, payments: pays.map(({ raw: _raw, ...p }) => p), refunds: refs, customer: cust[0] ?? null,
    customerLink: orderLink(c.get('deps'), o),
    codCall: codCalls[0] ?? null,
  });
});

const zFulfil = z.object({
  status: z.enum(['unfulfilled', 'packed', 'shipped', 'delivered']),
  courier: zText(80).optional(),
  trackingNumber: zText(80).optional(),
  trackingUrl: z.union([z.url().max(500), z.literal('')]).optional(),
  notify: z.boolean().default(true),
});

adminOrders.post('/:id/fulfillment', async (c) => {
  const deps = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, zFulfil);
  if (!['paid', 'partially_refunded'].includes(o.paymentStatus) || o.cancelledAt) throw new HttpError(409, 'Only paid, active orders can be fulfilled.');
  if (!o.requiresShipping) throw new HttpError(409, 'This order has nothing to ship.');
  if (input.status === 'shipped' && !input.trackingNumber && !o.trackingNumber) throw new HttpError(400, 'Add the tracking number before marking as shipped.');
  // Cash on delivery: packing or shipping an order that wasn't confirmed confirms it (and stops the call).
  if (o.paymentMode === 'cod' && input.status !== 'unfulfilled' && o.codConfirmation && o.codConfirmation !== 'confirmed') {
    await confirmCodByStaff(deps, o.id, c.get('admin').email, `Confirmed by marking it ${input.status}`);
  }
  const now = deps.now();
  const [u] = await deps.db.update(orders).set({
    fulfillmentStatus: input.status,
    courier: input.courier ?? o.courier,
    trackingNumber: input.trackingNumber ?? o.trackingNumber,
    trackingUrl: input.trackingUrl === '' ? null : input.trackingUrl ?? o.trackingUrl,
    packedAt: input.status === 'packed' ? now : input.status === 'unfulfilled' ? null : o.packedAt ?? now,
    shippedAt: input.status === 'shipped' ? o.shippedAt ?? now : input.status === 'delivered' ? o.shippedAt ?? now : null,
    deliveredAt: input.status === 'delivered' ? o.deliveredAt ?? now : null,
    // Cash on delivery: the courier collects the balance when the books are delivered.
    codCollectedAt: o.paymentMode === 'cod' ? (input.status === 'delivered' ? o.codCollectedAt ?? now : null) : null,
    updatedAt: sql`now()`,
  }).where(eq(orders.id, o.id)).returning();
  const label = { unfulfilled: 'Marked as not packed', packed: 'Packed', shipped: `Shipped${u.courier ? ` with ${u.courier}` : ''}${u.trackingNumber ? ` (${u.trackingNumber})` : ''}`, delivered: 'Delivered' }[input.status];
  await logEvent(deps.db, o.id, input.status === 'unfulfilled' ? 'fulfillment' : input.status, label, c.get('admin').email);
  await audit(c, 'order.fulfillment', 'order', o.number, input);
  if (input.status === 'shipped' && input.notify && o.fulfillmentStatus !== 'shipped') {
    await sendShipped(deps, u, await getSettings(deps.db));
    await orderWhatsApp(deps, 'shipped', u).catch((e) => console.error('[whatsapp] shipped', (e as Error).message));
  }
  if (input.status === 'delivered' && o.fulfillmentStatus !== 'delivered' && o.paymentMode === 'cod') {
    await logEvent(deps.db, o.id, 'cod_collected', `Cash on delivery: ₹${(o.codAmount / 100).toFixed(2)} collected`, c.get('admin').email);
    // Their free e-book is unlocked now: send the download links.
    const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    if (input.notify && items.some((i) => i.includesEbook)) {
      await sendEbookUnlocked(deps, u, items, await getSettings(deps.db));
      await orderWhatsApp(deps, 'ebook_ready', u).catch((e) => console.error('[whatsapp] e-book ready', (e as Error).message));
    }
  }
  return c.json({ order: u });
});

adminOrders.post('/:id/refund', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({
    amount: z.number().int().positive(), reason: zText(300).default(''), restock: z.boolean().default(false),
    cancel: z.boolean().default(false), notify: z.boolean().default(true),
  }));
  const u = await refundOrder(deps, o.id, input, c.get('admin').email);
  if (input.cancel) await stopCodConfirmation(deps, o.id, 'The order was cancelled').catch(() => undefined);
  await audit(c, 'order.refund', 'order', o.number, input);
  if (input.notify) await sendRefundNotice(deps, u, input.amount, await getSettings(deps.db));
  return c.json({ order: u });
});

adminOrders.post('/:id/cancel', async (c) => {
  const o = await loadOrder(c);
  const input = await body(c, z.object({ reason: zText(300).default('Cancelled by store') }));
  const u = await cancelUnpaid(c.get('deps'), o.id, input.reason, c.get('admin').email);
  await audit(c, 'order.cancel', 'order', o.number, input);
  return c.json({ order: u });
});

/** Cash on delivery: confirm the order by hand (the agent's call stops), or have the agent call again. */
adminOrders.post('/:id/cod-confirmation', async (c) => {
  const deps = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({ action: z.enum(['confirm', 'call']) }));
  const by = c.get('admin').email;
  if (input.action === 'confirm') await confirmCodByStaff(deps, o.id, by);
  else await recallCodConfirmation(deps, o.id, by);
  await audit(c, `order.cod_${input.action}`, 'order', o.number);
  const [u] = await deps.db.select().from(orders).where(eq(orders.id, o.id));
  return c.json({ order: u });
});

/** Cash on delivery: cancel an order that won't be delivered, keeping the (non-refundable) advance. */
adminOrders.post('/:id/cancel-cod', async (c) => {
  const deps = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({ reason: zText(300).min(3, 'Give the reason'), restock: z.boolean().default(true), notify: z.boolean().default(true) }));
  const u = await cancelCodOrder(deps, o.id, { reason: input.reason, restock: input.restock }, c.get('admin').email);
  await audit(c, 'order.cancel_cod', 'order', o.number, input);
  if (input.notify) await sendCodCancelled(deps, u, await getSettings(deps.db));
  return c.json({ order: u });
});

adminOrders.post('/:id/note', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({ internalNote: zText(5000) }));
  const [u] = await db.update(orders).set({ internalNote: input.internalNote, updatedAt: sql`now()` }).where(eq(orders.id, o.id)).returning();
  return c.json({ order: u });
});

/**
 * E-books open only in the account of the order's email. When a buyer ordered with an address
 * they can't sign in with Google as, staff give the e-books to their Google address too ('' removes it).
 */
adminOrders.post('/:id/ebook-email', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({ email: z.union([z.literal(''), z.email().max(200)]) }));
  const email = input.email.trim().toLowerCase() || null;
  if (email && email === o.email.toLowerCase()) throw new HttpError(400, 'That’s already the order’s email.');
  const [u] = await db.update(orders).set({ ebookEmail: email, updatedAt: sql`now()` }).where(eq(orders.id, o.id)).returning();
  await logEvent(db, o.id, 'note', email ? `E-books also opened for ${email}` : 'Removed the extra e-book email', c.get('admin').email);
  await audit(c, 'order.ebook_email', 'order', o.number, { email });
  return c.json({ order: u });
});

adminOrders.post('/:id/resolve', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const [u] = await db.update(orders).set({ needsAttention: false, updatedAt: sql`now()` }).where(eq(orders.id, o.id)).returning();
  await logEvent(db, o.id, 'resolved', `Marked as resolved: ${o.attentionReason ?? ''}`, c.get('admin').email);
  await audit(c, 'order.resolve', 'order', o.number);
  return c.json({ order: u });
});

adminOrders.post('/:id/resend', async (c) => {
  const deps = c.get('deps');
  const o = await loadOrder(c);
  if (!['paid', 'partially_refunded'].includes(o.paymentStatus)) throw new HttpError(409, 'The order isn’t paid.');
  const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  await sendOrderConfirmation(deps, o, items, await getSettings(deps.db));
  await logEvent(deps.db, o.id, 'email', 'Confirmation email re-sent', c.get('admin').email);
  return c.json({ ok: true });
});

adminOrders.get('/:id/invoice', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  if (!o.invoiceNumber) throw notFound('No invoice yet');
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  return c.body(await renderInvoicePdf(o, items, await getSettings(db)), 200, {
    'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${invoiceFileName(o)}"`, 'Cache-Control': 'no-store',
  });
});

adminOrders.get('/:id/packing-slip', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  return c.html(renderPackingSlip(o, items, await getSettings(db)));
});
