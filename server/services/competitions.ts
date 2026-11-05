// Competitions: loading one with its groups, questions, resources and prizes; the
// public view (never any personal data); preview links for drafts; defaults.
import { createHmac } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import type { Q } from '../db/client.js';
import {
  competitionEmailTemplates, competitionFormFields, competitionGroups, competitionResources, competitions, prizes, registrations, submissions,
} from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { getCompetitionStatus, isPublic, registrationOpen, submissionOpen } from '../../src/shared/competition.js';
import { defaultTemplate, EMAIL_KINDS } from '../../src/shared/competitionEmail.js';
import { DEFAULT_DECLARATION } from '../../src/shared/consents.js';

export type Competition = typeof competitions.$inferSelect;
export type Group = typeof competitionGroups.$inferSelect;
export type FormField = typeof competitionFormFields.$inferSelect;
export type Resource = typeof competitionResources.$inferSelect;
export type Prize = typeof prizes.$inferSelect;
export interface Full { c: Competition; groups: Group[]; fields: FormField[]; resources: Resource[]; prizes: Prize[] }

export async function loadFull(db: Q, where: { id?: string; slug?: string }): Promise<Full | null> {
  const [c] = await db.select().from(competitions).where(where.id ? eq(competitions.id, where.id) : eq(competitions.slug, where.slug ?? ''));
  if (!c) return null;
  const [groups, fields, resources, prz] = await Promise.all([
    db.select().from(competitionGroups).where(eq(competitionGroups.competitionId, c.id)).orderBy(asc(competitionGroups.sortOrder), asc(competitionGroups.letter)),
    db.select().from(competitionFormFields).where(eq(competitionFormFields.competitionId, c.id)).orderBy(asc(competitionFormFields.sortOrder)),
    db.select().from(competitionResources).where(eq(competitionResources.competitionId, c.id)).orderBy(asc(competitionResources.sortOrder)),
    db.select().from(prizes).where(eq(prizes.competitionId, c.id)).orderBy(asc(prizes.sortOrder)),
  ]);
  return { c, groups, fields, resources, prizes: prz };
}

export const mediaUrl = (deps: Deps, key: string | null | undefined) => (key ? deps.storage.publicUrl('competition-media', key) : null);
export const competitionUrl = (deps: Deps, slug: string) => `${deps.env.SITE_URL.replace(/\/$/, '')}/competitions/${slug}`;

/** The submission deadline for one group (same for all in Phase 1), with grace minutes. */
export const deadlineWithGrace = (c: Competition) =>
  c.submissionClosesAt ? new Date(c.submissionClosesAt.getTime() + c.submissionGraceMinutes * 60_000) : null;

export function statusOf(c: Competition, now: Date) { return getCompetitionStatus(c, now); }
export const regOpen = (c: Competition, now: Date) => registrationOpen(c, now);
export const subOpen = (c: Competition, now: Date) => submissionOpen(c, now);

/** Registration counts, for seat caps and the admin. */
export async function registeredCount(db: Q, competitionId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(registrations)
    .where(and(eq(registrations.competitionId, competitionId), eq(registrations.status, 'registered')));
  return n;
}

/** Everything a visitor may see. No names, schools or contact details of anyone. */
export function publicView(deps: Deps, f: Full, now: Date, opts: { seatsLeft?: number | null } = {}) {
  const { c } = f;
  return {
    id: c.id, slug: c.slug, title: c.title, tagline: c.tagline, type: c.type, prompt: c.prompt, description: c.description,
    rulesContent: c.rulesContent, rulesPdfUrl: mediaUrl(deps, c.rulesPdfKey), disclaimer: c.disclaimer,
    thumbnailUrl: mediaUrl(deps, c.thumbnail9x16Key), squareUrl: mediaUrl(deps, c.image1x1Key), bannerUrl: mediaUrl(deps, c.banner16x9Key),
    languages: c.languages, organiserName: c.organiserName, faqs: c.faqs,
    judges: c.judges.map((j) => ({ name: j.name, role: j.role, photoUrl: mediaUrl(deps, j.photoKey) })),
    regionScope: c.regionScope, states: c.states, maxEntriesPerStudent: c.maxEntriesPerStudent, isPaid: c.isPaid, seatCap: c.seatCap,
    seatsLeft: opts.seatsLeft ?? null,
    dates: {
      announceAt: c.announceAt, registrationOpensAt: c.registrationOpensAt, registrationClosesAt: c.registrationClosesAt,
      submissionOpensAt: c.submissionOpensAt, submissionClosesAt: c.submissionClosesAt, submissionGraceMinutes: c.submissionGraceMinutes,
      judgingStartsAt: c.judgingStartsAt, shortlistAt: c.shortlistAt, votingOpensAt: c.votingOpensAt, votingClosesAt: c.votingClosesAt, resultsAt: c.resultsAt,
    },
    publishState: c.publishState, resultsPublished: c.resultsPublished, submissionRequired: c.submissionRequired,
    submission: {
      types: c.allowedSubmissionTypes, mimeTypes: c.allowedMimeTypes, maxFileSizeMb: c.maxFileSizeMb, maxMainFiles: c.maxMainFiles,
      extraFiles: c.extraFiles, minWords: c.minWords, maxWords: c.maxWords, allowEditUntilDeadline: c.allowEditUntilDeadline, allowWithdraw: c.allowWithdraw,
      declarationText: c.declarationText || DEFAULT_DECLARATION,
    },
    status: getCompetitionStatus(c, now),
    groups: f.groups.map((g) => ({ id: g.id, name: g.name, letter: g.letter, classMin: g.classMin, classMax: g.classMax, formatNote: g.formatNote, minWords: g.minWords, maxWords: g.maxWords, maxMainFiles: g.maxMainFiles })),
    fields: f.fields.map((x) => ({ key: x.key, label: x.label, type: x.type, options: x.options, required: x.required, helpText: x.helpText })),
    resources: f.resources.map((r) => ({ id: r.id, title: r.title, description: r.description, visibility: r.visibility, fileName: r.fileName })),
    prizes: f.prizes.map((p) => ({ groupId: p.groupId, rankFrom: p.rankFrom, rankTo: p.rankTo, awardName: p.awardName, description: p.description, prizeType: p.prizeType })),
    seo: { title: c.seoTitle || c.title, description: c.seoDescription || c.tagline || c.prompt.slice(0, 160), imageUrl: mediaUrl(deps, c.ogImageKey ?? c.banner16x9Key) },
  };
}
export type PublicCompetition = ReturnType<typeof publicView>;

export const isListed = (c: Competition, now: Date) => isPublic(getCompetitionStatus(c, now));

/* ---------------- Preview links for drafts (admin only) ---------------- */

export function previewToken(secret: string, id: string, now: Date, hours = 6) {
  const exp = String(now.getTime() + hours * 3600_000);
  return `${exp}.${createHmac('sha256', secret).update(`preview:${id}:${exp}`).digest('base64url')}`;
}
export function checkPreview(secret: string, id: string, token: string | undefined, now: Date) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < now.getTime()) return false;
  return safeEqual(createHmac('sha256', secret).update(`preview:${id}:${exp}`).digest('base64url'), sig);
}

/* ---------------- Defaults ---------------- */

export const HOW_HEARD_OPTIONS = ['School or teacher', 'WhatsApp', 'Instagram', 'Facebook', 'YouTube', 'Friend or family', 'Newspaper', 'Elden book or website', 'Other'];

/** A new competition starts with the "How did you hear about us?" question and the default emails. */
export async function addDefaults(db: Q, competitionId: string, title: string) {
  await db.insert(competitionFormFields).values({ competitionId, key: 'how_heard', label: 'How did you hear about us?', type: 'select', options: HOW_HEARD_OPTIONS, required: false, sortOrder: 0 });
  await db.insert(competitionEmailTemplates).values(EMAIL_KINDS.map(([templateType, audience]) => ({ competitionId, templateType, audience, ...defaultTemplate(templateType, audience, title) })));
}

/** Entry/submission numbers for the admin list. */
export async function countsFor(db: Q, ids: string[]) {
  const out = new Map<string, { registrations: number; submissions: number }>();
  if (!ids.length) return out;
  const regs = await db.select({ id: registrations.competitionId, n: sql<number>`count(*)::int` }).from(registrations)
    .where(and(inArray(registrations.competitionId, ids), eq(registrations.status, 'registered'))).groupBy(registrations.competitionId);
  const subs = await db.select({ id: registrations.competitionId, n: sql<number>`count(*)::int` }).from(submissions)
    .innerJoin(registrations, eq(registrations.id, submissions.registrationId))
    .where(and(inArray(registrations.competitionId, ids), eq(submissions.status, 'submitted'))).groupBy(registrations.competitionId);
  for (const id of ids) out.set(id, { registrations: regs.find((r) => r.id === id)?.n ?? 0, submissions: subs.find((r) => r.id === id)?.n ?? 0 });
  return out;
}
