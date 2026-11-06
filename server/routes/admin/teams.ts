// Admin → Competitions → a team competition (DoomsDay Diaries): applications with filters,
// review (approve, request changes, reject) with secure ID-document viewing, submissions,
// notices and emails to groups of teams, shortlist and results, settings (dates, pictures,
// official documents), exports and numbers. Store owner only. Every action is audit-logged.
import { Hono, type Context } from 'hono';
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { accounts, auditLog, competitionNotices, competitionSettings, teamApplications, teamFiles, teamMembers } from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound } from '../../lib/http.js';
import { stateName } from '../../lib/states.js';
import { istDateTime } from '../../../src/shared/competitions.js';
import { ageOn, RESULT_TEXT, STATUS_TEXT } from '../../../src/shared/teams.js';
import {
  allRecipients, code, datesOf, loadApplication, mediaUrl, membersOf, noticeReaches, sendNoticeEmail, sendTeamEmail, settingsFor, teamCompetition,
  type TeamComp, type TeamSettings,
} from '../../services/teams.js';
import { deleteIdDocs } from '../teams.js';
import { audit } from './auth.js';

export const adminTeams = new Hono<AppEnv>();

const ID = '[0-9a-f-]{36}';
const LIVE = ['pending', 'changes_requested', 'approved'];
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const zFilters = z.object({
  status: z.string().max(30).optional(), category: z.string().max(30).optional(), institutionType: z.string().max(20).optional(),
  state: z.string().max(4).optional(), city: z.string().trim().max(60).optional(), result: z.string().max(30).optional(),
  files: z.enum(['complete', 'missing']).optional(), q: z.string().trim().max(100).optional(),
});

function where(slug: string, f: z.infer<typeof zFilters>) {
  const w: (SQL | undefined)[] = [eq(teamApplications.competitionSlug, slug)];
  if (f.status) w.push(eq(teamApplications.status, f.status));
  if (f.category) w.push(eq(teamApplications.category, f.category));
  if (f.institutionType) w.push(eq(teamApplications.institutionType, f.institutionType));
  if (f.state) w.push(eq(teamApplications.state, f.state));
  if (f.city) w.push(ilike(teamApplications.city, like(f.city)));
  if (f.result) w.push(f.result === 'none' ? eq(teamApplications.result, '') : eq(teamApplications.result, f.result));
  // Written with table names: in a one-table query Drizzle leaves columns unqualified, which would
  // make "id" inside these subqueries mean the subquery's own table.
  const hasBoth = sql.raw(`(select count(distinct f.kind) from team_files f where f.application_id = "team_applications"."id" and f.replaced_at is null)`);
  if (f.files === 'complete') w.push(sql`${hasBoth} >= 2`);
  if (f.files === 'missing') w.push(and(eq(teamApplications.status, 'approved'), sql`${hasBoth} < 2`));
  if (f.q) {
    const num = /^[a-z]{1,4}-?0*(\d{1,6})$/i.exec(f.q)?.[1];
    w.push(or(
      ilike(teamApplications.teamName, like(f.q)), ilike(teamApplications.institutionName, like(f.q)), ilike(teamApplications.email, like(f.q)),
      sql`exists (select 1 from team_members tm where tm.application_id = "team_applications"."id" and (tm.full_name ilike ${like(f.q)} or tm.email ilike ${like(f.q)}))`,
      ...(num ? [eq(teamApplications.applicationNo, Number(num))] : []),
    ));
  }
  return and(...w);
}

const groupLabel = (c: TeamComp, k: string) => c.team.groups.find((g) => g.key === k)?.label ?? k;
const instLabel = (c: TeamComp, k: string) => c.team.institutionTypes.find((g) => g.key === k)?.label ?? k;

async function filesByApp(c: Context<AppEnv>, ids: string[]) {
  const { db } = c.get('deps');
  const rows = ids.length ? await db.select().from(teamFiles).where(and(inArray(teamFiles.applicationId, ids), sql`${teamFiles.replacedAt} is null`)) : [];
  const out = new Map<string, Record<string, { pages: number | null; at: Date }>>();
  for (const f of rows) out.set(f.applicationId, { ...(out.get(f.applicationId) ?? {}), [f.kind]: { pages: f.pages, at: f.uploadedAt } });
  return out;
}

/** The numbers: by status, age group, institution type and state; members; uploads; registrations per day. */
adminTeams.get('/:slug/teams/stats', async (c) => {
  const { db, now } = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const inComp = eq(teamApplications.competitionSlug, comp.slug);
  const count = (col: AnyPgColumn) => db.select({ k: col, n: sql<number>`count(*)::int` }).from(teamApplications).where(inComp).groupBy(col);
  const [byStatus, byCategory, byInst, byState] = await Promise.all([count(teamApplications.status), count(teamApplications.category), count(teamApplications.institutionType), count(teamApplications.state)]);
  const approvedByCat = await db.select({ k: teamApplications.category, n: sql<number>`count(*)::int` }).from(teamApplications).where(and(inComp, eq(teamApplications.status, 'approved'))).groupBy(teamApplications.category);
  const [people] = await db.select({ members: sql<number>`count(*)::int`, minors: sql<number>`count(*) filter (where ${teamMembers.dob} > ${comp.team.ageOn}::date - interval '18 years')::int` })
    .from(teamMembers).innerJoin(teamApplications, eq(teamApplications.id, teamMembers.applicationId)).where(and(inComp, inArray(teamApplications.status, LIVE)));
  const uploads = await db.select({ k: teamFiles.kind, n: sql<number>`count(distinct ${teamFiles.applicationId})::int` }).from(teamFiles)
    .innerJoin(teamApplications, eq(teamApplications.id, teamFiles.applicationId)).where(and(inComp, eq(teamApplications.status, 'approved'), sql`${teamFiles.replacedAt} is null`)).groupBy(teamFiles.kind);
  const since = new Date(now().getTime() - 21 * 86400_000);
  const daily = await db.select({ d: sql<string>`to_char(${teamApplications.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`, n: sql<number>`count(*)::int` })
    .from(teamApplications).where(and(inComp, sql`${teamApplications.createdAt} >= ${since}`)).groupBy(sql`1`).orderBy(sql`1`);
  const total = byStatus.reduce((n, x) => n + x.n, 0);
  return c.json({
    total, byStatus: Object.fromEntries(byStatus.map((x) => [x.k, x.n])),
    byCategory: comp.team.groups.map((g) => ({ key: g.key, label: `${g.label} (${g.min}–${g.max})`, teams: byCategory.find((x) => x.k === g.key)?.n ?? 0, approved: approvedByCat.find((x) => x.k === g.key)?.n ?? 0 })),
    byInstitution: comp.team.institutionTypes.map((t) => ({ label: t.label, teams: byInst.find((x) => x.k === t.key)?.n ?? 0 })),
    byState: byState.sort((a, b) => b.n - a.n).slice(0, 12).map((x) => ({ label: stateName(x.k), teams: x.n })),
    members: people?.members ?? 0, minors: people?.minors ?? 0,
    uploads: Object.fromEntries(uploads.map((u) => [u.k, u.n])), daily,
  });
});

adminTeams.get('/:slug/teams', async (c) => {
  const { db } = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const f = zFilters.parse(c.req.query());
  const rows = await db.select().from(teamApplications).where(where(comp.slug, f)).orderBy(desc(teamApplications.createdAt)).limit(1000);
  const mem = await membersOf(db, rows.map((r) => r.id));
  const files = await filesByApp(c, rows.map((r) => r.id));
  const states = await db.selectDistinct({ s: teamApplications.state }).from(teamApplications).where(eq(teamApplications.competitionSlug, comp.slug));
  return c.json({
    groups: comp.team.groups, institutionTypes: comp.team.institutionTypes, files: comp.team.files.map((x) => ({ kind: x.kind, label: x.label })),
    states: states.map((x) => ({ code: x.s, name: stateName(x.s) })).sort((a, b) => a.name.localeCompare(b.name)),
    items: rows.map((r) => ({
      id: r.id, code: code(comp, r), teamName: r.teamName, institution: r.institutionName, institutionType: instLabel(comp, r.institutionType),
      city: r.city, state: stateName(r.state), category: groupLabel(comp, r.category), status: r.status, statusText: STATUS_TEXT[r.status] ?? r.status,
      result: r.result, members: (mem.get(r.id) ?? []).map((m) => m.fullName), createdAt: r.createdAt, email: r.email, files: files.get(r.id) ?? {},
    })),
  });
});

/** One application: the team, every member (with guardian and ID details), files, notes and history. */
adminTeams.get(`/:slug/teams/:id{${ID}}`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const x = await loadApplication(deps.db, c.req.param('id'));
  if (!x || x.app.competitionSlug !== comp.slug) throw notFound('Application not found');
  const [acct] = await deps.db.select().from(accounts).where(eq(accounts.userId, x.app.userId));
  const history = await deps.db.select().from(auditLog).where(eq(auditLog.entityId, x.app.id)).orderBy(desc(auditLog.createdAt)).limit(50);
  const notices = await deps.db.select().from(competitionNotices).where(eq(competitionNotices.competitionSlug, comp.slug)).orderBy(desc(competitionNotices.createdAt)).limit(100);
  const { app } = x;
  return c.json({
    id: app.id, code: code(comp, app), teamName: app.teamName, institutionType: instLabel(comp, app.institutionType), institutionName: app.institutionName,
    city: app.city, state: stateName(app.state), category: groupLabel(comp, app.category), status: app.status, statusText: STATUS_TEXT[app.status] ?? app.status,
    reviewNote: app.reviewNote, adminNotes: app.adminNotes, result: app.result, flags: app.flags, createdAt: app.createdAt, updatedAt: app.updatedAt,
    reviewedAt: app.reviewedAt, reviewedBy: app.reviewedBy, acceptedTermsAt: app.acceptedTermsAt,
    registeredBy: { email: app.email, name: acct?.fullName || acct?.name || '', phone: acct?.phone ?? '', type: acct?.accountType ?? null, city: acct?.city ?? '' },
    members: x.members.map((m) => ({
      id: m.id, captain: m.position === 0, fullName: m.fullName, dob: m.dob, age: ageOn(m.dob, comp.team.ageOn), email: m.email, phone: m.phone,
      institutionName: m.institutionName, roles: m.roles.map((r) => comp.team.roles.find((x) => x.key === r)?.label ?? r), instagram: m.instagram,
      idDocType: comp.team.idDocs.find((d) => d.key === m.idDocType)?.label ?? m.idDocType, idDoc: Boolean(m.idDocKey), idDocDeletedAt: m.idDocDeletedAt,
      guardianName: m.guardianName, guardianRelation: m.guardianRelation, guardianPhone: m.guardianPhone, guardianEmail: m.guardianEmail, guardianConsentAt: m.guardianConsentAt,
    })),
    files: x.files.map((f) => ({ id: f.id, kind: f.kind, name: f.originalName, size: f.sizeBytes, pages: f.pages, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, replacedAt: f.replacedAt, available: Boolean(f.storageKey) })),
    notices: notices.filter((n) => !n.audience.public && noticeReaches(n.audience, app)).map((n) => ({ title: n.title, createdAt: n.createdAt })),
    history: history.map((h) => ({ at: h.createdAt, actor: h.actor, action: h.action, details: h.details })),
  });
});

/** Look at a member's ID document: a link for 5 minutes, recorded in the audit log. */
adminTeams.get(`/:slug/teams/:id{${ID}}/id/:memberId{${ID}}`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const x = await loadApplication(deps.db, c.req.param('id'));
  const m = x?.members.find((y) => y.id === c.req.param('memberId'));
  if (!x || x.app.competitionSlug !== comp.slug || !m?.idDocKey) throw notFound('ID document not found');
  await audit(c, 'team.view_id', 'team', x.app.id, { member: m.fullName });
  return c.json({ url: await deps.storage.signedDownloadUrl('competition-entries', m.idDocKey, 300) });
});

adminTeams.get(`/:slug/teams/:id{${ID}}/files/:fileId{${ID}}`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const x = await loadApplication(deps.db, c.req.param('id'));
  const f = x?.files.find((y) => y.id === c.req.param('fileId'));
  if (!x || x.app.competitionSlug !== comp.slug || !f?.storageKey) throw notFound('File not found');
  return c.json({ url: await deps.storage.signedDownloadUrl('competition-entries', f.storageKey, 600, `${code(comp, x.app)}-${f.kind}.pdf`) });
});

/** Approve, ask for changes (with a message) or reject (with a reason). The team is emailed. */
adminTeams.post(`/:slug/teams/:id{${ID}}/review`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const x = await loadApplication(deps.db, c.req.param('id'));
  if (!x || x.app.competitionSlug !== comp.slug) throw notFound('Application not found');
  const input = await body(c, z.object({ action: z.enum(['approve', 'changes', 'reject']), message: z.string().trim().max(2000).default('') }));
  if (x.app.status === 'withdrawn') throw new HttpError(409, 'The team withdrew.', 'withdrawn');
  if (input.action === 'changes' && input.message.length < 5) throw new HttpError(400, 'Say what needs to change.');
  const status = input.action === 'approve' ? 'approved' : input.action === 'changes' ? 'changes_requested' : 'rejected';
  const [app] = await deps.db.update(teamApplications).set({ status, reviewNote: input.message, reviewedAt: deps.now(), reviewedBy: c.get('admin').email, updatedAt: deps.now() })
    .where(eq(teamApplications.id, x.app.id)).returning();
  await audit(c, `team.${input.action === 'changes' ? 'request_changes' : input.action}`, 'team', app.id, { team: app.teamName, from: x.app.status, message: input.message });
  const mail = sendTeamEmail(deps, comp, app, x.members, input.action === 'approve' ? 'approved' : input.action === 'changes' ? 'changes' : 'rejected');
  if (deps.defer) deps.defer(mail); else await mail;
  return c.json({ ok: true, status });
});

adminTeams.post(`/:slug/teams/:id{${ID}}/result`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const { result } = await body(c, z.object({ result: z.enum(['', 'shortlisted', 'first', 'second', 'third', 'peoples_choice']) }));
  const [app] = await deps.db.update(teamApplications).set({ result, updatedAt: deps.now() })
    .where(and(eq(teamApplications.id, c.req.param('id')), eq(teamApplications.competitionSlug, comp.slug), eq(teamApplications.status, 'approved'))).returning();
  if (!app) throw new HttpError(409, 'Only approved teams can be shortlisted or win.', 'not_approved');
  await audit(c, 'team.result', 'team', app.id, { team: app.teamName, result: result || 'none' });
  return c.json({ ok: true });
});

adminTeams.put(`/:slug/teams/:id{${ID}}/notes`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const { notes } = await body(c, z.object({ notes: z.string().max(4000) }));
  const [app] = await deps.db.update(teamApplications).set({ adminNotes: notes.trim() }).where(and(eq(teamApplications.id, c.req.param('id')), eq(teamApplications.competitionSlug, comp.slug))).returning();
  if (!app) throw notFound('Application not found');
  await audit(c, 'team.notes', 'team', app.id);
  return c.json({ ok: true });
});

/** One row per member, with the team's details; contact and guardian details only when asked. */
adminTeams.get('/:slug/teams/export.csv', async (c) => {
  const { db } = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const f = zFilters.parse(c.req.query());
  const contacts = c.req.query('contacts') === '1';
  const apps = await db.select().from(teamApplications).where(where(comp.slug, f)).orderBy(asc(teamApplications.applicationNo));
  const mem = await membersOf(db, apps.map((a) => a.id));
  const files = await filesByApp(c, apps.map((a) => a.id));
  type L = { a: (typeof apps)[number]; m: NonNullable<ReturnType<typeof mem.get>>[number] };
  const lines: L[] = apps.flatMap((a) => (mem.get(a.id) ?? []).map((m) => ({ a, m })));
  const cols: [string, (l: L) => unknown][] = [
    ['Application ID', (l) => code(comp, l.a)], ['Team', (l) => l.a.teamName], ['Status', (l) => STATUS_TEXT[l.a.status] ?? l.a.status],
    ['Age group', (l) => groupLabel(comp, l.a.category)], ['Institution type', (l) => instLabel(comp, l.a.institutionType)], ['Institution', (l) => l.a.institutionName],
    ['City', (l) => l.a.city], ['State', (l) => stateName(l.a.state)], ['Registered (IST)', (l) => istDateTime(l.a.createdAt)], ['Registered by', (l) => l.a.email],
    ['Member no.', (l) => l.m.position + 1], ['Captain', (l) => (l.m.position === 0 ? 'yes' : '')], ['Name', (l) => l.m.fullName], ['Date of birth', (l) => l.m.dob],
    ['Age on ' + comp.team.ageOn, (l) => ageOn(l.m.dob, comp.team.ageOn)], ['Roles', (l) => l.m.roles.join(', ')], ['Member institution', (l) => l.m.institutionName],
    ['Instagram', (l) => l.m.instagram], ['ID document', (l) => comp.team.idDocs.find((d) => d.key === l.m.idDocType)?.label ?? l.m.idDocType],
    ...(contacts ? [
      ['Email', (l: L) => l.m.email], ['Phone', (l: L) => l.m.phone], ['Guardian', (l: L) => l.m.guardianName], ['Guardian relation', (l: L) => l.m.guardianRelation],
      ['Guardian phone', (l: L) => l.m.guardianPhone], ['Guardian email', (l: L) => l.m.guardianEmail], ['Guardian consent (IST)', (l: L) => (l.m.guardianConsentAt ? istDateTime(l.m.guardianConsentAt) : '')],
    ] as [string, (l: L) => unknown][] : []),
    ...comp.team.files.map((spec): [string, (l: L) => unknown] => [`${spec.label} pages`, (l) => files.get(l.a.id)?.[spec.kind]?.pages ?? (files.get(l.a.id)?.[spec.kind] ? '?' : '')]),
    ['Result', (l) => RESULT_TEXT[l.a.result] ?? ''],
  ];
  await audit(c, 'competition.export', 'competition', comp.slug, { rows: lines.length, contacts, filters: f });
  return c.body(toCsv(lines, cols), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${comp.slug}-participants${contacts ? '-with-contacts' : ''}.csv"`, 'Cache-Control': 'no-store' });
});

/* ---------------- Notices and emails ---------------- */

const zAudience = z.object({
  public: z.boolean().optional(), statuses: z.array(z.string().max(30)).max(10).optional(), categories: z.array(z.string().max(30)).max(10).optional(),
  results: z.array(z.string().max(30)).max(10).optional(), applicationIds: z.array(z.uuid()).max(200).optional(),
});

adminTeams.get('/:slug/notices', async (c) => {
  const { db } = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const rows = await db.select().from(competitionNotices).where(eq(competitionNotices.competitionSlug, comp.slug)).orderBy(desc(competitionNotices.createdAt)).limit(200);
  return c.json({ items: rows });
});

/** Who a notice reaches (live teams only, unless the statuses say otherwise). */
async function reach(c: Context<AppEnv>, comp: TeamComp, a: z.infer<typeof zAudience>) {
  const { db } = c.get('deps');
  const apps = await db.select().from(teamApplications).where(eq(teamApplications.competitionSlug, comp.slug));
  const scoped = { ...a, statuses: a.statuses?.length ? a.statuses : a.applicationIds?.length ? undefined : LIVE };
  return apps.filter((x) => noticeReaches({ ...scoped, public: false }, x));
}

adminTeams.post('/:slug/notices/preview', async (c) => {
  const comp = teamCompetition(c.req.param('slug'));
  const { audience } = await body(c, z.object({ audience: zAudience }));
  const apps = await reach(c, comp, audience);
  return c.json({ teams: apps.length });
});

/** Post a notice on the website (public, or in the chosen teams' pages), and email it if asked. */
adminTeams.post('/:slug/notices', async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const input = await body(c, z.object({ title: z.string().trim().min(3).max(150), body: z.string().trim().min(3).max(5000), audience: zAudience, email: z.boolean().default(false) }));
  const apps = await reach(c, comp, input.audience);
  const stored = input.audience.public ? { public: true } : { ...input.audience, statuses: input.audience.statuses?.length ? input.audience.statuses : input.audience.applicationIds?.length ? undefined : LIVE };
  const [row] = await deps.db.insert(competitionNotices).values({ competitionSlug: comp.slug, title: input.title, body: input.body, audience: stored, createdBy: c.get('admin').email }).returning();
  let emailed = 0;
  if (input.email && apps.length) {
    const mem = await membersOf(deps.db, apps.map((a) => a.id));
    const to = [...new Set(apps.flatMap((a) => allRecipients(a, mem.get(a.id) ?? [])))];
    emailed = await sendNoticeEmail(deps, comp, input, to);
    await deps.db.update(competitionNotices).set({ emailed }).where(eq(competitionNotices.id, row.id));
  }
  await audit(c, 'competition.notice', 'competition', comp.slug, { title: input.title, audience: stored, teams: apps.length, emailed });
  return c.json({ notice: { ...row, emailed }, teams: apps.length, emailed }, 201);
});

adminTeams.delete(`/:slug/notices/:id{${ID}}`, async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const [row] = await deps.db.delete(competitionNotices).where(and(eq(competitionNotices.id, c.req.param('id')), eq(competitionNotices.competitionSlug, comp.slug))).returning();
  if (!row) throw notFound('Notice not found');
  await audit(c, 'competition.notice_delete', 'competition', comp.slug, { title: row.title });
  return c.json({ ok: true });
});

/* ---------------- Settings ---------------- */

const zKey = z.string().trim().max(300).nullable();
const zWhen = z.string().trim().nullable().refine((v) => v === null || v === '' || !Number.isNaN(Date.parse(v)), 'Check the date').transform((v) => v || null);
const zSettings = z.object({
  bannerKey: zKey, artKey: zKey, sponsorKeys: z.array(z.string().max(300)).max(8), rulesDocKey: zKey, topicDocKey: zKey,
  closesAt: zWhen, submissionDeadline: zWhen, resultsOn: z.string().trim().nullable().refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD').transform((v) => v || null),
  registrationPaused: z.boolean(), resultsPublished: z.boolean(),
}).partial();

function settingsView(c: Context<AppEnv>, comp: TeamComp, s: TeamSettings) {
  const deps = c.get('deps');
  return {
    settings: s, dates: datesOf(comp, s), defaults: { closesAt: comp.closesAt, submissionDeadline: comp.team.submissionDeadline, resultsOn: comp.team.resultsOn },
    urls: { bannerKey: mediaUrl(deps, s.bannerKey), artKey: mediaUrl(deps, s.artKey), rulesDocKey: mediaUrl(deps, s.rulesDocKey), topicDocKey: mediaUrl(deps, s.topicDocKey), sponsorKeys: s.sponsorKeys.map((k) => mediaUrl(deps, k)) },
  };
}

adminTeams.get('/:slug/settings', async (c) => {
  const comp = teamCompetition(c.req.param('slug'));
  return c.json(settingsView(c, comp, await settingsFor(c.get('deps').db, comp.slug)));
});

adminTeams.put('/:slug/settings', async (c) => {
  const { db } = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const input = await body(c, zSettings);
  const next = { ...(await settingsFor(db, comp.slug)), ...input };
  await db.insert(competitionSettings).values({ slug: comp.slug, data: next, updatedBy: c.get('admin').email })
    .onConflictDoUpdate({ target: competitionSettings.slug, set: { data: next, updatedBy: c.get('admin').email, updatedAt: sql`now()` } });
  await audit(c, 'competition.settings', 'competition', comp.slug, input);
  return c.json(settingsView(c, comp, next));
});

/** Delete the ID documents of teams already decided (approved, rejected or withdrawn): they were only needed for the check. */
adminTeams.post('/:slug/teams/delete-ids', async (c) => {
  const deps = c.get('deps');
  const comp = teamCompetition(c.req.param('slug'));
  const rows = await deps.db.select({ m: teamMembers }).from(teamMembers).innerJoin(teamApplications, eq(teamApplications.id, teamMembers.applicationId))
    .where(and(eq(teamApplications.competitionSlug, comp.slug), inArray(teamApplications.status, ['approved', 'rejected', 'withdrawn']), isNotNull(teamMembers.idDocKey)));
  await deleteIdDocs(c, rows.map((r) => r.m));
  await audit(c, 'team.delete_ids', 'competition', comp.slug, { documents: rows.length });
  return c.json({ deleted: rows.length });
});
