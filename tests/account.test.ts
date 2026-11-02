import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { products } from '../server/db/schema.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const auth = async (email: string, provider = 'google') =>
  ({ authorization: `Bearer ${await supabaseToken({ sub: '11111111-1111-1111-1111-111111111111', email, provider, name: 'Asha Verma' })}` });

async function buy(kind: 'print' | 'digital' | 'bundle', email = contact.email) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind, quantity: 1 }], contact: { ...contact, email }, shipping: address } });
  await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId, {}) });
  return r.json as { number: number; token: string };
}

describe('customer accounts', () => {
  it('needs a signed-in, verified customer', async () => {
    expect((await t.call('GET', '/account')).status).toBe(401);
    expect((await t.call('GET', '/account', { headers: await auth(contact.email, 'email') })).status).toBe(403);
  });

  it('shows the customer’s own orders and e-book library', async () => {
    const mine = await buy('digital');
    await buy('print', 'someone@else.in');
    const r = await t.call('GET', '/account', { headers: await auth('ASHA@example.com') });
    expect(r.status).toBe(200);
    expect(r.json.customer).toMatchObject({ email: contact.email, name: 'Asha Verma' });
    expect(r.json.orders.map((o: any) => o.number)).toEqual([mine.number]);
    expect(r.json.orders[0]).toMatchObject({ status: 'Complete', token: mine.token });
    expect(r.json.library).toHaveLength(1);
    expect(r.json.library[0]).toMatchObject({ title: 'Mathematics Today', orderNumber: mine.number, canRead: true, downloadsLeft: 10 });
    expect(r.json.library[0].downloadUrl).toContain(`/api/orders/${mine.number}/download/`);
  });

  it('opens an owned e-book for reading without using a download', async () => {
    await buy('digital');
    const { json } = await t.call('GET', '/account', { headers: await auth(contact.email) });
    const itemId = json.library[0].itemId;
    const read = await t.call('POST', `/account/library/${itemId}/read`, { headers: await auth(contact.email) });
    expect(read.status).toBe(200);
    expect(read.json.url).toMatch(/^https:\/\/files\.test\/signed\/ebooks\//);
    expect((await t.call('GET', '/account', { headers: await auth(contact.email) })).json.library[0].downloadsLeft).toBe(10);
    expect((await t.call('POST', `/account/library/${itemId}/read`, { headers: await auth('someone@else.in') })).status).toBe(404);
  });

  it('gives a customer account no access to the admin', async () => {
    expect((await t.call('GET', '/admin/dashboard', { headers: await auth(contact.email) })).status).toBe(403);
  });
});
