import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { hmacHex } from '../server/lib/crypto.js';
import { inventoryMovements, orders, productVariants, products } from '../server/db/schema.js';
import { address, contact, setup, WEBHOOK_SECRET } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof setup>>;
let t: Ctx;

async function productBySlug(slug: string) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, slug));
  return p;
}
async function printStock(productId: string) {
  const [v] = await t.db.select().from(productVariants).where(eq(productVariants.productId, productId));
  const all = await t.db.select().from(productVariants).where(eq(productVariants.productId, productId));
  return (all.find((x) => x.kind === 'print') ?? v).stock;
}
async function checkout(items: { productId: string; kind: string; quantity: number }[], extra: Record<string, unknown> = {}) {
  return t.call('POST', '/checkout', { body: { items, contact, shipping: address, ...extra } });
}
async function pay(rzpOrderId: string, opts: { fail?: boolean } = {}) {
  const payload = t.razorpay.simulatePayment(rzpOrderId, opts);
  return { payload, res: await t.call('POST', '/checkout/verify', { body: payload }) };
}

beforeEach(async () => { t = await setup(); });

describe('catalogue', () => {
  it('lists active products with their formats', async () => {
    const r = await t.call('GET', '/catalog');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toMatch(/s-maxage/);
    const m8 = r.json.items.find((i: any) => i.slug === 'mathematics-today');
    expect(m8.formats.print.price).toBe(39500);
    expect(m8.formats.digital.price).toBe(24900);
    expect(m8.formats.bundle.price).toBeGreaterThan(39500);
    expect(r.json.categories.length).toBe(6);
    // Seeded out-of-stock title shows as unavailable in print
    const out = r.json.items.find((i: any) => i.formats.print && !i.formats.print.available);
    expect(out).toBeTruthy();
  });

  it('hides drafts', async () => {
    const p = await productBySlug('mathematics-today');
    await t.db.update(products).set({ status: 'draft' }).where(eq(products.id, p.id));
    const r = await t.call('GET', '/catalog');
    expect(r.json.items.some((i: any) => i.id === p.id)).toBe(false);
  });
});

describe('checkout and payment', () => {
  it('quotes a cart', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await t.call('POST', '/cart/quote', { body: { items: [{ productId: p.id, kind: 'bundle', quantity: 1 }], couponCode: 'WELCOME10' } });
    expect(r.status).toBe(200);
    expect(r.json.quote.discount).toBeGreaterThan(0);
    expect(r.json.quote.coupon.code).toBe('WELCOME10');
  });

  it('reserves stock, takes payment, and confirms the order once', async () => {
    const p = await productBySlug('mathematics-today');
    const before = await printStock(p.id);
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 2 }, { productId: p.id, kind: 'digital', quantity: 1 }]);
    expect(r.status).toBe(201);
    expect(r.json.razorpay.simulated).toBe(true);
    expect(r.json.total).toBe(39500 * 2 + 24900 + 0); // ₹1,039 → free shipping
    expect(await printStock(p.id)).toBe(before - 2);

    const { payload, res } = await pay(r.json.razorpay.orderId);
    expect(res.status).toBe(200);
    expect(res.json.paymentStatus).toBe('paid');
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o.invoiceNumber).toMatch(/^EAP\/\d\d-\d\d\/00001$/);
    expect(o.customerId).toBeTruthy();
    expect(o.phone).toBe('9876543210');
    expect(t.mailer.sent.map((m) => m.subject)).toEqual(expect.arrayContaining([`Order #${o.number} confirmed: your e-books are ready`, expect.stringContaining('New order')]));
    const confirmation = t.mailer.sent.find((m) => m.to === contact.email)!;
    expect(confirmation.html).toContain(`/api/orders/${o.number}/download/`);
    expect(confirmation.attachments!.map((a) => a.filename)).toEqual([expect.stringMatching(/^Elden-invoice-EAP-\d\d-\d\d-00001\.pdf$/), 'mathematics-today.pdf']);
    expect(new TextDecoder().decode(confirmation.attachments![0].content.slice(0, 5))).toBe('%PDF-');

    // Second confirmation (e.g. webhook after the browser) changes nothing
    const again = await t.call('POST', '/checkout/verify', { body: payload });
    expect(again.status).toBe(200);
    expect(t.mailer.sent.length).toBe(2);
    expect(await printStock(p.id)).toBe(before - 2);
  });

  it('rejects a forged payment signature', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }]);
    const { payload } = { payload: t.razorpay.simulatePayment(r.json.razorpay.orderId) };
    const bad = await t.call('POST', '/checkout/verify', { body: { ...payload, razorpay_signature: 'f'.repeat(64) } });
    expect(bad.status).toBe(400);
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o.paymentStatus).toBe('pending');
  });

  it('does not confirm a failed payment', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }]);
    const { res } = await pay(r.json.razorpay.orderId, { fail: true });
    expect(res.status).toBe(402);
  });

  it('never sells more printed copies than are in stock', async () => {
    const p = await productBySlug('english-grammar-practice'); // seeded with 3 copies
    expect(await printStock(p.id)).toBe(3);
    const first = await checkout([{ productId: p.id, kind: 'print', quantity: 2 }]);
    expect(first.status).toBe(201);
    const second = await checkout([{ productId: p.id, kind: 'print', quantity: 2 }]);
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('cart_changed');
    expect(await printStock(p.id)).toBe(1);
  });

  it('requires a full address, for e-books too, and validates input', async () => {
    const p = await productBySlug('mathematics-today');
    for (const kind of ['print', 'digital']) {
      const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind, quantity: 1 }], contact } });
      expect(r.status).toBe(400);
      expect(Object.keys(r.json.details)).toContain('shipping');
    }
    const bad = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact: { ...contact, phone: '123' }, shipping: { ...address, state: '99' } } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.json.details)).toEqual(expect.arrayContaining(['contact', 'shipping']));
  });

  it('keeps the billing address of an e-book order and uses its state for GST', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }], { shipping: { ...address, state: '27', city: 'Pune', pincode: '411001' } });
    expect(r.status).toBe(201);
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o).toMatchObject({ requiresShipping: false, fulfillmentStatus: 'not_required', shipLine1: address.line1, shipCity: 'Pune', billingState: '27' });
    await pay(r.json.razorpay.orderId);
    const view = await t.call('GET', `/orders/${o.number}?t=${r.json.token}`);
    expect(view.json.address).toMatchObject({ city: 'Pune', state: 'Maharashtra' });
  });

  it('releases stock when a checkout expires, and re-takes it if paid late', async () => {
    const p = await productBySlug('mathematics-today');
    const before = await printStock(p.id);
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 1 }]);
    t.setClock(new Date(Date.now() + 31 * 60_000));
    const cron = await t.call('GET', '/cron/expire-orders', { headers: { Authorization: 'Bearer cron-secret' } });
    expect(cron.json.expired).toBe(1);
    expect(await printStock(p.id)).toBe(before);
    const [expired] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(expired.paymentStatus).toBe('expired');

    const { res } = await pay(r.json.razorpay.orderId);
    expect(res.json.paymentStatus).toBe('paid');
    expect(await printStock(p.id)).toBe(before - 1);
    const moves = await t.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, r.json.orderId));
    expect(moves.map((m) => m.reason)).toEqual(['order', 'expired', 'late_payment']);
  });

  it('protects the cron endpoint', async () => {
    expect((await t.call('GET', '/cron/expire-orders')).status).toBe(401);
    expect((await t.call('GET', '/cron/expire-orders', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
  });

  it('completes a free order without payment', async () => {
    await t.db.execute(`insert into coupons (code, type, value) values ('FREEBOOK', 'percent', 100)` as never);
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }], { couponCode: 'FREEBOOK' });
    expect(r.status).toBe(201);
    expect(r.json.paid).toBe(true);
    expect(r.json.razorpay).toBeNull();
  });
});

describe('Razorpay webhooks', () => {
  const sign = (raw: string) => hmacHex(WEBHOOK_SECRET, raw);

  it('marks the order paid once, even when delivered twice', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }]);
    const { razorpay_payment_id } = t.razorpay.simulatePayment(r.json.razorpay.orderId);
    const payment = await t.razorpay.fetchPayment(razorpay_payment_id);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: payment } } });
    const headers = { 'x-razorpay-signature': sign(raw), 'x-razorpay-event-id': 'evt_1' };
    expect((await t.call('POST', '/webhooks/razorpay', { raw, headers })).status).toBe(200);
    const dup = await t.call('POST', '/webhooks/razorpay', { raw, headers });
    expect(dup.json.duplicate).toBe(true);
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o.paymentStatus).toBe('paid');
    expect(t.mailer.sent.filter((m) => m.subject.includes('confirmed')).length).toBe(1);
  });

  it('rejects unsigned webhooks', async () => {
    const raw = JSON.stringify({ event: 'payment.captured', payload: {} });
    expect((await t.call('POST', '/webhooks/razorpay', { raw, headers: { 'x-razorpay-signature': 'bad' } })).status).toBe(400);
  });

  it('flags a payment whose amount does not match', async () => {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }]);
    const raw = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: r.json.razorpay.orderId, amount: 100, currency: 'INR', status: 'captured' } } } });
    await t.call('POST', '/webhooks/razorpay', { raw, headers: { 'x-razorpay-signature': sign(raw) } });
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o.paymentStatus).toBe('pending');
    expect(o.needsAttention).toBe(true);
  });
});

describe('after purchase', () => {
  async function paidOrder() {
    const p = await productBySlug('mathematics-today');
    const r = await checkout([{ productId: p.id, kind: 'bundle', quantity: 1 }]);
    await pay(r.json.razorpay.orderId);
    return r.json as { number: number; token: string; orderId: string };
  }

  it('shows the order only with the private link', async () => {
    const o = await paidOrder();
    expect((await t.call('GET', `/orders/${o.number}`)).status).toBe(404);
    expect((await t.call('GET', `/orders/${o.number}?t=wrong`)).status).toBe(404);
    const r = await t.call('GET', `/orders/${o.number}?t=${o.token}`);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('Confirmed');
    expect(r.json.items[0].canDownload).toBe(true);
    expect(r.json.timeline.map((e: any) => [e.type, e.message])).toEqual([['created', 'Order placed'], ['paid', 'Payment received · UPI']]);
  });

  it('serves e-books through short-lived links, with a download limit', async () => {
    const o = await paidOrder();
    const status = await t.call('GET', `/orders/${o.number}?t=${o.token}`);
    const itemId = status.json.items[0].id;
    const r = await t.call('GET', `/orders/${o.number}/download/${itemId}?t=${o.token}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toMatch(/^https:\/\/files\.test\/signed\/ebooks\/samples\/mathematics-today\.pdf\?expires=300$/);
    for (let i = 1; i < 10; i++) await t.call('GET', `/orders/${o.number}/download/${itemId}?t=${o.token}`);
    const over = await t.call('GET', `/orders/${o.number}/download/${itemId}?t=${o.token}`);
    expect(over.status).toBe(403);
  });

  it('serves the invoice as a PDF', async () => {
    const o = await paidOrder();
    const res = await t.app.request(`/api/orders/${o.number}/invoice?t=${o.token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/Elden-invoice-EAP-/);
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it('finds an order by number and email or phone, and re-sends the link', async () => {
    const o = await paidOrder();
    const byPhone = await t.call('POST', '/orders/lookup', { body: { number: o.number, contact: '+91 98765 43210' } });
    expect(byPhone.status).toBe(200);
    expect(byPhone.json.status).toBe('Confirmed');
    expect((await t.call('POST', '/orders/lookup', { body: { number: o.number, contact: 'someone@else.com' } })).status).toBe(404);
    const sent = t.mailer.sent.length;
    expect((await t.call('POST', '/orders/resend', { body: { number: o.number, contact: 'ASHA@example.com' } })).status).toBe(200);
    expect(t.mailer.sent.length).toBe(sent + 1);
    expect(t.mailer.sent.at(-1)!.html).toContain(`/order/${o.number}?t=${o.token}`);
  });

  it('rate-limits lookups', async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await t.call('POST', '/orders/lookup', { body: { number: 1, contact: 'x@y.com' } })).status;
    expect(last).toBe(429);
  });
});

describe('enquiry forms', () => {
  it('stores the enquiry and emails the store', async () => {
    const r = await t.call('POST', '/enquiries', { body: { kind: 'sample', name: 'R. Sharma', email: 'r@school.in', institution: 'DAV Hazaribagh', title: 'Mathematics Today — Class 8' } });
    expect(r.status).toBe(201);
    expect(t.mailer.sent[0].subject).toBe('Sample copy request: R. Sharma, DAV Hazaribagh');
    expect(t.mailer.sent[0].replyTo).toBe('r@school.in');
  });
  it('rejects bots and empty contact details', async () => {
    expect((await t.call('POST', '/enquiries', { body: { kind: 'contact', name: 'Bot', email: 'a@b.co', website: 'spam' } })).status).toBe(400);
    expect((await t.call('POST', '/enquiries', { body: { kind: 'contact', name: 'No Contact' } })).status).toBe(400);
  });
});

describe('email copies', () => {
  it('sends customers their email, with a hidden copy to MAIL_TO', async () => {
    const m = await setup({ env: { MAIL_TO: 'hello@eldenap.in, office@eldenap.in' } });
    const [p] = await m.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await m.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await m.call('POST', '/checkout/verify', { body: m.razorpay.simulatePayment(r.json.razorpay.orderId, {}) });
    expect(m.mailer.sent).toHaveLength(1); // no separate alert: MAIL_TO already has the copy
    expect(m.mailer.sent[0]).toMatchObject({ to: contact.email, bcc: ['hello@eldenap.in', 'office@eldenap.in'], replyTo: 'hello@eldenap.in' });
  });

  it('still alerts the store when MAIL_TO is not set', async () => {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 1 }]);
    await pay(r.json.razorpay.orderId);
    expect(t.mailer.sent.map((x) => x.to)).toEqual(expect.arrayContaining([contact.email, ['hello@eldenap.in']]));
    expect(t.mailer.sent.find((x) => x.to === contact.email)!.bcc).toEqual([]);
  });
});

describe('contact form recipients', () => {
  it('sends enquiries to MAIL_TO when it is set', async () => {
    const m = await setup({ env: { MAIL_TO: 'office@eldenap.in, editor@eldenap.in' }, seed: false });
    await m.call('POST', '/enquiries', { body: { kind: 'contact', name: 'Priya', email: 'priya@example.com', message: 'Hello' } });
    expect(m.mailer.sent[0].to).toEqual(['office@eldenap.in', 'editor@eldenap.in']);
  });
});
