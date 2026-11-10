// Meta CompleteRegistration for competition registrations (teams, individuals and groups), and
// the AccountSignup custom event for new accounts. The browser fires the same event ids; its
// once-per-browser guard (fireOnce) is tested here too.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { competitionSignups, teamApplications } from '../server/db/schema.js';
import { memoryMeta, toPayload } from '../server/lib/meta.js';
import { metaAllowed, REGISTRATION_META_TIMEOUT_MS } from '../server/services/tracking.js';
import { COMPETITIONS, type Competition } from '../src/shared/competitions.js';
import { fireOnce, registrationEventId, registrationParams, SIGNUP_EVENT, signupEventId } from '../src/shared/metaEvents.js';
import { emptyMember, type MemberInput, type TeamInput } from '../src/shared/teams.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let meta: ReturnType<typeof memoryMeta>;
beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in' } });
  t.setClock(new Date('2026-11-10T10:00:00+05:30'));
  meta = memoryMeta();
  t.deps.meta = meta;
});

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const FBP = 'fb.1.1793500000000.1234567890';
const FBC = 'fb.1.1793500000000.IwAR0abc_DEF-123';
const UA = 'Mozilla/5.0 Test';
const accepted = { Cookie: `elden_consent=all; _fbp=${FBP}; _fbc=${FBC}`, 'User-Agent': UA };
const essential = { Cookie: `elden_consent=essential; _fbp=${FBP}`, 'User-Agent': UA };
/** Let fire-and-forget work started by a request finish. */
const settle = () => new Promise((r) => setTimeout(r, 20));
const registrations = () => meta.sent.filter((e) => e.name === 'CompleteRegistration');

const SLUG = 'doomsday-diaries';
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const TEACHER = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'asha@school.in', name: 'Asha Verma' };
const PARENT = { sub: 'd4444444-4444-4444-8444-444444444444', email: 'parent@example.com', name: 'Kiran Das' };
const STUDENT = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'riya.s@example.com', name: 'Riya Sharma' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });

const PROFILES = {
  teacher: { type: 'teacher', institutionType: 'school', institutionName: 'DAV Public School' },
  parent: { type: 'parent' },
  student: { type: 'student', dob: '2012-05-04', institutionType: 'school', institutionName: 'DAV Public School', grade: 'Class 8', guardianName: 'Meera Sharma', guardianPhone: '9123456780' },
};
/** Signs in (creating the account without ad consent) and completes the profile. */
async function signedIn(u: typeof TEACHER, kind: keyof typeof PROFILES = 'teacher') {
  const h = await as(u);
  expect((await t.call('GET', '/account', { headers: h })).status).toBe(200);
  const p = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '98765 43210', fullName: u.name, city: 'Ranchi', state: '20', ...PROFILES[kind] } });
  expect(p.json.completed).toBe(true);
  return h;
}

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const enc = (s: string) => [...new TextEncoder().encode(s)];
const idPhoto = () => Uint8Array.from([0xff, 0xd8, ...seg(0xe1, [...enc('Exif\0\0')]), ...seg(0xc0, [8, 0, 10, 0, 20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), 1, 2, 3, 0xff, 0xd9]);
async function uploadId(h: Record<string, string>) {
  const r = await t.call('POST', `/competitions/${SLUG}/team/id-upload`, { headers: h, body: { contentType: 'image/jpeg', size: 500 } });
  expect(r.status).toBe(201);
  await t.deps.storage.write('competition-entries', r.json.key, idPhoto());
  return r.json.key as string;
}
const member = (o: Partial<MemberInput>): MemberInput => ({ ...emptyMember(), idDocType: 'school_id', guardianName: 'Meera Sharma', guardianRelation: 'Mother', guardianPhone: '9123456780', guardianConsent: true, ...o });
const RIYA_TEAM = [
  { fullName: 'Riya Sharma', dob: '2013-05-04', roles: ['writer'], instagram: 'riya.draws', email: STUDENT.email },
  { fullName: 'Aman Gupta', dob: '2012-12-01', roles: ['artist', 'colourist'], instagram: 'aman_g' },
] as Partial<MemberInput>[];
const KABIR_TEAM = [
  { fullName: 'Kabir Das', dob: '2012-03-03', roles: ['writer'], instagram: 'kabir.d', email: 'kabir@example.com' },
  { fullName: 'Neha Roy', dob: '2012-04-04', roles: ['artist'], instagram: 'neha.r' },
] as Partial<MemberInput>[];
async function team(h: Record<string, string>, members = RIYA_TEAM, teamName = 'The Ink Avengers'): Promise<TeamInput> {
  return {
    teamName, institutionType: 'school', institutionName: 'DAV Public School', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
    members: await Promise.all(members.map(async (m) => member({ idDocKey: await uploadId(h), ...m }))),
  };
}
const registerTeam = (h: Record<string, string>, body: TeamInput, extra: Record<string, string> = accepted) =>
  t.call('POST', `/competitions/${SLUG}/team`, { headers: { ...h, ...extra }, body });

/** An individual / group competition that exists only in these tests (open on the test clock). */
const QUIZ: Competition = {
  slug: 'test-meta-quiz', title: 'Meta Test Quiz', tagline: 'Test only', about: 'Test only.',
  opensAt: '2026-11-01T00:00:00+05:30', closesAt: '2026-12-10T23:59:59+05:30', maxPerAccount: 5,
  individual: { participant: [{ key: 'student_name', label: 'Student’s name', required: true }] },
  group: { minMembers: 2, maxMembers: 3, nameLabel: 'Team name', member: [{ key: 'student_name', label: 'Student’s name', required: true }] },
};
beforeAll(() => { COMPETITIONS.push(QUIZ); });
afterAll(() => { COMPETITIONS.splice(COMPETITIONS.indexOf(QUIZ), 1); });
const registerQuiz = (h: Record<string, string>, extra: Record<string, string> = accepted, mode: 'individual' | 'group' = 'individual') =>
  t.call('POST', `/competitions/${QUIZ.slug}/register`, {
    headers: { ...h, ...extra },
    body: mode === 'individual'
      ? { mode, answers: {}, participants: [{ student_name: 'Riya Sharma' }] }
      : { mode, groupName: 'Quiz Stars', answers: {}, participants: [{ student_name: 'Riya Sharma' }, { student_name: 'Aman Gupta' }] },
  });

describe('CompleteRegistration (server)', () => {
  it('a) is sent once for a new team registration, with reg_<id>, the parameters and the matching details', async () => {
    const h = await signedIn(TEACHER);
    const r = await registerTeam(h, await team(h));
    expect(r.status).toBe(201);
    await settle();
    const sent = registrations();
    expect(sent).toHaveLength(1);
    const p = toPayload(sent[0]);
    expect(p).toMatchObject({
      event_name: 'CompleteRegistration', event_id: `reg_${r.json.application.id}`, action_source: 'website',
      event_source_url: `https://eldenap.in/competitions/${SLUG}`,
      custom_data: { content_name: SLUG, content_category: 'competition', currency: 'INR', value: 0 },
      user_data: {
        em: [sha(TEACHER.email)], ph: [sha('919876543210')], fn: [sha('asha')], ln: [sha('verma')], external_id: [sha(TEACHER.email)],
        client_ip_address: '10.0.0.1', client_user_agent: UA, fbp: FBP, fbc: FBC,
      },
    });
    expect(JSON.stringify(p)).not.toContain(TEACHER.email); // only hashed
  });

  it('a) is sent once for individual and group registrations too, each with its own reg_<id>', async () => {
    const h = await signedIn(TEACHER);
    const one = await registerQuiz(h, accepted, 'individual');
    const group = await registerQuiz(h, accepted, 'group');
    expect([one.status, group.status]).toEqual([201, 201]);
    await settle();
    const rows = await t.db.select({ id: competitionSignups.id, mode: competitionSignups.mode }).from(competitionSignups);
    const ids = Object.fromEntries(rows.map((x) => [x.mode, x.id]));
    expect(registrations().map((e) => e.eventId)).toEqual([`reg_${ids.individual}`, `reg_${ids.group}`]);
    for (const e of registrations()) {
      expect(toPayload(e).custom_data).toEqual({ content_name: QUIZ.slug, content_category: 'competition', currency: 'INR', value: 0 });
      expect(toPayload(e).user_data).toMatchObject({ em: [sha(TEACHER.email)], ph: [sha('919876543210')], external_id: [sha(TEACHER.email)], fbp: FBP, fbc: FBC });
    }
  });

  it('b) is not sent again on edits, resubmission after "Request changes", approval, rejection or withdrawal', async () => {
    const admin = await as(OWNER);
    // Team 1: changes requested → resubmitted → edited again while pending → rejected.
    const h = await signedIn(TEACHER);
    const app1 = (await registerTeam(h, await team(h))).json.application;
    // Team 2 (another account): approved → withdrawn.
    const p = await signedIn(PARENT, 'parent');
    const app2 = (await registerTeam(p, await team(p, KABIR_TEAM, 'Quiz Kids'))).json.application;
    await settle();
    expect(registrations().map((e) => e.eventId)).toEqual([`reg_${app1.id}`, `reg_${app2.id}`]);

    const review = (id: string, action: string, message = '') => t.call('POST', `/admin/competitions/${SLUG}/teams/${id}/review`, { headers: { ...admin, ...accepted }, body: { action, message } });
    expect((await review(app1.id, 'changes', 'Please upload a clearer ID.')).status).toBe(200);
    const mine = (await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.applications[0];
    const edit = { teamName: mine.teamName, institutionType: 'school', institutionName: 'DAV Public School', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
      members: mine.members.map((m: MemberInput) => member({ ...m, guardianConsent: true })) };
    const put = () => t.call('PUT', `/competitions/${SLUG}/team/${app1.id}`, { headers: { ...h, ...accepted }, body: edit });
    expect((await put()).json.application.status).toBe('pending'); // resubmitted
    expect((await put()).status).toBe(200); // edited while pending
    expect((await review(app1.id, 'reject', 'Not eligible.')).status).toBe(200);
    expect((await review(app2.id, 'approve')).status).toBe(200);
    expect((await t.call('POST', `/competitions/${SLUG}/team/${app2.id}/withdraw`, { headers: { ...p, ...accepted } })).status).toBe(200);
    await settle();
    expect(registrations().map((e) => e.eventId)).toEqual([`reg_${app1.id}`, `reg_${app2.id}`]);
    expect(meta.sent.filter((e) => e.name !== 'CompleteRegistration' && e.name !== SIGNUP_EVENT)).toEqual([]);
  });

  it('c) is not sent with "Essential only" or without a cookie choice', async () => {
    const h = await signedIn(TEACHER);
    expect((await registerTeam(h, await team(h), essential)).status).toBe(201);
    expect((await registerQuiz(h, essential)).status).toBe(201);
    expect((await registerQuiz(h, { 'User-Agent': UA })).status).toBe(201);
    await settle();
    expect(registrations()).toEqual([]);
  });

  it('d) the registration still succeeds when Meta throws', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    t.deps.meta = { send: async () => { throw new Error('Meta is down'); } };
    const h = await signedIn(TEACHER);
    const r = await registerTeam(h, await team(h));
    expect(r.status).toBe(201);
    expect(r.json.application).toMatchObject({ code: 'DD-0001', status: 'pending' });
    expect(await t.db.select().from(teamApplications)).toHaveLength(1);
    t.deps.meta = { send: () => { throw new Error('Meta threw at once'); } }; // not even a promise
    expect((await registerQuiz(h)).status).toBe(201);
    await settle();
    expect(errors.mock.calls.map((c) => c.join(' '))).toEqual(expect.arrayContaining([
      expect.stringContaining('Meta is down'), expect.stringContaining('Meta threw at once'),
    ]));
    errors.mockRestore();
  });

  it('d) the registration answers at once when Meta never replies, and the wait is cut off by the timeout', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const background: Promise<unknown>[] = [];
    t.deps.defer = (p) => { background.push(p); };
    let calls = 0;
    t.deps.meta = { send: () => { calls++; return new Promise(() => {}); } }; // hangs forever
    const h = await signedIn(TEACHER);
    const body = await team(h);
    const started = Date.now();
    const r = await registerTeam(h, body);
    expect(r.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(calls).toBe(1);
    await Promise.all(background); // ends only because of the timeout
    expect(Date.now() - started).toBeGreaterThanOrEqual(REGISTRATION_META_TIMEOUT_MS - 100);
    expect(errors.mock.calls.map((c) => c.join(' '))).toContainEqual(expect.stringContaining(`no answer in ${REGISTRATION_META_TIMEOUT_MS} ms`));
    errors.mockRestore();
  }, REGISTRATION_META_TIMEOUT_MS + 15_000);
});

describe('browser guard (the Pixel twin)', () => {
  const memoryStore = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it('e) uses the same id and parameters as the server, and fires once per registration in a browser', () => {
    expect(registrationEventId('0d6c1a52-0000-4000-8000-000000000001')).toBe('reg_0d6c1a52-0000-4000-8000-000000000001');
    expect(registrationParams('doomsday-diaries')).toEqual({ content_name: 'doomsday-diaries', content_category: 'competition', currency: 'INR', value: 0 });
    const store = memoryStore();
    const fire = vi.fn();
    expect(fireOnce(store, 'elden-reg-tracked:a', fire)).toBe(true);
    expect(fireOnce(store, 'elden-reg-tracked:a', fire)).toBe(false); // a refresh or second submit
    expect(fireOnce(store, 'elden-reg-tracked:b', fire)).toBe(true); // another registration
    expect(fire).toHaveBeenCalledTimes(2);
    expect(store.m.get('elden-reg-tracked:a')).toBe('1');
  });

  it('e) never throws: a blocked Pixel or blocked storage can’t stop the success screen', () => {
    expect(() => fireOnce(memoryStore(), 'k', () => { throw new Error('fbq is not defined'); })).not.toThrow();
    const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); } };
    const fire = vi.fn();
    expect(fireOnce(blocked, 'k', fire)).toBe(true);
    expect(fireOnce(null, 'k', fire)).toBe(true);
    expect(fire).toHaveBeenCalledTimes(2); // still sent; Meta drops a repeat by its event id
  });
});

describe('AccountSignup', () => {
  const NEW = { sub: '77777777-7777-4777-8777-777777777777', email: 'new@example.com', name: 'New Reader' };
  const profile = { phone: '98765 43210', fullName: 'New Reader', city: 'Ranchi', state: '20', type: 'parent' };

  it('f) is sent once, as AccountSignup with signup-<userId>, when the profile first says who the person is (not at sign-in)', async () => {
    const h = { ...(await as(NEW)), ...accepted };
    expect((await t.call('GET', '/account', { headers: h })).json).toMatchObject({ newAccount: true, meta: { allowed: true } });
    await t.call('GET', '/account', { headers: h });
    expect(meta.sent).toEqual([]); // signing in alone sends nothing
    const first = await t.call('PUT', '/account/profile', { headers: h, body: profile });
    expect(first.json.meta).toEqual({ allowed: true, signupEventId: signupEventId(NEW.sub) });
    const again = await t.call('PUT', '/account/profile', { headers: h, body: { city: 'Hazaribagh' } });
    expect(again.json.meta).toEqual({ allowed: true, signupEventId: null });
    expect(meta.sent.map((e) => `${e.name}:${e.eventId}`)).toEqual([`AccountSignup:${signupEventId(NEW.sub)}`]);
    expect(toPayload(meta.sent[0])).toMatchObject({
      event_name: 'AccountSignup', custom_data: { content_name: 'Google sign-in', status: 'complete' },
      user_data: { em: [sha(NEW.email)], ph: [sha('919876543210')], fn: [sha('new')], ln: [sha('reader')], external_id: [sha(NEW.email)], client_ip_address: '10.0.0.1', client_user_agent: UA, fbp: FBP, fbc: FBC },
    });
  });

  it('f) is not sent without "Accept all"', async () => {
    const h = { ...(await as(NEW)), ...essential };
    await t.call('GET', '/account', { headers: h });
    await t.call('PUT', '/account/profile', { headers: h, body: profile });
    expect(meta.sent).toEqual([]);
  });
});

describe('students: Meta only from META_MIN_AGE (13), by date of birth', () => {
  // Today is 10 November 2026 (India time).
  const student = (dob?: string) => ({ phone: '98765 43210', fullName: 'Riya Sharma', city: 'Ranchi', state: '20', type: 'student',
    institutionType: 'school', institutionName: 'DAV Public School', grade: 'Class 8', guardianName: 'Meera Sharma', guardianPhone: '9123456780', ...(dob ? { dob } : {}) });
  const aboutStudent = () => meta.sent.filter((e) => JSON.stringify(toPayload(e)).includes(sha(STUDENT.email)));

  it.each([
    ['12 (turns 13 tomorrow)', '2013-11-11', false],
    ['exactly 13 (birthday today)', '2013-11-10', true],
    ['17', '2009-06-15', true],
    ['18 and over (26)', '2000-01-01', true],
  ])('a student aged %s (date of birth %s): sent to Meta = %s', async (_label, dob, allowed) => {
    const h = { ...(await as(STUDENT)), ...accepted };
    await t.call('GET', '/account', { headers: h });
    const saved = await t.call('PUT', '/account/profile', { headers: h, body: student(dob as string) });
    expect(saved.json.completed).toBe(true);
    expect(saved.json.meta).toEqual({ allowed, signupEventId: allowed ? signupEventId(STUDENT.sub) : null });
    expect((await t.call('GET', '/account', { headers: h })).json.meta).toEqual({ allowed });
    const app = (await registerTeam(h, await team(h, KABIR_TEAM, 'Student Team'))).json.application;
    expect((await registerQuiz(h, accepted)).status).toBe(201);
    await settle();
    if (!allowed) {
      expect(meta.sent).toEqual([]);
      return;
    }
    // Exactly as for any other account: the same events, ids and match details.
    expect(meta.sent.map((e) => e.name)).toEqual(['AccountSignup', 'CompleteRegistration', 'CompleteRegistration']);
    expect(meta.sent[1].eventId).toBe(`reg_${app.id}`);
    for (const e of meta.sent) {
      expect(toPayload(e).user_data).toMatchObject({ em: [sha(STUDENT.email)], ph: [sha('919876543210')], fn: [sha('riya')], ln: [sha('sharma')], external_id: [sha(STUDENT.email)], client_ip_address: '10.0.0.1', client_user_agent: UA, fbp: FBP, fbc: FBC });
    }
  });

  it('a student with no date of birth: nothing, until they add one (then AccountSignup, if old enough)', async () => {
    const h = { ...(await as(STUDENT)), ...accepted };
    await t.call('GET', '/account', { headers: h });
    const saved = await t.call('PUT', '/account/profile', { headers: h, body: student() });
    expect(saved.json).toMatchObject({ completed: false, missing: ['dob'], meta: { allowed: false, signupEventId: null } });
    expect((await t.call('GET', '/account', { headers: h })).json.meta).toEqual({ allowed: false });
    // Without a date of birth the profile isn't complete, so they can't register either.
    expect((await registerTeam(h, await team(h, KABIR_TEAM, 'Student Team'))).json.code).toBe('profile_incomplete');
    await settle();
    expect(meta.sent).toEqual([]);
    const later = await t.call('PUT', '/account/profile', { headers: h, body: { dob: '2010-01-01' } }); // 16
    expect(later.json.meta).toEqual({ allowed: true, signupEventId: signupEventId(STUDENT.sub) });
    expect(meta.sent.map((e) => e.name)).toEqual(['AccountSignup']);
  });

  it('a teacher, parent or "Other" (no date of birth asked) is sent as before', async () => {
    const h = { ...(await as(TEACHER)), ...accepted };
    await t.call('GET', '/account', { headers: h });
    const saved = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '98765 43210', fullName: TEACHER.name, city: 'Ranchi', state: '20', ...PROFILES.teacher } });
    expect(saved.json.meta).toEqual({ allowed: true, signupEventId: signupEventId(TEACHER.sub) });
    const app = (await registerTeam(h, await team(h))).json.application;
    await settle();
    expect(meta.sent.map((e) => `${e.name}:${e.eventId}`)).toEqual([`AccountSignup:${signupEventId(TEACHER.sub)}`, `CompleteRegistration:reg_${app.id}`]);
  });

  it('the minimum age is one setting: META_MIN_AGE=18 stops a 17-year-old, lets an 18-year-old through', async () => {
    t = await setup({ env: { SITE_URL: 'https://eldenap.in', META_MIN_AGE: '18' } });
    t.setClock(new Date('2026-11-10T10:00:00+05:30'));
    t.deps.meta = meta = memoryMeta();
    expect((await t.call('GET', '/config')).json.metaMinAge).toBe(18);
    const h = { ...(await as(STUDENT)), ...accepted };
    await t.call('GET', '/account', { headers: h });
    expect((await t.call('PUT', '/account/profile', { headers: h, body: student('2009-06-15') })).json.meta.allowed).toBe(false); // 17
    await registerTeam(h, await team(h, KABIR_TEAM, 'Student Team'));
    await settle();
    expect(aboutStudent()).toEqual([]);
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { dob: '2008-11-10' } })).json.meta.allowed).toBe(true); // 18 today
    expect((await registerQuiz(h, accepted)).status).toBe(201);
    await settle();
    expect(meta.sent.map((e) => e.name)).toEqual(['CompleteRegistration']); // AccountSignup was due when they first identified (at 17): not sent, not repeated
  });

  it('the rule itself', () => {
    const d = { env: { META_MIN_AGE: 13 }, now: () => new Date('2026-11-10T10:00:00+05:30') } as Parameters<typeof metaAllowed>[0];
    expect(metaAllowed(d, { accountType: 'student', dob: '2013-11-11' })).toBe(false); // 12
    expect(metaAllowed(d, { accountType: 'student', dob: '2013-11-10' })).toBe(true); // 13 today
    expect(metaAllowed(d, { accountType: 'student', dob: null })).toBe(false);
    expect(metaAllowed(d, { accountType: 'teacher', dob: null })).toBe(true);
    expect(metaAllowed(d, { accountType: 'parent', dob: null })).toBe(true);
    expect(metaAllowed(d, { accountType: null, dob: null })).toBe(true); // hasn't said yet
    // Just after midnight in India it's already the birthday (the server clock is UTC).
    expect(metaAllowed({ ...d, now: () => new Date('2026-11-09T18:31:00Z') }, { accountType: 'student', dob: '2013-11-10' })).toBe(true);
    expect(metaAllowed({ ...d, now: () => new Date('2026-11-09T18:29:00Z') }, { accountType: 'student', dob: '2013-11-10' })).toBe(false);
  });
});
