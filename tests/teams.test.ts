import { beforeEach, describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog, teamMembers } from '../server/db/schema.js';
import { pdfPageCount } from '../server/lib/fileCheck.js';
import { findCompetition } from '../src/shared/competitions.js';
import { ageOn, checkTeam, emptyMember, type MemberInput, type TeamInput } from '../src/shared/teams.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); t.setClock(new Date('2026-11-10T10:00:00+05:30')); });

const SLUG = 'doomsday-diaries';
const cfg = findCompetition(SLUG)!.team!;
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const TEACHER = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'asha@school.in', name: 'Asha Verma' };
const STUDENT = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'riya.s@example.com', name: 'Riya Sharma' };
const OTHER = { sub: 'd4444444-4444-4444-8444-444444444444', email: 'someone@example.com', name: 'Someone' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });

const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const enc = (s: string) => [...new TextEncoder().encode(s)];
/** A phone photo of an ID card with a GPS location in its EXIF. */
const idPhoto = () => Uint8Array.from([0xff, 0xd8, ...seg(0xe1, [...enc('Exif\0\0'), ...enc('GPSLatitude 23.99 N')]), ...seg(0xc0, [8, 0, 10, 0, 20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), 1, 2, 3, 0xff, 0xd9]);
const pdf = (pages: number) => new TextEncoder().encode(`%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count ${pages} >> endobj\n4 0 obj << /Type /Outlines /First 5 0 R /Last 5 0 R /Count 99 >> endobj\n%%EOF`);

async function signedIn(u: typeof TEACHER, profile: Record<string, unknown> = { type: 'teacher', institutionType: 'school', institutionName: 'DAV Public School' }) {
  const h = await as(u);
  expect((await t.call('GET', '/account', { headers: h })).status).toBe(200);
  const p = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: u.name, city: 'Ranchi', state: '20', ...profile } });
  expect(p.status).toBe(200);
  return h;
}

async function uploadId(h: Record<string, string>) {
  const r = await t.call('POST', `/competitions/${SLUG}/team/id-upload`, { headers: h, body: { contentType: 'image/jpeg', size: 500 } });
  expect(r.status).toBe(201);
  await t.deps.storage.write('competition-entries', r.json.key, idPhoto());
  return r.json.key as string;
}

const member = (o: Partial<MemberInput>): MemberInput => ({ ...emptyMember(), idDocType: 'school_id', guardianName: 'Meera Sharma', guardianRelation: 'Mother', guardianPhone: '9123456780', guardianConsent: true, ...o });
async function team(h: Record<string, string>, o: Partial<TeamInput> = {}, members?: Partial<MemberInput>[]): Promise<TeamInput> {
  const list = members ?? [
    { fullName: 'Riya Sharma', dob: '2013-05-04', roles: ['writer'], instagram: 'riya.draws', email: STUDENT.email },
    { fullName: 'Aman Gupta', dob: '2012-12-01', roles: ['artist', 'colourist'], instagram: 'aman_g' },
  ];
  return {
    teamName: 'The Ink Avengers', institutionType: 'school', institutionName: 'DAV Public School', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
    members: await Promise.all(list.map(async (m) => member({ idDocKey: await uploadId(h), ...m }))), ...o,
  };
}
const register = (h: Record<string, string>, body: TeamInput) => t.call('POST', `/competitions/${SLUG}/team`, { headers: h, body });

describe('team rules', () => {
  const base = (members: Partial<MemberInput>[], o: Partial<TeamInput> = {}): TeamInput => ({
    teamName: 'Team', institutionType: 'school', institutionName: 'DAV', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
    members: members.map((m) => member({ idDocKey: 'k', instagram: 'x', ...m })), ...o,
  });
  it('sets the age group from the oldest member, on 6 November 2026', () => {
    expect(ageOn('2014-11-06', '2026-11-06')).toBe(12);
    expect(ageOn('2014-11-07', '2026-11-06')).toBe(11);
    expect(ageOn('2014-02-30', '2026-11-06')).toBeNull();
    const r = checkTeam(cfg, base([{ fullName: 'A', dob: '2016-01-01', roles: ['writer'] }, { fullName: 'Bo', dob: '2014-11-06', roles: ['artist'] }]));
    expect(r.errors).toEqual(['Team captain: add their full name.']);
    expect(r.group?.label).toBe('Rising Heroes');
  });
  it('refuses mixed under-18 and adult teams, solo entries, missing roles and ages out of range', () => {
    const e = (m: Partial<MemberInput>[], o?: Partial<TeamInput>) => checkTeam(cfg, base(m, o)).errors;
    expect(e([{ fullName: 'Ann', dob: '2009-01-01', roles: ['writer'] }, { fullName: 'Ben', dob: '2008-01-01', roles: ['artist'], email: 'b@x.in' }]))
      .toContain('Members under 18 and members aged 18 or above can’t be on the same team.');
    expect(e([{ fullName: 'Ann', dob: '2012-01-01', roles: ['writer', 'artist'] }])).toContain('A team has 2 to 4 members.');
    expect(e([{ fullName: 'Ann', dob: '2012-01-01', roles: ['writer'] }, { fullName: 'Ben', dob: '2012-01-01', roles: ['letterer'] }])).toContain('Every team needs a Artist.');
    expect(e([{ fullName: 'Ann', dob: '2019-01-01', roles: ['writer'] }, { fullName: 'Ben', dob: '2012-01-01', roles: ['artist'] }])[0]).toMatch(/Team captain must be 8 to 24 years old on 6 November 2026 \(they’ll be 7\)/);
    expect(e([{ fullName: 'Ann', dob: '2012-01-01', roles: ['writer'], guardianConsent: false }, { fullName: 'Ben', dob: '2012-01-01', roles: ['artist'] }])).toContain('Team captain: confirm the parent or guardian agrees.');
    expect(e([{ fullName: 'Ann', dob: '2012-01-01', roles: ['writer'], instagram: '' }, { fullName: 'Ben', dob: '2016-01-01', roles: ['artist'], instagram: '' }]))
      .toEqual(['Team captain: add their Instagram username (needed from age 13).']);
    expect(e([{ fullName: 'Ann', dob: '2004-01-01', roles: ['writer'] }, { fullName: 'Ben', dob: '2005-01-01', roles: ['artist'], email: 'b@x.in' }]))
      .toEqual(['Team captain: add an email address or phone number.']);
    // "Other" institutions: members name their own (they may differ).
    expect(e([{ fullName: 'Ann', dob: '2012-01-01', roles: ['writer'] }, { fullName: 'Ben', dob: '2012-01-01', roles: ['artist'], institutionName: 'Art Club' }], { institutionType: 'other', institutionName: '' }))
      .toEqual(['Team captain: add their school, college or institution.']);
  });
  it('counts PDF pages, including a page tree hidden in a compressed object stream, and ignores outline counts', () => {
    expect(pdfPageCount(pdf(42))).toBe(42);
    const inner = deflateSync(Buffer.from('2 0 << /Type /Pages /Kids [3 0 R 4 0 R] /Count 47 >>'));
    const packed = Buffer.concat([Buffer.from('%PDF-1.5\n5 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode >>\nstream\n'), inner, Buffer.from('\nendstream\nendobj\n%%EOF')]);
    expect(pdfPageCount(packed)).toBe(47);
    expect(pdfPageCount(new TextEncoder().encode('%PDF-1.4 nothing here'))).toBeNull();
  });
});

describe('profile by role', () => {
  it('asks students for date of birth, class, institution and (under 18) a parent; teachers for their institution', async () => {
    const h = await as(STUDENT);
    await t.call('GET', '/account', { headers: h });
    const p1 = await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: 'Riya Sharma', city: 'Ranchi', state: '20', type: 'student' } });
    expect(p1.json.missing).toEqual(['dob', 'institutionType', 'institutionName', 'grade']);
    const p2 = await t.call('PUT', '/account/profile', { headers: h, body: { dob: '2012-05-04', institutionType: 'school', institutionName: 'DAV', grade: 'Class 8' } });
    expect(p2.json.missing).toEqual(['guardianName', 'guardianPhone']);
    const p3 = await t.call('PUT', '/account/profile', { headers: h, body: { guardianName: 'Meera Sharma', guardianPhone: '9123456780', instagram: '@riya.draws' } });
    expect(p3.json).toMatchObject({ completed: true, missing: [], instagram: 'riya.draws' });
    const teacher = await as(TEACHER);
    await t.call('GET', '/account', { headers: teacher });
    expect((await t.call('PUT', '/account/profile', { headers: teacher, body: { phone: '9876543211', fullName: 'Asha', city: 'Ranchi', state: '20', type: 'teacher' } })).json.missing).toEqual(['institutionType', 'institutionName']);
  });
});

describe('DoomsDay Diaries registration', () => {
  it('needs a completed profile (skipping it never blocks the account, only registration)', async () => {
    const h = await as(TEACHER);
    await t.call('GET', '/account', { headers: h });
    const r = await register(h, await team(h));
    expect(r.json.code).toBe('profile_incomplete');
    expect((await t.call('GET', '/account', { headers: h })).status).toBe(200);
  });

  it('registers a team as Pending verification with an application ID, strips ID photo metadata and emails the registrant', async () => {
    const h = await signedIn(TEACHER);
    t.mailer.sent.length = 0;
    const body = await team(h);
    const r = await register(h, body);
    expect(r.status).toBe(201);
    expect(r.json.application).toMatchObject({ code: 'DD-0001', status: 'pending', statusText: 'Pending verification', categoryLabel: 'Rising Heroes', canUpload: false, canEdit: true });
    const stored = await t.deps.storage.read('competition-entries', body.members[0].idDocKey);
    expect(new TextDecoder().decode(stored)).not.toContain('GPSLatitude');
    const mail = t.mailer.sent.find((m) => m.to === TEACHER.email)!;
    expect(mail.subject).toBe('Application received: The Ink Avengers (DD-0001)');
    expect(t.mailer.sent.find((m) => m.to === STUDENT.email)).toBeTruthy(); // the captain too
    // The captain (a member with their own account) sees the team, without other members' contacts.
    const student = await as(STUDENT);
    const seen = (await t.call('GET', `/competitions/${SLUG}/team`, { headers: student })).json.applications[0];
    expect(seen).toMatchObject({ teamName: 'The Ink Avengers', own: false });
    expect(seen.members[1].guardianPhone).toBeUndefined();
    // Somebody else sees nothing.
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: await as(OTHER) })).json.applications).toEqual([]);
    expect((await t.call('GET', '/account', { headers: h })).json.teams).toMatchObject([{ teamName: 'The Ink Avengers', status: 'pending', code: 'DD-0001' }]);
  });

  it('refuses an ID upload that isn’t the registrant’s own, and the same person on two teams', async () => {
    const h = await signedIn(TEACHER);
    const body = await team(h);
    const other = await signedIn(OTHER, { type: 'parent' });
    const stolen = { ...(await team(other)), members: body.members };
    expect((await register(other, stolen)).json.code).toBe('bad_id');
    expect((await register(h, body)).status).toBe(201);
    const again = await team(h, { teamName: 'Second Team' });
    const dup = await register(h, again);
    expect(dup.status).toBe(409);
    expect(dup.json.error).toBe('Riya Sharma is already on another team. A person can be on only one team.');
  });

  it('closes registration on time and when paused by the admin', async () => {
    const h = await signedIn(TEACHER);
    const body = await team(h);
    t.setClock(new Date('2026-12-06T00:00:00+05:30'));
    expect((await register(h, body)).json.error).toBe('Registration has closed.');
    t.setClock(new Date('2026-11-10T10:00:00+05:30'));
    const admin = await as(OWNER);
    expect((await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: admin, body: { registrationPaused: true } })).status).toBe(200);
    expect((await register(h, body)).json.code).toBe('closed');
  });

  it('runs review, changes, approval, uploads with page checks and replacement, and the deadline', async () => {
    const h = await signedIn(TEACHER);
    const app = (await register(h, await team(h))).json.application;
    const admin = await as(OWNER);
    // Not approved yet: no uploads, and the story brief stays secret.
    expect((await t.call('POST', `/competitions/${SLUG}/team/${app.id}/uploads`, { headers: h, body: { kind: 'comic', contentType: 'application/pdf', size: 1000 } })).json.code).toBe('not_approved');
    const before = await t.call('GET', `/competitions/${SLUG}/team`, { headers: h });
    expect(before.json.brief).toBeNull();
    expect(before.text).not.toMatch(/Wrong Town/i);
    // Changes requested → the team edits → back to pending.
    t.mailer.sent.length = 0;
    expect((await t.call('POST', `/admin/competitions/${SLUG}/teams/${app.id}/review`, { headers: admin, body: { action: 'changes', message: 'Please upload a clearer ID for Aman.' } })).status).toBe(200);
    expect(t.mailer.sent.find((m) => m.to === TEACHER.email)?.subject).toBe('Changes needed: The Ink Avengers (DD-0001)');
    const mine = (await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.applications[0];
    expect(mine).toMatchObject({ status: 'changes_requested', reviewNote: 'Please upload a clearer ID for Aman.', canEdit: true });
    const edit = { teamName: mine.teamName, institutionType: 'school', institutionName: 'DAV Public School', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
      members: mine.members.map((m: any, i: number) => member({ ...m, guardianConsent: true, ...(i === 1 ? { idDocKey: '' } : {}) })) };
    edit.members[1].idDocKey = await uploadId(h);
    const oldKey = mine.members[1].idDocKey;
    expect((await t.call('PUT', `/competitions/${SLUG}/team/${app.id}`, { headers: h, body: edit })).json.application.status).toBe('pending');
    await expect(t.deps.storage.read('competition-entries', oldKey)).resolves.toBeTruthy(); // memory storage keeps it; the real one deletes it
    // Approve → uploads open.
    t.mailer.sent.length = 0;
    await t.call('POST', `/admin/competitions/${SLUG}/teams/${app.id}/review`, { headers: admin, body: { action: 'approve' } });
    expect(t.mailer.sent.find((m) => m.to === TEACHER.email)?.subject).toBe('Approved: The Ink Avengers is in DoomsDay Diaries');
    const after = (await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json;
    expect(after.applications[0]).toMatchObject({ status: 'approved', canUpload: true, canEdit: false });
    expect(after.brief).toMatchObject({ title: 'Doom Picked the Wrong Town', hashtag: '#DoomPickedTheWrongTown' });
    expect(t.mailer.sent.find((m) => m.to === TEACHER.email)?.html).toContain('read the story brief');
    const up = async (kind: string, file: Uint8Array) => {
      const u = await t.call('POST', `/competitions/${SLUG}/team/${app.id}/uploads`, { headers: h, body: { kind, contentType: 'application/pdf', size: file.length } });
      expect(u.status).toBe(201);
      await t.deps.storage.write('competition-entries', u.json.key, file);
      return t.call('POST', `/competitions/${SLUG}/team/${app.id}/files`, { headers: h, body: { kind, key: u.json.key, name: `${kind}.pdf` } });
    };
    expect((await up('comic', pdf(12))).json.error).toBe('This PDF has 12 pages; the comic needs at least 40.');
    expect((await up('comic', new TextEncoder().encode('<html>not a pdf'))).json.code).toBe('bad_file');
    t.mailer.sent.length = 0;
    expect((await up('comic', pdf(44))).status).toBe(200);
    expect(t.mailer.sent[0].subject).toBe('Comic (PDF) received: The Ink Avengers');
    const second = await up('comic', pdf(46));
    const comic = second.json.application.files.find((f: any) => f.kind === 'comic');
    expect(comic.current).toMatchObject({ pages: 46 });
    expect(comic.history.map((x: any) => x.pages)).toEqual([46, 44]);
    expect((await up('sketches', pdf(39))).json.error).toBe('This PDF has 39 pages; the rough pencil sketches needs at least 40.');
    expect((await up('sketches', pdf(40))).status).toBe(200);
    // Another account can't upload; after the deadline nobody can.
    expect((await t.call('POST', `/competitions/${SLUG}/team/${app.id}/uploads`, { headers: await as(OTHER), body: { kind: 'comic', contentType: 'application/pdf', size: 10 } })).status).toBe(404);
    t.setClock(new Date('2026-12-06T00:00:00+05:30'));
    expect((await t.call('POST', `/competitions/${SLUG}/team/${app.id}/uploads`, { headers: h, body: { kind: 'comic', contentType: 'application/pdf', size: 10 } })).json.code).toBe('closed');
  });
});

describe('DoomsDay Diaries admin', () => {
  async function approvedTeam() {
    const h = await signedIn(TEACHER);
    const app = (await register(h, await team(h))).json.application;
    const admin = await as(OWNER);
    await t.call('POST', `/admin/competitions/${SLUG}/teams/${app.id}/review`, { headers: admin, body: { action: 'approve' } });
    return { h, admin, app };
  }

  it('lists, filters and shows applications; ID documents open only through logged links; CSV with or without contacts', async () => {
    const { admin, app } = await approvedTeam();
    const list = (await t.call('GET', `/admin/competitions/${SLUG}/teams?status=approved&category=rising`, { headers: admin })).json;
    expect(list.items).toMatchObject([{ code: 'DD-0001', teamName: 'The Ink Avengers', category: 'Rising Heroes', members: ['Riya Sharma', 'Aman Gupta'] }]);
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams?q=dd-1`, { headers: admin })).json.items).toHaveLength(1);
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams?q=aman`, { headers: admin })).json.items).toHaveLength(1);
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams?category=junior`, { headers: admin })).json.items).toHaveLength(0);
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams?files=missing`, { headers: admin })).json.items).toHaveLength(1);
    const d = (await t.call('GET', `/admin/competitions/${SLUG}/teams/${app.id}`, { headers: admin })).json;
    expect(d.members[0]).toMatchObject({ fullName: 'Riya Sharma', age: 13, guardianName: 'Meera Sharma', idDoc: true, captain: true });
    expect(d.history.map((h: any) => h.action)).toContain('team.approve');
    const id = await t.call('GET', `/admin/competitions/${SLUG}/teams/${app.id}/id/${d.members[0].id}`, { headers: admin });
    expect(id.json.url).toMatch(/signed\/competition-entries\/teams\/doomsday-diaries\/ids\//);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, 'team.view_id'))).length).toBe(1);
    const plain = (await t.call('GET', `/admin/competitions/${SLUG}/participants.csv`, { headers: admin }));
    expect(plain.status).toBe(404);
    const csv = await t.call('GET', `/admin/competitions/${SLUG}/teams/export.csv`, { headers: admin });
    expect(csv.text.trim().split('\r\n')).toHaveLength(3);
    expect(csv.text).not.toContain('9123456780');
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams/export.csv?contacts=1`, { headers: admin })).text).toContain('9123456780');
    const stats = (await t.call('GET', `/admin/competitions/${SLUG}/teams/stats`, { headers: admin })).json;
    expect(stats).toMatchObject({ total: 1, byStatus: { approved: 1 }, members: 2, minors: 2 });
    expect(stats.byCategory.find((c: any) => c.key === 'rising')).toMatchObject({ teams: 1, approved: 1 });
    // Deleting ID documents of decided teams.
    expect((await t.call('POST', `/admin/competitions/${SLUG}/teams/delete-ids`, { headers: admin })).json.deleted).toBe(2);
    expect((await t.db.select().from(teamMembers)).every((m) => m.idDocKey === null && m.idDocDeletedAt)).toBe(true);
  });

  it('sends notices to a group of teams (dashboard + email), public notices on the page, and results once published', async () => {
    const { h, admin, app } = await approvedTeam();
    t.mailer.sent.length = 0;
    const n = await t.call('POST', `/admin/competitions/${SLUG}/notices`, { headers: admin, body: { title: 'Upload early', body: 'Servers get busy near the deadline.', audience: { statuses: ['approved'], categories: ['rising'] }, email: true } });
    expect(n.json).toMatchObject({ teams: 1, emailed: 2 });
    expect(t.mailer.sent[0].bcc).toEqual([TEACHER.email, STUDENT.email]);
    expect((await t.call('POST', `/admin/competitions/${SLUG}/notices/preview`, { headers: admin, body: { audience: { categories: ['junior'] } } })).json.teams).toBe(0);
    await t.call('POST', `/admin/competitions/${SLUG}/notices`, { headers: admin, body: { title: 'Registrations are open', body: 'Tell your friends.', audience: { public: true } } });
    const mine = (await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.applications[0];
    expect(mine.notices.map((x: any) => x.title)).toEqual(['Upload early']);
    const infoRes = await t.call('GET', `/competition-info/${SLUG}`);
    const info = infoRes.json;
    expect(info.notices.map((x: any) => x.title)).toEqual(['Registrations are open']);
    // The public page never gets the story brief or the official PDFs (they name it).
    expect(infoRes.text).not.toMatch(/Wrong Town|brief|rulesDoc|topicDoc/i);
    expect(info.results).toEqual([]);
    await t.call('POST', `/admin/competitions/${SLUG}/teams/${app.id}/result`, { headers: admin, body: { result: 'first' } });
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.applications[0].result).toBe('');
    await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: admin, body: { resultsPublished: true } });
    expect((await t.call('GET', `/competition-info/${SLUG}`)).json.results).toEqual([{ team: 'The Ink Avengers', category: 'rising', result: 'first', credit: 'Riya, Aman · Ranchi' }]);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.applications[0].result).toBe('1st place');
  });

  it('is for the store owner only', async () => {
    const MANAGER = { sub: '22222222-2222-4222-8222-222222222222', email: 'manager@eldenap.in' };
    await t.db.insert(adminUsers).values({ userId: MANAGER.sub, email: MANAGER.email, role: 'manager' });
    expect((await t.call('GET', `/admin/competitions/${SLUG}/teams`, { headers: await as(MANAGER) })).status).toBe(403);
  });
});
