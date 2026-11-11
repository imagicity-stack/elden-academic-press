// Admin → Dashboard: money for a period with cash on delivery kept apart (advances, collected,
// still to collect with its age, lost), compared with the previous period.
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, products } from '../server/db/schema.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const DAY = 86_400_000;

async function buy(mode: 'online' | 'cod', quantity = 2) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity }], contact, shipping: address, paymentMode: mode } });
  await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
  const [o] = await t.db.select().from(orders).where(eq(orders.id, r.json.orderId));
  return o;
}

describe('dashboard', () => {
  it('splits the money: paid online, COD advances, cash collected, still to collect (by age), lost', async () => {
    const now = Date.now();
    const online = await buy('online');
    const collected = await buy('cod');
    const waiting = await buy('cod');
    const refused = await buy('cod');
    await t.db.update(orders).set({ fulfillmentStatus: 'delivered', shippedAt: new Date(now - 2 * DAY), deliveredAt: new Date(now - DAY), codCollectedAt: new Date(now - DAY), paidAt: new Date(now - 3 * DAY) }).where(eq(orders.id, collected.id));
    await t.db.update(orders).set({ fulfillmentStatus: 'shipped', shippedAt: new Date(now - 10 * DAY), paidAt: new Date(now - 11 * DAY) }).where(eq(orders.id, waiting.id));
    await t.db.update(orders).set({ cancelledAt: new Date(now - DAY) }).where(eq(orders.id, refused.id));

    const r = await t.call('GET', '/admin/dashboard?days=30', { headers: await admin() });
    expect(r.status).toBe(200);
    const a = r.json.analytics;
    const adv = collected.total - collected.codAmount;
    expect(a.money).toMatchObject({
      prepaid: online.total,
      codAdvances: adv * 3, // three COD orders paid their advance in the period
      codCollected: collected.codAmount,
      codOutstanding: waiting.codAmount,
      codLost: refused.codAmount,
    });
    expect(a.kpis.booked.now).toBe(online.total + collected.total + waiting.total + refused.total - refused.codAmount);
    expect(a.kpis.received.now).toBe(online.total + adv * 3 + collected.codAmount);
    expect(a.kpis.orders.now).toBe(4);
    expect(a.cod.outstanding).toMatchObject({ amount: waiting.codAmount, parcels: 1 });
    expect(a.cod.outstanding.ageing.find((x: any) => x.label === 'Shipped 8+ days ago')).toMatchObject({ parcels: 1, amount: waiting.codAmount });
    expect(a.cod).toMatchObject({ orders: 3, collectedOrders: 1, lostOrders: 1, collectionRate: 50, avgDaysToCollect: 2 });
    expect(a.cod.oldest.map((o: any) => o.number)).toEqual([waiting.number]);
    expect(a.mix).toMatchObject({ online: { orders: 1 }, cod: { orders: 3 } });
    expect(a.series).toHaveLength(30);
    expect(a.series.reduce((n: number, s: any) => n + s.orders, 0)).toBe(4);

    // Today only: the 11-day-old order isn't in it, but its cash is still to collect.
    const today = (await t.call('GET', '/admin/dashboard?days=1', { headers: await admin() })).json.analytics;
    expect(today.series).toHaveLength(1);
    expect(today.cod.outstanding.amount).toBe(waiting.codAmount);
    expect(today.kpis.orders.now).toBe(2); // online and refused were paid today
  });
});
