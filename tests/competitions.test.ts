import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog } from '../server/db/schema.js';
import { COMPETITIONS, type Competition } from '../src/shared/competitions.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const MANAGER = { sub: '22222222-2222-4222-8222-222222222222', email: 'manager@eldenap.in' };
const TEACHER = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'asha@school.in', name: 'Asha Verma' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });
const ist = (s: string) => new Date(`${s}+05:30`);

/** A competition that exists only in these tests. */
const QUIZ: Competition = {
  slug: 'test-science-quiz', title: 'Science Quiz 2026', tagline: 'Ten questions, one winner', about: 'Answer **ten** questions.',
  opensAt: '2026-12-01T00:00:00+05:30', closesAt: '2026-12-10T23:59:59+05:30', maxPerAccount: 3,
  individual: {
    participant: [
      { key: 'student_name', label: 'Student’s name', required: true },
      { key: 'class', label: 'Class', type: 'class', required: true },
      { key: 'school', label: 'School', required: true },
    ],
    questions: [{ key: 'how_heard', label: 'How did you hear about us?', type: 'select', options: ['School', 'WhatsApp'] }],
  },
  group: {
    minMembers: 2, maxMembers: 3, nameLabel: 'Team name',
    member: [{ key: 'student_name', label: 'Student’s name', required: true }, { key: 'class', label: 'Class', type: 'class', required: true }],
    questions: [{ key: 'teacher_phone', label: 'Teacher’s phone', type: 'phone', required: true }],
  },
};
beforeAll(() => { COMPETITIONS.push(QUIZ); });
afterAll(() => { COMPETITIONS.splice(COMPETITIONS.indexOf(QUIZ), 1); });

async function signedIn(complete = true) {
  const h = await as(TEACHER);
  expect((await t.call('GET', '/account', { headers: h })).status).toBe(200);
  if (complete) {
    const p = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '98765 43210', fullName: 'Asha Verma', city: 'Ranchi', state: '20', type: 'teacher', institutionType: 'school', institutionName: 'DAV Ranchi' } });
    expect(p.json).toMatchObject({ completed: true, type: 'teacher', phone: '9876543210', stateName: 'Jharkhand' });
  }
  return h;
}
const individual = (name = 'Riya Sharma', cls = 'Class 7') => ({ mode: 'individual', answers: { how_heard: 'School' }, participants: [{ student_name: name, class: cls, school: 'DAV Ranchi' }] });

describe('profile', () => {
  it('a parent is complete with name, WhatsApp, city, state and "I am a"; the phone alone still works', async () => {
    const h = await signedIn(false);
    expect((await t.call('GET', '/account', { headers: h })).json.profile).toMatchObject({ completed: false, type: null });
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210' } })).json).toMatchObject({ phone: '9876543210', completed: false });
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'A', city: 'Ranchi', state: '20', type: 'teacher' } })).status).toBe(400);
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'Asha', city: 'Ranchi', state: '99', type: 'teacher' } })).json.error).toBeTruthy();
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'Asha', city: 'Ranchi', state: '20', type: 'principal' } })).status).toBe(400);
    const ok = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'Asha Verma', city: 'Ranchi', state: '20', type: 'parent' } });
    expect(ok.json).toMatchObject({ completed: true, type: 'parent', missing: [] });
    expect((await t.call('GET', '/account', { headers: h })).json.profile).toMatchObject({ fullName: 'Asha Verma', city: 'Ranchi', completed: true });
  });
});

describe('competitions', () => {
  it('needs a sign-in and a completed profile, then registers one person and emails a confirmation', async () => {
    t.setClock(ist('2026-12-05T10:00:00'));
    expect((await t.call('POST', `/competitions/${QUIZ.slug}/register`, { body: individual() })).status).toBe(401);
    const h = await signedIn(false);
    expect((await t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: individual() })).json.code).toBe('profile_incomplete');
    await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'Asha Verma', city: 'Ranchi', state: '20', type: 'teacher', institutionType: 'school', institutionName: 'DAV Ranchi' } });
    t.mailer.sent.length = 0;
    const r = await t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: individual() });
    expect(r.status).toBe(201);
    expect(r.json.signup).toMatchObject({ mode: 'individual', people: ['Riya Sharma'] });
    const mail = t.mailer.sent.find((m) => m.to === TEACHER.email)!;
    expect(mail.subject).toBe('Registered: Science Quiz 2026');
    expect(mail.html).toContain('Riya Sharma');
    expect((await t.call('GET', `/competitions/${QUIZ.slug}/mine`, { headers: h })).json.items).toHaveLength(1);
    expect((await t.call('GET', '/account', { headers: h })).json.competitions).toMatchObject([{ slug: QUIZ.slug, title: 'Science Quiz 2026', people: ['Riya Sharma'] }]);
  });

  it('checks the answers: required fields, classes, options, phone numbers and group sizes', async () => {
    t.setClock(ist('2026-12-05T10:00:00'));
    const h = await signedIn();
    const post = (b: object) => t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: b });
    expect((await post({ mode: 'individual', participants: [{ class: 'Class 7', school: 'DAV' }] })).json.error).toBe('Student’s name is needed.');
    expect((await post(individual('Riya', 'Class 13'))).json.error).toBe('Class: choose a class.');
    expect((await post({ ...individual(), answers: { how_heard: 'TV' } })).json.error).toBe('How did you hear about us?: choose one of the options.');
    const team = (members: object[], phone = '9123456780') => ({ mode: 'group', groupName: 'Little Newtons', answers: { teacher_phone: phone }, participants: members });
    expect((await post(team([{ student_name: 'A', class: 'Class 6' }]))).json.error).toBe('A group has 2 to 3 members.');
    expect((await post(team([{ student_name: 'A', class: 'Class 6' }, { student_name: 'B', class: 'Class 6' }], '12345'))).json.error).toBe('Teacher’s phone must be a 10-digit mobile number.');
    expect((await post({ ...team([{ student_name: 'A', class: 'Class 6' }, { student_name: 'B', class: 'Class 6' }]), groupName: '' })).json.error).toBe('Team name is needed.');
    const g = await post(team([{ student_name: 'Aman', class: 'Class 6' }, { student_name: 'Bela', class: 'Class 7' }]));
    expect(g.status).toBe(201);
    expect(g.json.signup).toMatchObject({ mode: 'group', groupName: 'Little Newtons', people: ['Aman', 'Bela'] });
  });

  it('opens and closes on time (India time) and limits registrations per account', async () => {
    const h = await signedIn();
    const post = () => t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: individual() });
    t.setClock(ist('2026-11-30T23:59:59'));
    expect((await post()).json.code).toBe('not_open');
    t.setClock(ist('2026-12-10T23:59:59'));
    for (let i = 0; i < 3; i++) expect((await post()).status).toBe(201);
    expect((await post()).json.code).toBe('limit');
    t.setClock(ist('2026-12-11T00:00:00'));
    expect((await post()).json.code).toBe('closed');
    expect((await t.call('POST', '/competitions/no-such-thing/register', { headers: h, body: individual() })).status).toBe(404);
  });

  it('shows in Admin → Competitions with every registration and a CSV (one row per person), for the owner only', async () => {
    t.setClock(ist('2026-12-05T10:00:00'));
    const h = await signedIn();
    await t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: individual() });
    await t.call('POST', `/competitions/${QUIZ.slug}/register`, { headers: h, body: { mode: 'group', groupName: 'Little Newtons', answers: { teacher_phone: '9123456780' }, participants: [{ student_name: 'Aman', class: 'Class 6' }, { student_name: 'Bela', class: 'Class 7' }] } });
    const admin = await as(OWNER);
    const list = (await t.call('GET', '/admin/competitions', { headers: admin })).json.items;
    expect(list.find((x: any) => x.slug === QUIZ.slug)).toMatchObject({ phase: 'open', registrations: 2, groups: 1, people: 3, modes: ['individual', 'group'] });
    const d = (await t.call('GET', `/admin/competitions/${QUIZ.slug}`, { headers: admin })).json;
    expect(d.items).toHaveLength(2);
    expect(d.items[0].by).toMatchObject({ name: 'Asha Verma', email: TEACHER.email, phone: '9876543210', city: 'Ranchi', state: 'Jharkhand', type: 'Teacher' });
    expect(d.questions.map((q: any) => q.key)).toEqual(['how_heard', 'teacher_phone']);
    const csv = await t.call('GET', `/admin/competitions/${QUIZ.slug}/export.csv`, { headers: admin });
    const lines = csv.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(4); // header + Riya + Aman + Bela
    expect(lines[0]).toContain('Student’s name');
    expect(csv.text).toContain('Little Newtons');
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, 'competition.export'))).length).toBe(1);

    await t.db.insert(adminUsers).values({ userId: MANAGER.sub, email: MANAGER.email, role: 'manager' });
    expect((await t.call('GET', '/admin/competitions', { headers: await as(MANAGER) })).status).toBe(403);
  });

  it('lists only listed competitions in the sitemap', async () => {
    const get = async () => (await t.app.request('/sitemap.xml')).text();
    const before = process.env.VITE_SITE_LIVE;
    process.env.VITE_SITE_LIVE = 'true';
    try {
      expect(await get()).toContain(`<loc>https://eldenap.in/competitions/${QUIZ.slug}</loc>`);
      QUIZ.unlisted = true;
      expect(await get()).not.toContain(QUIZ.slug);
    } finally {
      QUIZ.unlisted = false;
      if (before === undefined) delete process.env.VITE_SITE_LIVE; else process.env.VITE_SITE_LIVE = before;
    }
  });
});
