// Cookie-banner analytics: anonymous counters (no IP or ids stored), and Admin → Cookie consent.
import { beforeEach, describe, expect, it } from 'vitest';
import { consentStats } from '../server/db/schema.js';
import { deviceOf } from '../server/routes/consent.js';
import { pageGroup, timingOf } from '../src/shared/consentStats.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
  t.setClock(new Date('2026-11-11T11:00:00+05:30'));
});
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const PHONE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15';
const india = { 'x-vercel-ip-country': 'IN', 'x-vercel-ip-country-region': 'JH' };
const metaAd = { first: { at: Date.parse('2026-11-11T05:00:00Z'), source: 'facebook', medium: 'paid' } };
const send = (body: unknown, ua = PHONE, extra: Record<string, string> = india) => t.call('POST', '/consent/track', { headers: { 'User-Agent': ua, ...extra }, body });

describe('cookie consent analytics', () => {
  it('helpers', () => {
    expect(deviceOf(PHONE)).toBe('mobile');
    expect(deviceOf(MAC)).toBe('desktop');
    expect(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('tablet');
    expect(pageGroup('/books/mathematics-today')).toBe('book');
    expect(pageGroup('/')).toBe('home');
    expect(timingOf(3)).toBe('lt5');
    expect(timingOf(90_000)).toBe('later');
  });

  it('keeps only counters (no IP address or browser string), and adds them up for the admin', async () => {
    await send({ event: 'shown', path: '/books/mathematics-today', visit: metaAd });
    await send({ event: 'shown', path: '/' });
    await send({ event: 'shown', path: '/', visit: metaAd }, MAC, { 'x-vercel-ip-country': 'AE' });
    await send({ event: 'accept', path: '/books/mathematics-today', seconds: 4, visit: metaAd });
    await send({ event: 'essential', path: '/', seconds: 20 });
    await send({ event: 'change_all', path: '/privacy' });
    expect((await send({ event: 'stalk', path: '/' })).status).toBe(400);
    expect((await send({ event: 'shown', path: '/' }, 'Googlebot/2.1')).status).toBe(204); // bots ignored

    const rows = await t.db.select().from(consentStats);
    const columns = Object.keys(rows[0]);
    expect(columns.sort()).toEqual(['channel', 'day', 'device', 'event', 'n', 'page', 'region', 'timing']);
    expect(JSON.stringify(rows)).not.toContain('10.0.0.1');
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(6);

    const r = await t.call('GET', '/admin/consent?days=7', { headers: await admin() });
    expect(r.status).toBe(200);
    expect(r.json.totals).toMatchObject({ shown: 3, accept: 1, essential: 1, noChoice: 1, acceptRate: 50, changedToAll: 1 });
    expect(r.json.byDevice.find((x: any) => x.key === 'mobile')).toMatchObject({ shown: 2, accept: 1, essential: 1, acceptRate: 50 });
    expect(r.json.byRegion.map((x: any) => x.label)).toEqual(expect.arrayContaining(['Jharkhand', 'AE']));
    expect(r.json.byChannel.find((x: any) => x.key === 'meta_ads')).toMatchObject({ shown: 2, accept: 1 });
    expect(r.json.byPage.find((x: any) => x.key === 'book')).toMatchObject({ label: 'A book page', accept: 1 });
    expect(r.json.timing.find((x: any) => x.key === 'lt5')).toMatchObject({ accept: 1 });
    expect(r.json.daily.at(-1)).toMatchObject({ day: '2026-11-11', shown: 3, accept: 1, essential: 1 });
  });
});
