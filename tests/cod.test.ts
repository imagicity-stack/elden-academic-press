import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { orders, products, productVariants, settings } from '../server/db/schema.js';
import { codAdvanceFor } from '../src/shared/cod.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken(OWNER)}` });

async function book() {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  await t.db.update(products).set({ ebookWithPrint: true }).where(eq(products.id, p.id));
  return p;
}
const checkout = (items: { productId: string; kind: string; quantity: number }[], paymentMode: 'online' | 'cod') =>
  t.call('POST', '/checkout', { body: { items, contact, shipping: address, paymentMode } });

describe('cash on delivery', () => {
  it('takes the advance online, then unlocks the free e-book on delivery', async () => {
    const p = await book();
    expect((await t.call('GET', '/config')).json.cod).toEqual({ type: 'flat', advance: 6000, bps: 1000, min: 0 });
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 2 }], 'cod');
    expect(r.status).toBe(201);
    expect(r.json.razorpay.amount).toBe(6000);
    const total = r.json.total as number;

    t.mailer.sent.length = 0;
    const paid = await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    expect(paid.json.paymentStatus).toBe('paid');
    const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
    expect(o).toMatchObject({ paymentMode: 'cod', codAmount: total - 6000, needsAttention: false, codCollectedAt: null });

    // The order page: the balance to pay in cash, and the free e-book waits for delivery.
    const view = await t.call('GET', `/orders/${r.json.number}?t=${r.json.token}`);
    expect(view.json).toMatchObject({ paymentMode: 'cod', paidOnline: 6000, codAmount: total - 6000, ebooksAfterDelivery: true });
    expect(view.json.items[0]).toMatchObject({ canDownload: false });
    expect(view.json.items[0].files.length).toBeGreaterThan(0);
    const item = view.json.items[0].id;
    const buyer = { authorization: `Bearer ${await supabaseToken({ sub: '33333333-3333-4333-8333-333333333333', email: contact.email, provider: 'google', name: 'Asha' })}` };
    await t.call('GET', '/account', { headers: buyer });
    const early = await t.call('POST', `/account/library/${item}/download`, { headers: buyer });
    expect(early.status).toBe(403);
    expect(early.json.code).toBe('awaiting_delivery');

    const mail = t.mailer.sent.find((m) => m.to === contact.email)!;
    expect(mail.html).toContain('Pay on delivery');
    expect(mail.html).toContain('unlocks when your books are delivered');
    expect(mail.html).not.toContain(`/download/${item}`);
    expect(t.mailer.sent.find((m) => /New order/.test(m.subject))!.subject).toContain('COD');

    // Delivered: cash collected, e-book unlocked and emailed.
    t.mailer.sent.length = 0;
    const done = await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: await admin(), body: { status: 'delivered' } });
    expect(done.status).toBe(200);
    expect(done.json.order.codCollectedAt).toBeTruthy();
    const unlocked = t.mailer.sent.find((m) => /free e-book is ready/.test(m.subject))!;
    expect(unlocked.html).toContain('/account?tab=library');
    expect(unlocked.html).not.toContain('/download/');
    const dl = await t.call('POST', `/account/library/${item}/download`, { headers: buyer });
    expect(dl.status).toBe(200);
  });

  it('is only for printed books', async () => {
    const p = await book();
    const ebook = await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }], 'cod');
    expect(ebook.status).toBe(400);
    expect(ebook.json.code).toBe('cod_unavailable');
    const mixed = await checkout([{ productId: p.id, kind: 'print', quantity: 1 }, { productId: p.id, kind: 'digital', quantity: 1 }], 'cod');
    expect(mixed.status).toBe(400);
    expect(mixed.json.error).toMatch(/E-books can only be paid for online/);
    // Online payment for the same carts works as before.
    expect((await checkout([{ productId: p.id, kind: 'digital', quantity: 1 }], 'online')).status).toBe(201);
  });

  it('can be switched off, and its advance changed', async () => {
    const p = await book();
    const h = await admin();
    const s = (await t.call('GET', '/admin/settings', { headers: h })).json;
    const { updatedAt: _u, id: _i, ...rest } = s;
    expect((await t.call('PUT', '/admin/settings', { headers: h, body: { ...rest, codAdvance: 10000 } })).status).toBe(200);
    expect((await checkout([{ productId: p.id, kind: 'print', quantity: 2 }], 'cod')).json.razorpay.amount).toBe(10000);
    await t.db.update(settings).set({ codEnabled: false });
    expect((await t.call('GET', '/config')).json.cod).toBeNull();
    expect((await checkout([{ productId: p.id, kind: 'print', quantity: 1 }], 'cod')).status).toBe(400);
  });

  it('can take a percentage of the order instead, with a minimum', async () => {
    const p = await book();
    const h = await admin();
    const { updatedAt: _u, id: _i, ...rest } = (await t.call('GET', '/admin/settings', { headers: h })).json;
    // 10% of the order, at least ₹50.
    expect((await t.call('PUT', '/admin/settings', { headers: h, body: { ...rest, codAdvanceType: 'percent', codAdvanceBps: 1000, codAdvanceMin: 5000 } })).status).toBe(200);
    expect((await t.call('GET', '/config')).json.cod).toEqual({ type: 'percent', advance: 6000, bps: 1000, min: 5000 });
    const big = await checkout([{ productId: p.id, kind: 'print', quantity: 4 }], 'cod');
    const total = big.json.total as number;
    const expected = Math.max(Math.ceil(total / 10 / 100) * 100, 5000);
    expect(big.json.razorpay.amount).toBe(expected);
    const [o] = await t.db.select().from(orders).where(eq(orders.id, big.json.orderId));
    expect(o.codAmount).toBe(total - expected);
    // Out-of-range percentages are refused.
    expect((await t.call('PUT', '/admin/settings', { headers: h, body: { ...rest, codAdvanceType: 'percent', codAdvanceBps: 15000 } })).status).toBe(400);
  });

  it('works the advance out the same way everywhere', () => {
    const r = { type: 'percent' as const, advance: 6000, bps: 1250, min: 0 };
    expect(codAdvanceFor(79900, r)).toBe(10000); // 12.5% of ₹799 = ₹99.88, rounded up to ₹100
    expect(codAdvanceFor(20000, { ...r, min: 5000 })).toBe(5000); // the minimum
    expect(codAdvanceFor(3000, { ...r, min: 5000 })).toBe(3000); // never more than the order
    expect(codAdvanceFor(79900, { ...r, type: 'flat' })).toBe(6000);
  });

  it('refunds only the advance through Razorpay', async () => {
    const p = await book();
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 1 }], 'cod');
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    const h = await admin();
    const tooMuch = await t.call('POST', `/admin/orders/${r.json.orderId}/refund`, { headers: h, body: { amount: 6001 } });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.json.error).toMatch(/up to ₹60\.00/);
    const ok = await t.call('POST', `/admin/orders/${r.json.orderId}/refund`, { headers: h, body: { amount: 6000, cancel: true, restock: true } });
    expect(ok.json.order).toMatchObject({ paymentStatus: 'refunded', refundedAmount: 6000 });
  });

  it('leaves online orders unchanged: the e-book unlocks at once', async () => {
    const p = await book();
    const r = await checkout([{ productId: p.id, kind: 'print', quantity: 1 }], 'online');
    expect(r.json.razorpay.amount).toBe(r.json.total);
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    const view = await t.call('GET', `/orders/${r.json.number}?t=${r.json.token}`);
    expect(view.json).toMatchObject({ paymentMode: 'online', ebooksAfterDelivery: false });
    expect(view.json.items[0].canDownload).toBe(true);
    const [v] = await t.db.select().from(productVariants).where(and(eq(productVariants.productId, p.id), eq(productVariants.kind, 'digital')));
    expect(v.filePath).toBeTruthy();
  });
});
