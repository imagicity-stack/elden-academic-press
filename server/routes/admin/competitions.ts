// Admin: competitions (the store owner only, for now). Create, edit (all tabs in one
// save), duplicate, publish, archive, preview drafts. Every change is in the audit log.
import { Hono, type Context } from 'hono';
import { and, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import type { Tx } from '../../db/client.js';
import {
  accounts, competitionEmailTemplates, competitionFormFields, competitionGroups, competitionResources, competitions, parentApprovalRequests, prizes,
  registrations, studentProfiles,
} from '../../db/schema.js';
import { notify } from '../../services/notify.js';
import { purgeExpiredRequests, studentsOf } from '../../services/students.js';
import '../../services/studentEmails.js';
import { body, HttpError, notFound, zText } from '../../lib/http.js';
import { isStateCode } from '../../lib/states.js';
import { getCompetitionStatus, overlappingGroups } from '../../../src/shared/competition.js';
import { addDefaults, countsFor, loadFull, mediaUrl, previewToken, type Full } from '../../services/competitions.js';
import { audit } from './auth.js';

export const adminCompetitions = new Hono<AppEnv>();

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'competition';
const zKey = z.string().trim().max(300).nullable().optional().transform((v) => v || null);
const zDate = z.union([z.string().trim(), z.null()]).optional().transform((v, ctx) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) { ctx.addIssue({ code: 'custom', message: 'Enter a valid date' }); return z.NEVER; }
  return d;
});
const zInt = (min: number, max: number) => z.number().int().min(min).max(max);
const zOptInt = (min: number, max: number) => zInt(min, max).nullable().optional().transform((v) => v ?? null);
const MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'] as const;

const zCompetition = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/, 'Use lowercase letters, numbers and dashes'),
  entryCodePrefix: z.string().trim().toUpperCase().regex(/^[A-Z]{2,4}$/, '2 to 4 capital letters'),
  title: z.string().trim().min(3, 'Add a title').max(150),
  tagline: zText(200).default(''),
  type: z.enum(['comic', 'story', 'essay', 'drawing', 'poem', 'quiz', 'video', 'photo', 'live_event', 'other']),
  prompt: zText(2000).default(''),
  description: zText(20000).default(''),
  rulesContent: zText(20000).default(''),
  rulesPdfKey: zKey,
  disclaimer: zText(3000).default(''),
  thumbnail9x16Key: zKey, image1x1Key: zKey, banner16x9Key: zKey, ogImageKey: zKey,
  languages: z.array(z.string().trim().min(1).max(40)).max(12).default(['English']),
  organiserName: zText(120).default('Elden Academic Press'),
  faqs: z.array(z.object({ question: z.string().trim().min(1).max(300), answer: z.string().trim().min(1).max(3000) })).max(40).default([]),
  judges: z.array(z.object({ name: z.string().trim().min(1).max(120), role: zText(200).default(''), photoKey: zKey })).max(20).default([]),
  regionScope: z.enum(['pan_india', 'states']).default('pan_india'),
  states: z.array(z.string().refine(isStateCode, 'Unknown state')).max(40).default([]),
  participationMode: z.enum(['individual', 'team']).default('individual'),
  teamMin: zOptInt(2, 10), teamMax: zOptInt(2, 10),
  maxEntriesPerStudent: zInt(1, 10).default(1),
  isPaid: z.boolean().default(false),
  feeAmountInr: zOptInt(0, 100000),
  seatCap: zOptInt(1, 1_000_000),
  announceAt: zDate, registrationOpensAt: zDate, registrationClosesAt: zDate, submissionOpensAt: zDate, submissionClosesAt: zDate,
  submissionGraceMinutes: zInt(0, 240).default(0),
  judgingStartsAt: zDate, shortlistAt: zDate, votingOpensAt: zDate, votingClosesAt: zDate, resultsAt: zDate,
  submissionRequired: z.boolean().default(true),
  allowedSubmissionTypes: z.array(z.enum(['file', 'text', 'link'])).max(3).default(['file']),
  allowedMimeTypes: z.array(z.enum(MIME)).max(MIME.length).default(['image/jpeg', 'image/png', 'application/pdf']),
  maxFileSizeMb: zInt(1, 50).default(10),
  maxMainFiles: zInt(1, 20).default(1),
  extraFiles: z.array(z.object({
    key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'Use lowercase letters, numbers and _'), label: z.string().trim().min(1).max(120),
    helpText: zText(300).default(''), required: z.boolean().default(false),
  })).max(5).default([]),
  minWords: zOptInt(1, 100000), maxWords: zOptInt(1, 100000),
  allowEditUntilDeadline: z.boolean().default(true),
  allowWithdraw: z.boolean().default(true),
  declarationText: zText(2000).default(''),
  consentTextVersion: zText(20).default('v1'),
  termsVersion: zText(20).default('v1'),
  upsellRules: z.array(z.object({
    classMin: zInt(3, 12), classMax: zInt(3, 12), productId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
    url: z.union([z.literal(''), z.url()]).nullable().optional().transform((v) => v || null), headline: z.string().trim().min(1).max(200),
  })).max(10).default([]),
  seoTitle: zText(120).default(''),
  seoDescription: zText(300).default(''),
});

const zSave = z.object({
  competition: zCompetition,
  groups: z.array(z.object({
    id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), letter: z.string().trim().toUpperCase().regex(/^[A-Z]$/, 'One letter, A to Z'),
    classMin: zInt(3, 12), classMax: zInt(3, 12), formatNote: zText(300).default(''),
    minWords: zOptInt(1, 100000), maxWords: zOptInt(1, 100000), maxMainFiles: zOptInt(1, 20),
  })).max(10),
  fields: z.array(z.object({
    key: z.string().trim().regex(/^[a-z0-9_]{1,40}$/, 'Use lowercase letters, numbers and _'), label: z.string().trim().min(1).max(200),
    type: z.enum(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number']),
    options: z.array(z.string().trim().min(1).max(120)).max(50).default([]), required: z.boolean().default(false), helpText: zText(300).default(''),
  })).max(20),
  resources: z.array(z.object({
    id: z.string().uuid().optional(), title: z.string().trim().min(1).max(150), description: zText(500).default(''),
    fileKey: z.string().trim().min(1).max(300), fileName: zText(200).default(''), visibility: z.enum(['public', 'registered_only']),
  })).max(30),
  prizes: z.array(z.object({
    groupLetter: z.string().trim().toUpperCase().regex(/^[A-Z]?$/).default(''), rankFrom: zOptInt(1, 1000), rankTo: zOptInt(1, 1000),
    awardName: z.string().trim().min(1).max(150), description: zText(500).default(''), prizeType: z.enum(['physical', 'voucher', 'digital', 'certificate']),
  })).max(40),
});
type Save = z.infer<typeof zSave>;

/** Problems with the dates, groups and settings, in plain words. */
function problems(s: Save, publishing: boolean): string[] {
  const c = s.competition;
  const out: string[] = [];
  const before = (a: Date | null, b: Date | null, msg: string) => { if (a && b && a.getTime() >= b.getTime()) out.push(msg); };
  before(c.registrationOpensAt, c.registrationClosesAt, 'Registration must open before it closes.');
  before(c.submissionOpensAt, c.submissionClosesAt, 'Submissions must open before they close.');
  before(c.announceAt, c.registrationOpensAt && new Date(c.registrationOpensAt.getTime() + 1), 'The announcement must be on or before registration opens.');
  if (c.registrationOpensAt && c.submissionClosesAt && c.submissionClosesAt <= c.registrationOpensAt) out.push('Submissions must close after registration opens.');
  const lastWindow = c.submissionRequired ? c.submissionClosesAt ?? c.registrationClosesAt : c.registrationClosesAt;
  if (c.judgingStartsAt && lastWindow && c.judgingStartsAt < lastWindow) out.push('Judging must start after the last window closes.');
  before(c.votingOpensAt, c.votingClosesAt, 'Voting must open before it closes.');
  if (c.votingOpensAt && lastWindow && c.votingOpensAt < lastWindow) out.push('Voting must start after the last window closes.');
  if (c.resultsAt && lastWindow && c.resultsAt < lastWindow) out.push('Results must come after the last window closes.');
  if (c.minWords && c.maxWords && c.minWords > c.maxWords) out.push('Minimum words can’t be more than maximum words.');
  if (c.regionScope === 'states' && !c.states.length) out.push('Choose at least one state, or make it open to all of India.');
  for (const g of s.groups) {
    if (g.classMin > g.classMax) out.push(`${g.name}: the first class must not be above the last.`);
    if (g.minWords && g.maxWords && g.minWords > g.maxWords) out.push(`${g.name}: minimum words can’t be more than maximum words.`);
  }
  const overlap = overlappingGroups(s.groups);
  if (overlap) out.push(`${overlap[0]} and ${overlap[1]} share a class. Each class can be in only one group.`);
  if (new Set(s.groups.map((g) => g.letter)).size !== s.groups.length) out.push('Each group needs its own letter.');
  if (new Set(s.fields.map((f) => f.key)).size !== s.fields.length) out.push('Each registration question needs its own key.');
  for (const f of s.fields) if ((f.type === 'select' || f.type === 'multiselect') && !f.options.length) out.push(`“${f.label}” needs options to choose from.`);
  for (const r of c.upsellRules) if (r.classMin > r.classMax) out.push('Upsell: the first class must not be above the last.');
  for (const p of s.prizes) if (p.groupLetter && !s.groups.some((g) => g.letter === p.groupLetter)) out.push(`Prize “${p.awardName}” is for group ${p.groupLetter}, which doesn’t exist.`);
  if (c.isPaid) out.push('Paid competitions aren’t available yet: switch off “Paid”.');
  if (c.participationMode === 'team') out.push('Team entries aren’t available yet: choose Individual.');
  if (publishing) {
    if (!s.groups.length) out.push('Add at least one group (which classes can enter).');
    if (!c.registrationOpensAt || !c.registrationClosesAt) out.push('Set when registration opens and closes.');
    if (c.submissionRequired && (!c.submissionOpensAt || !c.submissionClosesAt)) out.push('Set when submissions open and close.');
    if (c.submissionRequired && !c.allowedSubmissionTypes.length) out.push('Choose how entries are submitted (file, text or link).');
    if (c.submissionRequired && c.allowedSubmissionTypes.includes('file') && !c.allowedMimeTypes.length) out.push('Choose which file types are allowed.');
  }
  return out.filter(Boolean);
}

/** The editor's data: everything, with picture links. */
async function detail(c: Context<AppEnv>, id: string) {
  const deps = c.get('deps');
  const f = await loadFull(deps.db, { id });
  if (!f) throw notFound('Competition not found');
  const templates = await deps.db.select().from(competitionEmailTemplates).where(eq(competitionEmailTemplates.competitionId, id));
  const counts = (await countsFor(deps.db, [id])).get(id)!;
  const media = (k: string | null) => (k ? { key: k, url: mediaUrl(deps, k) } : null);
  return {
    competition: { ...f.c, status: getCompetitionStatus(f.c, deps.now()) },
    media: {
      thumbnail9x16Key: media(f.c.thumbnail9x16Key), image1x1Key: media(f.c.image1x1Key), banner16x9Key: media(f.c.banner16x9Key),
      ogImageKey: media(f.c.ogImageKey), rulesPdfKey: media(f.c.rulesPdfKey),
    },
    judges: f.c.judges.map((j) => ({ ...j, photoUrl: mediaUrl(deps, j.photoKey) })),
    groups: f.groups,
    fields: f.fields,
    resources: f.resources.map((r) => ({ ...r, url: r.visibility === 'public' ? mediaUrl(deps, r.fileKey) : null })),
    prizes: f.prizes.map((p) => ({ ...p, groupLetter: f.groups.find((g) => g.id === p.groupId)?.letter ?? '' })),
    templates,
    counts,
  };
}

adminCompetitions.get('/', async (c) => {
  const { db, now } = c.get('deps');
  const rows = await db.select().from(competitions).orderBy(desc(competitions.createdAt)).limit(300);
  const counts = await countsFor(db, rows.map((r) => r.id));
  return c.json({
    items: rows.map((r) => ({
      id: r.id, slug: r.slug, title: r.title, type: r.type, publishState: r.publishState, status: getCompetitionStatus(r, now()),
      registrationOpensAt: r.registrationOpensAt, registrationClosesAt: r.registrationClosesAt, submissionOpensAt: r.submissionOpensAt,
      submissionClosesAt: r.submissionClosesAt, resultsAt: r.resultsAt, ...counts.get(r.id),
    })),
  });
});

async function uniqueSlug(c: Context<AppEnv>, wanted: string, exceptId?: string) {
  const base = slugify(wanted);
  for (let i = 0; ; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const [hit] = await c.get('deps').db.select({ id: competitions.id }).from(competitions).where(eq(competitions.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
  }
}
async function uniquePrefix(c: Context<AppEnv>, title: string) {
  const words = title.toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const tries = [words.map((w) => w[0]).join('').slice(0, 3), (words[0] ?? 'EAP').slice(0, 3)];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < 400; i++) {
    let p = tries[i] ?? `${(tries[0] || 'EA').slice(0, 2)}${letters[Math.floor(Math.random() * 26)]}${i > 200 ? letters[Math.floor(Math.random() * 26)] : ''}`;
    p = p.padEnd(2, 'X').slice(0, 4);
    if (!/^[A-Z]{2,4}$/.test(p)) continue;
    const [hit] = await c.get('deps').db.select({ id: competitions.id }).from(competitions).where(eq(competitions.entryCodePrefix, p));
    if (!hit) return p;
  }
  throw new HttpError(409, 'Couldn’t find a free entry code prefix; set one yourself.');
}

/** A new draft: just a title and type. */
adminCompetitions.post('/', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ title: z.string().trim().min(3, 'Add a title').max(150), type: zCompetition.shape.type }));
  const slug = await uniqueSlug(c, input.title);
  const entryCodePrefix = await uniquePrefix(c, input.title);
  const id = await deps.db.transaction(async (tx) => {
    const [row] = await tx.insert(competitions).values({ ...input, slug, entryCodePrefix, createdBy: c.get('admin').email }).returning({ id: competitions.id });
    await tx.insert(competitionGroups).values({ competitionId: row.id, name: 'Group A', letter: 'A', classMin: 3, classMax: 12 });
    await addDefaults(tx, row.id, input.title);
    return row.id;
  });
  await audit(c, 'competition.create', 'competition', id, { title: input.title });
  return c.json(await detail(c, id), 201);
});

adminCompetitions.get('/:id{[0-9a-f-]{36}}', async (c) => c.json(await detail(c, c.req.param('id'))));

async function save(c: Context<AppEnv>, id: string, s: Save, publishState?: 'published' | 'archived' | 'draft') {
  const deps = c.get('deps');
  const before = await loadFull(deps.db, { id });
  if (!before) throw notFound('Competition not found');
  const state = publishState ?? before.c.publishState;
  const errs = problems(s, state === 'published');
  if (errs.length) throw new HttpError(400, errs.join(' '), 'invalid_competition', { problems: errs });
  const [slugHit] = await deps.db.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.slug, s.competition.slug), ne(competitions.id, id)));
  if (slugHit) throw new HttpError(409, 'Another competition already uses this web address.', 'slug_taken');
  const [prefixHit] = await deps.db.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.entryCodePrefix, s.competition.entryCodePrefix), ne(competitions.id, id)));
  if (prefixHit) throw new HttpError(409, 'Another competition already uses this entry code prefix.', 'prefix_taken');
  // A group with registrations can't be removed, and its letter must stay (entry codes use it).
  const keptIds = s.groups.map((g) => g.id).filter(Boolean) as string[];
  const removed = before.groups.filter((g) => !keptIds.includes(g.id));
  if (removed.length) {
    const [used] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(registrations).where(inArray(registrations.groupId, removed.map((g) => g.id)));
    if (used.n > 0) throw new HttpError(409, 'A group with registrations can’t be removed. Change its classes instead.', 'group_in_use');
  }
  await deps.db.transaction(async (tx) => {
    await tx.update(competitions).set({ ...s.competition, publishState: state, updatedAt: sql`now()` }).where(eq(competitions.id, id));
    if (removed.length) await tx.delete(competitionGroups).where(inArray(competitionGroups.id, removed.map((g) => g.id)));
    const letterToId = new Map<string, string>();
    for (const [i, g] of s.groups.entries()) {
      const values = { name: g.name, letter: g.letter, classMin: g.classMin, classMax: g.classMax, formatNote: g.formatNote, minWords: g.minWords, maxWords: g.maxWords, maxMainFiles: g.maxMainFiles, sortOrder: i };
      if (g.id && before.groups.some((x) => x.id === g.id)) {
        // Letters are swapped through a placeholder so the unique (competition, letter) index never trips.
        await tx.update(competitionGroups).set({ ...values, letter: `_${i}` }).where(eq(competitionGroups.id, g.id));
        letterToId.set(g.letter, g.id);
      } else {
        const [row] = await tx.insert(competitionGroups).values({ ...values, letter: `_${i}`, competitionId: id }).returning({ id: competitionGroups.id });
        letterToId.set(g.letter, row.id);
      }
    }
    for (const [letter, gid] of letterToId) await tx.update(competitionGroups).set({ letter }).where(eq(competitionGroups.id, gid));
    await tx.delete(competitionFormFields).where(eq(competitionFormFields.competitionId, id));
    if (s.fields.length) await tx.insert(competitionFormFields).values(s.fields.map((f, i) => ({ ...f, competitionId: id, sortOrder: i })));
    const keepRes = s.resources.map((r) => r.id).filter(Boolean) as string[];
    await tx.delete(competitionResources).where(and(eq(competitionResources.competitionId, id), keepRes.length ? notInArray(competitionResources.id, keepRes) : sql`true`));
    for (const [i, r] of s.resources.entries()) {
      const values = { title: r.title, description: r.description, fileKey: r.fileKey, fileName: r.fileName, visibility: r.visibility, sortOrder: i };
      if (r.id && before.resources.some((x) => x.id === r.id)) await tx.update(competitionResources).set(values).where(eq(competitionResources.id, r.id));
      else await tx.insert(competitionResources).values({ ...values, competitionId: id });
    }
    await tx.delete(prizes).where(eq(prizes.competitionId, id));
    if (s.prizes.length) {
      await tx.insert(prizes).values(s.prizes.map((p, i) => ({
        competitionId: id, groupId: p.groupLetter ? letterToId.get(p.groupLetter) ?? null : null, rankFrom: p.rankFrom, rankTo: p.rankTo,
        awardName: p.awardName, description: p.description, prizeType: p.prizeType, sortOrder: i,
      })));
    }
  });
}

adminCompetitions.put('/:id{[0-9a-f-]{36}}', async (c) => {
  const id = c.req.param('id');
  const s = await body(c, zSave);
  await save(c, id, s);
  await audit(c, 'competition.edit', 'competition', id, { title: s.competition.title });
  return c.json(await detail(c, id));
});

/** Save and publish in one go (checks every required setting first). */
adminCompetitions.post('/:id{[0-9a-f-]{36}}/publish', async (c) => {
  const id = c.req.param('id');
  const s = await body(c, zSave);
  await save(c, id, s, 'published');
  await audit(c, 'competition.publish', 'competition', id, { title: s.competition.title });
  return c.json(await detail(c, id));
});

adminCompetitions.post('/:id{[0-9a-f-]{36}}/state', async (c) => {
  const deps = c.get('deps');
  const id = c.req.param('id');
  const { state } = await body(c, z.object({ state: z.enum(['draft', 'archived']) }));
  const [row] = await deps.db.update(competitions).set({ publishState: state, updatedAt: sql`now()` }).where(eq(competitions.id, id)).returning({ title: competitions.title });
  if (!row) throw notFound('Competition not found');
  await audit(c, state === 'archived' ? 'competition.archive' : 'competition.unpublish', 'competition', id, { title: row.title });
  return c.json(await detail(c, id));
});

adminCompetitions.post('/:id{[0-9a-f-]{36}}/results', async (c) => {
  const deps = c.get('deps');
  const id = c.req.param('id');
  const { published } = await body(c, z.object({ published: z.boolean() }));
  await deps.db.update(competitions).set({ resultsPublished: published, updatedAt: sql`now()` }).where(eq(competitions.id, id));
  await audit(c, published ? 'competition.results_publish' : 'competition.results_hide', 'competition', id);
  return c.json(await detail(c, id));
});

/** A copy with everything but the dates: groups, questions, prizes, resources and emails. */
adminCompetitions.post('/:id{[0-9a-f-]{36}}/duplicate', async (c) => {
  const deps = c.get('deps');
  const f = await loadFull(deps.db, { id: c.req.param('id') });
  if (!f) throw notFound('Competition not found');
  const title = `${f.c.title} (copy)`;
  const slug = await uniqueSlug(c, `${f.c.slug}-copy`);
  const entryCodePrefix = await uniquePrefix(c, title);
  const newId = await deps.db.transaction(async (tx) => copy(tx, f, { title, slug, entryCodePrefix, createdBy: c.get('admin').email }));
  await audit(c, 'competition.duplicate', 'competition', newId, { from: f.c.id, title });
  return c.json(await detail(c, newId), 201);
});

async function copy(tx: Tx, f: Full, o: { title: string; slug: string; entryCodePrefix: string; createdBy: string }) {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = f.c;
  const [row] = await tx.insert(competitions).values({
    ...rest, ...o, publishState: 'draft', resultsPublished: false,
    announceAt: null, registrationOpensAt: null, registrationClosesAt: null, submissionOpensAt: null, submissionClosesAt: null,
    judgingStartsAt: null, shortlistAt: null, votingOpensAt: null, votingClosesAt: null, resultsAt: null,
  }).returning({ id: competitions.id });
  const groupMap = new Map<string, string>();
  for (const g of f.groups) {
    const { id: gid, competitionId: _cid, nextEntryNo: _n, ...gv } = g;
    const [ng] = await tx.insert(competitionGroups).values({ ...gv, competitionId: row.id }).returning({ id: competitionGroups.id });
    groupMap.set(gid, ng.id);
  }
  if (f.fields.length) await tx.insert(competitionFormFields).values(f.fields.map(({ id: _i, competitionId: _c2, ...x }) => ({ ...x, competitionId: row.id })));
  if (f.resources.length) await tx.insert(competitionResources).values(f.resources.map(({ id: _i, competitionId: _c2, ...x }) => ({ ...x, competitionId: row.id })));
  if (f.prizes.length) await tx.insert(prizes).values(f.prizes.map(({ id: _i, competitionId: _c2, groupId, ...x }) => ({ ...x, groupId: groupId ? groupMap.get(groupId) ?? null : null, competitionId: row.id })));
  const templates = await tx.select().from(competitionEmailTemplates).where(eq(competitionEmailTemplates.competitionId, f.c.id));
  if (templates.length) await tx.insert(competitionEmailTemplates).values(templates.map(({ id: _i, competitionId: _c2, updatedAt: _u2, ...x }) => ({ ...x, competitionId: row.id })));
  return row.id;
}

/** Drafts nobody registered for can be deleted. */
adminCompetitions.delete('/:id{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const id = c.req.param('id');
  const [row] = await deps.db.select().from(competitions).where(eq(competitions.id, id));
  if (!row) throw notFound('Competition not found');
  const [{ n }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(registrations).where(eq(registrations.competitionId, id));
  if (row.publishState !== 'draft' || n > 0) throw new HttpError(409, 'Only drafts with no registrations can be deleted. Archive it instead.', 'locked');
  await deps.db.delete(competitions).where(eq(competitions.id, id));
  await audit(c, 'competition.delete', 'competition', id, { title: row.title });
  return c.json({ ok: true });
});

/** A link that shows the page as it will look, even as a draft (6 hours). */
adminCompetitions.post('/:id{[0-9a-f-]{36}}/preview', async (c) => {
  const deps = c.get('deps');
  const id = c.req.param('id');
  const [row] = await deps.db.select({ slug: competitions.slug }).from(competitions).where(eq(competitions.id, id));
  if (!row) throw notFound('Competition not found');
  const { as } = await body(c, z.object({ as: z.enum(['parent', 'student']).default('parent') }));
  return c.json({ url: `/competitions/${row.slug}?preview=${previewToken(deps.env.ORDER_LINK_SECRET, id, deps.now())}&as=${as}` });
});

/* ---------------- Student accounts ---------------- */

/** Students waiting for a parent, oldest first, with how long they've waited. */
adminCompetitions.get('/accounts/pending', async (c) => {
  const { db, now } = c.get('deps');
  const rows = await db.select({ r: parentApprovalRequests, p: studentProfiles }).from(parentApprovalRequests)
    .innerJoin(studentProfiles, eq(studentProfiles.id, parentApprovalRequests.studentProfileId))
    .where(and(eq(parentApprovalRequests.status, 'pending'), eq(studentProfiles.approvalStatus, 'pending')))
    .orderBy(parentApprovalRequests.createdAt).limit(500);
  return c.json({
    items: rows.map(({ r, p }) => ({
      id: r.id, studentFirstName: p.firstName, classGrade: p.classGrade, schoolName: p.schoolName, city: p.city,
      parentEmail: r.parentEmail, parentWhatsapp: r.parentWhatsapp, createdAt: p.createdAt, linkExpiresAt: r.expiresAt,
      ageDays: Math.floor((now().getTime() - p.createdAt.getTime()) / 86400_000), linkExpired: r.expiresAt < now(),
    })),
  });
});

/** The same clean-up the scheduled job does: requests nobody approved in 14 days. */
adminCompetitions.post('/accounts/purge', async (c) => {
  const deps = c.get('deps');
  const r = await purgeExpiredRequests(deps);
  await notify(deps, r.emails.map((e) => ({ template: 'request_expired', to: e.to, userId: e.userId, payload: { firstName: e.firstName } })));
  await audit(c, 'competition.purge_requests', 'student', null, { purged: r.purged });
  return c.json({ purged: r.purged });
});

/** Find an account by email (to change its type). */
adminCompetitions.get('/accounts/find', async (c) => {
  const { db } = c.get('deps');
  const email = (c.req.query('email') ?? '').trim().toLowerCase();
  if (!email) return c.json({ account: null });
  const [a] = await db.select().from(accounts).where(eq(accounts.email, email));
  if (!a) return c.json({ account: null });
  const list = await studentsOf(db, a.userId);
  return c.json({
    account: { userId: a.userId, email: a.email, name: a.name, type: a.accountType, locked: Boolean(a.typeLockedAt), completed: Boolean(a.onboardingCompletedAt) },
    students: list.map(({ profile: p, rel }) => ({ id: p.id, firstName: p.firstName, classGrade: p.classGrade, approvalStatus: p.approvalStatus, relation: rel })),
  });
});

/** Only an admin can change a linked account's type, with a reason (audit-logged). */
adminCompetitions.post('/accounts/type', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ userId: z.uuid(), type: z.enum(['parent', 'student', 'none']), reason: z.string().trim().min(5, 'Give a reason').max(500) }));
  const [before] = await db.select().from(accounts).where(eq(accounts.userId, input.userId));
  if (!before) throw notFound('Account not found');
  const type = input.type === 'none' ? null : input.type;
  await db.update(accounts).set({ accountType: type, typeLockedAt: null, onboardingCompletedAt: type ? before.onboardingCompletedAt : null, updatedAt: sql`now()` })
    .where(eq(accounts.userId, input.userId));
  await audit(c, 'account.type_change', 'account', input.userId, { email: before.email, from: before.accountType, to: type, reason: input.reason });
  return c.json({ ok: true });
});
