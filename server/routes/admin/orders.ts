import { Hono, type Context } from 'hono';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { customers, orderEvents, orderItems, orders, payments, refunds } from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound, query, zText } from '../../lib/http.js';
import { stateName } from '../../lib/states.js';
import { getSettings } from '../../services/catalog.js';
import { sendOrderConfirmation, sendRefundNotice, sendShipped } from '../../services/emails.js';
import { renderInvoice, renderPackingSlip } from '../../services/invoice.js';
import { cancelUnpaid, logEvent, orderLink, refundOrder } from '../../services/orders.js';
import { orderStatusLabel } from '../orders.js';
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
    }).from(orders).leftJoin(itemCount, eq(itemCount.orderId, orders.id)).where(where)
      .orderBy(desc(orders.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(orders).where(where),
  ]);
  return c.json({ items: rows.map((r) => ({ ...r, status: orderStatusLabel(r) })), total, page: f.page, limit: f.limit });
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
  const [items, events, pays, refs, cust] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt)),
    db.select().from(payments).where(eq(payments.orderId, o.id)).orderBy(asc(payments.createdAt)),
    db.select().from(refunds).where(eq(refunds.orderId, o.id)).orderBy(asc(refunds.createdAt)),
    o.customerId ? db.select().from(customers).where(eq(customers.id, o.customerId)) : Promise.resolve([]),
  ]);
  return c.json({
    order: { ...o, status: orderStatusLabel(o), shipStateName: stateName(o.shipState), billingStateName: stateName(o.billingState) },
    items, events, payments: pays.map(({ raw: _raw, ...p }) => p), refunds: refs, customer: cust[0] ?? null,
    customerLink: orderLink(c.get('deps'), o),
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
  const now = deps.now();
  const [u] = await deps.db.update(orders).set({
    fulfillmentStatus: input.status,
    courier: input.courier ?? o.courier,
    trackingNumber: input.trackingNumber ?? o.trackingNumber,
    trackingUrl: input.trackingUrl === '' ? null : input.trackingUrl ?? o.trackingUrl,
    packedAt: input.status === 'packed' ? now : input.status === 'unfulfilled' ? null : o.packedAt ?? now,
    shippedAt: input.status === 'shipped' ? o.shippedAt ?? now : input.status === 'delivered' ? o.shippedAt ?? now : null,
    deliveredAt: input.status === 'delivered' ? now : null,
    updatedAt: sql`now()`,
  }).where(eq(orders.id, o.id)).returning();
  const label = { unfulfilled: 'Marked as not packed', packed: 'Packed', shipped: `Shipped${u.courier ? ` with ${u.courier}` : ''}${u.trackingNumber ? ` (${u.trackingNumber})` : ''}`, delivered: 'Delivered' }[input.status];
  await logEvent(deps.db, o.id, input.status === 'unfulfilled' ? 'fulfillment' : input.status, label, c.get('admin').email);
  await audit(c, 'order.fulfillment', 'order', o.number, input);
  if (input.status === 'shipped' && input.notify && o.fulfillmentStatus !== 'shipped') await sendShipped(deps, u, await getSettings(deps.db));
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

adminOrders.post('/:id/note', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const input = await body(c, z.object({ internalNote: zText(5000) }));
  const [u] = await db.update(orders).set({ internalNote: input.internalNote, updatedAt: sql`now()` }).where(eq(orders.id, o.id)).returning();
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
  return c.html(renderInvoice(o, items, await getSettings(db)));
});

adminOrders.get('/:id/packing-slip', async (c) => {
  const { db } = c.get('deps');
  const o = await loadOrder(c);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  return c.html(renderPackingSlip(o, items, await getSettings(db)));
});
