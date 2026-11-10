// Admin → Competitions → Analytics: the registration funnel (steps the website counts
// anonymously, then saved registrations), per day, channels with conversion, and who registers.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { COMPETITIONS, type Competition } from '../src/shared/competitions.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
const ist = (s: string) => new Date(`${s}+05:30`);
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const TEACHER = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'asha@school.in', name: 'Asha Verma' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });
const at = Date.parse('2026-12-04T10:00:00Z');
const metaAd = { first: { at, source: 'instagram', medium: 'paid', campaign: 'quiz' } };

const QUIZ: Competition = {
  slug: 'test-analytics-quiz', title: 'Analytics Quiz', tagline: 'x', about: 'x',
  opensAt: '2026-12-01T00:00:00+05:30', closesAt: '2026-12-10T23:59:59+05:30',
  individual: { participant: [{ key: 'student_name', label: 'Student’s name', required: true }], questions: [] },
};
beforeAll(() => { COMPETITIONS.push(QUIZ); });
afterAll(() => { COMPETITIONS.splice(COMPETITIONS.indexOf(QUIZ), 1); });
beforeEach(async () => {
  t = await setup();
  t.setClock(ist('2026-12-05T10:00:00'));
});
const track = (step: string, visit?: unknown, slug = QUIZ.slug) => t.call('POST', `/competition-info/${slug}/track`, { body: { step, visit } });

describe('competition analytics', () => {
  it('counts steps anonymously, refuses unknown ones', async () => {
    expect((await track('view', metaAd)).status).toBe(200);
    expect((await track('teleport')).status).toBe(400);
    expect((await track('members')).status).toBe(400); // a team-form step on an individual competition
    expect((await track('members', undefined, 'doomsday-diaries')).status).toBe(200);
    expect((await track('view', undefined, 'no-such-competition')).status).toBe(404);
  });

  it('funnel, per day, channels and who registers', async () => {
    // Four visitors (three from an Instagram ad), three sign in, two start, one registers.
    for (const v of [metaAd, metaAd, metaAd, undefined]) await track('view', v);
    for (const v of [metaAd, metaAd, undefined]) await track('signin', v);
    for (const v of [metaAd, metaAd]) await track('start', v);
    const h = await as(TEACHER);
    await t.call('GET', '/account', { headers: { ...h, 'X-Visit-Source': JSON.stringify(metaAd) } });
    await t.call('PUT', '/account/profile', { headers: h, body: { phone: '98765 43210', fullName: 'Asha Verma', city: 'Ranchi', state: '20', type: 'teacher', institutionType: 'school', institutionName: 'DAV Ranchi' } });
    expect((await t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: { mode: 'individual', participants: [{ student_name: 'Riya' }] } })).status).toBe(201);

    const r = await t.call('GET', `/admin/competitions/${QUIZ.slug}/analytics?days=30`, { headers: await admin() });
    expect(r.status).toBe(200);
    expect(r.json.funnel.map((f: any) => [f.key, f.n])).toEqual([['view', 4], ['signin', 3], ['start', 2], ['submitted', 1]]);
    expect(r.json.totals).toMatchObject({ visits: 4, registrations: 1, people: 1, conversion: 25 });
    expect(r.json.channels[0]).toMatchObject({ key: 'meta_ads', visits: 3, registrations: 1, conversion: 33.3 });
    expect(r.json.channels.find((c: any) => c.key === 'direct')).toMatchObject({ visits: 1, registrations: 0 });
    expect(r.json.who).toEqual([{ label: 'Teachers', n: 1 }]);
    expect(r.json.states).toEqual([{ label: 'Jharkhand', n: 1 }]);
    expect(r.json.daily.at(-1)).toMatchObject({ day: '2026-12-05', visits: 4 });
    expect(r.json.daily.reduce((n: number, d: any) => n + d.registrations, 0)).toBe(1); // stamped by the database's own clock

    // The list of competitions shows visits and the conversion.
    const list = await t.call('GET', '/admin/competitions', { headers: await admin() });
    expect(list.json.items.find((x: any) => x.slug === QUIZ.slug)).toMatchObject({ visits: 4, started: 2, registrations: 1 });

    // DoomsDay Diaries has the team steps, approvals and uploads in its funnel.
    const dd = await t.call('GET', '/admin/competitions/doomsday-diaries/analytics', { headers: await admin() });
    expect(dd.json.funnel.map((f: any) => f.key)).toEqual(['view', 'signin', 'start', 'members', 'review', 'submitted', 'approved', 'uploaded']);
  });
});
