// /api/competitions — the public list and pages (no personal data, ever), what the
// signed-in family can do on each, registration, the confirmation and dashboard,
// and resource downloads. The server's clock decides every window.
import { Hono, type Context } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import {
  competitionGroups, competitionResources, competitions, products, registrations, resourceDownloads, submissions,
} from '../db/schema.js';
import { body, HttpError, notFound, rateLimit } from '../lib/http.js';
import { tagCatalog } from '../lib/cdn.js';
import { groupForClass, istDateTime, regionAllows } from '../../src/shared/competition.js';
import {
  checkPreview, competitionUrl, deadlineWithGrace, isListed, loadFull, mediaUrl, publicView, regOpen, registeredCount, statusOf, subOpen,
  type Full,
} from '../services/competitions.js';
import { notifyRegistration } from '../services/competitionEmails.js';
import { accountOf, latestConsents, shortCode, studentFor, studentsOf, type Profile } from '../services/students.js';
import { readCustomer, requireCustomer } from './account.js';

export const publicCompetitions = new Hono<AppEnv>();
export const myCompetitions = new Hono<AppEnv>();

/** The public list: published and announced. */
publicCompetitions.get('/', async (c) => {
  const deps = c.get('deps');
  const rows = await deps.db.select().from(competitions).where(eq(competitions.publishState, 'published')).orderBy(desc(competitions.registrationOpensAt));
  const listed = rows.filter((r) => isListed(r, deps.now()));
  const groups = listed.length ? await deps.db.select().from(competitionGroups).where(inArray(competitionGroups.competitionId, listed.map((r) => r.id))) : [];
  await tagCatalog();
  c.header('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60');
  return c.json({
    items: listed.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, tagline: r.tagline, type: r.type, status: statusOf(r, deps.now()),
      thumbnailUrl: mediaUrl(deps, r.thumbnail9x16Key), squareUrl: mediaUrl(deps, r.image1x1Key), bannerUrl: mediaUrl(deps, r.banner16x9Key),
      regionScope: r.regionScope, states: r.states, submissionRequired: r.submissionRequired,
      dates: { registrationOpensAt: r.registrationOpensAt, registrationClosesAt: r.registrationClosesAt, submissionOpensAt: r.submissionOpensAt, submissionClosesAt: r.submissionClosesAt, resultsAt: r.resultsAt },
      groups: groups.filter((g) => g.competitionId === r.id).sort((a, b) => a.sortOrder - b.sortOrder).map((g) => ({ id: g.id, name: g.name, classMin: g.classMin, classMax: g.classMax })),
    })),
  });
});

/** A competition the visitor may see: listed, or a draft with the admin's preview link. */
async function visible(c: Context<AppEnv>, slug: string): Promise<{ f: Full; preview: boolean }> {
  const deps = c.get('deps');
  const f = await loadFull(deps.db, { slug });
  if (!f) throw notFound('Competition not found');
  const preview = checkPreview(deps.env.ORDER_LINK_SECRET, f.c.id, c.req.query('preview'), deps.now());
  if (!preview && !isListed(f.c, deps.now())) throw notFound('Competition not found');
  return { f, preview };
}

publicCompetitions.get('/:slug{[a-z0-9-]+}', async (c) => {
  const deps = c.get('deps');
  const { f, preview } = await visible(c, c.req.param('slug'));
  const seatsLeft = f.c.seatCap ? Math.max(0, f.c.seatCap - await registeredCount(deps.db, f.c.id)) : null;
  if (!preview) { await tagCatalog(); c.header('Cache-Control', 'public, max-age=0, s-maxage=30, stale-while-revalidate=60'); }
  return c.json({ ...publicView(deps, f, deps.now(), { seatsLeft }), preview });
});

/** Why a student can't register here (or null). */
function eligibility(f: Full, p: Profile): { group: Full['groups'][number] | null; reason: string | null } {
  const group = groupForClass(f.groups, p.classGrade) ?? null;
  if (!group) {
    const classes = f.groups.length ? `${Math.min(...f.groups.map((g) => g.classMin))}–${Math.max(...f.groups.map((g) => g.classMax))}` : '';
    return { group, reason: `This competition is for Classes ${classes}. ${p.firstName} is in Class ${p.classGrade}.` };
  }
  if (!regionAllows(f.c, p.state)) return { group, reason: `This competition is only for students in some states, not ${p.firstName}’s.` };
  return { group, reason: null };
}

/** For the signed-in family: each child (or the student themselves), eligible or not, and their registration. */
publicCompetitions.get('/:slug{[a-z0-9-]+}/me', async (c) => {
  const deps = c.get('deps');
  const me = await readCustomer(c);
  const { f } = await visible(c, c.req.param('slug'));
  if (!me) return c.json({ signedIn: false });
  const a = await accountOf(deps.db, me.userId);
  const list = await studentsOf(deps.db, me.userId);
  const regs = list.length ? await deps.db.select().from(registrations)
    .where(and(eq(registrations.competitionId, f.c.id), inArray(registrations.studentProfileId, list.map((x) => x.profile.id)))) : [];
  const subs = regs.length ? await deps.db.select().from(submissions).where(inArray(submissions.registrationId, regs.map((r) => r.id))) : [];
  return c.json({
    signedIn: true,
    account: { type: a?.accountType ?? null, completed: Boolean(a?.onboardingCompletedAt) },
    students: list.map(({ profile: p, rel }) => {
      const e = eligibility(f, p);
      const reg = regs.find((r) => r.studentProfileId === p.id);
      const sub = reg ? subs.filter((s) => s.registrationId === reg.id).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] : undefined;
      return {
        id: p.id, firstName: p.firstName, classGrade: p.classGrade, relation: rel, approvalStatus: p.approvalStatus,
        group: e.group ? { id: e.group.id, name: e.group.name, formatNote: e.group.formatNote } : null, notEligible: e.reason,
        registration: reg ? { id: reg.id, status: reg.status } : null,
        submission: sub ? { id: sub.id, status: sub.status, entryCode: sub.entryCode } : null,
      };
    }),
  });
});

const zRegister = z.object({
  studentId: z.uuid(),
  answers: z.record(z.string(), z.unknown()).default({}),
  utm: z.object({ source: z.string().max(100).default(''), medium: z.string().max(100).default(''), campaign: z.string().max(150).default(''), content: z.string().max(150).default(''), term: z.string().max(150).default('') }).partial().default({}),
  ref: z.string().trim().max(20).regex(/^[A-Z0-9]*$/).default(''),
});

/** Check the answers to this competition's own questions. */
function checkAnswers(f: Full, raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const errors: Record<string, string[]> = {};
  for (const q of f.fields) {
    const v = raw[q.key];
    const empty = v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;
    if (empty) { if (q.required) errors[q.key] = ['Please answer this']; continue; }
    if (q.type === 'number') { const n = Number(v); if (!Number.isFinite(n)) errors[q.key] = ['Enter a number']; else out[q.key] = n; }
    else if (q.type === 'checkbox') out[q.key] = v === true;
    else if (q.type === 'select') { if (typeof v !== 'string' || !q.options.includes(v)) errors[q.key] = ['Choose one of the options']; else out[q.key] = v; }
    else if (q.type === 'multiselect') { const arr = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && q.options.includes(x)) : []; if (!arr.length) errors[q.key] = ['Choose at least one']; else out[q.key] = arr; }
    else { const s = String(v).trim(); if (s.length > (q.type === 'textarea' ? 3000 : 300)) errors[q.key] = ['That’s too long']; else out[q.key] = s; }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Please answer the questions marked.', 'invalid', errors);
  return out;
}

/** Register a student: one quick step, every rule checked on the server in one transaction. */
publicCompetitions.post('/:slug{[a-z0-9-]+}/register', requireCustomer, async (c) => {
  const deps = c.get('deps');
  const me = c.get('customer');
  await rateLimit(deps.db, `register:${me.userId}`, 30, 3600);
  const input = await body(c, zRegister);
  const f = await loadFull(deps.db, { slug: c.req.param('slug') });
  if (!f || !isListed(f.c, deps.now())) throw notFound('Competition not found');
  const a = await accountOf(deps.db, me.userId);
  if (!a?.accountType || !a.onboardingCompletedAt) throw new HttpError(409, 'Complete your profile first.', 'profile_needed');
  const { profile: p } = await studentFor(deps.db, me.userId, input.studentId, 'register');
  const e = eligibility(f, p);
  if (e.reason || !e.group) throw new HttpError(409, e.reason ?? 'Not eligible.', 'not_eligible');
  const answers = checkAnswers(f, input.answers);
  const howHeard = typeof answers.how_heard === 'string' ? answers.how_heard : '';
  const reg = await deps.db.transaction(async (tx) => {
    // Lock the competition so the seat limit holds even when many register at once.
    const [locked] = await tx.select().from(competitions).where(eq(competitions.id, f.c.id)).for('update');
    if (!regOpen(locked, deps.now())) throw new HttpError(409, 'Registration isn’t open right now.', 'registration_closed');
    const [dup] = await tx.select({ id: registrations.id, status: registrations.status }).from(registrations)
      .where(and(eq(registrations.competitionId, f.c.id), eq(registrations.studentProfileId, p.id)));
    if (dup) throw new HttpError(409, `${p.firstName} is already registered.`, 'already_registered', { registrationId: dup.id });
    if (locked.seatCap && await registeredCount(tx, f.c.id) >= locked.seatCap) throw new HttpError(409, 'Sorry, all places are taken.', 'full');
    const [row] = await tx.insert(registrations).values({
      competitionId: f.c.id, groupId: e.group!.id, studentProfileId: p.id, registeredByUserId: me.userId, registeredByType: a.accountType!,
      classAtRegistration: p.classGrade, customAnswers: answers, howHeard,
      utmSource: input.utm.source ?? '', utmMedium: input.utm.medium ?? '', utmCampaign: input.utm.campaign ?? '', utmContent: input.utm.content ?? '', utmTerm: input.utm.term ?? '',
      referralCode: `${shortCode(6)}${shortCode(2)}`, referredByCode: input.ref,
    }).returning();
    return row;
  });
  await notifyRegistration(deps, reg.id);
  return c.json({ registrationId: reg.id }, 201);
});

/* ---------------- The family's own registrations ---------------- */

myCompetitions.use('*', requireCustomer);

async function ownRegistration(c: Context<AppEnv>, id: string) {
  const deps = c.get('deps');
  const [reg] = await deps.db.select().from(registrations).where(eq(registrations.id, id));
  if (!reg) throw notFound('Registration not found');
  const { profile, rel } = await studentFor(deps.db, c.get('customer').userId, reg.studentProfileId, 'view').catch(() => { throw notFound('Registration not found'); });
  const f = await loadFull(deps.db, { id: reg.competitionId });
  if (!f) throw notFound('Registration not found');
  return { reg, profile, rel, f };
}

/** The confirmation page: ID, deadline, unlocked resources, referral link and book suggestion (parents only). */
myCompetitions.get('/registrations/:id{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const { reg, profile: p, rel, f } = await ownRegistration(c, c.req.param('id'));
  const group = f.groups.find((g) => g.id === reg.groupId);
  const subs = await deps.db.select().from(submissions).where(eq(submissions.registrationId, reg.id)).orderBy(desc(submissions.createdAt));
  const approved = p.approvalStatus === 'approved' && reg.status === 'registered';
  let upsell: { headline: string; url: string; title: string | null; coverUrl: string | null } | null = null;
  if (rel === 'parent') {
    const rule = f.c.upsellRules.find((u) => p.classGrade >= u.classMin && p.classGrade <= u.classMax);
    if (rule) {
      const [prod] = rule.productId ? await deps.db.select().from(products).where(and(eq(products.id, rule.productId), eq(products.status, 'active'))) : [];
      const url = prod ? `/books/${prod.slug}` : rule.url;
      if (url) upsell = { headline: rule.headline, url, title: prod?.title ?? null, coverUrl: prod?.coverPath ? deps.storage.publicUrl('covers', prod.coverPath) : null };
    }
  }
  return c.json({
    id: reg.id, status: reg.status, createdAt: reg.createdAt, relation: rel,
    student: { id: p.id, firstName: p.firstName, classGrade: reg.classAtRegistration },
    group: group ? { name: group.name, letter: group.letter, formatNote: group.formatNote, minWords: group.minWords, maxWords: group.maxWords, maxMainFiles: group.maxMainFiles } : null,
    competition: publicView(deps, f, deps.now()),
    deadline: deadlineWithGrace(f.c) && f.c.submissionClosesAt ? { at: f.c.submissionClosesAt, label: istDateTime(f.c.submissionClosesAt) } : null,
    canSubmit: approved && f.c.submissionRequired && subOpen(f.c, deps.now()),
    resources: f.resources.map((r) => ({ id: r.id, title: r.title, description: r.description, visibility: r.visibility, fileName: r.fileName, unlocked: r.visibility === 'public' || approved })),
    submissions: subs.map((s) => ({ id: s.id, entryCode: s.entryCode, status: s.status, submittedAt: s.submittedAt, title: s.title })),
    // Never for students: referral link and book suggestions are for parents.
    referralUrl: rel === 'parent' ? `${competitionUrl(deps, f.c.slug)}?ref=${reg.referralCode}` : null,
    upsell,
  });
});

/** The dashboard: every registration of the user's children (or their own). */
myCompetitions.get('/competitions', async (c) => {
  const deps = c.get('deps');
  const me = c.get('customer');
  const list = await studentsOf(deps.db, me.userId);
  if (!list.length) return c.json({ items: [] });
  const regs = await deps.db.select({ r: registrations, c: competitions, g: competitionGroups }).from(registrations)
    .innerJoin(competitions, eq(competitions.id, registrations.competitionId))
    .innerJoin(competitionGroups, eq(competitionGroups.id, registrations.groupId))
    .where(inArray(registrations.studentProfileId, list.map((x) => x.profile.id))).orderBy(desc(registrations.createdAt));
  const subs = regs.length ? await deps.db.select().from(submissions).where(inArray(submissions.registrationId, regs.map((x) => x.r.id))) : [];
  const consents = await latestConsents(deps.db, list.map((x) => x.profile.id));
  return c.json({
    items: regs.map(({ r, c: comp, g }) => {
      const s = list.find((x) => x.profile.id === r.studentProfileId)!;
      return {
        registrationId: r.id, status: r.status, createdAt: r.createdAt,
        student: { id: s.profile.id, firstName: s.profile.firstName, relation: s.rel, publication: s.rel === 'parent' ? consents.get(s.profile.id)?.publication ?? false : undefined },
        competition: {
          slug: comp.slug, title: comp.title, status: statusOf(comp, deps.now()), submissionRequired: comp.submissionRequired,
          submissionClosesAt: comp.submissionClosesAt, resultsAt: comp.resultsAt, thumbnailUrl: mediaUrl(deps, comp.image1x1Key ?? comp.banner16x9Key),
          canSubmit: s.profile.approvalStatus === 'approved' && r.status === 'registered' && subOpen(comp, deps.now()),
        },
        group: { name: g.name },
        submissions: subs.filter((x) => x.registrationId === r.id).map((x) => ({ id: x.id, entryCode: x.entryCode, status: x.status, submittedAt: x.submittedAt, hiddenFromPublic: x.hiddenFromPublic })),
      };
    }),
  });
});

/** A resource: public ones for anyone; registered-only ones need a registration (each download is counted). */
publicCompetitions.post('/resources/:id{[0-9a-f-]{36}}/link', async (c) => {
  const deps = c.get('deps');
  const [r] = await deps.db.select().from(competitionResources).where(eq(competitionResources.id, c.req.param('id')));
  if (!r) throw notFound('File not found');
  const me = await readCustomer(c);
  if (r.visibility === 'public') {
    await deps.db.insert(resourceDownloads).values({ resourceId: r.id, userId: me?.userId ?? null });
    return c.json({ url: deps.storage.publicUrl('competition-media', r.fileKey) });
  }
  if (!me) throw new HttpError(401, 'Sign in and register to download this.', 'unauthenticated');
  await rateLimit(deps.db, `resource:${me.userId}`, 120, 3600);
  const list = await studentsOf(deps.db, me.userId);
  const approvedIds = list.filter((x) => x.profile.approvalStatus === 'approved').map((x) => x.profile.id);
  const [reg] = approvedIds.length ? await deps.db.select({ id: registrations.id }).from(registrations)
    .where(and(eq(registrations.competitionId, r.competitionId), eq(registrations.status, 'registered'), inArray(registrations.studentProfileId, approvedIds))).limit(1) : [];
  if (!reg) throw new HttpError(403, 'This file is for registered students. Register first.', 'not_registered');
  await deps.db.insert(resourceDownloads).values({ resourceId: r.id, registrationId: reg.id, userId: me.userId });
  return c.json({ url: await deps.storage.signedDownloadUrl('competition-files', r.fileKey, 300, r.fileName || undefined) });
});

