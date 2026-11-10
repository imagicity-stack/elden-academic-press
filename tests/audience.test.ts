// Admin → Audience: where sign-ups came from (Meta ads, Google, a popup…) and how complete
// each profile is; plus the progress shown on the customer's own account page.
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, subscribers } from '../server/db/schema.js';
import { profileProgress } from '../src/shared/profile.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in' } });
  t.setClock(new Date('2026-11-10T11:00:00+05:30'));
});
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const customer = async (sub: string, email: string) => ({ Authorization: `Bearer ${await supabaseToken({ sub, email, provider: 'google', name: 'Ravi Kumar' })}` });
const at = Date.parse('2026-11-09T10:00:00Z');
const metaAd = { first: { at, source: 'facebook', medium: 'paid', campaign: 'diwali-books', landing: '/books/mathematics-today' } };
const google = { first: { at, ref: 'www.google.com', landing: '/' } };

describe('profile completion', () => {
  const blank = { type: null, fullName: '', phone: '', city: '', state: '', dob: null, institutionType: '', institutionName: '', grade: '', guardianName: '', guardianPhone: '', instagram: '' };
  it('counts the fields each kind of person is asked for', () => {
    expect(profileProgress(blank)).toMatchObject({ done: 0, total: 5, percent: 0 });
    expect(profileProgress({ ...blank, type: 'parent', fullName: 'A B', phone: '+919876543210', city: 'Ranchi' })).toMatchObject({ done: 4, total: 5, percent: 80, missing: ['state'] });
    // A 14-year-old student: also class, school and a parent's contact.
    const s = profileProgress({ ...blank, type: 'student', fullName: 'A B', phone: '+919876543210', city: 'Ranchi', state: '20', dob: '2012-05-01' }, '2026-11-10');
    expect(s).toMatchObject({ total: 11, done: 6 });
    expect(s.missing).toEqual(['institutionType', 'institutionName', 'grade', 'guardianName', 'guardianPhone']);
  });
});

describe('where sign-ups came from', () => {
  it('records the channel of a newsletter or popup sign-up, and of a new account', async () => {
    const popup = (await t.call('POST', '/admin/popups', { headers: await admin(), body: { name: 'Diwali offer', template: 'welcome' } })).json;
    expect(popup.id).toBeTruthy();
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'a@example.com', phone: '9876543210', consent: true, visit: metaAd } });
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'b@example.com', phone: '9876500000', consent: true, source: 'popup', popupId: popup.id, visit: google } });
    const [a] = await t.db.select().from(subscribers).where(eq(subscribers.email, 'a@example.com'));
    expect(a).toMatchObject({ channel: 'meta_ads', channelDetail: 'Facebook · diwali-books', source: 'footer' });
    const [b] = await t.db.select().from(subscribers).where(eq(subscribers.email, 'b@example.com'));
    expect(b).toMatchObject({ channel: 'search', channelDetail: 'Google', source: 'popup', popupId: popup.id });
    // A Google sign-in: the account page sends the visit its browser remembered.
    const h = await customer('22222222-2222-4222-8222-222222222222', 'ravi@example.com');
    const r = await t.call('GET', '/account', { headers: { ...h, 'X-Visit-Source': JSON.stringify(metaAd) } });
    expect(r.status).toBe(200);
    const [acc] = await t.db.select().from(accounts).where(eq(accounts.email, 'ravi@example.com'));
    expect(acc).toMatchObject({ channel: 'meta_ads' });
    // A later visit from elsewhere doesn't overwrite where they first came from.
    await t.call('GET', '/account', { headers: { ...h, 'X-Visit-Source': JSON.stringify(google) } });
    expect((await t.db.select().from(accounts).where(eq(accounts.email, 'ravi@example.com')))[0].channel).toBe('meta_ads');
    // Junk in the header is ignored.
    expect((await t.call('GET', '/account', { headers: { ...h, 'X-Visit-Source': '{nope' } })).status).toBe(200);
  });

  it('Admin → Audience: numbers, sources, forms, completion and filters', async () => {
    const popup = (await t.call('POST', '/admin/popups', { headers: await admin(), body: { name: 'Diwali offer', template: 'welcome' } })).json;
    expect(popup.id).toBeTruthy();
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'a@example.com', phone: '9876543210', consent: true, visit: metaAd } });
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'b@example.com', phone: '9876500000', consent: true, source: 'popup', popupId: popup.id, visit: metaAd } });
    const h = await customer('22222222-2222-4222-8222-222222222222', 'ravi@example.com');
    await t.call('GET', '/account', { headers: { ...h, 'X-Visit-Source': JSON.stringify(google) } });
    await t.call('PUT', '/account/profile', { headers: h, body: { type: 'parent', fullName: 'Ravi Kumar', phone: '9876511111', city: 'Ranchi', state: '20' } });

    const r = await t.call('GET', '/admin/audience?days=30', { headers: await admin() });
    expect(r.status).toBe(200);
    const s = r.json.stats;
    expect(s).toMatchObject({ total: 3, accounts: 1, joined: 3, complete: 1, averageCompletion: 100 });
    expect(s.channels).toEqual([{ key: 'meta_ads', label: 'Meta ads', n: 2 }, { key: 'search', label: 'Search', n: 1 }]);
    expect(s.forms).toEqual(expect.arrayContaining([{ key: 'popup:Diwali offer', label: 'Popup: Diwali offer', n: 1 }]));
    expect(s.buckets).toMatchObject({ complete: 1, none: 2 });
    const ravi = r.json.items.find((p: any) => p.email === 'ravi@example.com');
    expect(ravi).toMatchObject({ account: true, channel: 'search', channelDetail: 'Google', progress: { percent: 100 }, form: 'signup' });
    const b = r.json.items.find((p: any) => p.email === 'b@example.com');
    expect(b).toMatchObject({ account: false, progress: null, bucket: 'none', form: 'popup', popupName: 'Diwali offer' });

    // Filters: by source, by completion, by popup.
    const meta = await t.call('GET', '/admin/audience?channel=meta_ads', { headers: await admin() });
    expect(meta.json.items.map((p: any) => p.email).sort()).toEqual(['a@example.com', 'b@example.com']);
    expect((await t.call('GET', '/admin/audience?bucket=complete', { headers: await admin() })).json.total).toBe(1);
    expect((await t.call('GET', `/admin/audience?form=${encodeURIComponent('popup:Diwali offer')}`, { headers: await admin() })).json.total).toBe(1);
    const csv = await t.call('GET', '/admin/audience/export.csv', { headers: await admin() });
    expect(csv.text).toContain('Popup: Diwali offer');
    expect(csv.text).toContain('Meta ads');
  });
});
