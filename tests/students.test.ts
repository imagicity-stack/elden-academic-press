import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, consentRecords, studentProfiles, subscribers } from '../server/db/schema.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const PARENT = { sub: 'a1111111-1111-4111-8111-111111111111', email: 'meera@example.com', name: 'Meera Sharma' };
const STUDENT = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'riya.s@example.com', name: 'Riya Sharma' };
const OTHER = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'arjun.dad@example.com', name: 'Vikram Rao' };
const STUDENT2 = { sub: 'd4444444-4444-4444-8444-444444444444', email: 'kid2@example.com', name: 'Kabir Rao' };
const as = async (u: { sub: string; email: string; name: string }) => ({ Authorization: `Bearer ${await supabaseToken({ ...u, provider: 'google' })}` });

const child = { firstName: 'Riya', lastName: 'Sharma', classGrade: 7, schoolName: 'The Elden Heights School', city: 'Hazaribagh', state: '20' };
const parentDetails = { fullName: 'Meera Sharma', whatsapp: '9876543210', city: 'Hazaribagh', state: '20' };
const consents = { data_processing: true, publication: true, marketing: false };

async function becomeParent(u = PARENT) {
  const h = await as(u);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
  const r = await t.call('PUT', '/profile/details', { headers: h, body: parentDetails });
  expect(r.status).toBe(200);
  return h;
}

async function studentSignsUp() {
  const h = await as(STUDENT);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'student' } });
  const r = await t.call('PUT', '/profile/student', { headers: h, body: { ...child, parent: { name: 'Meera Sharma', whatsapp: '9876543210', email: PARENT.email } } });
  expect(r.status).toBe(200);
  const me = r.json.students[0];
  return { h, me, token: String(me.approval.link).split('/approve/')[1] };
}

describe('profiles', () => {
  it('lets a parent add a child with consents (no student login needed), and keeps shopping separate', async () => {
    const h = await as(PARENT);
    expect((await t.call('GET', '/profile', { headers: h })).json.account).toMatchObject({ type: null, completed: false });
    // Adding a child needs the parent's details first.
    await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
    expect((await t.call('POST', '/profile/children', { headers: h, body: { ...child, consents } })).status).toBe(409);
    await becomeParent();
    expect((await t.call('POST', '/profile/children', { headers: h, body: { ...child, consents: { ...consents, data_processing: false } } })).status).toBe(400);
    const r = await t.call('POST', '/profile/children', { headers: h, body: { ...child, consents } });
    expect(r.status).toBe(201);
    expect(r.json.account).toMatchObject({ type: 'parent', completed: true, locked: true });
    expect(r.json.students).toEqual([expect.objectContaining({ firstName: 'Riya', approvalStatus: 'approved', relation: 'parent', hasLogin: false, consents })]);
    // Locked once linked: the type can't flip to student.
    expect((await t.call('POST', '/profile/type', { headers: h, body: { type: 'student' } })).status).toBe(409);
    // Consents change by appending, never editing.
    const id = r.json.students[0].id;
    await t.call('POST', `/profile/children/${id}/consents`, { headers: h, body: { publication: false, marketing: true } });
    expect((await t.db.select().from(consentRecords).where(eq(consentRecords.studentProfileId, id))).length).toBe(5);
    expect((await t.call('GET', '/profile', { headers: h })).json.students[0].consents).toEqual({ data_processing: true, publication: false, marketing: true });
  });

  it('keeps families apart', async () => {
    const h1 = await becomeParent();
    const id = (await t.call('POST', '/profile/children', { headers: h1, body: { ...child, consents } })).json.students[0].id;
    const h2 = await becomeParent(OTHER);
    expect((await t.call('GET', '/profile', { headers: h2 })).json.students).toEqual([]);
    expect((await t.call('PUT', `/profile/children/${id}`, { headers: h2, body: { classGrade: 8 } })).status).toBe(404);
    expect((await t.call('POST', `/profile/children/${id}/invite`, { headers: h2 })).status).toBe(404);
    expect((await t.call('DELETE', `/profile/children/${id}`, { headers: h2 })).status).toBe(404);
  });
});

describe('a student signing up asks a parent to approve', () => {
  it('waits for approval, emails the parent, and refuses self-approval', async () => {
    const { h, me, token } = await studentSignsUp();
    expect(me).toMatchObject({ approvalStatus: 'pending', relation: 'self', approval: { status: 'pending', parentEmail: PARENT.email } });
    const mail = t.mailer.sent.find((m) => m.to === PARENT.email)!;
    expect(mail.subject).toBe('Please approve Riya for Elden competitions');
    expect(mail.html).toContain(`/approve/${token}`);

    // The page shows first name, class and school only.
    const page = await t.call('GET', `/approvals/${token}`);
    expect(page.json).toMatchObject({ status: 'pending', student: { firstName: 'Riya', classGrade: 7, schoolName: 'The Elden Heights School' } });
    expect(JSON.stringify(page.json)).not.toContain('Sharma');

    // The student's own account, and any other student account, can't approve.
    const self = await t.call('POST', `/approvals/${token}`, { headers: h, body: { decision: 'approve', details: parentDetails, consents } });
    expect(self.status).toBe(403);
    expect(self.json.error).toBe('This must be approved from a parent’s Google account.');
    const h2 = await as(STUDENT2);
    await t.call('POST', '/profile/type', { headers: h2, body: { type: 'student' } });
    expect((await t.call('POST', `/approvals/${token}`, { headers: h2, body: { decision: 'approve', details: parentDetails, consents } })).status).toBe(403);
    expect((await t.call('GET', `/approvals/${token}`, { headers: h2 })).json.viewer.blocked).toMatch(/parent’s Google account/);
  });

  it('a parent with a new account approves once: details, consents, then the student can take part', async () => {
    const { h, token } = await studentSignsUp();
    const ph = await as(PARENT);
    expect((await t.call('GET', `/approvals/${token}`, { headers: ph })).json.viewer).toMatchObject({ type: null, needsDetails: true, blocked: null });
    expect((await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'approve', consents } })).status).toBe(400); // details needed
    t.mailer.sent.length = 0;
    const ok = await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'approve', details: parentDetails, consents } });
    expect(ok.json.status).toBe('approved');
    expect(t.mailer.sent.find((m) => m.to === STUDENT.email)!.subject).toBe('Your parent approved you: you can take part now');
    const [pa] = await t.db.select().from(accounts).where(eq(accounts.userId, PARENT.sub));
    expect(pa).toMatchObject({ accountType: 'parent', fullName: 'Meera Sharma', whatsapp: '9876543210' });
    expect((await t.call('GET', '/profile', { headers: h })).json.students[0]).toMatchObject({ approvalStatus: 'approved', relation: 'self' });
    expect((await t.call('GET', '/profile', { headers: ph })).json.students[0]).toMatchObject({ firstName: 'Riya', relation: 'parent', hasLogin: true });
    // Single use.
    expect((await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'approve', consents } })).status).toBe(410);
  });

  it('expires links after 7 days, deletes the request after 14, and merges with a child the parent already added', async () => {
    const { token } = await studentSignsUp();
    t.setClock(new Date(Date.now() + 8 * 86400_000));
    expect((await t.call('GET', `/approvals/${token}`)).json.status).toBe('expired');
    const ph = await becomeParent();
    expect((await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'approve', consents } })).status).toBe(410);
    t.setClock(new Date(Date.now() + 15 * 86400_000));
    const purge = await t.call('GET', '/cron/competitions', { headers: { authorization: 'Bearer cron-secret' } });
    expect(purge.json.purged).toBe(1);
    expect(await t.db.select().from(studentProfiles)).toEqual([]);
    expect(t.mailer.sent.some((m) => m.to === STUDENT.email && m.subject === 'Your approval request ran out')).toBe(true);
    t.setClock(null);

    // Start again; the parent already added Riya herself: merge instead of a duplicate.
    await t.call('POST', '/profile/children', { headers: ph, body: { ...child, consents } });
    const again = await studentSignsUp();
    const view = await t.call('GET', `/approvals/${again.token}`, { headers: ph });
    expect(view.json.viewer.mergeCandidates).toHaveLength(1);
    const merged = await t.call('POST', `/approvals/${again.token}`, { headers: ph, body: { decision: 'approve', consents, mergeInto: view.json.viewer.mergeCandidates[0].id } });
    expect(merged.json.studentId).toBe(view.json.viewer.mergeCandidates[0].id);
    expect((await t.db.select().from(studentProfiles)).length).toBe(1);
    expect((await t.call('GET', '/profile', { headers: again.h })).json.students[0]).toMatchObject({ approvalStatus: 'approved', relation: 'self' });
  });

  it('a decline removes the pending details', async () => {
    const { h, token } = await studentSignsUp();
    const ph = await becomeParent();
    expect((await t.call('POST', `/approvals/${token}`, { headers: ph, body: { decision: 'decline' } })).json.status).toBe('declined');
    expect(await t.db.select().from(studentProfiles)).toEqual([]);
    expect((await t.call('GET', '/profile', { headers: h })).json).toMatchObject({ account: { type: 'student', completed: false }, students: [] });
  });
});

describe('a parent gives their child their own login', () => {
  it('links the child’s Google account to the profile, but never the parent’s', async () => {
    const ph = await becomeParent();
    const id = (await t.call('POST', '/profile/children', { headers: ph, body: { ...child, consents } })).json.students[0].id;
    const inv = await t.call('POST', `/profile/children/${id}/invite`, { headers: ph });
    expect(inv.status).toBe(201);
    const token = String(inv.json.inviteUrl).split('/invite/')[1];
    expect(t.mailer.sent.some((m) => m.to === PARENT.email && m.html.includes(`/invite/${token}`))).toBe(true);
    expect((await t.call('GET', `/invites/${token}`)).json).toEqual({ status: 'open', firstName: 'Riya' });
    expect((await t.call('POST', `/invites/${token}/claim`, { headers: ph })).status).toBe(403);
    const sh = await as(STUDENT);
    const claimed = await t.call('POST', `/invites/${token}/claim`, { headers: sh });
    expect(claimed.json.status).toBe('claimed');
    expect((await t.call('GET', '/profile', { headers: sh })).json).toMatchObject({ account: { type: 'student', locked: true }, students: [{ id, relation: 'self', approvalStatus: 'approved' }] });
    expect((await t.call('POST', `/invites/${token}/claim`, { headers: await as(STUDENT2) })).status).toBe(410);
    // An approved student may change class and school only.
    expect((await t.call('PUT', `/profile/children/${id}`, { headers: sh, body: { classGrade: 8, schoolName: 'DAV Public School' } })).status).toBe(200);
    expect((await t.call('PUT', `/profile/children/${id}`, { headers: sh, body: { lastName: 'Verma' } })).status).toBe(403);
    expect((await t.call('POST', `/profile/children/${id}/consents`, { headers: sh, body: { publication: false, marketing: false } })).status).toBe(403);
  });

  it('a parent deletes a child: details wiped, guardian link removed', async () => {
    const ph = await becomeParent();
    const id = (await t.call('POST', '/profile/children', { headers: ph, body: { ...child, consents } })).json.students[0].id;
    expect((await t.call('DELETE', `/profile/children/${id}`, { headers: ph })).json.students).toEqual([]);
    const [p] = await t.db.select().from(studentProfiles).where(eq(studentProfiles.id, id));
    expect(p).toMatchObject({ firstName: 'Deleted', lastName: '', schoolName: '', city: '' });
    expect(p.deletedAt).not.toBeNull();
  });
});

describe('newsletter on sign-up', () => {
  it('subscribes every account when it signs in, with no confirmation step, unless they unsubscribed', async () => {
    const h = await as(PARENT);
    await t.call('GET', '/account', { headers: h });
    expect((await t.db.select().from(subscribers).where(eq(subscribers.email, PARENT.email)))[0]).toMatchObject({ status: 'subscribed', source: 'signup' });
    await t.call('PUT', '/account/newsletter', { headers: h, body: { subscribed: false } });
    await t.call('GET', '/account', { headers: h });
    expect((await t.db.select().from(subscribers).where(eq(subscribers.email, PARENT.email)))[0].status).toBe('unsubscribed');
  });
});
