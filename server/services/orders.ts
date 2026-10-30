import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q, Tx } from '../db/client.js';
import {
  customers, coupons, inventoryMovements, invoiceCounters, orderEvents, orderItems, orders, payments, productVariants, refunds,
} from '../db/schema.js';
import { hmacHex, safeEqual } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { priceCart, type CartLineInput, type Quote } from '../lib/pricing.js';
import type { RzpPayment } from '../lib/razorpay.js';
import { findCoupon, getSettings, loadPricingProducts, type Settings } from './catalog.js';
import { sendOrderConfirmation, sendStoreNewOrder } from './emails.js';

export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;

/* ---------------- Customer order links ---------------- */

export const orderToken = (secret: string, orderId: string) =>
  Buffer.from(hmacHex(secret, 'order:' + orderId), 'hex').toString('base64url');
export const checkOrderToken = (secret: string, orderId: string, token: string | undefined) =>
  Boolean(token) && safeEqual(orderToken(secret, orderId), token!);
export const orderLink = (deps: Deps, o: Pick<Order, 'id' | 'number'>) =>
  `${deps.env.SITE_URL}/order/${o.number}?t=${orderToken(deps.env.ORDER_LINK_SECRET, o.id)}`;

export async function logEvent(q: Q, orderId: string, type: string, message: string, actor = 'system', data?: unknown) {
  await q.insert(orderEvents).values({ orderId, type, message, actor, data: data ?? null });
}

/* ---------------- Quotes ---------------- */

export async function quote(db: Q, input: { items: CartLineInput[]; couponCode?: string | null; placeOfSupply?: string | null }, now: Date) {
  const [s, products, coupon] = await Promise.all([
    getSettings(db),
    loadPricingProducts(db, input.items.map((i) => i.productId)),
    findCoupon(db, input.couponCode),
  ]);
  const q = priceCart({ items: input.items, products, settings: s, coupon, couponCode: input.couponCode, placeOfSupply: input.placeOfSupply, now });
  return { quote: q, settings: s };
}

/* ---------------- Stock ---------------- */

/** Print copies held by an order, per product. */
function printQuantities(items: Pick<OrderItem, 'productId' | 'requiresShipping' | 'quantity'>[]) {
  const m = new Map<string, number>();
  for (const it of items) if (it.requiresShipping && it.productId) m.set(it.productId, (m.get(it.productId) ?? 0) + it.quantity);
  return m;
}

/** Take stock for an order. Returns false (and changes nothing in this tx) if any title is short. */
async function reserveStock(tx: Tx, orderId: string, wanted: Map<string, number>, reason: string, actor: string): Promise<boolean> {
  for (const [productId, qty] of wanted) {
    const [row] = await tx.update(productVariants)
      .set({ stock: sql`CASE WHEN ${productVariants.trackStock} THEN ${productVariants.stock} - ${qty} ELSE ${productVariants.stock} END`, updatedAt: sql`now()` })
      .where(and(
        eq(productVariants.productId, productId),
        eq(productVariants.kind, 'print'),
        sql`(NOT ${productVariants.trackStock} OR ${productVariants.stock} >= ${qty})`,
      ))
      .returning({ id: productVariants.id, stock: productVariants.stock, track: productVariants.trackStock });
    if (!row) return false;
    if (row.track) await tx.insert(inventoryMovements).values({ variantId: row.id, delta: -qty, stockAfter: row.stock, reason, orderId, actor });
  }
  return true;
}

async function releaseStock(tx: Tx, order: Order, reason: string, actor: string) {
  if (!order.stockReserved) return;
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  for (const [productId, qty] of printQuantities(items)) {
    const [row] = await tx.update(productVariants)
      .set({ stock: sql`${productVariants.stock} + ${qty}`, updatedAt: sql`now()` })
      .where(and(eq(productVariants.productId, productId), eq(productVariants.kind, 'print'), eq(productVariants.trackStock, true)))
      .returning({ id: productVariants.id, stock: productVariants.stock });
    if (row) await tx.insert(inventoryMovements).values({ variantId: row.id, delta: qty, stockAfter: row.stock, reason, orderId: order.id, actor });
  }
  await tx.update(orders).set({ stockReserved: false, updatedAt: sql`now()` }).where(eq(orders.id, order.id));
}

/* ---------------- Checkout ---------------- */

export interface CheckoutInput {
  items: CartLineInput[];
  couponCode?: string | null;
  contact: { name: string; email: string; phone: string };
  shipping?: { name: string; line1: string; line2?: string; city: string; state: string; pincode: string } | null;
  billingState: string;
  note?: string;
}

export async function createOrder(deps: Deps, input: CheckoutInput, ip: string) {
  const { db, razorpay, env } = deps;
  if (!razorpay) throw new HttpError(503, 'Online payments are not available right now. Please contact us to order.', 'payments_unavailable');

  const placeOfSupply = input.shipping?.state ?? input.billingState;
  const { quote: q, settings: s } = await quote(db, { items: input.items, couponCode: input.couponCode, placeOfSupply }, deps.now());
  if (!q.ok) throw new HttpError(409, q.couponError ?? 'Some items in your cart need attention.', 'cart_changed', q);
  if (q.requiresShipping && !input.shipping) throw new HttpError(400, 'A delivery address is needed for printed books.', 'address_required');

  if (q.coupon) {
    const [c] = await db.select().from(coupons).where(eq(coupons.code, q.coupon.code));
    if (c?.oncePerCustomer) {
      const [used] = await db.select({ id: orders.id }).from(orders).where(and(
        eq(orders.couponCode, c.code), eq(orders.email, input.contact.email), inArray(orders.paymentStatus, ['paid', 'partially_refunded']),
      )).limit(1);
      if (used) throw new HttpError(409, 'This code has already been used with your email address.', 'coupon_used', q);
    }
  }

  const expiresAt = new Date(deps.now().getTime() + s.orderExpiryMinutes * 60_000);
  const order = await db.transaction(async (tx) => {
    const ship = q.requiresShipping ? input.shipping! : null;
    const [o] = await tx.insert(orders).values({
      name: input.contact.name,
      email: input.contact.email,
      phone: input.contact.phone,
      shipName: ship?.name ?? null,
      shipLine1: ship?.line1 ?? null,
      shipLine2: ship?.line2 || null,
      shipCity: ship?.city ?? null,
      shipState: ship?.state ?? null,
      shipPincode: ship?.pincode ?? null,
      billingState: placeOfSupply,
      requiresShipping: q.requiresShipping,
      subtotal: q.subtotal,
      discount: q.discount,
      shipping: q.shipping,
      tax: q.tax,
      total: q.total,
      couponCode: q.coupon?.code ?? null,
      fulfillmentStatus: q.requiresShipping ? 'unfulfilled' : 'not_required',
      expiresAt,
      stockReserved: true,
      customerNote: input.note ?? '',
      ip,
    }).returning();
    await tx.insert(orderItems).values(q.lines.map((l) => ({
      orderId: o.id,
      productId: l.productId,
      variantKind: l.kind,
      title: l.title,
      formatLabel: l.formatLabel,
      sku: l.sku,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.lineTotal,
      discount: l.discount,
      taxableValue: l.taxableValue,
      taxAmount: l.taxAmount,
      taxRate: l.taxRate,
      requiresShipping: l.requiresShipping,
      isDigital: l.isDigital,
      weightGrams: l.weightGrams,
    })));
    const wanted = printQuantities(q.lines.map((l) => ({ productId: l.productId, requiresShipping: l.requiresShipping, quantity: l.quantity })));
    if (!(await reserveStock(tx, o.id, wanted, 'order', 'checkout'))) {
      throw new HttpError(409, 'Sorry — one of the printed books just sold out. Please review your cart.', 'out_of_stock');
    }
    await logEvent(tx, o.id, 'created', 'Order placed, awaiting payment', 'customer');
    return o;
  });

  // Free orders (e.g. a 100% coupon) need no payment.
  if (order.total === 0) {
    const paid = await markPaid(deps, order.id, { id: `free_${order.number}`, amount: 0, status: 'captured', method: 'free', order_id: '', currency: 'INR' }, 'system');
    return { order: paid.order, token: orderToken(env.ORDER_LINK_SECRET, order.id), razorpay: null, quote: q };
  }

  let rzpOrderId: string;
  try {
    const r = await razorpay.createOrder({ amount: order.total, receipt: `EAP-${order.number}`, notes: { order_id: order.id, order_number: String(order.number) } });
    rzpOrderId = r.id;
  } catch (e) {
    await db.transaction(async (tx) => {
      await releaseStock(tx, order, 'payment_setup_failed', 'system');
      await tx.update(orders).set({ paymentStatus: 'failed', updatedAt: sql`now()` }).where(eq(orders.id, order.id));
      await logEvent(tx, order.id, 'payment_error', 'Could not start payment: ' + (e as Error).message);
    });
    throw new HttpError(502, 'We couldn’t start the payment. Please try again in a moment.', 'gateway_error');
  }
  await db.update(orders).set({ razorpayOrderId: rzpOrderId, updatedAt: sql`now()` }).where(eq(orders.id, order.id));

  return {
    order: { ...order, razorpayOrderId: rzpOrderId },
    token: orderToken(env.ORDER_LINK_SECRET, order.id),
    razorpay: { keyId: razorpay.keyId, orderId: rzpOrderId, amount: order.total, currency: 'INR', simulated: razorpay.simulated },
    quote: q as Quote,
  };
}

/* ---------------- Payment confirmation ---------------- */

/** Financial year label for an Indian invoice date, e.g. "27-28". */
export function financialYear(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

async function nextInvoiceNumber(tx: Tx, s: Settings, at: Date) {
  const fy = financialYear(at);
  const [row] = await tx.insert(invoiceCounters).values({ fy, last: 1 })
    .onConflictDoUpdate({ target: invoiceCounters.fy, set: { last: sql`${invoiceCounters.last} + 1` } })
    .returning({ last: invoiceCounters.last });
  return `${s.invoicePrefix}/${fy}/${String(row.last).padStart(5, '0')}`;
}

/**
 * Record a captured payment against an order. Idempotent: the browser callback
 * and Razorpay's webhook may both arrive, in any order, any number of times.
 */
export async function markPaid(deps: Deps, orderId: string, payment: Pick<RzpPayment, 'id' | 'amount' | 'status' | 'method' | 'order_id' | 'currency'> & Partial<RzpPayment>, actor: string) {
  const result = await deps.db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!o) throw new HttpError(404, 'Order not found');

    await tx.insert(payments).values({
      orderId: o.id,
      razorpayPaymentId: payment.id,
      razorpayOrderId: payment.order_id || (o.razorpayOrderId ?? ''),
      amount: payment.amount,
      status: payment.status,
      method: payment.method ?? null,
      raw: payment,
    }).onConflictDoUpdate({ target: payments.razorpayPaymentId, set: { status: payment.status, updatedAt: sql`now()` } });

    if (['paid', 'partially_refunded', 'refunded'].includes(o.paymentStatus)) {
      if (o.razorpayPaymentId && o.razorpayPaymentId !== payment.id) {
        // A second successful payment for the same order — must be refunded by hand.
        await tx.update(orders).set({ needsAttention: true, attentionReason: `Duplicate payment ${payment.id} received — refund it in Razorpay.`, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
        await logEvent(tx, o.id, 'duplicate_payment', `Second payment ${payment.id} received for an already-paid order`, actor);
      }
      return { order: o, newlyPaid: false };
    }

    if (payment.amount !== o.total || (payment.currency && payment.currency !== 'INR')) {
      await tx.update(orders).set({ needsAttention: true, attentionReason: `Payment amount ${payment.amount} does not match order total ${o.total}.`, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
      await logEvent(tx, o.id, 'amount_mismatch', `Payment ${payment.id} amount ${payment.amount} ≠ order total ${o.total}`, actor);
      return { order: o, newlyPaid: false };
    }

    const s = await getSettings(tx);
    const now = deps.now();
    let attention: string | null = null;
    let stockReserved = o.stockReserved;
    if (!o.stockReserved) {
      // Paid after the reservation lapsed: take the stock again if it is still there.
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, o.id));
      const wanted = printQuantities(items);
      if (wanted.size === 0) stockReserved = false;
      else {
        const ok = await tx.transaction(async (inner) => {
          if (await reserveStock(inner, o.id, wanted, 'late_payment', actor)) return true;
          inner.rollback();
          return false;
        }).catch(() => false);
        stockReserved = ok;
        if (!ok) attention = 'Paid after the reservation expired and some printed copies are no longer in stock.';
      }
    }

    const invoiceNumber = await nextInvoiceNumber(tx, s, now);

    // Customer record (guest checkout: one per email address)
    const [cust] = await tx.insert(customers).values({
      email: o.email, phone: o.phone, name: o.name, ordersCount: 1, totalSpent: o.total, firstOrderAt: now, lastOrderAt: now,
    }).onConflictDoUpdate({
      target: customers.email,
      set: {
        phone: o.phone, name: o.name,
        ordersCount: sql`${customers.ordersCount} + 1`,
        totalSpent: sql`${customers.totalSpent} + ${o.total}`,
        lastOrderAt: now,
        updatedAt: sql`now()`,
      },
    }).returning({ id: customers.id });

    if (o.couponCode) await tx.update(coupons).set({ usedCount: sql`${coupons.usedCount} + 1` }).where(eq(coupons.code, o.couponCode));

    const [paid] = await tx.update(orders).set({
      paymentStatus: 'paid',
      paidAt: now,
      razorpayPaymentId: payment.id,
      paymentMethod: payment.method ?? null,
      expiresAt: null,
      cancelledAt: null,
      cancelReason: null,
      stockReserved,
      invoiceNumber,
      invoiceDate: now,
      customerId: cust.id,
      needsAttention: attention ? true : o.needsAttention,
      attentionReason: attention ?? o.attentionReason,
      updatedAt: sql`now()`,
    }).where(eq(orders.id, o.id)).returning();
    await logEvent(tx, o.id, 'paid', `Payment received${payment.method ? ` (${payment.method})` : ''}`, actor, { paymentId: payment.id });
    if (attention) await logEvent(tx, o.id, 'attention', attention, 'system');
    return { order: paid, newlyPaid: true };
  });

  if (result.newlyPaid) {
    const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const s = await getSettings(deps.db);
    await Promise.all([
      sendOrderConfirmation(deps, result.order, items, s),
      sendStoreNewOrder(deps, result.order, items, s),
    ]);
  }
  return result;
}

/** Look up a Razorpay payment, capture it if only authorised, and record it. */
export async function confirmRazorpayPayment(deps: Deps, order: Order, paymentId: string, actor: string) {
  const rzp = deps.razorpay!;
  let p = await rzp.fetchPayment(paymentId);
  if (p.order_id !== order.razorpayOrderId) throw new HttpError(400, 'Payment does not belong to this order.', 'payment_mismatch');
  if (p.status === 'authorized') p = await rzp.capturePayment(p.id, p.amount);
  if (p.status !== 'captured') {
    await logEvent(deps.db, order.id, 'payment_failed', `Payment ${p.id} is ${p.status}${p.error_description ? `: ${p.error_description}` : ''}`, actor);
    throw new HttpError(402, 'The payment didn’t go through. You haven’t been charged — please try again.', 'payment_failed');
  }
  return markPaid(deps, order.id, p, actor);
}

/* ---------------- Expiry, cancellation, refunds ---------------- */

/** Release stock held by checkouts that were never paid. */
export async function expireOrders(deps: Deps, limit = 200) {
  const stale = await deps.db.select({ id: orders.id }).from(orders)
    .where(and(eq(orders.paymentStatus, 'pending'), lt(orders.expiresAt, deps.now())))
    .limit(limit);
  for (const { id } of stale) {
    await deps.db.transaction(async (tx) => {
      const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!o || o.paymentStatus !== 'pending') return;
      await releaseStock(tx, o, 'expired', 'system');
      await tx.update(orders).set({ paymentStatus: 'expired', cancelledAt: deps.now(), cancelReason: 'Not paid in time', updatedAt: sql`now()` }).where(eq(orders.id, o.id));
      await logEvent(tx, o.id, 'expired', 'Checkout expired without payment; stock released');
    });
  }
  return stale.length;
}

export async function cancelUnpaid(deps: Deps, orderId: string, reason: string, actor: string) {
  return deps.db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.paymentStatus !== 'pending' && o.paymentStatus !== 'failed') throw new HttpError(409, 'Paid orders are cancelled with a refund.');
    await releaseStock(tx, o, 'cancelled', actor);
    const [u] = await tx.update(orders).set({ paymentStatus: o.paymentStatus === 'pending' ? 'expired' : o.paymentStatus, cancelledAt: deps.now(), cancelReason: reason, updatedAt: sql`now()` })
      .where(eq(orders.id, o.id)).returning();
    await logEvent(tx, o.id, 'cancelled', `Order cancelled: ${reason}`, actor);
    return u;
  });
}

/**
 * Refund all or part of a paid order through Razorpay. Optionally puts the
 * printed copies back in stock and cancels the order.
 */
export async function refundOrder(deps: Deps, orderId: string, args: { amount: number; reason: string; restock: boolean; cancel: boolean }, actor: string) {
  const [o] = await deps.db.select().from(orders).where(eq(orders.id, orderId));
  if (!o) throw new HttpError(404, 'Order not found');
  if (!['paid', 'partially_refunded'].includes(o.paymentStatus) || !o.razorpayPaymentId) throw new HttpError(409, 'Only paid orders can be refunded.');
  const refundable = o.total - o.refundedAmount;
  if (args.amount <= 0 || args.amount > refundable) throw new HttpError(400, `You can refund up to ₹${(refundable / 100).toFixed(2)}.`);

  let refund: { id: string; status: string } = { id: '', status: 'processed' };
  if (o.total > 0 && !o.razorpayPaymentId.startsWith('free_')) {
    if (!deps.razorpay) throw new HttpError(503, 'Payments are not configured.');
    refund = await deps.razorpay.refund(o.razorpayPaymentId, { amount: args.amount, notes: { order_number: String(o.number), reason: args.reason.slice(0, 200) } });
  }

  return deps.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
    const refunded = cur.refundedAmount + args.amount;
    const full = refunded >= cur.total;
    await tx.insert(refunds).values({
      orderId, razorpayRefundId: refund.id || null, razorpayPaymentId: cur.razorpayPaymentId!, amount: args.amount,
      status: refund.status === 'processed' ? 'processed' : 'pending', reason: args.reason, restocked: args.restock && cur.stockReserved, actor,
    });
    if (args.restock && cur.stockReserved) await releaseStock(tx, cur, 'refund', actor);
    const [u] = await tx.update(orders).set({
      refundedAmount: refunded,
      paymentStatus: full ? 'refunded' : 'partially_refunded',
      cancelledAt: args.cancel ? deps.now() : cur.cancelledAt,
      cancelReason: args.cancel ? args.reason : cur.cancelReason,
      updatedAt: sql`now()`,
    }).where(eq(orders.id, orderId)).returning();
    if (cur.customerId) await tx.update(customers).set({ totalSpent: sql`greatest(${customers.totalSpent} - ${args.amount}, 0)` }).where(eq(customers.id, cur.customerId));
    await logEvent(tx, orderId, 'refund', `Refunded ₹${(args.amount / 100).toFixed(2)}${args.reason ? ` — ${args.reason}` : ''}`, actor, { refundId: refund.id });
    if (args.cancel) await logEvent(tx, orderId, 'cancelled', 'Order cancelled', actor);
    return u;
  });
}
