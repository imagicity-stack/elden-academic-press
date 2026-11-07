import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { orders, products } from '../server/db/schema.js';
import { tagCampaignLinks } from '../server/services/newsletter.js';
import { classify, orderChannel, touchFrom, type OrderSource } from '../src/shared/attribution.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

const SITE = 'https://www.eldenap.in';
const visit = (path: string, ref = '') => touchFrom(SITE + path, ref, 1_800_000_000_000, 'www.eldenap.in');
const channelOf = (path: string, ref = '') => classify(visit(path, ref));

describe('where a visit came from', () => {
  it('tells ads, search, social, email, other sites and direct visits apart', () => {
    expect(channelOf('/books/x?utm_source=ig&utm_medium=paid&utm_campaign=Diwali&fbclid=abc', 'https://l.instagram.com/')).toEqual({ channel: 'meta_ads', detail: 'Instagram · Diwali' });
    expect(channelOf('/?utm_source=facebook&utm_medium=cpc&utm_campaign=Launch')).toEqual({ channel: 'meta_ads', detail: 'Facebook · Launch' });
    expect(channelOf('/?fbclid=abc', 'http://m.facebook.com/')).toEqual({ channel: 'meta_social', detail: 'Facebook' });
    expect(channelOf('/', 'https://www.instagram.com/')).toEqual({ channel: 'meta_social', detail: 'Instagram' });
    expect(channelOf('/?gclid=xyz').channel).toBe('google_ads');
    expect(channelOf('/?utm_source=google&utm_medium=cpc&utm_campaign=Class-10').channel).toBe('google_ads');
    expect(channelOf('/books/x', 'https://www.google.co.in/')).toEqual({ channel: 'search', detail: 'Google' });
    expect(channelOf('/', 'android-app://com.google.android.googlequicksearchbox/')).toEqual({ channel: 'search', detail: 'Google' });
    expect(channelOf('/', 'https://www.bing.com/')).toEqual({ channel: 'search', detail: 'Bing' });
    expect(channelOf('/', 'https://mail.google.com/')).toEqual({ channel: 'email', detail: '' });
    expect(channelOf('/', 'android-app://com.google.android.gm/').channel).toBe('email');
    expect(channelOf('/?utm_source=newsletter&utm_medium=email&utm_campaign=new-books')).toEqual({ channel: 'email', detail: 'new-books' });
    expect(channelOf('/', 'https://youtube.com/')).toEqual({ channel: 'social', detail: 'YouTube' });
    expect(channelOf('/', 'https://web.whatsapp.com/')).toEqual({ channel: 'social', detail: 'WhatsApp' });
    expect(channelOf('/?utm_source=school-poster')).toEqual({ channel: 'campaign', detail: 'school-poster' });
    expect(channelOf('/', 'https://www.shiksha.com/some/article')).toEqual({ channel: 'referral', detail: 'shiksha.com' });
  });

  it('ignores our own pages, sign-in and payment as sources', () => {
    expect(visit('/books/x', 'https://www.eldenap.in/store')).toBeNull();
    expect(visit('/account', 'https://accounts.google.com/')).toBeNull();
    expect(visit('/order/12', 'https://api.razorpay.com/')).toBeNull();
    expect(visit('/account', 'https://abc.supabase.co/auth/v1/callback')).toBeNull();
    expect(visit('/')).toBeNull();
    expect(classify(null)).toEqual({ channel: 'direct', detail: '' });
  });

  it('keeps only the source: no click id values, no query string on the landing page', () => {
    const t = visit('/books/maths?utm_source=fb&utm_medium=paid&fbclid=SECRET123&email=a@b.c', 'https://m.facebook.com/story?id=1');
    expect(JSON.stringify(t)).not.toMatch(/SECRET123|a@b\.c|story/);
    expect(t).toMatchObject({ click: 'meta', ref: 'm.facebook.com', landing: '/books/maths' });
  });

  it('credits the order to the last visit with a source, else the first', () => {
    const ad = visit('/?utm_source=ig&utm_medium=paid')!;
    const search = visit('/', 'https://www.google.com/')!;
    expect(orderChannel({ first: ad, last: search }).channel).toBe('search');
    expect(orderChannel({ first: ad }).channel).toBe('meta_ads');
    expect(orderChannel({ first: { at: 1 } }).channel).toBe('direct');
    expect(orderChannel(undefined).channel).toBe('direct');
  });
});

describe('newsletter links', () => {
  it('are tagged as email, except unsubscribe links, other sites and links already tagged', () => {
    const html = '<a href="https://eldenap.in/books/maths">x</a><a href="https://www.eldenap.in/store?sort=new&amp;page=2">y</a>'
      + '<a href="https://eldenap.in/api/newsletter/unsubscribe?t=1">u</a><a href="https://www.instagram.com/eldenacademicpress/">i</a>'
      + '<a href="https://eldenap.in/?utm_source=poster">p</a>';
    const out = tagCampaignLinks(html, 'https://eldenap.in', 'New books for Class 10!');
    expect(out).toContain('href="https://eldenap.in/books/maths?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=new-books-for-class-10"');
    expect(out).toContain('href="https://www.eldenap.in/store?sort=new&amp;page=2&amp;utm_source=newsletter');
    expect(out).toContain('href="https://eldenap.in/api/newsletter/unsubscribe?t=1"');
    expect(out).toContain('href="https://www.instagram.com/eldenacademicpress/"');
    expect(out).toContain('href="https://eldenap.in/?utm_source=poster"');
  });
});

describe('orders: where they came from', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
  beforeEach(async () => { t = await setup(); });

  async function paidOrder(source?: unknown) {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address, source } });
    expect(r.status).toBe(201);
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    return r.json.orderId as string;
  }

  it('records the source with the order and shows it in the admin: list, filter, summary, detail and CSV', async () => {
    const ad: OrderSource = { first: visit('/', 'https://www.google.com/')!, last: visit('/books/mathematics-today?utm_source=ig&utm_medium=paid&utm_campaign=Board+exams')! };
    const fromAd = await paidOrder(ad);
    await paidOrder({ first: visit('/', 'https://www.google.com/')! });
    await paidOrder(undefined);
    // A broken source never stops an order; it's just not recorded.
    const broken = await paidOrder({ last: { at: 'yesterday', ref: '<script>' } });
    expect((await t.db.select({ c: orders.channel }).from(orders).where(eq(orders.id, broken)))[0].c).toBe('direct');

    const admin = { Authorization: `Bearer ${await supabaseToken(OWNER)}` };
    const list = (await t.call('GET', '/admin/orders', { headers: admin })).json.items;
    expect(list.find((o: any) => o.id === fromAd)).toMatchObject({ channel: 'meta_ads', sourceLabel: 'Meta ads', sourceDetail: 'Instagram · Board exams' });
    const onlyAds = (await t.call('GET', '/admin/orders?source=meta_ads', { headers: admin })).json;
    expect(onlyAds.total).toBe(1);

    const sum = (await t.call('GET', '/admin/orders/sources', { headers: admin })).json;
    expect(sum.totals.orders).toBe(4);
    expect(Object.fromEntries(sum.channels.map((c: any) => [c.channel, c.orders]))).toEqual({ meta_ads: 1, search: 1, direct: 2 });
    expect(sum.campaigns).toEqual([expect.objectContaining({ channel: 'meta_ads', campaign: 'Board exams', orders: 1 })]);

    const d = (await t.call('GET', `/admin/orders/${fromAd}`, { headers: admin })).json.source;
    expect(d).toMatchObject({ channel: 'meta_ads', label: 'Meta ads', first: { channel: 'search', detail: 'Google' }, last: { campaign: 'Board exams', landing: '/books/mathematics-today' } });

    const csv = (await t.call('GET', '/admin/orders/export.csv', { headers: admin })).text;
    expect(csv).toContain('Source,Source detail,Campaign,Landing page');
    expect(csv).toContain('Meta ads,Instagram · Board exams,Board exams,/books/mathematics-today');
  });
});
