import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog, competitionResources, resourceDownloads } from '../server/db/schema.js';
import { setup, supabaseToken } from './helpers.js';
import { createCompetition, geotaggedJpeg, ist } from './competitionHelpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const PARENT = { sub: 'a1111111-1111-4111-8111-111111111111', email: 'meera@example.com', name: 'Meera Sharma' };
const MANAGER = { sub: '22222222-2222-4222-8222-222222222222', email: 'manager@eldenap.in' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });
const kidBody = (firstName: string, classGrade: number, schoolName: string, marketing = false) =>
  ({ firstName, lastName: 'Sharma', classGrade, schoolName, city: 'Hazaribagh', state: '20', consents: { data_processing: true, publication: firstName === 'Riya', marketing } });

/** Two children: Riya (class 4, group A) submits; Arjun (class 7, group B) only registers. */
async function world() {
  const { id, h: admin, save } = await createCompetition(t, { maxMainFiles: 2 });
  await t.call('POST', `/admin/competitions/${id}/publish`, { headers: admin, body: save });
  const slug = save.competition.slug as string;
  const h = await as(PARENT);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
  await t.call('PUT', '/profile/details', { headers: h, body: { fullName: 'Meera Sharma', whatsapp: '9876543210', city: 'Hazaribagh', state: '20' } });
  await t.call('POST', '/profile/children', { headers: h, body: kidBody('Riya', 4, 'Elden High School') });
  const kids = (await t.call('POST', '/profile/children', { headers: h, body: kidBody('Arjun', 7, 'DAV Public School') })).json.students;
  const riya = kids.find((k: any) => k.firstName === 'Riya').id;
  const arjun = kids.find((k: any) => k.firstName === 'Arjun').id;
  t.setClock(new Date(ist('2026-11-20T10:00:00')));
  const regA = (await t.call('POST', `/competitions/${slug}/register`, { headers: h, body: { studentId: riya, answers: { how_heard: 'WhatsApp' }, utm: { source: 'whatsapp', campaign: 'launch' } } })).json.registrationId;
  const rb = await t.call('POST', `/competitions/${slug}/register`, { headers: h, body: { studentId: arjun, answers: { how_heard: 'School or teacher' } } });
  expect(rb.status).toBe(201);
  const regB = rb.json.registrationId;
  const sub = (await t.call('POST', `/my/entries/${regA}/draft`, { headers: h, body: {} })).json.submission;
  const up = await t.call('POST', `/my/submissions/${sub.id}/files`, { headers: h, body: { kind: 'main', fileName: 'drawing.jpg', contentType: 'image/jpeg', size: 200 } });
  await t.deps.storage.write('competition-entries', up.json.upload.path, geotaggedJpeg());
  await t.call('POST', `/my/submissions/${sub.id}/files/${up.json.fileId}/verify`, { headers: h });
  await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { title: 'Didi the postwoman' } });
  expect((await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } })).status).toBe(200);
  return { id, admin, h, slug, regA, regB, sub };
}

describe('entries manager', () => {
  it('lists registrations with entry status, filters and searches', async () => {
    const { id, admin, regA, sub } = await world();
    const all = (await t.call('GET', `/admin/competitions/${id}/entries`, { headers: admin })).json;
    expect(all.total).toBe(2);
    const riya = all.items.find((x: any) => x.id === regA);
    expect(riya).toMatchObject({
      state: 'submitted', registeredByType: 'parent', publication: true, howHeard: 'WhatsApp', utmSource: 'whatsapp',
      student: { firstName: 'Riya', lastName: 'Sharma', classGrade: 4, school: 'Elden High School', state: 'Jharkhand' }, group: { letter: 'A' },
    });
    expect(riya.submissions[0]).toMatchObject({ entryCode: sub.entryCode, status: 'submitted', files: 1, flags: [], hidden: false });
    expect(all.items.find((x: any) => x.id !== regA)).toMatchObject({ state: 'no_entry', publication: false, group: { letter: 'B' } });
    expect(all.options.howHeard).toEqual(['School or teacher', 'WhatsApp']);
    expect(all.options.utmSource).toEqual(['(none)', 'whatsapp']);

    const q = async (qs: string) => (await t.call('GET', `/admin/competitions/${id}/entries?${qs}`, { headers: admin })).json.items.map((x: any) => x.student.firstName);
    expect(await q('status=submitted')).toEqual(['Riya']);
    expect(await q('status=no_entry')).toEqual(['Arjun']);
    expect(await q('group=B')).toEqual(['Arjun']);
    expect(await q('school=dav')).toEqual(['Arjun']);
    expect(await q('howHeard=School%20or%20teacher')).toEqual(['Arjun']);
    expect(await q('utmSource=(none)')).toEqual(['Arjun']);
    expect(await q('registeredByType=student')).toEqual([]);
    expect(await q(`q=${encodeURIComponent(sub.entryCode.toLowerCase())}`)).toEqual(['Riya']);
    expect(await q('q=riya%20sharma')).toEqual(['Riya']);
    expect((await q('q=98765')).sort()).toEqual(['Arjun', 'Riya']); // parent's WhatsApp
    expect(await q('q=%25')).toEqual([]); // a literal %, not "everything"
  });

  it('shows one registration in full with private previews and logs the view', async () => {
    const { id, admin, regA } = await world();
    const d = (await t.call('GET', `/admin/competitions/${id}/entries/${regA}`, { headers: admin })).json;
    expect(d.student).toMatchObject({ firstName: 'Riya', lastName: 'Sharma', school: 'Elden High School', ownLogin: false });
    expect(d.contacts.parents).toEqual([{ name: 'Meera Sharma', email: PARENT.email, whatsapp: '9876543210' }]);
    expect(d.answers).toEqual([{ key: 'how_heard', label: 'How did you hear about us?', value: 'WhatsApp' }]);
    expect(d.source).toMatchObject({ howHeard: 'WhatsApp', utmSource: 'whatsapp', utmCampaign: 'launch' });
    expect(d.consents.map((c: any) => [c.type, c.granted])).toEqual([['data_processing', true], ['publication', true], ['marketing', false]]);
    const file = d.submissions[0].files[0];
    expect(file).toMatchObject({ kind: 'main', mimeType: 'image/jpeg', verified: true, width: 200, height: 100 });
    expect(file.url).toMatch(/^https:\/\/files\.test\/signed\/competition-entries\/.+expires=600$/);
    expect(d.submissions[0].title).toBe('Didi the postwoman');
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, 'entry.view'))).length).toBe(1);
  });

  it('flags, notes, hides, disqualifies with a reason and reinstates, all audit-logged', async () => {
    const { id, admin, h, regA, sub } = await world();
    const set = (b: object) => t.call('POST', `/admin/competitions/${id}/entries/submissions/${sub.id}`, { headers: admin, body: b });
    expect((await set({ flags: ['suspected_ai', 'suspected_ai'] })).json).toEqual({ flags: ['suspected_ai'], notes: '', hidden: false });
    expect((await set({ flags: ['made_up'] })).status).toBe(400);
    expect((await set({ notes: '  Looks traced from a book.  ' })).json.notes).toBe('Looks traced from a book.');
    expect((await set({ hidden: true })).json.hidden).toBe(true);
    const q = async (s: string) => (await t.call('GET', `/admin/competitions/${id}/entries?status=${s}`, { headers: admin })).json.total;
    expect(await q('flagged')).toBe(1);
    expect(await q('hidden')).toBe(1);

    expect((await t.call('POST', `/admin/competitions/${id}/entries/${regA}/disqualify`, { headers: admin, body: { reason: 'no' } })).status).toBe(400);
    expect((await t.call('POST', `/admin/competitions/${id}/entries/${regA}/disqualify`, { headers: admin, body: { reason: 'Copied from a published comic.' } })).status).toBe(200);
    expect(await q('disqualified')).toBe(1);
    expect(await q('submitted')).toBe(0);
    // The family can't change a disqualified entry.
    expect((await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { title: 'New' } })).status).toBe(409);
    const d = (await t.call('GET', `/admin/competitions/${id}/entries/${regA}`, { headers: admin })).json;
    expect(d).toMatchObject({ status: 'disqualified', disqualifyReason: 'Copied from a published comic.' });
    expect(d.submissions[0].status).toBe('disqualified');

    expect((await t.call('POST', `/admin/competitions/${id}/entries/${regA}/reinstate`, { headers: admin })).status).toBe(200);
    expect(await q('submitted')).toBe(1);
    const actions = (await t.db.select().from(auditLog)).map((a) => a.action);
    for (const a of ['entry.flag', 'entry.note', 'entry.hide', 'entry.disqualify', 'entry.reinstate']) expect(actions).toContain(a);
  });

  it('exports CSV with or without contact details (audit-logged), safe for spreadsheets', async () => {
    const { id, admin, sub } = await world();
    await t.call('POST', `/admin/competitions/${id}/entries/submissions/${sub.id}`, { headers: admin, body: { notes: '=HYPERLINK("http://x")' } });
    const plain = await t.call('GET', `/admin/competitions/${id}/entries/export.csv`, { headers: admin });
    expect(plain.status).toBe(200);
    expect(plain.headers.get('content-type')).toContain('text/csv');
    const text = plain.text;
    const [head, ...rows] = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(head).toContain('Entry code');
    expect(head).toContain('How did you hear about us?');
    expect(head).not.toContain('Parent email');
    expect(text).not.toContain(PARENT.email);
    expect(text).not.toContain('9876543210');
    expect(rows).toHaveLength(2);
    expect(text).toContain(`${sub.entryCode}`);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);

    const full = await t.call('GET', `/admin/competitions/${id}/entries/export.csv?contacts=1&group=A`, { headers: admin });
    expect(full.text).toContain('Parent WhatsApp');
    expect(full.text).toContain(PARENT.email);
    expect(full.text.trim().split('\r\n')).toHaveLength(2);
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.action, 'competition.export'));
    expect(logs.map((l) => (l.details as any).contacts)).toEqual([false, true]);
  });

  it('counts registrations, entries, rate, splits, downloads and pending approvals', async () => {
    const { id, admin, regA } = await world();
    const [res] = await t.db.select().from(competitionResources).where(eq(competitionResources.competitionId, id));
    await t.db.insert(resourceDownloads).values([{ resourceId: res.id, registrationId: regA, userId: PARENT.sub }, { resourceId: res.id, registrationId: regA, userId: PARENT.sub }]);
    const s = (await t.call('GET', `/admin/competitions/${id}/stats`, { headers: admin })).json;
    expect(s).toMatchObject({ registrations: 2, submissions: 1, rate: 50, drafts: 0, withdrawn: 0, disqualified: 0, referred: 0, pendingApprovals: 0 });
    expect(s.byGroup.map((g: any) => [g.label, g.registrations, g.submissions])).toEqual([['Group A', 1, 1], ['Group B', 1, 0]]);
    expect(s.byRegisteredBy).toEqual([{ label: 'Parent', registrations: 2, submissions: 1, rate: 50 }]);
    expect(s.byHowHeard.map((x: any) => x.label).sort()).toEqual(['School or teacher', 'WhatsApp']);
    expect(s.byUtmSource.map((x: any) => x.label).sort()).toEqual(['(none)', 'whatsapp']);
    expect(s.downloads).toMatchObject({ total: 2, items: [{ title: 'Starter kit', total: 2, people: 1 }] });
  });

  it('is for the store owner only', async () => {
    const { id } = await world();
    await t.db.insert(adminUsers).values({ userId: MANAGER.sub, email: MANAGER.email, role: 'manager' });
    const m = await as(MANAGER);
    expect((await t.call('GET', `/admin/competitions/${id}/entries`, { headers: m })).status).toBe(403);
    expect((await t.call('GET', `/admin/competitions/${id}/entries/export.csv`, { headers: m })).status).toBe(403);
    expect((await t.call('GET', `/admin/competitions/${id}/stats`, { headers: m })).status).toBe(403);
  });
});
