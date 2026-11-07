import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, coupons, popupStats, products } from '../server/db/schema.js';
import { blankPopup, eligible, pageMatches, TEMPLATES, type LivePopup, type VisitorContext } from '../src/shared/popups.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

const visitor = (v: Partial<VisitorContext> = {}): VisitorContext => ({
  path: '/', device: 'desktop', isNew: true, signedIn: false, student: false, channel: 'direct', campaign: '', cartItems: 0,
  now: Date.parse('2026-11-10T10:00:00Z'), memory: {}, session: [], ...v,
});
const live = (patch: (p: LivePopup) => void = () => {}): LivePopup => {
  const p: LivePopup = { id: 'p1', priority: 0, ...blankPopup() };
  patch(p);
  return p;
};

describe('who sees a popup', () => {
  it('matches pages: exact, and "/x/*" for a section', () => {
    expect(pageMatches('/books/*', '/books/maths-6')).toBe(true);
    expect(pageMatches('/books/*', '/books')).toBe(true);
    expect(pageMatches('/books/*', '/bookshelf')).toBe(false);
    expect(pageMatches('/', '/')).toBe(true);
    expect(pageMatches('/', '/store')).toBe(false);
    expect(pageMatches('/store', '/store/')).toBe(true);
  });

  it('never shows at checkout, on order pages or the admin', () => {
    for (const path of ['/checkout', '/order/1234', '/track', '/admin/orders']) expect(eligible(live(), visitor({ path }))).toBe(false);
    expect(eligible(live(), visitor({ path: '/books/x' }))).toBe(true);
  });

  it('follows pages, device, new or returning, signed in, source, campaign, cart and dates', () => {
    expect(eligible(live((p) => { p.audience.pages = { mode: 'only', patterns: ['/books/*'] }; }), visitor({ path: '/store' }))).toBe(false);
    expect(eligible(live((p) => { p.audience.pages = { mode: 'except', patterns: ['/competitions/*'] }; }), visitor({ path: '/competitions/doomsday-diaries' }))).toBe(false);
    expect(eligible(live((p) => { p.audience.device = 'mobile'; }), visitor())).toBe(false);
    expect(eligible(live((p) => { p.audience.visitor = 'returning'; }), visitor({ isNew: true }))).toBe(false);
    expect(eligible(live((p) => { p.audience.signedIn = 'out'; }), visitor({ signedIn: true }))).toBe(false);
    expect(eligible(live((p) => { p.audience.channels = ['meta_ads', 'meta_social']; }), visitor({ channel: 'search' }))).toBe(false);
    expect(eligible(live((p) => { p.audience.channels = ['meta_ads']; }), visitor({ channel: 'meta_ads' }))).toBe(true);
    expect(eligible(live((p) => { p.audience.campaign = 'diwali'; }), visitor({ campaign: 'Diwali-2026' }))).toBe(true);
    expect(eligible(live((p) => { p.audience.cart = 'has_items'; }), visitor())).toBe(false);
    expect(eligible(live((p) => { p.startsAt = '2026-11-11T00:00:00+05:30'; }), visitor())).toBe(false);
    expect(eligible(live((p) => { p.endsAt = '2026-11-09T00:00:00+05:30'; }), visitor())).toBe(false);
  });

  it('keeps students out unless allowed, and never asks them for an email', () => {
    expect(eligible(live(), visitor({ student: true }))).toBe(false);
    expect(eligible(live((p) => { p.audience.students = true; }), visitor({ student: true }))).toBe(true);
    expect(eligible(live((p) => { p.audience.students = true; p.content.goal = 'subscribe'; }), visitor({ student: true }))).toBe(false);
  });

  it('respects how often: every time, once a visit, every N days, once, and after a sign-up', () => {
    const now = visitor().now;
    const days = live((p) => { p.frequency = { show: 'days', days: 7, stopAfterConvert: true }; });
    expect(eligible(days, visitor({ memory: { p1: { lastShown: now - 3 * 86_400_000 } } }))).toBe(false);
    expect(eligible(days, visitor({ memory: { p1: { lastShown: now - 8 * 86_400_000 } } }))).toBe(true);
    expect(eligible(days, visitor({ memory: { p1: { lastShown: now - 8 * 86_400_000, converted: true } } }))).toBe(false);
    const session = live((p) => { p.frequency.show = 'session'; });
    expect(eligible(session, visitor({ session: ['p1'] }))).toBe(false);
    const once = live((p) => { p.frequency.show = 'once'; });
    expect(eligible(once, visitor({ memory: { p1: { lastShown: 1 } } }))).toBe(false);
    const every = live((p) => { p.frequency = { show: 'every', days: 1, stopAfterConvert: false }; });
    expect(eligible(every, visitor({ session: ['p1'], memory: { p1: { lastShown: now, converted: true } } }))).toBe(true);
  });
});

describe('Admin → Popups and the website', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
  const STAFF = { sub: '22222222-2222-4222-8222-222222222222', email: 'packer@eldenap.in' };
  const as = async (who: { sub: string; email: string }) => ({ Authorization: `Bearer ${await supabaseToken(who)}` });
  beforeEach(async () => { t = await setup(); });

  async function create(template = 'welcome', name = 'Welcome offer') {
    const r = await t.call('POST', '/admin/popups', { headers: await as(OWNER), body: { name, template } });
    expect(r.status).toBe(201);
    return r.json;
  }
  const save = async (p: any, patch: (x: any) => void = () => {}) => {
    const x = structuredClone(p); patch(x);
    const { id: _i, status: _s, createdAt: _c, updatedAt: _u, createdBy: _b, stats: _st, ...rest } = x;
    return t.call('PUT', `/admin/popups/${p.id}`, { headers: await as(OWNER), body: rest });
  };

  it('is for managers and the owner, not staff', async () => {
    await t.call('GET', '/admin/popups', { headers: await as(OWNER) }); // the owner signs in first
    await t.db.insert(adminUsers).values({ userId: STAFF.sub, email: STAFF.email, role: 'staff' });
    expect((await t.call('GET', '/admin/popups', { headers: await as(STAFF) })).status).toBe(403);
  });

  it('creates from a template, checks what is saved, and warns about a discount code that does not exist', async () => {
    const p = await create();
    expect(p).toMatchObject({ status: 'draft', content: { goal: 'subscribe', coupon: 'WELCOME10' } });
    expect((await save(p, (x) => { x.design.colors.background = 'red; position:fixed'; })).status).toBe(400);
    expect((await save(p, (x) => { x.content.button.url = 'javascript:alert(1)'; })).status).toBe(400);
    expect((await save(p, (x) => { x.content.image = 'https://evil.example/x.png'; })).status).toBe(400);
    expect((await save(p, (x) => { x.audience.pages = { mode: 'only', patterns: ['books'] }; })).status).toBe(400);
    const ok = await save(p, (x) => { x.content.image = 'https://files.test/public/covers/2026/a/pic.webp'; x.content.coupon = 'newreader5'; });
    expect(ok.status).toBe(200);
    expect(ok.json.popup.content.coupon).toBe('NEWREADER5');
    expect(ok.json.warnings[0]).toMatch(/no discount code NEWREADER5/);
    await t.db.insert(coupons).values({ code: 'NEWREADER5', type: 'percent', value: 5 });
    expect((await save(ok.json.popup)).json.warnings).toEqual([]);
    await t.db.update(coupons).set({ active: false }).where(eq(coupons.code, 'NEWREADER5'));
    expect((await save(ok.json.popup)).json.warnings[0]).toMatch(/switched off or has ended/);
  });

  it('goes live only when ready, and the website gets only live popups in their dates, without internal details', async () => {
    const p = await create('blank', 'Blank');
    expect((await save(p, (x) => { x.content.goal = 'link'; x.content.button = { label: '', url: '' }; })).status).toBe(200);
    const owner = await as(OWNER);
    const notReady = await t.call('POST', `/admin/popups/${p.id}/status`, { headers: owner, body: { status: 'live' } });
    expect(notReady.status).toBe(400);
    expect(notReady.json.error).toMatch(/button/);
    await save(p, (x) => { x.content.button = { label: 'Shop', url: '/store' }; });
    expect((await t.call('POST', `/admin/popups/${p.id}/status`, { headers: owner, body: { status: 'live' } })).json.status).toBe('live');
    const draft = await create('bar', 'Bar');
    const future = await create('competition', 'Later');
    await save(future, (x) => { x.startsAt = '2099-01-01T00:00:00+05:30'; });
    await t.call('POST', `/admin/popups/${future.id}/status`, { headers: owner, body: { status: 'live' } });
    const res = await t.call('GET', '/popups/live');
    expect(res.json.items.map((x: any) => x.id)).toEqual([p.id]);
    expect(res.json.items[0].name).toBeUndefined();
    expect(res.json.items[0].createdBy).toBeUndefined();
    expect(res.headers.get('cache-control')).toMatch(/s-maxage=60/);
    expect(draft.status).toBe('draft');
  });

  it('counts views, clicks and closes per day, sign-ups from the newsletter, and orders with its code', async () => {
    const p = await create(); // WELCOME10 is one of the demo discount codes
    for (const type of ['view', 'view', 'click', 'close']) expect((await t.call('POST', `/popups/${p.id}/event`, { body: { type } })).status).toBe(204);
    expect((await t.call('POST', `/popups/${p.id}/event`, { body: { type: 'purchase' } })).status).toBe(400);
    expect((await t.call('POST', '/popups/00000000-0000-4000-8000-000000000000/event', { body: { type: 'view' } })).status).toBe(204);
    const sub = await t.call('POST', '/newsletter/subscribe', { body: { email: 'new@example.com', phone: '9876543210', source: 'popup', popupId: p.id, consent: true } });
    expect(sub.json.status).toBe('subscribed');
    // Already on the list: not a new sign-up.
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'new@example.com', phone: '9876543210', source: 'popup', popupId: p.id, consent: true } });
    const [prod] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await t.call('POST', '/checkout', { body: { items: [{ productId: prod.id, kind: 'print', quantity: 1 }], couponCode: 'WELCOME10', contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });

    const d = (await t.call('GET', `/admin/popups/${p.id}`, { headers: await as(OWNER) })).json;
    expect(d.totals).toEqual({ views: 2, clicks: 1, closes: 1, conversions: 1 });
    expect(d.days).toHaveLength(1);
    expect(d.couponOrders).toMatchObject({ code: 'WELCOME10', orders: 1 });
    expect(d.couponOrders.revenue).toBe(r.json.total);
    const list = (await t.call('GET', '/admin/popups', { headers: await as(OWNER) })).json.items;
    expect(list[0].stats).toMatchObject({ views: 2, conversions: 1 });
  });

  it('duplicates as a draft and deletes with its numbers', async () => {
    const p = await create();
    const owner = await as(OWNER);
    await t.call('POST', `/popups/${p.id}/event`, { body: { type: 'view' } });
    const copy = (await t.call('POST', `/admin/popups/${p.id}/duplicate`, { headers: owner })).json;
    expect(copy).toMatchObject({ name: 'Welcome offer (copy)', status: 'draft', content: { coupon: 'WELCOME10' } });
    expect((await t.call('DELETE', `/admin/popups/${p.id}`, { headers: owner })).status).toBe(200);
    expect(await t.db.select().from(popupStats)).toEqual([]);
    expect((await t.call('GET', `/admin/popups/${p.id}`, { headers: owner })).status).toBe(404);
  });

  it('offers templates that are all valid to save', async () => {
    for (const tpl of TEMPLATES) {
      const p = await create(tpl.key, tpl.name);
      const r = await save(p);
      expect(r.status, tpl.key).toBe(200);
    }
  });
});
