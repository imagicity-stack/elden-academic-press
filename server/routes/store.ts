// Public storefront API: catalogue, cart quotes, checkout and payment confirmation.
import { Hono } from 'hono';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { orders, resources } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit, zEmail, zName, zPhone, zPincode, zText } from '../lib/http.js';
import { MAX_QTY } from '../lib/pricing.js';
import { STATES, isStateCode } from '../lib/states.js';
import { getSettings, loadCatalog } from '../services/catalog.js';
import { confirmRazorpayPayment, createOrder, logEvent, orderToken, quote } from '../services/orders.js';

const zState = z.string().refine(isStateCode, 'Choose a state');
const zItems = z.array(z.object({
  productId: z.uuid(),
  kind: z.enum(['print', 'digital', 'bundle']),
  quantity: z.number().int().min(1).max(MAX_QTY.print),
})).min(1, 'Your cart is empty').max(60);
const zCoupon = z.string().trim().max(40).optional().nullable();

export const store = new Hono<AppEnv>();

store.get('/config', async (c) => {
  const { db, razorpay } = c.get('deps');
  const s = await getSettings(db);
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300');
  return c.json({
    storeName: s.storeName,
    payments: razorpay ? { keyId: razorpay.keyId, simulated: razorpay.simulated } : null,
    shipping: { flat: s.shippingFlat, freeAbove: s.freeShippingAbove },
    states: STATES,
    supportEmail: s.supportEmail,
  });
});

store.get('/catalog', async (c) => {
  const { db, storage } = c.get('deps');
  const data = await loadCatalog(db, storage);
  // Cached at Vercel's edge for a minute; admins' edits show up within that.
  c.header('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=600');
  return c.json(data);
});

store.get('/resources', async (c) => {
  const { db, storage } = c.get('deps');
  const rows = await db.select().from(resources).where(eq(resources.published, true)).orderBy(asc(resources.sort), asc(resources.title));
  c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
  return c.json({
    items: rows.map((r) => ({
      id: r.id, title: r.title, kind: r.kind, level: r.level, subject: r.subject, size: r.fileSize,
      url: r.filePath ? storage.publicUrl('resources', r.filePath) : null,
    })),
  });
});

store.post('/cart/quote', async (c) => {
  const { db, now } = c.get('deps');
  const input = await body(c, z.object({ items: z.array(zItems.element).max(60), couponCode: zCoupon, state: zState.optional().nullable() }));
  if (!input.items.length) return c.json({ quote: null });
  const { quote: q } = await quote(db, { items: input.items, couponCode: input.couponCode, placeOfSupply: input.state }, now());
  return c.json({ quote: q });
});

const zCheckout = z.object({
  items: zItems,
  couponCode: zCoupon,
  contact: z.object({ name: zName, email: zEmail, phone: zPhone }),
  /** Delivery address for printed books; billing address for e-book-only orders. Always required. */
  shipping: z.object({
    name: zName,
    line1: z.string().trim().min(3, 'Enter the house / street').max(200),
    line2: zText(200).optional(),
    city: z.string().trim().min(2, 'Enter the city').max(80),
    state: zState,
    pincode: zPincode,
  }, { error: 'Enter your address' }),
  /** Older clients sent the state separately; the address's state is used now. */
  billingState: zState.optional(),
  note: zText(500).optional(),
  /** Honeypot: real people never fill this in. */
  website: z.string().max(0).optional(),
});

store.post('/checkout', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, zCheckout);
  await rateLimit(deps.db, `checkout:${c.get('ip')}`, 20, 3600);
  const r = await createOrder(deps, input, c.get('ip'));
  return c.json({
    orderId: r.order.id,
    number: r.order.number,
    token: r.token,
    total: r.order.total,
    paid: r.order.paymentStatus === 'paid',
    razorpay: r.razorpay,
    prefill: { name: input.contact.name, email: input.contact.email, contact: input.contact.phone },
  }, 201);
});

/** Razorpay Checkout's success handler posts here with the signed payment ids. */
store.post('/checkout/verify', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({
    razorpay_order_id: z.string().min(5).max(64),
    razorpay_payment_id: z.string().min(5).max(64),
    razorpay_signature: z.string().min(10).max(256),
  }));
  if (!deps.razorpay) throw new HttpError(503, 'Payments are not configured.');
  const [o] = await deps.db.select().from(orders).where(eq(orders.razorpayOrderId, input.razorpay_order_id));
  if (!o) throw notFound('Order not found');
  if (!deps.razorpay.verifyPaymentSignature(input.razorpay_order_id, input.razorpay_payment_id, input.razorpay_signature)) {
    await logEvent(deps.db, o.id, 'signature_invalid', 'A payment confirmation with an invalid signature was rejected', 'customer');
    throw new HttpError(400, 'We couldn’t verify this payment.', 'bad_signature');
  }
  const { order } = await confirmRazorpayPayment(deps, o, input.razorpay_payment_id, 'customer');
  return c.json({ number: order.number, token: orderToken(deps.env.ORDER_LINK_SECRET, order.id), paymentStatus: order.paymentStatus });
});

/** The customer closed or failed the payment window; keeps a note on the order. */
store.post('/checkout/abandoned', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ razorpayOrderId: z.string().max(64), reason: zText(300).optional() }));
  const [o] = await db.select({ id: orders.id, status: orders.paymentStatus }).from(orders).where(and(eq(orders.razorpayOrderId, input.razorpayOrderId)));
  if (o && o.status === 'pending') await logEvent(db, o.id, 'payment_abandoned', input.reason ? `Payment not completed: ${input.reason}` : 'Payment window closed', 'customer');
  return c.json({ ok: true });
});
