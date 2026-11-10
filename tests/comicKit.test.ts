// The DoomsDay Diaries comic kit: the organiser uploads a PDF (private storage), and every team that
// registers gets it, attached to the "Application received" email and on their team page.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyMember, type MemberInput, type TeamInput } from '../src/shared/teams.js';
import { KIT_ATTACH_MAX } from '../server/services/teams.js';
import { setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); t.setClock(new Date('2026-11-10T10:00:00+05:30')); });

const SLUG = 'doomsday-diaries';
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const TEACHER = { sub: 'b2222222-2222-4222-8222-222222222222', email: 'asha@school.in', name: 'Asha Verma' };
const CAPTAIN = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'riya.s@example.com', name: 'Riya Sharma' };
const OTHER = { sub: 'd4444444-4444-4444-8444-444444444444', email: 'someone@example.com', name: 'Someone' };
const as = async (u: { sub: string; email: string; name?: string }) => ({ Authorization: `Bearer ${await supabaseToken({ name: '', ...u, provider: 'google' })}` });
const KIT = new TextEncoder().encode('%PDF-1.7 DoomsDay Diaries comic kit');

async function signedIn(u: typeof TEACHER) {
  const h = await as(u);
  expect((await t.call('GET', '/account', { headers: h })).status).toBe(200);
  expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210', fullName: u.name, city: 'Ranchi', state: '20', type: 'teacher', institutionType: 'school', institutionName: 'DAV Public School' } })).status).toBe(200);
  return h;
}
const seg = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xff, ...payload];
const idPhoto = () => Uint8Array.from([0xff, 0xd8, ...seg(0xc0, [8, 0, 10, 0, 20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), 1, 2, 3, 0xff, 0xd9]);
async function uploadId(h: Record<string, string>) {
  const r = await t.call('POST', `/competitions/${SLUG}/team/id-upload`, { headers: h, body: { contentType: 'image/jpeg', size: 500 } });
  await t.deps.storage.write('competition-entries', r.json.key, idPhoto());
  return r.json.key as string;
}
const member = (o: Partial<MemberInput>): MemberInput => ({ ...emptyMember(), idDocType: 'school_id', guardianName: 'Meera Sharma', guardianRelation: 'Mother', guardianPhone: '9123456780', guardianConsent: true, ...o });
async function register(h: Record<string, string>, names: [string, string] = ['Riya Sharma', 'Aman Gupta'], captainEmail = CAPTAIN.email) {
  const body: TeamInput = {
    teamName: `${names[0]}’s team`, institutionType: 'school', institutionName: 'DAV Public School', city: 'Ranchi', state: '20', acceptRules: true, confirmTrue: true,
    members: [
      member({ fullName: names[0], dob: '2013-05-04', roles: ['writer'], instagram: 'one.draws', email: captainEmail, idDocKey: await uploadId(h) }),
      member({ fullName: names[1], dob: '2012-12-01', roles: ['artist'], instagram: 'two.draws', idDocKey: await uploadId(h) }),
    ],
  };
  const r = await t.call('POST', `/competitions/${SLUG}/team`, { headers: h, body });
  expect(r.status).toBe(201);
  return r.json.application as { id: string; code: string };
}

/** As the admin's browser does it: a one-time upload link to the private bucket, the upload, then save it in the settings. */
async function uploadKit(size = KIT.length) {
  const admin = await as(OWNER);
  const up = await t.call('POST', '/admin/uploads', { headers: admin, body: { bucket: 'competition-files', fileName: 'Comic Kit.pdf', contentType: 'application/pdf', size } });
  expect(up.status).toBe(200);
  await t.deps.storage.write('competition-files', up.json.path, KIT);
  const saved = await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: admin, body: { kitKey: up.json.path, kitName: 'Comic Kit.pdf', kitSize: size } });
  expect(saved.status).toBe(200);
  return { admin, key: up.json.path as string, saved: saved.json };
}
const received = () => t.mailer.sent.filter((m) => m.subject.startsWith('Application received'));

describe('comic kit upload (admin)', () => {
  it('is stored in the private bucket and shown in the settings with a private link', async () => {
    const { key, saved } = await uploadKit();
    expect(saved.settings).toMatchObject({ kitKey: key, kitName: 'Comic Kit.pdf', kitSize: KIT.length });
    expect(saved.urls.kitKey).toBe(`https://files.test/signed/competition-files/${key}?expires=3600`);
    expect(saved.kit).toEqual({ attachMaxBytes: KIT_ATTACH_MAX, registeredTeams: 0 });
    expect(await t.deps.storage.read('competition-files', key)).toEqual(KIT);
  });

  it('only accepts sensible values, and only from the store owner', async () => {
    const admin = await as(OWNER);
    expect((await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: admin, body: { kitSize: -1 } })).status).toBe(400);
    expect((await t.call('POST', '/admin/uploads', { headers: admin, body: { bucket: 'competition-files', fileName: 'kit.pdf', contentType: 'application/pdf', size: 60 * 1024 * 1024 } })).status).toBe(400);
    expect((await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: await as(TEACHER), body: { kitKey: 'x' } })).status).toBe(403);
  });
});

describe('comic kit for registered teams', () => {
  it('is attached to the registration email (registrant and captain) and on the team page', async () => {
    await uploadKit();
    const h = await signedIn(TEACHER);
    const app = await register(h);
    const mails = received();
    expect(mails.map((m) => m.to).sort()).toEqual([TEACHER.email, CAPTAIN.email].sort());
    for (const m of mails) {
      expect(m.attachments).toHaveLength(1);
      expect(m.attachments![0]).toMatchObject({ filename: 'Comic Kit.pdf', contentType: 'application/pdf' });
      expect(Buffer.from(m.attachments![0].content).equals(Buffer.from(KIT))).toBe(true);
      expect(m.html).toContain('Your <strong>comic kit</strong> is attached to this email');
    }
    // The team page, for the registrant and the captain, while the team is still pending.
    for (const u of [h, await as(CAPTAIN)]) {
      const page = await t.call('GET', `/competitions/${SLUG}/team`, { headers: u });
      expect(page.json.applications[0]).toMatchObject({ id: app.id, status: 'pending' });
      expect(page.json.kit).toEqual({ name: 'Comic Kit.pdf', size: KIT.length });
      const dl = await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: u });
      expect(dl.status).toBe(200);
      expect(dl.json.url).toMatch(/^https:\/\/files\.test\/signed\/competition-files\/.+\?expires=300$/);
    }
    // Other emails (changes, approval…) don't carry it again.
    const admin = await as(OWNER);
    await t.call('POST', `/admin/competitions/${SLUG}/teams/${app.id}/review`, { headers: admin, body: { action: 'approve' } });
    expect(t.mailer.sent.filter((m) => m.subject.startsWith('Approved')).every((m) => !m.attachments?.length)).toBe(true);
  });

  it('a kit too big to attach is linked to the team page instead', async () => {
    await uploadKit(20 * 1024 * 1024);
    await register(await signedIn(TEACHER));
    for (const m of received()) {
      expect(m.attachments ?? []).toHaveLength(0);
      expect(m.html).toContain('download it from your team page');
    }
  });

  it('if the kit can’t be read, the email still goes out, pointing to the team page', async () => {
    await uploadKit();
    // The kit's bucket fails (ID photos, read during registration, still work).
    const read = t.deps.storage.read.bind(t.deps.storage);
    t.deps.storage.read = async (bucket, path) => { if (bucket === 'competition-files') throw new Error('storage down'); return read(bucket, path); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await register(await signedIn(TEACHER));
    expect(received()).toHaveLength(2);
    for (const m of received()) { expect(m.attachments ?? []).toHaveLength(0); expect(m.html).toContain('download it from your team page'); }
    expect(err).toHaveBeenCalledWith('[teams] comic kit for the email', 'storage down');
    err.mockRestore();
  });

  it('is only for teams that registered (not others, not withdrawn teams)', async () => {
    await uploadKit();
    const h = await signedIn(TEACHER);
    const app = await register(h);
    const other = await as(OTHER);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: other })).json.kit).toBeNull();
    const denied = await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: other });
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe('not_registered');
    expect((await t.call('GET', `/competitions/${SLUG}/team/kit`)).status).toBe(401);
    expect((await t.call('POST', `/competitions/${SLUG}/team/${app.id}/withdraw`, { headers: h })).status).toBe(200);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.kit).toBeNull();
    expect((await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: h })).status).toBe(403);
  });

  it('teams that registered before it was uploaded see it on their team page', async () => {
    const h = await signedIn(TEACHER);
    await register(h);
    expect(received().every((m) => !m.attachments?.length && !m.html.includes('comic kit'))).toBe(true);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.kit).toBeNull();
    expect((await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: h })).status).toBe(404);
    const { saved } = await uploadKit();
    expect(saved.kit.registeredTeams).toBe(1);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.kit).toMatchObject({ name: 'Comic Kit.pdf' });
    expect((await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: h })).status).toBe(200);
  });

  it('once removed, it’s no longer given out', async () => {
    const { admin } = await uploadKit();
    await t.call('PUT', `/admin/competitions/${SLUG}/settings`, { headers: admin, body: { kitKey: null, kitName: '', kitSize: 0 } });
    const h = await signedIn(TEACHER);
    await register(h);
    expect(received().every((m) => !m.attachments?.length)).toBe(true);
    expect((await t.call('GET', `/competitions/${SLUG}/team`, { headers: h })).json.kit).toBeNull();
    expect((await t.call('GET', `/competitions/${SLUG}/team/kit`, { headers: h })).status).toBe(404);
  });
});
