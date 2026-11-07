// Team competitions for signed-in people: register a team (the whole team in one form,
// with an ID document for each member and a parent's consent for anyone under 18), see its
// status, make changes the organiser asks for, and, once approved, upload the comic and the
// rough sketches until the deadline. Only the person who registered (and the team captain)
// can change or upload; any member whose email is on the team can see it.
import { randomUUID } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { accounts, competitionNotices, teamApplications, teamFiles, teamMembers } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit } from '../lib/http.js';
import { isImage, pdfPageCount, sniff, stripImageMetadata } from '../lib/fileCheck.js';
import { isStateCode, stateName } from '../lib/states.js';
import { ageOn, checkTeam, RESULT_TEXT, STATUS_TEXT, type TeamInput } from '../../src/shared/teams.js';
import {
  assertOpen, canUpload, code, datesOf, ID_TYPES, loadApplication, mediaUrl, membersOf, noticeReaches, registrationState, requireAccess,
  sendTeamEmail, sendTeamStaffAlert, settingsFor, teamCompetition, type App, type Member, type TeamComp, type TeamFile, type TeamSettings,
} from '../services/teams.js';
import { briefFor } from '../services/briefs.js';
import { profileOf, requireCustomer } from './account.js';

export const teams = new Hono<AppEnv>();
teams.use('/:slug/team', requireCustomer);
teams.use('/:slug/team/*', requireCustomer);

const ID_MAX = 10 * 1024 * 1024;
const zMember = z.object({
  fullName: z.string().max(200).default(''), dob: z.string().max(20).default(''), email: z.string().max(200).default(''), phone: z.string().max(30).default(''),
  institutionName: z.string().max(200).default(''), roles: z.array(z.string().max(20)).max(6).default([]), instagram: z.string().max(60).default(''),
  idDocType: z.string().max(40).default(''), idDocKey: z.string().max(300).default(''),
  guardianName: z.string().max(200).default(''), guardianRelation: z.string().max(60).default(''), guardianPhone: z.string().max(30).default(''),
  guardianEmail: z.string().max(200).default(''), guardianConsent: z.boolean().default(false),
});
const zTeam = z.object({
  teamName: z.string().max(200).default(''), institutionType: z.string().max(20).default(''), institutionName: z.string().max(200).default(''),
  city: z.string().max(100).default(''), state: z.string().max(4).default(''), members: z.array(zMember).max(8).default([]),
  acceptRules: z.boolean().default(false), confirmTrue: z.boolean().default(false),
});

const idPrefix = (slug: string, userId: string) => `teams/${slug}/ids/${userId}/`;
const filePrefix = (slug: string, appId: string) => `teams/${slug}/${appId}/`;
const nameKey = (name: string, dob: string) => `${name.toLowerCase().replace(/\s+/g, ' ').trim()}|${dob}`;

/** The team as its own people see it. Contact, guardian and ID details only for the person who registered. */
function view(c: TeamComp, s: TeamSettings, x: { app: App; members: Member[]; files: TeamFile[] }, me: { userId: string; email: string }, now: Date) {
  const { app, members, files } = x;
  const own = app.userId === me.userId;
  const d = datesOf(c, s);
  const reg = registrationState(c, s, now);
  const beforeDeadline = now <= new Date(d.submissionDeadline);
  const current = files.filter((f) => !f.replacedAt);
  return {
    id: app.id, code: code(c, app), teamName: app.teamName, institutionType: app.institutionType, institutionName: app.institutionName,
    city: app.city, state: app.state, stateName: stateName(app.state), category: app.category,
    categoryLabel: c.team.groups.find((g) => g.key === app.category)?.label ?? app.category,
    status: app.status, statusText: STATUS_TEXT[app.status] ?? app.status, reviewNote: app.status === 'approved' && !app.reviewNote ? '' : app.reviewNote,
    // Results show once the organiser publishes them; a shortlist place shows as soon as it's set.
    result: app.result && (s.resultsPublished || app.result === 'shortlisted') ? RESULT_TEXT[app.result] ?? app.result : '',
    createdAt: app.createdAt, updatedAt: app.updatedAt, reviewedAt: app.reviewedAt, own,
    canEdit: own && ['pending', 'changes_requested'].includes(app.status) && reg.open,
    canWithdraw: own && ['pending', 'changes_requested', 'approved'].includes(app.status) && beforeDeadline,
    canUpload: app.status === 'approved' && canUpload(app, members, me) && beforeDeadline,
    members: members.map((m) => ({
      fullName: m.fullName, roles: m.roles, institutionName: m.institutionName, age: ageOn(m.dob, c.team.ageOn), captain: m.position === 0,
      ...(own ? {
        dob: m.dob, email: m.email, phone: m.phone, instagram: m.instagram, idDocType: m.idDocType, idDocKey: m.idDocKey ?? '', idDocOnFile: Boolean(m.idDocKey),
        guardianName: m.guardianName, guardianRelation: m.guardianRelation, guardianPhone: m.guardianPhone, guardianEmail: m.guardianEmail,
        guardianConsent: Boolean(m.guardianConsentAt),
      } : {}),
    })),
    files: c.team.files.map((spec) => ({
      ...spec,
      current: current.filter((f) => f.kind === spec.kind).map((f) => ({ id: f.id, name: f.originalName, size: f.sizeBytes, pages: f.pages, uploadedAt: f.uploadedAt }))[0] ?? null,
      history: files.filter((f) => f.kind === spec.kind).map((f) => ({ name: f.originalName, size: f.sizeBytes, pages: f.pages, uploadedAt: f.uploadedAt, replacedAt: f.replacedAt })).reverse(),
    })),
  };
}

/** This account's teams for a competition, with the notices meant for them. */
teams.get('/:slug/team', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const comp = teamCompetition(c.req.param('slug'));
  const me = c.get('customer');
  const s = await settingsFor(db, comp.slug);
  const byMember = await db.selectDistinct({ id: teamMembers.applicationId }).from(teamMembers).where(eq(teamMembers.email, me.email.toLowerCase()));
  const apps = await db.select().from(teamApplications).where(and(eq(teamApplications.competitionSlug, comp.slug),
    or(eq(teamApplications.userId, me.userId), byMember.length ? inArray(teamApplications.id, byMember.map((x) => x.id)) : sql`false`)))
    .orderBy(desc(teamApplications.createdAt));
  const notices = await db.select().from(competitionNotices).where(eq(competitionNotices.competitionSlug, comp.slug)).orderBy(desc(competitionNotices.createdAt)).limit(100);
  const out = [];
  for (const a of apps) {
    const x = (await loadApplication(db, a.id))!;
    out.push({
      ...view(comp, s, x, me, now()),
      notices: notices.filter((n) => !n.audience.public && noticeReaches(n.audience, a)).map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt })),
    });
  }
  const [acct] = await db.select().from(accounts).where(eq(accounts.userId, me.userId));
  // The story brief and the official PDFs (which name it) only for an approved team.
  const approved = apps.some((a) => a.status === 'approved');
  return c.json({
    applications: out,
    registration: registrationState(comp, s, now()),
    dates: datesOf(comp, s),
    profile: acct ? profileOf(acct, now()) : null,
    brief: approved ? briefFor(comp.slug) : null,
    rulesDocUrl: approved ? mediaUrl(deps, s.rulesDocKey) : null,
    topicDocUrl: approved ? mediaUrl(deps, s.topicDocKey) : null,
  });
});

/** A one-time link to upload a member's ID document (JPG, PNG or PDF, up to 10 MB), privately. */
teams.post('/:slug/team/id-upload', async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const me = c.get('customer');
  await rateLimit(deps.db, `teamid:${me.userId}`, 60, 3600);
  const input = await body(c, z.object({ contentType: z.string().max(100), size: z.number().int().positive() }));
  if (!ID_TYPES.includes(input.contentType)) throw new HttpError(400, 'Upload a photo (JPG or PNG) or a PDF of the ID.', 'bad_type');
  if (input.size > ID_MAX) throw new HttpError(400, 'The ID file is too big. The limit is 10 MB.', 'too_big');
  const ext = input.contentType === 'application/pdf' ? 'pdf' : input.contentType === 'image/png' ? 'png' : 'jpg';
  const key = `${idPrefix(comp.slug, me.userId)}${randomUUID()}.${ext}`;
  const upload = await deps.storage.signedUploadUrl('competition-entries', key);
  return c.json({ key, url: upload.url }, 201);
});

/** Check every member's ID file: really a picture or PDF, not too big; photo metadata (location) removed. */
async function checkIds(c: Context<AppEnv>, slug: string, members: TeamInput['members'], keep: Set<string>) {
  const deps = c.get('deps');
  const me = c.get('customer');
  for (const [i, m] of members.entries()) {
    if (keep.has(m.idDocKey)) continue;
    const who = i === 0 ? 'Team captain' : `Member ${i + 1}`;
    if (!m.idDocKey.startsWith(idPrefix(slug, me.userId)) || m.idDocKey.includes('..')) throw new HttpError(400, `${who}: upload their ID document again.`, 'bad_id');
    let bytes: Uint8Array;
    try { bytes = await deps.storage.read('competition-entries', m.idDocKey); } catch { throw new HttpError(400, `${who}: the ID upload didn’t arrive. Please upload it again.`, 'bad_id'); }
    const kind = sniff(bytes);
    if (!kind || !ID_TYPES.includes(kind) || bytes.length > ID_MAX) {
      await deps.storage.remove('competition-entries', m.idDocKey).catch(() => {});
      throw new HttpError(400, `${who}: the ID file must be a JPG, PNG or PDF up to 10 MB.`, 'bad_id');
    }
    if (isImage(kind)) {
      try {
        const clean = stripImageMetadata(bytes, kind);
        if (clean.length !== bytes.length) await deps.storage.write('competition-entries', m.idDocKey, clean, kind);
      } catch { throw new HttpError(400, `${who}: the ID photo looks damaged. Please upload it again.`, 'bad_id'); }
    }
  }
}

/** The same person can't be on two teams: name and date of birth, or email, already on another live team. */
async function checkDuplicates(c: Context<AppEnv>, slug: string, members: TeamInput['members'], exceptId?: string) {
  const { db } = c.get('deps');
  const others = await db.select({ m: teamMembers }).from(teamMembers).innerJoin(teamApplications, eq(teamApplications.id, teamMembers.applicationId))
    .where(and(eq(teamApplications.competitionSlug, slug), notInArray(teamApplications.status, ['rejected', 'withdrawn']),
      exceptId ? sql`${teamApplications.id} <> ${exceptId}` : sql`true`));
  const names = new Set(others.map(({ m }) => nameKey(m.fullName, m.dob)));
  const emails = new Set(others.map(({ m }) => m.email).filter(Boolean));
  for (const m of members) {
    if (names.has(nameKey(m.fullName, m.dob)) || (m.email && emails.has(m.email))) {
      throw new HttpError(409, `${m.fullName} is already on another team. A person can be on only one team.`, 'duplicate');
    }
  }
}

function validate(comp: TeamComp, input: TeamInput) {
  const checked = checkTeam(comp.team, input);
  if (checked.team.state && !isStateCode(checked.team.state)) checked.errors.push('Choose the team’s state.');
  if (checked.errors.length) throw new HttpError(400, checked.errors[0], 'invalid', { problems: checked.errors });
  if (!checked.group) throw new HttpError(400, 'Check the dates of birth.', 'invalid');
  return checked;
}

const memberRows = (appId: string, input: TeamInput, at: Date) => input.members.map((m, i) => ({
  applicationId: appId, position: i, fullName: m.fullName, dob: m.dob, email: m.email, phone: m.phone, institutionName: m.institutionName,
  roles: m.roles, instagram: m.instagram, idDocType: m.idDocType, idDocKey: m.idDocKey,
  guardianName: m.guardianName, guardianRelation: m.guardianRelation, guardianPhone: m.guardianPhone, guardianEmail: m.guardianEmail,
  guardianConsentAt: m.guardianConsent && m.guardianName ? at : null,
}));

/** Register a team. Its status is "Pending verification" until the organiser checks it. */
teams.post('/:slug/team', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const comp = teamCompetition(c.req.param('slug'));
  const me = c.get('customer');
  await rateLimit(db, `teamreg:${me.userId}`, 20, 3600);
  const s = await settingsFor(db, comp.slug);
  assertOpen(registrationState(comp, s, now()));
  const [acct] = await db.select().from(accounts).where(eq(accounts.userId, me.userId));
  if (!acct || !profileOf(acct, now()).completed) throw new HttpError(409, 'Please complete your profile first.', 'profile_incomplete');
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(teamApplications)
    .where(and(eq(teamApplications.competitionSlug, comp.slug), eq(teamApplications.userId, me.userId), notInArray(teamApplications.status, ['rejected', 'withdrawn'])));
  if (n >= (comp.maxPerAccount ?? 10)) throw new HttpError(409, `One account can register up to ${comp.maxPerAccount ?? 10} teams.`, 'limit');
  const checked = validate(comp, await body(c, zTeam) as TeamInput);
  await checkDuplicates(c, comp.slug, checked.team.members);
  await checkIds(c, comp.slug, checked.team.members, new Set());
  const at = now();
  const app = await db.transaction(async (tx) => {
    const [row] = await tx.insert(teamApplications).values({
      competitionSlug: comp.slug, userId: me.userId, email: me.email.toLowerCase(), teamName: checked.team.teamName,
      institutionType: checked.team.institutionType, institutionName: checked.team.institutionName, city: checked.team.city, state: checked.team.state,
      category: checked.group!.key, acceptedTermsAt: at,
    }).returning();
    await tx.insert(teamMembers).values(memberRows(row.id, checked.team, at));
    return row;
  });
  const x = (await loadApplication(db, app.id))!;
  const mail = Promise.all([sendTeamEmail(deps, comp, x.app, x.members, 'received'), sendTeamStaffAlert(deps, comp, x.app, x.members, 'new')]);
  if (deps.defer) deps.defer(mail); else await mail;
  return c.json({ application: view(comp, s, x, me, now()) }, 201);
});

/** Change the application while it's waiting (or when the organiser asked for changes); it goes back for checking. */
teams.put('/:slug/team/:id{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const comp = teamCompetition(c.req.param('slug'));
  const me = c.get('customer');
  const x = requireAccess(await loadApplication(db, c.req.param('id')), me);
  if (x.app.competitionSlug !== comp.slug || x.app.userId !== me.userId) throw notFound('Team not found');
  if (!['pending', 'changes_requested'].includes(x.app.status)) throw new HttpError(409, 'This application can’t be changed now.', 'locked');
  const s = await settingsFor(db, comp.slug);
  assertOpen(registrationState(comp, s, now()));
  const checked = validate(comp, await body(c, zTeam) as TeamInput);
  await checkDuplicates(c, comp.slug, checked.team.members, x.app.id);
  const existing = new Set(x.members.map((m) => m.idDocKey).filter((k): k is string => Boolean(k)));
  await checkIds(c, comp.slug, checked.team.members, existing);
  const at = now();
  await db.transaction(async (tx) => {
    await tx.update(teamApplications).set({
      teamName: checked.team.teamName, institutionType: checked.team.institutionType, institutionName: checked.team.institutionName,
      city: checked.team.city, state: checked.team.state, category: checked.group!.key, status: 'pending', acceptedTermsAt: at, updatedAt: at,
    }).where(eq(teamApplications.id, x.app.id));
    await tx.delete(teamMembers).where(eq(teamMembers.applicationId, x.app.id));
    await tx.insert(teamMembers).values(memberRows(x.app.id, checked.team, at));
  });
  // ID files no longer used by any member are removed.
  const kept = new Set(checked.team.members.map((m) => m.idDocKey));
  for (const k of existing) if (!kept.has(k)) await deps.storage.remove('competition-entries', k).catch(() => {});
  const y = (await loadApplication(db, x.app.id))!;
  // The organiser hears about it only when it comes back after "Request changes" (a pending one is already in the queue).
  const mail = Promise.all([sendTeamEmail(deps, comp, y.app, y.members, 'updated'),
    x.app.status === 'changes_requested' ? sendTeamStaffAlert(deps, comp, y.app, y.members, 'resubmitted') : null]);
  if (deps.defer) deps.defer(mail); else await mail;
  return c.json({ application: view(comp, s, y, me, now()) });
});

/** Withdraw the team (the person who registered). Its ID documents are deleted. */
teams.post('/:slug/team/:id{[0-9a-f-]{36}}/withdraw', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const comp = teamCompetition(c.req.param('slug'));
  const me = c.get('customer');
  const x = requireAccess(await loadApplication(db, c.req.param('id')), me);
  if (x.app.competitionSlug !== comp.slug || x.app.userId !== me.userId) throw notFound('Team not found');
  if (['rejected', 'withdrawn'].includes(x.app.status)) throw new HttpError(409, 'This team is no longer in the competition.', 'locked');
  await db.update(teamApplications).set({ status: 'withdrawn', updatedAt: now() }).where(eq(teamApplications.id, x.app.id));
  await deleteIdDocs(c, x.members);
  return c.json({ ok: true });
});

export async function deleteIdDocs(c: Context<AppEnv>, members: Member[]) {
  const { db, storage, now } = c.get('deps');
  for (const m of members) {
    if (!m.idDocKey) continue;
    await storage.remove('competition-entries', m.idDocKey).catch(() => {});
    await db.update(teamMembers).set({ idDocKey: null, idDocDeletedAt: now() }).where(eq(teamMembers.id, m.id));
  }
}

async function uploadable(c: Context<AppEnv>) {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug')!);
  const me = c.get('customer');
  const x = requireAccess(await loadApplication(deps.db, c.req.param('id')!), me);
  if (x.app.competitionSlug !== comp.slug) throw notFound('Team not found');
  if (x.app.status !== 'approved') throw new HttpError(403, 'Uploads open once your team is approved.', 'not_approved');
  if (!canUpload(x.app, x.members, me)) throw new HttpError(403, 'Only the person who registered the team, or the team captain, can upload.', 'not_captain');
  const s = await settingsFor(deps.db, comp.slug);
  const d = datesOf(comp, s);
  if (deps.now() > new Date(d.submissionDeadline)) throw new HttpError(409, 'The submission deadline has passed.', 'closed');
  return { comp, x, s, me };
}

/** A one-time link to upload the comic or the sketches PDF (approved teams, before the deadline). */
teams.post('/:slug/team/:id{[0-9a-f-]{36}}/uploads', async (c) => {
  const deps = c.get('deps');
  const { comp, x, me } = await uploadable(c);
  await rateLimit(deps.db, `teamfile:${me.userId}`, 40, 3600);
  const input = await body(c, z.object({ kind: z.string().max(20), contentType: z.string().max(100), size: z.number().int().positive() }));
  const spec = comp.team.files.find((f) => f.kind === input.kind);
  if (!spec) throw new HttpError(400, 'Unknown file.', 'bad_kind');
  if (input.contentType !== 'application/pdf') throw new HttpError(400, 'Upload a PDF.', 'bad_type');
  if (input.size > spec.maxMb * 1024 * 1024) throw new HttpError(400, `This file is too big. The limit is ${spec.maxMb} MB.`, 'too_big');
  const key = `${filePrefix(comp.slug, x.app.id)}${spec.kind}-${randomUUID()}.pdf`;
  const upload = await deps.storage.signedUploadUrl('competition-entries', key);
  return c.json({ key, url: upload.url }, 201);
});

/** After an upload: check it's a PDF with enough pages; it replaces the team's previous file of that kind. */
teams.post('/:slug/team/:id{[0-9a-f-]{36}}/files', async (c) => {
  const deps = c.get('deps');
  const { comp, x, s, me } = await uploadable(c);
  const input = await body(c, z.object({ kind: z.string().max(20), key: z.string().max(300), name: z.string().trim().max(200).default('') }));
  const spec = comp.team.files.find((f) => f.kind === input.kind);
  if (!spec) throw new HttpError(400, 'Unknown file.', 'bad_kind');
  if (!input.key.startsWith(`${filePrefix(comp.slug, x.app.id)}${spec.kind}-`) || input.key.includes('..')) throw new HttpError(400, 'Please upload the file again.', 'bad_key');
  const reject = async (msg: string): Promise<never> => {
    await deps.storage.remove('competition-entries', input.key).catch(() => {});
    throw new HttpError(400, msg, 'bad_file');
  };
  let bytes: Uint8Array;
  try { bytes = await deps.storage.read('competition-entries', input.key); } catch { return reject('The upload didn’t arrive. Please try again.'); }
  if (sniff(bytes) !== 'application/pdf') return reject('This file isn’t a PDF, or it’s damaged. Please choose the PDF again.');
  if (bytes.length > spec.maxMb * 1024 * 1024) return reject(`This file is too big. The limit is ${spec.maxMb} MB.`);
  const pages = pdfPageCount(bytes);
  if (pages !== null && pages < spec.minPages) return reject(`This PDF has ${pages} page${pages === 1 ? '' : 's'}; the ${spec.label.replace(/ \(PDF\)$/, '').toLowerCase()} needs at least ${spec.minPages}.`);
  const at = deps.now();
  const previous = x.files.filter((f) => f.kind === spec.kind && !f.replacedAt);
  const [row] = await deps.db.insert(teamFiles).values({
    applicationId: x.app.id, kind: spec.kind, storageKey: input.key, originalName: input.name || `${spec.kind}.pdf`, sizeBytes: bytes.length, pages, uploadedBy: me.email, uploadedAt: at,
  }).returning();
  // The newest upload is the one judged; the older file is deleted (its record stays in the history).
  for (const f of previous) {
    if (f.storageKey) await deps.storage.remove('competition-entries', f.storageKey).catch(() => {});
    await deps.db.update(teamFiles).set({ replacedAt: at, storageKey: null }).where(eq(teamFiles.id, f.id));
  }
  await deps.db.update(teamApplications).set({ updatedAt: at }).where(eq(teamApplications.id, x.app.id));
  const mail = sendTeamEmail(deps, comp, x.app, x.members, 'file', { file: row });
  if (deps.defer) deps.defer(mail); else await mail;
  const y = (await loadApplication(deps.db, x.app.id))!;
  return c.json({ application: view(comp, s, y, me, deps.now()), pagesCounted: pages !== null });
});

/** Open one of the team's current files (a link that works for 5 minutes). */
teams.get('/:slug/team/:id{[0-9a-f-]{36}}/files/:fileId{[0-9a-f-]{36}}', async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const x = requireAccess(await loadApplication(deps.db, c.req.param('id')), c.get('customer'));
  if (x.app.competitionSlug !== comp.slug) throw notFound('Team not found');
  const f = x.files.find((y) => y.id === c.req.param('fileId') && y.storageKey);
  if (!f) throw notFound('File not found');
  return c.json({ url: await deps.storage.signedDownloadUrl('competition-entries', f.storageKey!, 300, f.originalName || undefined) });
});

/* ---------------- Public ---------------- */

export const competitionInfo = new Hono<AppEnv>();

/** Pictures, dates, public notices and (once published) results. No personal data beyond winners' credits, and not the
 * story brief or the official PDFs (approved teams get those with their team). */
competitionInfo.get('/:slug', async (c) => {
  const deps = c.get('deps');
  const { db, now } = deps;
  const comp = teamCompetition(c.req.param('slug'));
  const s = await settingsFor(db, comp.slug);
  const notices = await db.select().from(competitionNotices).where(eq(competitionNotices.competitionSlug, comp.slug)).orderBy(desc(competitionNotices.createdAt)).limit(30);
  let results: { team: string; category: string; result: string; credit: string }[] = [];
  if (s.resultsPublished) {
    const won = await db.select().from(teamApplications).where(and(eq(teamApplications.competitionSlug, comp.slug), eq(teamApplications.status, 'approved'), sql`${teamApplications.result} <> ''`, sql`${teamApplications.result} <> 'shortlisted'`));
    const mem = await membersOf(db, won.map((w) => w.id));
    // Credit as first name and city only (as the terms say).
    results = won.map((w) => ({ team: w.teamName, category: w.category, result: w.result, credit: `${(mem.get(w.id) ?? []).map((m) => m.fullName.split(/\s+/)[0]).join(', ')} · ${w.city}` }));
  }
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return c.json({
    registration: registrationState(comp, s, now()),
    dates: datesOf(comp, s),
    bannerUrl: mediaUrl(deps, s.bannerKey), artUrl: mediaUrl(deps, s.artKey), sponsorUrls: s.sponsorKeys.map((k) => mediaUrl(deps, k)),
    notices: notices.filter((n) => n.audience.public).map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt })),
    resultsPublished: s.resultsPublished, results,
  });
});
