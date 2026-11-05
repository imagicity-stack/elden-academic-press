// Admin → Competitions: every competition built in src/shared/competitions.ts appears here
// by itself, with its registrations (and who made them) and a CSV export. Owner only.
import { Hono } from 'hono';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppEnv } from '../../app.js';
import type { Deps } from '../../deps.js';
import { accounts, competitionSignups } from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { notFound } from '../../lib/http.js';
import { stateName } from '../../lib/states.js';
import { accountTypeLabel, COMPETITIONS, findCompetition, istDateTime, personName, phaseOf, type Competition, type Field } from '../../../src/shared/competitions.js';
import { audit } from './auth.js';

export const adminCompetitions = new Hono<AppEnv>();

const ref = (id: string) => id.slice(0, 8).toUpperCase();

adminCompetitions.get('/', async (c) => {
  const { db, now } = c.get('deps');
  const totals = await db.select({
    slug: competitionSignups.competitionSlug,
    registrations: sql<number>`count(*)::int`,
    groups: sql<number>`count(*) filter (where ${competitionSignups.mode} = 'group')::int`,
    people: sql<number>`coalesce(sum(jsonb_array_length(${competitionSignups.participants})), 0)::int`,
  }).from(competitionSignups).groupBy(competitionSignups.competitionSlug);
  return c.json({
    items: COMPETITIONS.map((x) => {
      const t = totals.find((r) => r.slug === x.slug);
      return {
        slug: x.slug, title: x.title, tagline: x.tagline, opensAt: x.opensAt, closesAt: x.closesAt, phase: phaseOf(x, now().getTime()), unlisted: Boolean(x.unlisted),
        modes: [x.individual && 'individual', x.group && 'group'].filter(Boolean),
        registrations: t?.registrations ?? 0, groups: t?.groups ?? 0, people: t?.people ?? 0,
      };
    }),
  });
});

async function load(db: Deps['db'], comp: Competition) {
  const rows = await db.select().from(competitionSignups).where(eq(competitionSignups.competitionSlug, comp.slug)).orderBy(desc(competitionSignups.createdAt)).limit(20_000);
  const ids = [...new Set(rows.map((r) => r.userId))];
  const people = ids.length ? await db.select().from(accounts).where(inArray(accounts.userId, ids)) : [];
  return rows.map((r) => ({ r, a: people.find((p) => p.userId === r.userId) }));
}

/** Every question this competition asks, so the table and the export have a column for each. */
function columns(comp: Competition) {
  const uniq = (fs: Field[]) => fs.filter((f, i) => fs.findIndex((g) => g.key === f.key) === i);
  return {
    questions: uniq([...(comp.individual?.questions ?? []), ...(comp.group?.questions ?? [])]),
    person: uniq([...(comp.individual?.participant ?? []), ...(comp.group?.member ?? [])]),
  };
}

adminCompetitions.get('/:slug', async (c) => {
  const comp = findCompetition(c.req.param('slug'));
  if (!comp) throw notFound('Competition not found');
  const { now } = c.get('deps');
  const rows = await load(c.get('deps').db, comp);
  const cols = columns(comp);
  return c.json({
    competition: { slug: comp.slug, title: comp.title, opensAt: comp.opensAt, closesAt: comp.closesAt, phase: phaseOf(comp, now().getTime()), unlisted: Boolean(comp.unlisted) },
    questions: cols.questions.map((f) => ({ key: f.key, label: f.label })),
    personFields: cols.person.map((f) => ({ key: f.key, label: f.label })),
    items: rows.map(({ r, a }) => ({
      id: r.id, ref: ref(r.id), createdAt: r.createdAt, mode: r.mode, groupName: r.groupName, answers: r.answers,
      participants: r.participants, names: r.participants.map(personName),
      by: { name: a?.fullName || a?.name || '', email: r.email, phone: a?.phone ?? '', city: a?.city ?? '', state: stateName(a?.state), type: accountTypeLabel(a?.accountType) },
    })),
  });
});

/** One row per person taking part (a group's members each get a row, with the group's details). */
adminCompetitions.get('/:slug/export.csv', async (c) => {
  const comp = findCompetition(c.req.param('slug'));
  if (!comp) throw notFound('Competition not found');
  const rows = await load(c.get('deps').db, comp);
  const cols = columns(comp);
  type Line = (typeof rows)[number] & { person: Record<string, string>; n: number };
  const lines: Line[] = rows.flatMap((x) => (x.r.participants.length ? x.r.participants : [{}]).map((person, i) => ({ ...x, person, n: i + 1 })));
  const csv = toCsv(lines, [
    ['Reference', (l) => ref(l.r.id)], ['Registered (IST)', (l) => istDateTime(l.r.createdAt)], ['Type', (l) => l.r.mode], ['Group', (l) => l.r.groupName],
    ['Person no.', (l) => l.n],
    ...cols.person.map((f): [string, (l: Line) => unknown] => [f.label, (l) => l.person[f.key] ?? '']),
    ...cols.questions.map((f): [string, (l: Line) => unknown] => [f.label, (l) => l.r.answers[f.key] ?? '']),
    ['Registered by', (l) => l.a?.fullName || l.a?.name || ''], ['I am a', (l) => accountTypeLabel(l.a?.accountType)], ['Email', (l) => l.r.email],
    ['WhatsApp', (l) => l.a?.phone ?? ''], ['City', (l) => l.a?.city ?? ''], ['State', (l) => stateName(l.a?.state)],
  ]);
  await audit(c, 'competition.export', 'competition', comp.slug, { rows: lines.length });
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${comp.slug}-registrations.csv"`, 'Cache-Control': 'no-store' });
});
