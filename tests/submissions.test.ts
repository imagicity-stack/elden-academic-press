import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { submissionFiles } from '../server/db/schema.js';
import { hasPhotoMetadata, imageSize, sniff, stripImageMetadata } from '../server/lib/fileCheck.js';
import { setup, supabaseToken } from './helpers.js';
import { createCompetition, geotaggedJpeg, ist } from './competitionHelpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const PARENT = { sub: 'a1111111-1111-4111-8111-111111111111', email: 'meera@example.com', name: 'Meera Sharma' };
const OTHER = { sub: 'c3333333-3333-4333-8333-333333333333', email: 'vikram@example.com', name: 'Vikram Rao' };
const as = async (u: { sub: string; email: string; name: string }) => ({ Authorization: `Bearer ${await supabaseToken({ ...u, provider: 'google' })}` });
describe('photo metadata', () => {
  it('removes EXIF (with GPS) from a JPEG without touching the picture', () => {
    const photo = geotaggedJpeg();
    expect(sniff(photo)).toBe('image/jpeg');
    expect(hasPhotoMetadata(photo, 'image/jpeg')).toBe(true);
    const clean = stripImageMetadata(photo, 'image/jpeg');
    expect(hasPhotoMetadata(clean, 'image/jpeg')).toBe(false);
    expect(new TextDecoder().decode(clean)).not.toContain('GPS');
    expect(imageSize(clean, 'image/jpeg')).toEqual({ width: 200, height: 100 });
    expect([...clean.slice(-7)]).toEqual([1, 2, 3, 4, 5, 0xff, 0xd9]);
  });
  it('knows a PDF pretending to be a photo', () => {
    expect(sniff(new TextEncoder().encode('%PDF-1.7 …'))).toBe('application/pdf');
    expect(sniff(new TextEncoder().encode('<html>'))).toBeNull();
  });
});

async function setupEntry(overrides: Record<string, unknown> = {}) {
  const { id, h: admin, save } = await createCompetition(t, overrides);
  await t.call('POST', `/admin/competitions/${id}/publish`, { headers: admin, body: save });
  const slug = save.competition.slug as string;
  const h = await as(PARENT);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
  await t.call('PUT', '/profile/details', { headers: h, body: { fullName: 'Meera Sharma', whatsapp: '9876543210', city: 'Hazaribagh', state: '20' } });
  const kid = (await t.call('POST', '/profile/children', { headers: h, body: { firstName: 'Riya', lastName: 'Sharma', classGrade: 4, schoolName: 'EHS', city: 'Hazaribagh', state: '20', consents: { data_processing: true, publication: true, marketing: false } } })).json.students[0].id;
  t.setClock(new Date(ist('2026-11-20T10:00:00')));
  const reg = (await t.call('POST', `/competitions/${slug}/register`, { headers: h, body: { studentId: kid } })).json.registrationId as string;
  return { h, reg, slug };
}

async function upload(h: Record<string, string>, subId: string, bytes: Uint8Array, contentType = 'image/jpeg', kind = 'main') {
  const r = await t.call('POST', `/my/submissions/${subId}/files`, { headers: h, body: { kind, fileName: 'drawing.jpg', contentType, size: bytes.length } });
  expect(r.status).toBe(201);
  await t.deps.storage.write('competition-entries', r.json.upload.path, bytes);
  return { fileId: r.json.fileId as string, key: r.json.upload.path as string, verify: () => t.call('POST', `/my/submissions/${subId}/files/${r.json.fileId}/verify`, { headers: h }) };
}

describe('submissions', () => {
  it('uploads privately, strips the location, submits with a receipt email, and stops at the deadline', async () => {
    const { h, reg } = await setupEntry({ maxMainFiles: 2 });
    const draft = await t.call('POST', `/my/entries/${reg}/draft`, { headers: h, body: {} });
    expect(draft.status).toBe(201);
    const sub = draft.json.submission;
    expect(sub).toMatchObject({ status: 'draft', entryCode: 'ECC-A-0001' });

    const photo = await upload(h, sub.id, geotaggedJpeg());
    expect(photo.key).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/); // random name, no child's details
    const v = await photo.verify();
    expect(v.status).toBe(200);
    const stored = await t.deps.storage.read('competition-entries', photo.key);
    expect(hasPhotoMetadata(stored, 'image/jpeg')).toBe(false);
    expect(new TextDecoder().decode(stored)).not.toContain('GPSLatitude');
    expect(v.json.submission.files[0]).toMatchObject({ verified: true, width: 200, height: 100, mimeType: 'image/jpeg' });

    // A "photo" that is really something else is refused and deleted.
    const fake = await upload(h, sub.id, new TextEncoder().encode('<script>alert(1)</script>'));
    const bad = await fake.verify();
    expect(bad.status).toBe(400);
    expect((await t.db.select().from(submissionFiles).where(eq(submissionFiles.id, fake.fileId)))).toEqual([]);

    expect((await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: false } })).status).toBe(400);
    t.mailer.sent.length = 0;
    const done = await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } });
    expect(done.json.submission).toMatchObject({ status: 'submitted', entryCode: 'ECC-A-0001' });
    const mail = t.mailer.sent.find((m) => m.to === PARENT.email)!;
    expect(mail.subject).toBe('Entry received: ECC-A-0001');
    expect(mail.html).not.toContain(photo.key); // never a link to the child's file
    expect(mail.attachments ?? []).toEqual([]);

    // Changes until the deadline; a submitted entry can't lose its only file.
    expect((await t.call('DELETE', `/my/submissions/${sub.id}/files/${photo.fileId}`, { headers: h })).json.code).toBe('last_file');
    expect((await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { title: 'My town’s hero' } })).status).toBe(200);
    // 00:00:01 IST after the deadline: closed, whatever the browser's clock says.
    t.setClock(new Date(ist('2026-12-09T00:00:01')));
    expect((await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { title: 'Late change' } })).status).toBe(409);
    expect((await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } })).status).toBe(409);
    expect((await t.call('POST', `/my/submissions/${sub.id}/files`, { headers: h, body: { kind: 'main', fileName: 'x.jpg', contentType: 'image/jpeg', size: 10 } })).status).toBe(409);
    expect((await t.call('GET', `/my/entries/${reg}`, { headers: h })).json.window).toMatchObject({ open: false, canEdit: false, reason: 'The deadline has passed.' });
  });

  it('accepts an entry at 23:59:59 IST on the deadline day', async () => {
    const { h, reg } = await setupEntry();
    const sub = (await t.call('POST', `/my/entries/${reg}/draft`, { headers: h, body: {} })).json.submission;
    await (await upload(h, sub.id, geotaggedJpeg())).verify();
    t.setClock(new Date(ist('2026-12-08T23:59:59')));
    expect((await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } })).status).toBe(200);
  });

  it('checks word limits for written entries, refuses wrong file types, and lets a parent withdraw', async () => {
    const { h, reg } = await setupEntry({ allowedSubmissionTypes: ['text'], minWords: 5, maxWords: 50 });
    const sub = (await t.call('POST', `/my/entries/${reg}/draft`, { headers: h, body: {} })).json.submission;
    expect((await t.call('POST', `/my/submissions/${sub.id}/files`, { headers: h, body: { kind: 'main', fileName: 'a.jpg', contentType: 'image/jpeg', size: 10 } })).json.code).toBe('no_files');
    await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { textContent: 'Too short really' } });
    const short = await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } });
    expect(short.json.error).toBe('Write at least 5 words (now 3).');
    await t.call('PUT', `/my/submissions/${sub.id}`, { headers: h, body: { textContent: 'एक छोटी सी कहानी जो पाँच शब्दों से ज़्यादा है' } });
    expect((await t.call('POST', `/my/submissions/${sub.id}/submit`, { headers: h, body: { declaration: true } })).json.submission.status).toBe('submitted');
    t.mailer.sent.length = 0;
    const w = await t.call('POST', `/my/submissions/${sub.id}/withdraw`, { headers: h });
    expect(w.json.submission.status).toBe('withdrawn');
    expect(t.mailer.sent.some((m) => m.subject === `Entry withdrawn: ${sub.entryCode}`)).toBe(true);
  });

  it('keeps another family out', async () => {
    const { h, reg } = await setupEntry();
    const sub = (await t.call('POST', `/my/entries/${reg}/draft`, { headers: h, body: {} })).json.submission;
    const other = await as(OTHER);
    expect((await t.call('GET', `/my/entries/${reg}`, { headers: other })).status).toBe(404);
    expect((await t.call('PUT', `/my/submissions/${sub.id}`, { headers: other, body: { title: 'x' } })).status).toBe(404);
    expect((await t.call('POST', `/my/submissions/${sub.id}/files`, { headers: other, body: { kind: 'main', fileName: 'a.jpg', contentType: 'image/jpeg', size: 10 } })).status).toBe(404);
    expect((await t.call('GET', `/my/entries/${reg}`)).status).toBe(401);
  });
});
