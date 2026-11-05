// Admin: each competition's own emails (Emails tab). Registration confirmed and entry
// received, in a Parent and a Student version: edit, live preview with sample data,
// send a test to yourself, reset to default, and see what was sent (with retries).
// Unknown merge tags are refused on save; the Student version never keeps the
// referral or upsell blocks. Every change is in the audit log.
import { Hono, type Context } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { competitionEmailTemplates, notificationLog, registrations } from '../../db/schema.js';
import { body, HttpError, notFound } from '../../lib/http.js';
import { sniff } from '../../lib/fileCheck.js';
import {
  ATTACHMENT_LIMIT, BANNER_MAX_BYTES, defaultTemplate, EMAIL_KINDS, forAudience, templateProblems,
  type Audience, type EmailType, type TemplateContent,
} from '../../../src/shared/competitionEmail.js';
import { loadFull, mediaUrl, type Full } from '../../services/competitions.js';
import { renderCompetitionEmail, sampleUpsell, sampleValues } from '../../services/competitionEmails.js';
import { deliver } from '../../services/notify.js';
import { audit } from './auth.js';

export const adminCompetitionEmails = new Hono<AppEnv>();

const ID = ':id{[0-9a-f-]{36}}';
const zType = z.enum(['registration_confirmed', 'submission_received']);
const zAudience = z.enum(['parent', 'student']);
const line = (max: number) => z.string().trim().max(max).default('');
const zTemplate = z.object({
  enabled: z.boolean(),
  subject: line(200),
  preheader: line(200),
  bannerImageKey: z.string().trim().max(300).nullable().optional().transform((v) => v || null),
  bannerAlt: line(200),
  heading: line(200),
  bodyContent: z.string().max(10_000).default(''),
  primaryCtaLabel: line(60),
  primaryCtaUrl: line(500),
  secondaryCtaLabel: line(60),
  secondaryCtaUrl: line(500),
  blocks: z.object({
    showDetails: z.boolean(), showPrizes: z.boolean(), showRules: z.boolean(), showResources: z.boolean(), showReferral: z.boolean(), showUpsell: z.boolean(),
  }),
  attachmentKeys: z.array(z.string().trim().min(1).max(300)).max(ATTACHMENT_LIMIT.files).default([]),
});
const zEmail = z.object({ type: zType, audience: zAudience, template: zTemplate });

const content = (r: typeof competitionEmailTemplates.$inferSelect): TemplateContent => ({
  enabled: r.enabled, subject: r.subject, preheader: r.preheader, bannerImageKey: r.bannerImageKey, bannerAlt: r.bannerAlt, heading: r.heading,
  bodyContent: r.bodyContent, primaryCtaLabel: r.primaryCtaLabel, primaryCtaUrl: r.primaryCtaUrl, secondaryCtaLabel: r.secondaryCtaLabel,
  secondaryCtaUrl: r.secondaryCtaUrl, blocks: r.blocks, attachmentKeys: r.attachmentKeys,
});
const fileName = (key: string) => key.split('/').pop() || key;

async function competition(c: Context<AppEnv>) {
  const f = await loadFull(c.get('deps').db, { id: c.req.param('id')! });
  if (!f) throw notFound('Competition not found');
  return f;
}

/** Checks that need the files themselves: banner size and attachments (type, total size). */
async function fileProblems(c: Context<AppEnv>, t: TemplateContent) {
  const { storage } = c.get('deps');
  const out: string[] = [];
  if (t.bannerImageKey) {
    try {
      const b = await storage.read('competition-media', t.bannerImageKey);
      if (b.length > BANNER_MAX_BYTES) out.push(`The banner is ${Math.round(b.length / 1024)} KB; keep it under 300 KB so the email loads fast.`);
      const type = sniff(b);
      if (type !== 'image/jpeg' && type !== 'image/png') out.push('The banner must be a JPG or PNG (some email apps don’t show WebP).');
    } catch { out.push('The banner image is missing; upload it again.'); }
  }
  let total = 0;
  for (const key of t.attachmentKeys) {
    try {
      const b = await storage.read('competition-files', key);
      total += b.length;
      const type = sniff(b);
      if (type !== 'application/pdf' && type !== 'image/jpeg' && type !== 'image/png') out.push(`${fileName(key)}: attachments can be a PDF, JPG or PNG.`);
    } catch { out.push(`${fileName(key)} is missing; upload it again.`); }
  }
  if (total > ATTACHMENT_LIMIT.bytes) out.push(`Attachments come to ${(total / 1048576).toFixed(1)} MB; keep them under 5 MB together.`);
  return out;
}

function check(f: Full, type: EmailType, audience: Audience, t: TemplateContent) {
  return templateProblems(t, type, audience, { hasBanner: Boolean(f.c.banner16x9Key) });
}

async function render(c: Context<AppEnv>, f: Full, type: EmailType, audience: Audience, t: TemplateContent, attachments: boolean) {
  const deps = c.get('deps');
  const values = await sampleValues(deps, f);
  const upsell = audience === 'parent' ? await sampleUpsell(deps, f) : null;
  return renderCompetitionEmail(deps, forAudience(t, audience), { type, audience, f, values, upsell }, undefined, { attachments });
}

/** All four emails (saved, or the default), what the competition has to fill the blocks, and recent sends. */
adminCompetitionEmails.get(`/${ID}/emails`, async (c) => {
  const deps = c.get('deps');
  const f = await competition(c);
  const rows = await deps.db.select().from(competitionEmailTemplates).where(eq(competitionEmailTemplates.competitionId, f.c.id));
  const items = EMAIL_KINDS.map(([type, audience]) => {
    const r = rows.find((x) => x.templateType === type && x.audience === audience);
    const t = r ? content(r) : defaultTemplate(type, audience, f.c.title);
    return {
      type, audience, template: t, updatedBy: r?.updatedBy ?? '', updatedAt: r?.updatedAt ?? null,
      bannerUrl: mediaUrl(deps, t.bannerImageKey), attachments: t.attachmentKeys.map((key) => ({ key, name: fileName(key) })),
    };
  });
  return c.json({
    items,
    competition: {
      title: f.c.title, bannerUrl: mediaUrl(deps, f.c.banner16x9Key), submissionRequired: f.c.submissionRequired,
      prizes: f.prizes.length, rules: Boolean(f.c.rulesContent.trim()), resources: f.resources.length, upsell: f.c.upsellRules.length,
    },
  });
});

/** The email filled with sample data, from the editor's unsaved content (live preview). */
adminCompetitionEmails.post(`/${ID}/emails/preview`, async (c) => {
  const f = await competition(c);
  const { type, audience, template } = await body(c, zEmail);
  const mail = await render(c, f, type, audience, template, false);
  return c.json({ subject: mail.subject, html: mail.html, problems: check(f, type, audience, template) });
});

/** Save one email. Unknown merge tags, broken links or oversized files are refused. */
adminCompetitionEmails.put(`/${ID}/emails/:type/:audience`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const type = zType.parse(c.req.param('type'));
  const audience = zAudience.parse(c.req.param('audience'));
  const t = forAudience((await body(c, z.object({ template: zTemplate }))).template, audience);
  const problems = [...check(f, type, audience, t), ...(await fileProblems(c, t))];
  if (problems.length) throw new HttpError(400, problems[0], 'invalid', { problems });
  const by = c.get('admin').email;
  const [row] = await db.insert(competitionEmailTemplates).values({ competitionId: f.c.id, templateType: type, audience, ...t, updatedBy: by })
    .onConflictDoUpdate({ target: [competitionEmailTemplates.competitionId, competitionEmailTemplates.templateType, competitionEmailTemplates.audience], set: { ...t, updatedBy: by, updatedAt: sql`now()` } })
    .returning();
  await audit(c, 'competition.email_edit', 'competition', f.c.id, { type, audience, enabled: t.enabled });
  return c.json({ template: content(row), updatedBy: row.updatedBy, updatedAt: row.updatedAt });
});

/** Back to the default wording (the banner and attachments are cleared too). */
adminCompetitionEmails.post(`/${ID}/emails/:type/:audience/reset`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const type = zType.parse(c.req.param('type'));
  const audience = zAudience.parse(c.req.param('audience'));
  const t = defaultTemplate(type, audience, f.c.title);
  const by = c.get('admin').email;
  const [row] = await db.insert(competitionEmailTemplates).values({ competitionId: f.c.id, templateType: type, audience, ...t, updatedBy: by })
    .onConflictDoUpdate({ target: [competitionEmailTemplates.competitionId, competitionEmailTemplates.templateType, competitionEmailTemplates.audience], set: { ...t, updatedBy: by, updatedAt: sql`now()` } })
    .returning();
  await audit(c, 'competition.email_reset', 'competition', f.c.id, { type, audience });
  return c.json({ template: content(row), updatedBy: row.updatedBy, updatedAt: row.updatedAt });
});

/** Send the editor's current version, with sample data, to the signed-in admin only. */
adminCompetitionEmails.post(`/${ID}/emails/test`, async (c) => {
  const deps = c.get('deps');
  const f = await competition(c);
  const { type, audience, template } = await body(c, zEmail);
  const problems = [...check(f, type, audience, template), ...(await fileProblems(c, template))];
  if (problems.length) throw new HttpError(400, problems[0], 'invalid', { problems });
  const to = c.get('admin').email;
  const mail = await render(c, f, type, audience, template, true);
  try {
    await deps.mailer.send({ to, ...mail, subject: `[Test] ${mail.subject}` });
  } catch (e) {
    throw new HttpError(502, `The email couldn’t be sent: ${(e as Error).message}`, 'mail_failed');
  }
  await audit(c, 'competition.email_test', 'competition', f.c.id, { type, audience, to });
  return c.json({ ok: true, to });
});

/** What was sent for this competition: totals and the latest 50, failures first. */
adminCompetitionEmails.get(`/${ID}/emails/log`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const inThis = eq(registrations.competitionId, f.c.id);
  const totals = await db.select({ status: notificationLog.status, n: sql<number>`count(*)::int` }).from(notificationLog)
    .innerJoin(registrations, eq(registrations.id, notificationLog.registrationId)).where(inThis).groupBy(notificationLog.status);
  const rows = await db.select({ l: notificationLog }).from(notificationLog)
    .innerJoin(registrations, eq(registrations.id, notificationLog.registrationId)).where(inThis)
    .orderBy(sql`case when ${notificationLog.status} = 'failed' then 0 else 1 end`, desc(notificationLog.createdAt)).limit(50);
  return c.json({
    totals: Object.fromEntries(totals.map((t) => [t.status, t.n])),
    items: rows.map(({ l }) => ({
      id: l.id, template: l.template, to: l.toAddress, audience: l.payload.audience ?? null, status: l.status, attempts: l.attempts,
      error: l.error, createdAt: l.createdAt, sentAt: l.sentAt,
    })),
  });
});

/** Try this competition's failed emails again now (the scheduled job also does, every 15 minutes). */
adminCompetitionEmails.post(`/${ID}/emails/retry`, async (c) => {
  const deps = c.get('deps');
  const f = await competition(c);
  const failed = await deps.db.select({ id: notificationLog.id }).from(notificationLog)
    .innerJoin(registrations, eq(registrations.id, notificationLog.registrationId))
    .where(and(eq(registrations.competitionId, f.c.id), inArray(notificationLog.status, ['failed', 'queued']))).limit(50);
  for (const r of failed) await deliver(deps, r.id, 1);
  const ids = failed.map((r) => r.id);
  const still = ids.length ? await deps.db.select({ n: sql<number>`count(*)::int` }).from(notificationLog).where(and(inArray(notificationLog.id, ids), eq(notificationLog.status, 'failed'))) : [{ n: 0 }];
  await audit(c, 'competition.email_retry', 'competition', f.c.id, { tried: ids.length, stillFailing: still[0].n });
  return c.json({ tried: ids.length, stillFailing: still[0].n });
});
