// Admin: a competition's entries. The registrations table (with submission status, who
// registered, publication consent), filters and search, a detail view with private file
// previews (short signed links), flag / note / hide / disqualify, a CSV export (contact
// details optional) and the top-line counters. Every action and export is audit-logged.
import { Hono, type Context } from 'hono';
import { and, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import {
  accounts, auditLog, competitionResources, consentRecords, parentApprovalRequests, registrations, resourceDownloads,
  studentGuardians, studentProfiles, submissionFiles, submissions,
} from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound } from '../../lib/http.js';
import { stateName } from '../../lib/states.js';
import { istDateTime } from '../../../src/shared/competition.js';
import { loadFull, type Full } from '../../services/competitions.js';
import { regCode } from '../../services/competitionEmails.js';
import { latestConsents } from '../../services/students.js';
import { audit } from './auth.js';

export const adminCompetitionEntries = new Hono<AppEnv>();

const ID = ':id{[0-9a-f-]{36}}';
const UUID = '[0-9a-f-]{36}';
export const ENTRY_FLAGS = ['suspected_ai', 'possibly_copied', 'content_issue'] as const;
const FLAG_LABEL: Record<string, string> = { suspected_ai: 'Suspected AI', possibly_copied: 'Possibly copied', content_issue: 'Content issue' };
const PAGE = 50;

const zFilters = z.object({
  group: z.string().max(4).optional(),
  status: z.enum(['no_entry', 'draft', 'submitted', 'withdrawn', 'disqualified', 'flagged', 'hidden']).optional(),
  school: z.string().trim().max(120).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().max(4).optional(),
  howHeard: z.string().max(120).optional(),
  utmSource: z.string().max(120).optional(),
  registeredByType: z.enum(['parent', 'student']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
type Filters = z.infer<typeof zFilters>;

async function competition(c: Context<AppEnv>) {
  const f = await loadFull(c.get('deps').db, { id: c.req.param('id')! });
  if (!f) throw notFound('Competition not found');
  return f;
}

const subWhere = (cond: SQL) => sql`exists (select 1 from ${submissions} where ${submissions.registrationId} = ${registrations.id} and ${cond})`;
const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** The WHERE for the table and the export. */
function where(f: Full, q: Filters) {
  const w: (SQL | undefined)[] = [eq(registrations.competitionId, f.c.id)];
  const group = q.group ? f.groups.find((g) => g.letter === q.group) : null;
  if (q.group) w.push(group ? eq(registrations.groupId, group.id) : sql`false`);
  if (q.registeredByType) w.push(eq(registrations.registeredByType, q.registeredByType));
  if (q.school) w.push(ilike(studentProfiles.schoolName, like(q.school)));
  if (q.city) w.push(ilike(studentProfiles.city, like(q.city)));
  if (q.state) w.push(eq(studentProfiles.state, q.state));
  if (q.howHeard !== undefined && q.howHeard !== '') w.push(eq(registrations.howHeard, q.howHeard === '(none)' ? '' : q.howHeard));
  if (q.utmSource !== undefined && q.utmSource !== '') w.push(eq(registrations.utmSource, q.utmSource === '(none)' ? '' : q.utmSource));
  switch (q.status) {
    case 'no_entry': w.push(eq(registrations.status, 'registered'), sql`not ${subWhere(sql`${submissions.status} in ('submitted', 'disqualified')`)}`); break;
    case 'draft': w.push(subWhere(sql`${submissions.status} = 'draft'`)); break;
    case 'submitted': w.push(eq(registrations.status, 'registered'), subWhere(sql`${submissions.status} = 'submitted'`)); break;
    case 'withdrawn': w.push(or(eq(registrations.status, 'withdrawn'), subWhere(sql`${submissions.status} = 'withdrawn'`))); break;
    case 'disqualified': w.push(eq(registrations.status, 'disqualified')); break;
    case 'flagged': w.push(subWhere(sql`cardinality(${submissions.adminFlags}) > 0`)); break;
    case 'hidden': w.push(subWhere(sql`${submissions.hiddenFromPublic}`)); break;
  }
  if (q.q) {
    const text = q.q;
    const digits = text.replace(/\D/g, '');
    const any: SQL[] = [
      ilike(sql`${studentProfiles.firstName} || ' ' || ${studentProfiles.lastName}`, like(text)),
      subWhere(ilike(submissions.entryCode, like(text))),
    ];
    if (/^r-?[0-9a-f]{4,8}$/i.test(text)) any.push(ilike(sql`replace(${registrations.id}::text, '-', '')`, `${text.replace(/^r-?/i, '').toLowerCase()}%`));
    if (digits.length >= 4) {
      any.push(sql`exists (select 1 from ${studentGuardians} join ${accounts} on ${accounts.userId} = ${studentGuardians.parentUserId}
        where ${studentGuardians.studentProfileId} = ${studentProfiles.id} and regexp_replace(${accounts.whatsapp}, '\\D', '', 'g') like ${`%${digits}%`})`);
    }
    w.push(or(...any));
  }
  return and(...w);
}

type Row = { r: typeof registrations.$inferSelect; p: typeof studentProfiles.$inferSelect };

async function rowsFor(c: Context<AppEnv>, f: Full, q: Filters, limit: number, offset: number) {
  const { db } = c.get('deps');
  return db.select({ r: registrations, p: studentProfiles }).from(registrations)
    .innerJoin(studentProfiles, eq(studentProfiles.id, registrations.studentProfileId))
    .where(where(f, q)).orderBy(desc(registrations.createdAt)).limit(limit).offset(offset) as Promise<Row[]>;
}

async function submissionsFor(c: Context<AppEnv>, regIds: string[]) {
  const { db } = c.get('deps');
  if (!regIds.length) return new Map<string, (typeof submissions.$inferSelect & { files: number })[]>();
  const subs = await db.select().from(submissions).where(inArray(submissions.registrationId, regIds)).orderBy(submissions.createdAt);
  const counts = subs.length ? await db.select({ id: submissionFiles.submissionId, n: sql<number>`count(*)::int` }).from(submissionFiles)
    .where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).groupBy(submissionFiles.submissionId) : [];
  const out = new Map<string, (typeof submissions.$inferSelect & { files: number })[]>();
  for (const s of subs) out.set(s.registrationId, [...(out.get(s.registrationId) ?? []), { ...s, files: counts.find((x) => x.id === s.id)?.n ?? 0 }]);
  return out;
}

/** The parents (name, email, WhatsApp) of each student, and the student's own login email. */
async function contactsFor(c: Context<AppEnv>, studentIds: string[]) {
  const { db } = c.get('deps');
  const out = new Map<string, { parents: { name: string; email: string; whatsapp: string }[]; studentEmail: string }>();
  if (!studentIds.length) return out;
  const parents = await db.select({ s: studentGuardians.studentProfileId, a: accounts }).from(studentGuardians)
    .innerJoin(accounts, eq(accounts.userId, studentGuardians.parentUserId)).where(inArray(studentGuardians.studentProfileId, studentIds));
  const own = await db.select({ s: studentProfiles.id, email: accounts.email }).from(studentProfiles)
    .innerJoin(accounts, eq(accounts.userId, studentProfiles.studentUserId)).where(inArray(studentProfiles.id, studentIds));
  for (const id of studentIds) {
    out.set(id, {
      parents: parents.filter((x) => x.s === id).map(({ a }) => ({ name: a.fullName || a.name, email: a.email, whatsapp: a.whatsapp })),
      studentEmail: own.find((x) => x.s === id)?.email ?? '',
    });
  }
  return out;
}

/** The headline state of a registration, for the table. */
function entryState(r: typeof registrations.$inferSelect, subs: { status: string }[]) {
  if (r.status === 'disqualified') return 'disqualified';
  if (r.status === 'withdrawn') return 'withdrawn';
  if (subs.some((s) => s.status === 'submitted')) return 'submitted';
  if (subs.some((s) => s.status === 'draft')) return 'draft';
  if (subs.some((s) => s.status === 'withdrawn')) return 'withdrawn';
  return 'no_entry';
}

adminCompetitionEntries.get(`/${ID}/entries`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const q = zFilters.parse(c.req.query());
  const [rows, [{ n: total }]] = await Promise.all([
    rowsFor(c, f, q, PAGE, (q.page - 1) * PAGE),
    db.select({ n: sql<number>`count(*)::int` }).from(registrations).innerJoin(studentProfiles, eq(studentProfiles.id, registrations.studentProfileId)).where(where(f, q)),
  ]);
  const subs = await submissionsFor(c, rows.map((x) => x.r.id));
  const consents = await latestConsents(db, rows.map((x) => x.p.id));
  // Filter choices from this competition's own registrations.
  const distinct = async (col: typeof registrations.howHeard | typeof registrations.utmSource | typeof studentProfiles.state) =>
    (await db.selectDistinct({ v: col }).from(registrations).innerJoin(studentProfiles, eq(studentProfiles.id, registrations.studentProfileId))
      .where(eq(registrations.competitionId, f.c.id)).orderBy(col).limit(200)).map((x) => x.v);
  const [howHeard, utmSource, states] = await Promise.all([distinct(registrations.howHeard), distinct(registrations.utmSource), distinct(studentProfiles.state)]);
  return c.json({
    total, page: q.page, limit: PAGE,
    options: {
      groups: f.groups.map((g) => ({ letter: g.letter, name: g.name })),
      howHeard: howHeard.map((v) => v || '(none)'), utmSource: utmSource.map((v) => v || '(none)'),
      states: states.filter(Boolean).map((code) => ({ code, name: stateName(code) })),
    },
    items: rows.map(({ r, p }) => {
      const list = subs.get(r.id) ?? [];
      const g = f.groups.find((x) => x.id === r.groupId);
      return {
        id: r.id, code: regCode(r.id), createdAt: r.createdAt, status: r.status, state: entryState(r, list), registeredByType: r.registeredByType,
        student: { firstName: p.firstName, lastName: p.deletedAt ? '' : p.lastName, classGrade: r.classAtRegistration, school: p.deletedAt ? '' : p.schoolName, city: p.city, state: stateName(p.state), deleted: Boolean(p.deletedAt) },
        group: g ? { letter: g.letter, name: g.name } : null,
        publication: consents.get(p.id)?.publication ?? false,
        howHeard: r.howHeard, utmSource: r.utmSource,
        submissions: list.map((s) => ({ id: s.id, entryCode: s.entryCode, status: s.status, submittedAt: s.submittedAt, flags: s.adminFlags, hidden: s.hiddenFromPublic, files: s.files, hasNote: Boolean(s.adminNotes) })),
      };
    }),
  });
});

/** One registration in full: student, parents, answers, consents, entries with private previews, history. */
adminCompetitionEntries.get(`/${ID}/entries/:regId{${UUID}}`, async (c) => {
  const deps = c.get('deps');
  const { db, storage } = deps;
  const f = await competition(c);
  const [row] = await db.select({ r: registrations, p: studentProfiles }).from(registrations)
    .innerJoin(studentProfiles, eq(studentProfiles.id, registrations.studentProfileId))
    .where(and(eq(registrations.id, c.req.param('regId')), eq(registrations.competitionId, f.c.id)));
  if (!row) throw notFound('Registration not found');
  const { r, p } = row;
  const subs = (await submissionsFor(c, [r.id])).get(r.id) ?? [];
  const files = subs.length ? await db.select().from(submissionFiles).where(inArray(submissionFiles.submissionId, subs.map((s) => s.id))).orderBy(submissionFiles.kind, submissionFiles.sortOrder) : [];
  const contacts = (await contactsFor(c, [p.id])).get(p.id)!;
  const consentRows = await db.select().from(consentRecords).where(eq(consentRecords.studentProfileId, p.id)).orderBy(desc(consentRecords.createdAt));
  const latest = new Map<string, typeof consentRecords.$inferSelect>();
  for (const x of consentRows) if (!latest.has(x.consentType)) latest.set(x.consentType, x);
  const link = (key: string, name?: string) => storage.signedDownloadUrl('competition-entries', key, 10 * 60, name).catch(() => null);
  const history = await db.select().from(auditLog)
    .where(and(inArray(auditLog.entityId, [r.id, ...subs.map((s) => s.id)]), ne(auditLog.action, 'entry.view'))).orderBy(desc(auditLog.createdAt)).limit(30);
  const g = f.groups.find((x) => x.id === r.groupId);
  const extraLabel = (k: string | null) => f.c.extraFiles.find((x) => x.key === k)?.label ?? k ?? '';
  await audit(c, 'entry.view', 'registration', r.id, { competition: f.c.id });
  return c.json({
    id: r.id, code: regCode(r.id), createdAt: r.createdAt, status: r.status, disqualifyReason: r.disqualifyReason, registeredByType: r.registeredByType,
    group: g ? { letter: g.letter, name: g.name, formatNote: g.formatNote } : null,
    student: {
      firstName: p.firstName, lastName: p.deletedAt ? '' : p.lastName, classAtRegistration: r.classAtRegistration, classNow: p.classGrade,
      school: p.deletedAt ? '' : p.schoolName, city: p.city, state: stateName(p.state), approvalStatus: p.approvalStatus, ownLogin: Boolean(p.studentUserId), deleted: Boolean(p.deletedAt),
    },
    contacts: p.deletedAt ? { parents: [], studentEmail: '' } : contacts,
    answers: f.fields.map((fd) => ({ key: fd.key, label: fd.label, value: r.customAnswers[fd.key] ?? null })).filter((a) => a.value !== null && a.value !== ''),
    source: { howHeard: r.howHeard, utmSource: r.utmSource, utmMedium: r.utmMedium, utmCampaign: r.utmCampaign, utmContent: r.utmContent, utmTerm: r.utmTerm, referralCode: r.referralCode, referredByCode: r.referredByCode },
    consents: (['data_processing', 'publication', 'marketing'] as const).map((k) => {
      const x = latest.get(k);
      return { type: k, granted: x?.granted ?? false, at: x?.createdAt ?? null, version: x?.textVersion ?? '' };
    }),
    submissions: await Promise.all(subs.map(async (s) => ({
      id: s.id, entryCode: s.entryCode, status: s.status, title: s.title, language: s.language, textContent: s.textContent, linkUrl: s.linkUrl,
      submittedAt: s.submittedAt, updatedAt: s.updatedAt, declarationAcceptedAt: s.declarationAcceptedAt, flags: s.adminFlags, notes: s.adminNotes, hidden: s.hiddenFromPublic,
      words: s.textContent.trim() ? s.textContent.trim().split(/\s+/).length : 0,
      files: await Promise.all(files.filter((x) => x.submissionId === s.id).map(async (x) => ({
        id: x.id, kind: x.kind, label: x.kind === 'extra' ? extraLabel(x.extraKey) : 'Main', name: x.originalName, mimeType: x.mimeType, sizeBytes: x.sizeBytes,
        width: x.width, height: x.height, verified: Boolean(x.verifiedAt),
        url: x.verifiedAt ? await link(x.storageKey, x.originalName || undefined) : null,
        thumbUrl: x.verifiedAt && x.thumbnailKey ? await link(x.thumbnailKey) : null,
      }))),
    }))),
    history: history.map((h) => ({ at: h.createdAt, actor: h.actor, action: h.action, details: h.details })),
  });
});

async function submissionIn(c: Context<AppEnv>, f: Full) {
  const { db } = c.get('deps');
  const [row] = await db.select({ s: submissions }).from(submissions).innerJoin(registrations, eq(registrations.id, submissions.registrationId))
    .where(and(eq(submissions.id, c.req.param('subId')!), eq(registrations.competitionId, f.c.id)));
  if (!row) throw notFound('Entry not found');
  return row.s;
}

/** Flags, a private note, and hiding from the public (one call, only what's sent changes). */
adminCompetitionEntries.post(`/${ID}/entries/submissions/:subId{${UUID}}`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const s = await submissionIn(c, f);
  const input = await body(c, z.object({
    flags: z.array(z.enum(ENTRY_FLAGS)).max(3).optional(),
    notes: z.string().max(4000).optional(),
    hidden: z.boolean().optional(),
  }));
  const set: Partial<typeof submissions.$inferInsert> = {};
  if (input.flags) set.adminFlags = [...new Set(input.flags)];
  if (input.notes !== undefined) set.adminNotes = input.notes.trim();
  if (input.hidden !== undefined) set.hiddenFromPublic = input.hidden;
  if (!Object.keys(set).length) throw new HttpError(400, 'Nothing to change.');
  // updatedAt is left alone: it's the family's "last changed", not the admin's.
  const [row] = await db.update(submissions).set(set).where(eq(submissions.id, s.id)).returning();
  if (input.flags) await audit(c, 'entry.flag', 'submission', s.id, { entryCode: s.entryCode, from: s.adminFlags, to: row.adminFlags });
  if (input.notes !== undefined) await audit(c, 'entry.note', 'submission', s.id, { entryCode: s.entryCode });
  if (input.hidden !== undefined) await audit(c, input.hidden ? 'entry.hide' : 'entry.unhide', 'submission', s.id, { entryCode: s.entryCode });
  return c.json({ flags: row.adminFlags, notes: row.adminNotes, hidden: row.hiddenFromPublic });
});

/** Disqualify a registration (with a reason; its submitted entries too), or reinstate it. */
adminCompetitionEntries.post(`/${ID}/entries/:regId{${UUID}}/disqualify`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const { reason } = await body(c, z.object({ reason: z.string().trim().min(5, 'Give a reason (at least a few words).').max(1000) }));
  const [r] = await db.select().from(registrations).where(and(eq(registrations.id, c.req.param('regId')), eq(registrations.competitionId, f.c.id)));
  if (!r) throw notFound('Registration not found');
  if (r.status === 'withdrawn') throw new HttpError(409, 'This registration was withdrawn.', 'withdrawn');
  await db.transaction(async (tx) => {
    await tx.update(registrations).set({ status: 'disqualified', disqualifyReason: reason }).where(eq(registrations.id, r.id));
    await tx.update(submissions).set({ status: 'disqualified' }).where(and(eq(submissions.registrationId, r.id), eq(submissions.status, 'submitted')));
  });
  await audit(c, 'entry.disqualify', 'registration', r.id, { competition: f.c.id, reason });
  return c.json({ ok: true });
});

adminCompetitionEntries.post(`/${ID}/entries/:regId{${UUID}}/reinstate`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const [r] = await db.select().from(registrations).where(and(eq(registrations.id, c.req.param('regId')), eq(registrations.competitionId, f.c.id)));
  if (!r) throw notFound('Registration not found');
  if (r.status !== 'disqualified') throw new HttpError(409, 'Only a disqualified registration can be reinstated.');
  await db.transaction(async (tx) => {
    await tx.update(registrations).set({ status: 'registered', disqualifyReason: '' }).where(eq(registrations.id, r.id));
    await tx.update(submissions).set({ status: 'submitted' }).where(and(eq(submissions.registrationId, r.id), eq(submissions.status, 'disqualified')));
  });
  await audit(c, 'entry.reinstate', 'registration', r.id, { competition: f.c.id, previousReason: r.disqualifyReason });
  return c.json({ ok: true });
});

/** CSV: one row per entry (or per registration without one), with the table's filters. */
adminCompetitionEntries.get(`/${ID}/entries/export.csv`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const q = zFilters.parse(c.req.query());
  const withContacts = c.req.query('contacts') === '1';
  const rows = await rowsFor(c, f, q, 20_000, 0);
  const subs = await submissionsFor(c, rows.map((x) => x.r.id));
  const consents = await latestConsents(db, rows.map((x) => x.p.id));
  const contacts = withContacts ? await contactsFor(c, rows.map((x) => x.p.id)) : new Map();
  type Line = Row & { s: (typeof submissions.$inferSelect & { files: number }) | null };
  const lines = rows.flatMap((x): Line[] => {
    const list = subs.get(x.r.id) ?? [];
    return list.length ? list.map((s) => ({ ...x, s })) : [{ ...x, s: null }];
  });
  const date = (d: Date | null | undefined) => (d ? istDateTime(d) : '');
  const parents = (l: Line) => (contacts.get(l.p.id)?.parents ?? []) as { name: string; email: string; whatsapp: string }[];
  const columns: [string, (l: Line) => unknown][] = [
    ['Registration ID', (l) => regCode(l.r.id)], ['Registered (IST)', (l) => date(l.r.createdAt)], ['Registered by', (l) => l.r.registeredByType],
    ['Registration status', (l) => l.r.status], ['Disqualify reason', (l) => l.r.disqualifyReason],
    ['First name', (l) => l.p.firstName], ['Last name', (l) => (l.p.deletedAt ? '' : l.p.lastName)], ['Class', (l) => l.r.classAtRegistration],
    ['School', (l) => (l.p.deletedAt ? '' : l.p.schoolName)], ['City', (l) => l.p.city], ['State', (l) => stateName(l.p.state)],
    ['Group', (l) => f.groups.find((g) => g.id === l.r.groupId)?.letter ?? ''],
    ['Entry code', (l) => l.s?.entryCode ?? ''], ['Entry status', (l) => l.s?.status ?? 'no entry'], ['Submitted (IST)', (l) => date(l.s?.submittedAt)],
    ['Title', (l) => l.s?.title ?? ''], ['Files', (l) => l.s?.files ?? ''], ['Words', (l) => (l.s?.textContent.trim() ? l.s.textContent.trim().split(/\s+/).length : '')],
    ['Link', (l) => l.s?.linkUrl ?? ''], ['Flags', (l) => (l.s?.adminFlags ?? []).map((x) => FLAG_LABEL[x] ?? x)], ['Admin notes', (l) => l.s?.adminNotes ?? ''],
    ['Hidden from public', (l) => (l.s ? (l.s.hiddenFromPublic ? 'yes' : 'no') : '')],
    ['Publication consent', (l) => (consents.get(l.p.id)?.publication ? 'yes' : 'no')], ['Book news consent', (l) => (consents.get(l.p.id)?.marketing ? 'yes' : 'no')],
    ...f.fields.map((fd): [string, (l: Line) => unknown] => [fd.label, (l) => l.r.customAnswers[fd.key] ?? '']),
    ['UTM source', (l) => l.r.utmSource], ['UTM medium', (l) => l.r.utmMedium], ['UTM campaign', (l) => l.r.utmCampaign],
    ['UTM content', (l) => l.r.utmContent], ['UTM term', (l) => l.r.utmTerm], ['Referral code', (l) => l.r.referralCode], ['Referred by', (l) => l.r.referredByCode],
    ...(withContacts ? [
      ['Parent name', (l: Line) => parents(l).map((x) => x.name)], ['Parent email', (l: Line) => parents(l).map((x) => x.email)],
      ['Parent WhatsApp', (l: Line) => parents(l).map((x) => x.whatsapp)], ['Student email (own login)', (l: Line) => contacts.get(l.p.id)?.studentEmail ?? ''],
    ] as [string, (l: Line) => unknown][] : []),
  ];
  await audit(c, 'competition.export', 'competition', f.c.id, { rows: lines.length, contacts: withContacts, filters: { ...q, page: undefined } });
  const name = `${f.c.slug}-entries${withContacts ? '-with-contacts' : ''}.csv`;
  return c.body(toCsv(lines, columns), 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
});

/** Top-line numbers: registrations, entries, rate, splits, downloads, pending approvals. */
adminCompetitionEntries.get(`/${ID}/stats`, async (c) => {
  const { db } = c.get('deps');
  const f = await competition(c);
  const inThis = eq(registrations.competitionId, f.c.id);
  // Written out with table names: in a one-table query Drizzle leaves columns unqualified,
  // which would make "id" inside the subquery mean the submission's id.
  const has = (status: string) => `exists (select 1 from submissions s where s.registration_id = "registrations"."id" and s.status = '${status}')`;
  const submitted = sql<number>`count(*) filter (where ${sql.raw(has('submitted'))} and "registrations"."status" = 'registered')::int`;
  const active = sql<number>`count(*) filter (where "registrations"."status" = 'registered')::int`;
  const split = <T extends SQL | typeof registrations.groupId | typeof registrations.registeredByType | typeof registrations.howHeard | typeof registrations.utmSource>(col: T) =>
    db.select({ key: sql<string>`${col}`, registrations: active, submissions: submitted }).from(registrations).where(inThis).groupBy(col).orderBy(desc(active)).limit(25);
  const [[totals], byGroup, byType, byHowHeard, byUtm, downloads, [pending], [referred]] = await Promise.all([
    db.select({
      registrations: active, submissions: submitted,
      withdrawn: sql<number>`count(*) filter (where "registrations"."status" = 'withdrawn')::int`,
      disqualified: sql<number>`count(*) filter (where "registrations"."status" = 'disqualified')::int`,
      drafts: sql<number>`count(*) filter (where "registrations"."status" = 'registered' and ${sql.raw(has('draft'))} and not ${sql.raw(has('submitted'))})::int`,
    }).from(registrations).where(inThis),
    split(registrations.groupId), split(registrations.registeredByType), split(registrations.howHeard), split(registrations.utmSource),
    db.select({ id: competitionResources.id, title: competitionResources.title, total: sql<number>`count(${resourceDownloads.id})::int`, people: sql<number>`count(distinct coalesce(${resourceDownloads.userId}::text, ${resourceDownloads.registrationId}::text))::int` })
      .from(competitionResources).leftJoin(resourceDownloads, eq(resourceDownloads.resourceId, competitionResources.id))
      .where(eq(competitionResources.competitionId, f.c.id)).groupBy(competitionResources.id, competitionResources.title, competitionResources.sortOrder).orderBy(competitionResources.sortOrder),
    db.select({ n: sql<number>`count(*)::int` }).from(parentApprovalRequests).innerJoin(studentProfiles, eq(studentProfiles.id, parentApprovalRequests.studentProfileId))
      .where(and(eq(parentApprovalRequests.status, 'pending'), eq(studentProfiles.approvalStatus, 'pending'))),
    db.select({ n: sql<number>`count(*)::int` }).from(registrations).where(and(inThis, ne(registrations.referredByCode, ''))),
  ]);
  const rate = (s: number, r: number) => (r ? Math.round((s / r) * 1000) / 10 : 0);
  const named = (rows: { key: string; registrations: number; submissions: number }[], label: (k: string) => string) =>
    rows.map((x) => ({ label: label(x.key), registrations: x.registrations, submissions: x.submissions, rate: rate(x.submissions, x.registrations) }));
  return c.json({
    ...totals, rate: rate(totals.submissions, totals.registrations), referred: referred.n, pendingApprovals: pending.n,
    byGroup: f.groups.map((g) => {
      const x = byGroup.find((b) => b.key === g.id);
      return { label: g.name === `Group ${g.letter}` ? g.name : `${g.letter} · ${g.name}`, registrations: x?.registrations ?? 0, submissions: x?.submissions ?? 0, rate: rate(x?.submissions ?? 0, x?.registrations ?? 0) };
    }),
    byRegisteredBy: named(byType, (k) => (k === 'student' ? 'Student' : 'Parent')),
    byHowHeard: named(byHowHeard, (k) => k || '(not answered)'),
    byUtmSource: named(byUtm, (k) => k || '(none)'),
    downloads: { total: downloads.reduce((n, d) => n + d.total, 0), items: downloads },
  });
});
