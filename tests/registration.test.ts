import { beforeEach, describe, expect, it } from 'vitest';
import { setup, supabaseToken } from './helpers.js';
import { createCompetition, ist } from './competitionHelpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const PARENT = { sub: 'a1111111-1111-4111-8111-111111111111', email: 'meera@example.com', name: 'Meera Sharma' };
const OTHER = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'vikram@example.com', name: 'Vikram Rao' };
const STUDENT = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'riya.s@example.com', name: 'Riya Sharma' };
const as = async (u: { sub: string; email: string; name: string }) => ({ Authorization: `Bearer ${await supabaseToken({ ...u, provider: 'google' })}` });
const consents = { data_processing: true, publication: false, marketing: true };
const child = (o: Record<string, unknown> = {}) => ({ firstName: 'Riya', lastName: 'Sharma', classGrade: 4, schoolName: 'The Elden Heights School', city: 'Hazaribagh', state: '20', ...o });

async function parentWith(u = PARENT, kids: Record<string, unknown>[] = [child()]) {
  const h = await as(u);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
  await t.call('PUT', '/profile/details', { headers: h, body: { fullName: u.name, whatsapp: '9876543210', city: 'Hazaribagh', state: '20' } });
  let ids: string[] = [];
  for (const k of kids) ids = (await t.call('POST', '/profile/children', { headers: h, body: { ...k, consents } })).json.students.map((s: any) => s.id);
  return { h, ids };
}

async function published(overrides: Record<string, unknown> = {}) {
  const { id, h, save } = await createCompetition(t, overrides);
  const r = await t.call('POST', `/admin/competitions/${id}/publish`, { headers: h, body: save });
  expect(r.status).toBe(200);
  return { id, slug: save.competition.slug as string };
}

const register = (h: Record<string, string>, slug: string, studentId: string, answers: Record<string, unknown> = { how_heard: 'WhatsApp' }) =>
  t.call('POST', `/competitions/${slug}/register`, { headers: h, body: { studentId, answers, utm: { source: 'whatsapp', campaign: 'launch' } } });

describe('registration', () => {
  it('a parent registers a child with no student login; the server decides the window', async () => {
    const { slug } = await published();
    const { h, ids: [kid] } = await parentWith();
    t.setClock(new Date(ist('2026-11-13T23:59:59')));
    expect((await t.call('GET', '/competitions')).json.items[0]).toMatchObject({ slug, status: 'COMING_SOON' });
    expect((await register(h, slug, kid)).json.code).toBe('registration_closed');

    t.setClock(new Date(ist('2026-11-14T00:00:00')));
    t.mailer.sent.length = 0;
    const r = await register(h, slug, kid);
    expect(r.status).toBe(201);
    const mail = t.mailer.sent.find((m) => m.to === PARENT.email)!;
    expect(mail.subject).toBe('Registration confirmed: Riya is in Elden Comic Challenge 2026');
    expect(mail.html).toContain('Group A');
    expect(mail.html).toContain('?ref=');
    expect(t.mailer.sent).toHaveLength(1); // no student login, so no student email

    // Once per student.
    expect((await register(h, slug, kid)).json.code).toBe('already_registered');
    const me = await t.call('GET', `/competitions/${slug}/me`, { headers: h });
    expect(me.json.students[0]).toMatchObject({ group: { name: 'Group A' }, registration: { status: 'registered' } });
    const conf = await t.call('GET', `/my/registrations/${r.json.registrationId}`, { headers: h });
    expect(conf.json).toMatchObject({ relation: 'parent', student: { firstName: 'Riya' }, group: { name: 'Group A' }, canSubmit: true });
    expect(conf.json.referralUrl).toContain(`/competitions/${slug}?ref=`);
    t.setClock(new Date(ist('2026-12-09T00:00:01')));
    expect((await register(h, slug, kid)).json.code).toBe('registration_closed');
  });

  it('refuses classes outside every group, a full competition, and missing required answers', async () => {
    const { slug } = await published({ seatCap: 1 });
    t.setClock(new Date(ist('2026-11-20T10:00:00')));
    const { h, ids } = await parentWith(PARENT, [child(), child({ firstName: 'Kabir', classGrade: 10 }), child({ firstName: 'Anu', classGrade: 6 })]);
    const [riya, kabir, anu] = ids;
    const no = await register(h, slug, kabir);
    expect(no.json).toMatchObject({ code: 'not_eligible' });
    expect(no.json.error).toMatch(/Classes 3–8\. Kabir is in Class 10/);
    expect((await register(h, slug, riya)).status).toBe(201);
    expect((await register(h, slug, anu)).json.code).toBe('full');
  });

  it('keeps a pending student out until a parent approves', async () => {
    const { slug } = await published();
    t.setClock(new Date(ist('2026-11-20T10:00:00')));
    const sh = await as(STUDENT);
    await t.call('POST', '/profile/type', { headers: sh, body: { type: 'student' } });
    const me = (await t.call('PUT', '/profile/student', { headers: sh, body: { ...child(), parent: { name: 'Meera', whatsapp: '9876543210', email: PARENT.email } } })).json.students[0];
    const r = await register(sh, slug, me.id);
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('Ask your parent to approve you first.');
    // Approve, then the student registers themselves: the student gets the Student version, the parent the Parent version.
    const token = String(me.approval.link).split('/approve/')[1];
    const ph = await as(PARENT);
    await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'approve', consents, details: { fullName: 'Meera Sharma', whatsapp: '9876543210', city: 'Hazaribagh', state: '20' } } });
    t.mailer.sent.length = 0;
    const ok = await register(sh, slug, me.id);
    expect(ok.status).toBe(201);
    const toStudent = t.mailer.sent.find((m) => m.to === STUDENT.email)!;
    const toParent = t.mailer.sent.find((m) => m.to === PARENT.email)!;
    expect(toStudent.subject).toBe('You’re in, Riya! Elden Comic Challenge 2026 starts now');
    expect(toParent.subject).toBe('Registration confirmed: Riya is in Elden Comic Challenge 2026');
    // Never a referral link or book suggestion for the student.
    expect(toStudent.html).not.toContain('?ref=');
    expect(toStudent.html).not.toContain('Invite friends');
    const conf = await t.call('GET', `/my/registrations/${ok.json.registrationId}`, { headers: sh });
    expect(conf.json).toMatchObject({ relation: 'self', referralUrl: null, upsell: null });
  });

  it('opens registered-only resources only for registered families, and keeps families apart', async () => {
    const { id, slug } = await published();
    t.setClock(new Date(ist('2026-11-20T10:00:00')));
    const detail = await t.call('GET', `/competitions/${slug}`);
    const resource = detail.json.resources[0];
    expect(resource).toMatchObject({ title: 'Starter kit', visibility: 'registered_only' });
    expect((await t.call('POST', `/competitions/resources/${resource.id}/link`)).status).toBe(401);
    const { h, ids: [kid] } = await parentWith();
    expect((await t.call('POST', `/competitions/resources/${resource.id}/link`, { headers: h })).status).toBe(403);
    const reg = (await register(h, slug, kid)).json.registrationId;
    const link = await t.call('POST', `/competitions/resources/${resource.id}/link`, { headers: h });
    expect(link.json.url).toMatch(/^https:\/\/files\.test\/signed\/competition-files\//);

    const { h: other } = await parentWith(OTHER, [child({ firstName: 'Arjun', lastName: 'Rao' })]);
    expect((await t.call('GET', `/my/registrations/${reg}`, { headers: other })).status).toBe(404);
    expect((await t.call('GET', '/my/competitions', { headers: other })).json.items).toEqual([]);
    expect((await t.call('GET', '/my/competitions', { headers: h })).json.items).toHaveLength(1);
    // Public pages carry no names, schools or contact details.
    const pub = JSON.stringify([(await t.call('GET', '/competitions')).json, (await t.call('GET', `/competitions/${slug}`)).json]);
    for (const secret of ['Sharma', 'Elden Heights', 'meera@', '9876543210']) expect(pub).not.toContain(secret);
    expect(id).toBeTruthy();
  });

  it('shows drafts only with the admin’s preview link', async () => {
    const { id, h, save } = await createCompetition(t);
    await t.call('PUT', `/admin/competitions/${id}`, { headers: h, body: save });
    expect((await t.call('GET', `/competitions/${save.competition.slug}`)).status).toBe(404);
    const link = (await t.call('POST', `/admin/competitions/${id}/preview`, { headers: h, body: { as: 'student' } })).json.url as string;
    const token = new URL(link, 'https://x').searchParams.get('preview');
    const r = await t.call('GET', `/competitions/${save.competition.slug}?preview=${token}`);
    expect(r.json).toMatchObject({ preview: true, status: 'DRAFT' });
  });
});
