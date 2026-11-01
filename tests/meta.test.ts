import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, products } from '../server/db/schema.js';
import { memoryMeta, metaHttp, normalisePhone, toPayload, userData } from '../server/lib/meta.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof setup>>;
let t: Ctx;
let meta: ReturnType<typeof memoryMeta>;
beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in' } });
  meta = memoryMeta();
  t.deps.meta = meta;
});

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const FBP = 'fb.1.1793500000000.1234567890';
const FBC = 'fb.1.1793500000000.IwAR0abc_DEF-123';
const accepted = { Cookie: `elden_consent=all; _fbp=${FBP}; _fbc=${FBC}`, 'User-Agent': 'Mozilla/5.0 Test' };

async function order(headers: Record<string, string>) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const r = await t.call('POST', '/checkout', { headers, body: { items: [{ productId: p.id, kind: 'print', quantity: 2 }], contact, shipping: address } });
  expect(r.status).toBe(201);
  await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
  return { number: r.json.number as number, total: r.json.total as number, productId: p.id };
}

describe('Meta customer details', () => {
  it('normalises and hashes them the way Meta asks', () => {
    expect(normalisePhone('98765 43210')).toBe('919876543210');
    expect(normalisePhone('098765-43210')).toBe('919876543210');
    expect(normalisePhone('+91 98765 43210')).toBe('919876543210');
    const u = userData({ email: ' Asha@Example.com ', phone: '9876543210', name: 'Asha  Kumari', city: 'Hazaribagh', state: '20', pincode: '825 301', ip: '1.2.3.4', userAgent: 'UA', fbp: FBP });
    expect(u).toMatchObject({
      em: [sha('asha@example.com')], ph: [sha('919876543210')], fn: [sha('asha')], ln: [sha('kumari')],
      ct: [sha('hazaribagh')], st: [sha('jharkhand')], zp: [sha('825301')], country: [sha('in')], external_id: [sha('asha@example.com')],
      client_ip_address: '1.2.3.4', client_user_agent: 'UA', fbp: FBP,
    });
    expect(JSON.stringify(u)).not.toContain('asha@example.com');
  });

  it('posts to the Graph API with the token and test code', async () => {
    const calls: { url: string; body: any }[] = [];
    const fake = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{"events_received":1}'); }) as unknown as typeof fetch;
    await metaHttp('1121054814122471', 'tok', 'TEST123', fake).send([{ name: 'Lead', eventId: 'e-12345678', time: new Date(1793500000000), url: 'https://eldenap.in/contact', user: { email: 'a@b.in' } }]);
    expect(calls[0].url).toMatch(/^https:\/\/graph\.facebook\.com\/v\d+\.0\/1121054814122471\/events$/);
    expect(calls[0].body).toMatchObject({ access_token: 'tok', test_event_code: 'TEST123', data: [{ event_name: 'Lead', event_id: 'e-12345678', event_time: 1793500000, action_source: 'website' }] });
  });
});

describe('Purchase', () => {
  it('is reported by the server when payment is confirmed, with the browser’s event id', async () => {
    const o = await order(accepted);
    const [row] = await t.db.select().from(orders).where(eq(orders.number, o.number));
    expect(row).toMatchObject({ adConsent: true, fbp: FBP, fbc: FBC, userAgent: 'Mozilla/5.0 Test' });
    expect(meta.sent).toHaveLength(1);
    const p = toPayload(meta.sent[0]);
    expect(p).toMatchObject({ event_name: 'Purchase', event_id: `purchase-${o.number}`, action_source: 'website', event_source_url: 'https://eldenap.in/checkout' });
    expect(p.custom_data).toMatchObject({ value: o.total / 100, currency: 'INR', content_ids: [o.productId], num_items: 2, order_id: String(o.number), format: 'print' });
    expect(p.user_data).toMatchObject({ em: [sha(contact.email)], ph: [sha('919876543210')], fbp: FBP, fbc: FBC, client_user_agent: 'Mozilla/5.0 Test' });
  });

  it('is not reported without consent, or for staff', async () => {
    await order({});
    await order({ Cookie: `elden_consent=essential; _fbp=${FBP}` });
    await order({ Cookie: `elden_consent=staff; _fbp=${FBP}` });
    expect(meta.sent).toHaveLength(0);
    const rows = await t.db.select().from(orders);
    expect(rows.every((r) => !r.adConsent && !r.fbp)).toBe(true);
  });
});

describe('browser events through the server', () => {
  const event = { name: 'AddToCart', eventId: 'b1d2c3e4-0000-4000-8000-000000000000', url: 'https://www.eldenap.in/books/mathematics-today', custom: { value: 249, currency: 'INR', content_ids: ['x'], contents: [{ id: 'x', quantity: 1 }] } };

  it('forwards allowed events for visitors who accepted, with IP and Meta cookies', async () => {
    expect((await t.call('POST', '/meta/event', { body: event })).status).toBe(204);
    expect(meta.sent).toHaveLength(0);
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: event })).status).toBe(204);
    expect(meta.sent).toHaveLength(1);
    expect(toPayload(meta.sent[0])).toMatchObject({ event_name: 'AddToCart', event_id: event.eventId, user_data: { fbp: FBP, fbc: FBC, client_ip_address: '10.0.0.1' }, custom_data: { value: 249 } });
  });

  it('forwards searches and payment starts with their details', async () => {
    const search = { name: 'Search', eventId: 'c1d2c3e4-0000-4000-8000-000000000000', url: 'https://eldenap.in/catalogue', custom: { search_string: 'class 10 science', content_type: 'product', content_ids: ['x'] } };
    const pay = { name: 'AddPaymentInfo', eventId: 'd1d2c3e4-0000-4000-8000-000000000000', url: 'https://eldenap.in/checkout', custom: { value: 499, currency: 'INR', format: 'ebook,print' } };
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: search })).status).toBe(204);
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: pay })).status).toBe(204);
    expect(meta.sent.map((e) => toPayload(e))).toMatchObject([
      { event_name: 'Search', custom_data: { search_string: 'class 10 science' } },
      { event_name: 'AddPaymentInfo', custom_data: { value: 499, format: 'ebook,print' } },
    ]);
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: { ...pay, custom: { format: '<script>' } } })).status).toBe(400);
  });

  it('refuses events it must not relay and pages from other sites', async () => {
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: { ...event, name: 'Purchase' } })).status).toBe(400);
    expect((await t.call('POST', '/meta/event', { headers: accepted, body: { ...event, url: 'https://evil.example/x' } })).status).toBe(400);
    expect(meta.sent).toHaveLength(0);
  });
});

describe('leads and sign-ups', () => {
  it('reports an enquiry as a Lead with the browser’s event id and the hashed contact', async () => {
    const r = await t.call('POST', '/enquiries', { headers: { ...accepted, 'X-Meta-Event-Id': 'lead-abcdef12' }, body: { kind: 'sample', name: 'R. Verma', email: 'principal@school.in', phone: '9123456780', city: 'Ranchi' } });
    expect(r.status).toBe(201);
    expect(meta.sent).toHaveLength(1);
    expect(toPayload(meta.sent[0])).toMatchObject({ event_name: 'Lead', event_id: 'lead-abcdef12', user_data: { em: [sha('principal@school.in')], ct: [sha('ranchi')] }, custom_data: { content_name: 'sample' } });
  });

  it('reports a first Google sign-in as CompleteRegistration, once', async () => {
    const auth = { authorization: `Bearer ${await supabaseToken({ sub: '77777777-7777-4777-8777-777777777777', email: 'new@example.com', provider: 'google', name: 'New Reader' })}`, ...accepted };
    const first = await t.call('GET', '/account', { headers: auth });
    expect(first.json.newAccount).toBe(true);
    await t.call('GET', '/account', { headers: auth });
    const reg = meta.sent.filter((e) => e.name === 'CompleteRegistration');
    expect(reg).toHaveLength(1);
    expect(reg[0].eventId).toBe('signup-77777777-7777-4777-8777-777777777777');
  });
});
