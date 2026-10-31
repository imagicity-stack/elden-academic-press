// Customer order pages: private order link, tracking lookup, invoice, e-book downloads.
import { Hono, type Context } from 'hono';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { orderEvents, orderItems, orders, productVariants } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit } from '../lib/http.js';
import { getSettings } from '../services/catalog.js';
import { sendOrderLink } from '../services/emails.js';
import { invoiceFileName, renderInvoicePdf } from '../services/invoicePdf.js';
import { stateName } from '../lib/states.js';
import { checkOrderToken, type Order } from '../services/orders.js';

export const customerOrders = new Hono<AppEnv>();

const PUBLIC_EVENTS = new Set(['created', 'paid', 'packed', 'shipped', 'delivered', 'cancelled', 'refund', 'expired']);

export function orderStatusLabel(o: Pick<Order, 'paymentStatus' | 'fulfillmentStatus' | 'cancelledAt'>): string {
  if (o.paymentStatus === 'refunded') return 'Refunded';
  if (o.cancelledAt) return 'Cancelled';
  if (o.paymentStatus === 'expired') return 'Not paid';
  if (o.paymentStatus === 'pending' || o.paymentStatus === 'failed') return 'Awaiting payment';
  return { unfulfilled: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', not_required: 'Complete' }[o.fulfillmentStatus];
}

const isPaid = (o: Order) => o.paymentStatus === 'paid' || o.paymentStatus === 'partially_refunded';

async function loadByToken(c: Context<AppEnv>, numberParam: string, token: string | undefined) {
  const deps = c.get('deps');
  const n = Number(numberParam);
  if (!Number.isInteger(n)) throw notFound('Order not found');
  const [o] = await deps.db.select().from(orders).where(eq(orders.number, n));
  if (!o || !checkOrderToken(deps.env.ORDER_LINK_SECRET, o.id, token)) throw notFound('Order not found');
  return o;
}

customerOrders.get('/:number', async (c) => {
  const deps = c.get('deps');
  const o = await loadByToken(c, c.req.param('number'), c.req.query('t'));
  const s = await getSettings(deps.db);
  const [items, events] = await Promise.all([
    deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    deps.db.select().from(orderEvents).where(eq(orderEvents.orderId, o.id)).orderBy(asc(orderEvents.createdAt)),
  ]);
  const expiry = o.paidAt && s.downloadExpiryDays > 0 ? new Date(o.paidAt.getTime() + s.downloadExpiryDays * 86400_000) : null;
  const downloadsOpen = isPaid(o) && (!expiry || expiry > deps.now());
  c.header('Cache-Control', 'no-store');
  return c.json({
    number: o.number,
    status: orderStatusLabel(o),
    paymentStatus: o.paymentStatus,
    fulfillmentStatus: o.fulfillmentStatus,
    createdAt: o.createdAt,
    paidAt: o.paidAt,
    name: o.name,
    email: o.email,
    items: items.map((i) => ({
      id: i.id, title: i.title, format: i.formatLabel, kind: i.variantKind, quantity: i.quantity, lineTotal: i.lineTotal, isDigital: i.isDigital,
      downloadsLeft: i.isDigital ? Math.max(s.maxDownloads - i.downloadsUsed, 0) : null,
      canDownload: i.isDigital && downloadsOpen && i.downloadsUsed < s.maxDownloads,
    })),
    downloadsExpireAt: expiry,
    subtotal: o.subtotal, discount: o.discount, couponCode: o.couponCode, shipping: o.shipping, tax: o.tax, total: o.total,
    refundedAmount: o.refundedAmount,
    requiresShipping: o.requiresShipping,
    address: o.shipLine1 ? { name: o.shipName, line1: o.shipLine1, line2: o.shipLine2, city: o.shipCity, state: stateName(o.shipState ?? ''), pincode: o.shipPincode } : null,
    tracking: o.shippedAt ? { courier: o.courier, number: o.trackingNumber, url: o.trackingUrl, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt } : null,
    invoice: isPaid(o) || o.paymentStatus === 'refunded' ? o.invoiceNumber : null,
    timeline: events.filter((e) => PUBLIC_EVENTS.has(e.type)).map((e) => ({ type: e.type, message: e.message, at: e.createdAt })),
  });
});

customerOrders.get('/:number/invoice', async (c) => {
  const deps = c.get('deps');
  const o = await loadByToken(c, c.req.param('number'), c.req.query('t'));
  if (!o.invoiceNumber) throw notFound('No invoice for this order yet');
  const [items, s] = await Promise.all([deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)), getSettings(deps.db)]);
  return c.body(await renderInvoicePdf(o, items, s), 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${invoiceFileName(o)}"`,
    'Cache-Control': 'no-store',
  });
});

customerOrders.get('/:number/download/:itemId', async (c) => {
  const deps = c.get('deps');
  const o = await loadByToken(c, c.req.param('number'), c.req.query('t'));
  await rateLimit(deps.db, `download:${o.id}`, 30, 3600);
  const s = await getSettings(deps.db);
  if (!isPaid(o)) throw new HttpError(403, 'Downloads are available once the order is paid.');
  if (o.paidAt && s.downloadExpiryDays > 0 && o.paidAt.getTime() + s.downloadExpiryDays * 86400_000 < deps.now().getTime()) {
    throw new HttpError(410, 'This download link has expired. Please contact us.');
  }
  const itemId = c.req.param('itemId');
  const [item] = await deps.db.update(orderItems)
    .set({ downloadsUsed: sql`${orderItems.downloadsUsed} + 1` })
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, o.id), eq(orderItems.isDigital, true), sql`${orderItems.downloadsUsed} < ${s.maxDownloads}`))
    .returning();
  if (!item) throw new HttpError(403, 'Download limit reached for this e-book. Please contact us if you need more.');
  const [v] = item.productId
    ? await deps.db.select().from(productVariants).where(and(eq(productVariants.productId, item.productId), eq(productVariants.kind, 'digital')))
    : [];
  if (!v?.filePath) throw new HttpError(404, 'This e-book file is not available. Please contact us.');
  const url = await deps.storage.signedDownloadUrl('ebooks', v.filePath, 300, v.fileName ?? `${item.title}.pdf`);
  c.header('Cache-Control', 'no-store');
  return c.redirect(url, 302);
});

const zLookup = z.object({
  number: z.coerce.number().int().positive(),
  contact: z.string().trim().min(5).max(200),
});

async function lookup(c: Context<AppEnv>) {
  const deps = c.get('deps');
  const input = await body(c, zLookup);
  await rateLimit(deps.db, `lookup:${c.get('ip')}`, 10, 900);
  const contact = input.contact.toLowerCase();
  const phone = contact.replace(/[\s-]/g, '').replace(/^\+91/, '');
  const [o] = await deps.db.select().from(orders).where(and(
    eq(orders.number, input.number),
    or(eq(orders.email, contact), eq(orders.phone, phone)),
  ));
  if (!o || o.paymentStatus === 'pending' || o.paymentStatus === 'failed') throw notFound('We couldn’t find an order with those details.');
  return o;
}

/** Track an order with its number and the email or phone used. */
customerOrders.post('/lookup', async (c) => {
  const o = await lookup(c);
  const items = await c.get('deps').db.select({ title: orderItems.title, format: orderItems.formatLabel, quantity: orderItems.quantity }).from(orderItems).where(eq(orderItems.orderId, o.id));
  return c.json({
    number: o.number, status: orderStatusLabel(o), createdAt: o.createdAt, items,
    tracking: o.shippedAt ? { courier: o.courier, number: o.trackingNumber, url: o.trackingUrl, shippedAt: o.shippedAt, deliveredAt: o.deliveredAt } : null,
    emailHint: o.email.replace(/^(.{2}).*(@.*)$/, '$1•••$2'),
  });
});

/** Email the private order link (with downloads) to the address on the order. */
customerOrders.post('/resend', async (c) => {
  const deps = c.get('deps');
  const o = await lookup(c);
  await rateLimit(deps.db, `resend:${o.id}`, 3, 3600);
  await sendOrderLink(deps, o, await getSettings(deps.db));
  return c.json({ ok: true });
});
