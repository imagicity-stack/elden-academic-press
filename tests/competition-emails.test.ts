import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLog, notificationLog } from '../server/db/schema.js';
import { setup, supabaseToken } from './helpers.js';
import { createCompetition, ist, OWNER } from './competitionHelpers.js';

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => { t = await setup(); });

const PARENT = { sub: 'a1111111-1111-4111-8111-111111111111', email: 'meera@example.com', name: 'Meera Sharma' };
const as = async (u: { sub: string; email: string; name: string }) => ({ Authorization: `Bearer ${await supabaseToken({ ...u, provider: 'google' })}` });

async function published() {
  const { id, h, save } = await createCompetition(t);
  expect((await t.call('POST', `/admin/competitions/${id}/publish`, { headers: h, body: save })).status).toBe(200);
  const list = (await t.call('GET', `/admin/competitions/${id}/emails`, { headers: h })).json;
  const get = (type: string, audience: string) => list.items.find((x: any) => x.type === type && x.audience === audience).template;
  return { id, h, slug: save.competition.slug as string, get };
}

async function registerChild(slug: string) {
  const h = await as(PARENT);
  await t.call('POST', '/profile/type', { headers: h, body: { type: 'parent' } });
  await t.call('PUT', '/profile/details', { headers: h, body: { fullName: 'Meera Sharma', whatsapp: '9876543210', city: 'Hazaribagh', state: '20' } });
  const kid = (await t.call('POST', '/profile/children', { headers: h, body: { firstName: 'Riya', lastName: 'Sharma', classGrade: 4, schoolName: 'EHS', city: 'Hazaribagh', state: '20', consents: { data_processing: true, publication: true, marketing: false } } })).json.students[0].id;
  t.setClock(new Date(ist('2026-11-20T10:00:00')));
  const r = await t.call('POST', `/competitions/${slug}/register`, { headers: h, body: { studentId: kid } });
  expect(r.status).toBe(201);
  return r.json.registrationId as string;
}

describe('competition emails (admin)', () => {
  it('lists the four emails with their defaults and refuses unknown or wrong merge tags', async () => {
    const { id, h, get } = await published();
    const list = (await t.call('GET', `/admin/competitions/${id}/emails`, { headers: h })).json;
    expect(list.items.map((x: any) => `${x.type}/${x.audience}`)).toEqual([
      'registration_confirmed/parent', 'registration_confirmed/student', 'submission_received/parent', 'submission_received/student',
    ]);
    expect(get('registration_confirmed', 'parent').subject).toContain('{{student_first_name}}');

    const bad = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...get('registration_confirmed', 'parent'), subject: 'Hi {{first_name}}' } } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('{{first_name}} in the subject isn’t a merge tag.');

    const referral = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/student`, { headers: h, body: { template: { ...get('registration_confirmed', 'student'), bodyContent: 'Share {{referral_url}}' } } });
    expect(referral.json.error).toBe('{{referral_url}} can only be used in the Parent version (body).');

    const code = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...get('registration_confirmed', 'parent'), heading: 'Code {{entry_code}}' } } });
    expect(code.json.error).toBe('{{entry_code}} only works in the entry-received email (heading).');

    const link = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...get('registration_confirmed', 'parent'), primaryCtaUrl: 'javascript:alert(1)' } } });
    expect(link.json.error).toBe('The primary button link must be a merge tag or start with https:// or mailto:.');
  });

  it('saves edits, never keeps referral or upsell in the Student version, and resets to default', async () => {
    const { id, h, get } = await published();
    const student = { ...get('registration_confirmed', 'student'), subject: 'Go {{student_first_name}}!', blocks: { ...get('registration_confirmed', 'student').blocks, showReferral: true, showUpsell: true } };
    const saved = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/student`, { headers: h, body: { template: student } });
    expect(saved.status).toBe(200);
    expect(saved.json.template.subject).toBe('Go {{student_first_name}}!');
    expect(saved.json.template.blocks).toMatchObject({ showReferral: false, showUpsell: false });
    expect(saved.json.updatedBy).toBe(OWNER.email);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.action, 'competition.email_edit'))).length).toBe(1);

    const reset = await t.call('POST', `/admin/competitions/${id}/emails/registration_confirmed/student/reset`, { headers: h });
    expect(reset.json.template.subject).toBe('You’re in, {{student_first_name}}! {{competition_title}} starts now');
  });

  it('checks the banner and attachments: size, type and that they exist', async () => {
    const { id, h, get } = await published();
    const base = get('registration_confirmed', 'parent');
    const pdf = (mb: number) => { const b = new Uint8Array(mb * 1024 * 1024); b.set(new TextEncoder().encode('%PDF-1.7')); return b; };
    await t.deps.storage.write('competition-files', '2026/a/guide.pdf', pdf(3));
    await t.deps.storage.write('competition-files', '2026/b/rules.pdf', pdf(3));
    const tooBig = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, attachmentKeys: ['2026/a/guide.pdf', '2026/b/rules.pdf'] } } });
    expect(tooBig.json.error).toBe('Attachments come to 6.0 MB; keep them under 5 MB together.');
    const read = t.deps.storage.read;
    t.deps.storage.read = async (b, p) => { if (p.includes('gone')) throw new Error('Object not found'); return read(b, p); };
    const missing = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, attachmentKeys: ['2026/c/gone.pdf'] } } });
    expect(missing.json.error).toBe('gone.pdf is missing; upload it again.');
    const three = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, attachmentKeys: ['a', 'b', 'c'] } } });
    expect(three.status).toBe(400);

    await t.deps.storage.write('competition-media', '2026/d/banner.webp', new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '));
    const webp = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, bannerImageKey: '2026/d/banner.webp', bannerAlt: 'Comic' } } });
    expect(webp.json.error).toBe('The banner must be a JPG or PNG (some email apps don’t show WebP).');
    const noAlt = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, bannerImageKey: '2026/d/banner.webp', bannerAlt: '' } } });
    expect(noAlt.json.details.problems).toContain('Add alt text for the banner (it shows when images are off).');

    await t.deps.storage.write('competition-files', '2026/e/kit.pdf', pdf(1));
    const ok = await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...base, attachmentKeys: ['2026/e/kit.pdf'] } } });
    expect(ok.status).toBe(200);
  });

  it('previews with sample data (escaped) and sends a test only to the admin', async () => {
    const { id, h, get } = await published();
    const parent = { ...get('registration_confirmed', 'parent'), bodyContent: 'Hello {{parent_name}}, link: {{referral_url}}' };
    const pv = await t.call('POST', `/admin/competitions/${id}/emails/preview`, { headers: h, body: { type: 'registration_confirmed', audience: 'parent', template: parent } });
    expect(pv.status).toBe(200);
    expect(pv.json.subject).toBe('Registration confirmed: Riya is in Elden Comic Challenge 2026');
    expect(pv.json.html).toContain('Hello Meera');
    expect(pv.json.html).toContain('?ref=SAMPLE12');
    expect(pv.json.problems).toEqual([]);

    // Unsaved content with a wrong tag still previews, and says what's wrong.
    const student = { ...get('registration_confirmed', 'student'), bodyContent: 'Hi {{referral_url}} {{student_first_name}}', blocks: { ...get('registration_confirmed', 'student').blocks, showReferral: true } };
    const sv = await t.call('POST', `/admin/competitions/${id}/emails/preview`, { headers: h, body: { type: 'registration_confirmed', audience: 'student', template: student } });
    expect(sv.json.html).not.toContain('SAMPLE12');
    expect(sv.json.html).not.toContain('Invite friends');
    expect(sv.json.problems).toEqual(['{{referral_url}} can only be used in the Parent version (body).']);

    t.mailer.sent.length = 0;
    const test = await t.call('POST', `/admin/competitions/${id}/emails/test`, { headers: h, body: { type: 'registration_confirmed', audience: 'parent', template: parent } });
    expect(test.json).toEqual({ ok: true, to: OWNER.email });
    expect(t.mailer.sent).toHaveLength(1);
    expect(t.mailer.sent[0]).toMatchObject({ to: OWNER.email, subject: '[Test] Registration confirmed: Riya is in Elden Comic Challenge 2026' });
    expect((await t.call('POST', `/admin/competitions/${id}/emails/test`, { headers: h, body: { type: 'registration_confirmed', audience: 'student', template: student } })).status).toBe(400);
  });

  it('uses the saved email for real registrations, logs every send and retries failures', async () => {
    const { id, h, slug, get } = await published();
    await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...get('registration_confirmed', 'parent'), subject: '{{student_first_name}} is in!' } } });

    const send = t.deps.mailer.send;
    t.deps.mailer.send = async () => { throw new Error('SMTP is down'); };
    t.mailer.sent.length = 0;
    await registerChild(slug);
    t.deps.mailer.send = send;

    const failed = (await t.call('GET', `/admin/competitions/${id}/emails/log`, { headers: h })).json;
    expect(failed.totals).toEqual({ failed: 1 });
    expect(failed.items[0]).toMatchObject({ template: 'comp_registration', to: PARENT.email, status: 'failed', attempts: 3, error: 'SMTP is down' });

    const retry = await t.call('POST', `/admin/competitions/${id}/emails/retry`, { headers: h });
    expect(retry.json).toEqual({ tried: 1, stillFailing: 0 });
    expect(t.mailer.sent.find((m) => m.to === PARENT.email)?.subject).toBe('Riya is in!');
    const [row] = await t.db.select().from(notificationLog).where(eq(notificationLog.toAddress, PARENT.email));
    expect(row).toMatchObject({ status: 'sent', attempts: 4 });

    // Switched off: nothing is sent (logged as skipped).
    await t.call('PUT', `/admin/competitions/${id}/emails/registration_confirmed/parent`, { headers: h, body: { template: { ...get('registration_confirmed', 'parent'), enabled: false } } });
    expect((await t.call('GET', `/admin/competitions/${id}/emails/log`, { headers: h })).json.totals).toEqual({ sent: 1 });
  });
});
