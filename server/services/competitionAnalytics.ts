// Competition analytics (Admin → Competitions → Analytics): the registration funnel (page visits,
// sign-ins and form steps counted anonymously by the website, then submitted registrations and,
// for team competitions, approvals and uploads from the database), registrations per day,
// channels (visits and registrations, with conversion) and who registers.
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Q } from '../db/client.js';
import { accounts, competitionSignups, competitionStats, teamApplications, teamFiles, teamMembers } from '../db/schema.js';
import { stateName } from '../lib/states.js';
import { channelLabel, orderChannel, type OrderSource } from '../../src/shared/attribution.js';
import { FUNNEL_STEPS, type FunnelStep } from '../../src/shared/competitionFunnel.js';
import type { Competition } from '../../src/shared/competitions.js';

const IST = 330 * 60_000;
export const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

/** One browser reached a step: add it to today's count for its channel. */
export async function countStep(db: Q, slug: string, step: FunnelStep, visit: OrderSource | null | undefined, now: Date) {
  const channel = visit && (visit.first || visit.last) ? orderChannel(visit).channel : 'direct';
  await db.insert(competitionStats).values({ competitionSlug: slug, day: istDay(now), step, channel, n: 1 })
    .onConflictDoUpdate({ target: [competitionStats.competitionSlug, competitionStats.day, competitionStats.step, competitionStats.channel], set: { n: sql`${competitionStats.n} + 1` } });
}

const TYPE_LABEL: Record<string, string> = { student: 'Students', parent: 'Parents', teacher: 'Teachers', other: 'Others' };

export async function competitionAnalytics(db: Q, comp: Competition, days: number, now: Date) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const sinceDay = istDay(since);
  const team = Boolean(comp.team);
  const stats = await db.select().from(competitionStats).where(and(eq(competitionStats.competitionSlug, comp.slug), gte(competitionStats.day, sinceDay)));

  // Registrations in the period: who registered (account), when, and how many people.
  const regs: { userId: string; at: Date; people: number; state: string; extra: string; status?: string; id?: string }[] = team
    ? (await db.select({ id: teamApplications.id, userId: teamApplications.userId, at: teamApplications.createdAt, state: teamApplications.state, extra: teamApplications.category, status: teamApplications.status })
      .from(teamApplications).where(and(eq(teamApplications.competitionSlug, comp.slug), gte(teamApplications.createdAt, since)))).map((r) => ({ ...r, people: 0 }))
    : (await db.select({ userId: competitionSignups.userId, at: competitionSignups.createdAt, mode: competitionSignups.mode, people: sql<number>`jsonb_array_length(${competitionSignups.participants})::int` })
      .from(competitionSignups).where(and(eq(competitionSignups.competitionSlug, comp.slug), gte(competitionSignups.createdAt, since)))).map((r) => ({ userId: r.userId, at: r.at, people: r.people, state: '', extra: r.mode }));
  if (team && regs.length) {
    const members = await db.select({ app: teamMembers.applicationId, n: sql<number>`count(*)::int` }).from(teamMembers).where(inArray(teamMembers.applicationId, regs.map((r) => r.id!))).groupBy(teamMembers.applicationId);
    for (const r of regs) r.people = members.find((m) => m.app === r.id)?.n ?? 0;
  }
  const userIds = [...new Set(regs.map((r) => r.userId))];
  const accs = userIds.length ? await db.select({ userId: accounts.userId, type: accounts.accountType, channel: accounts.channel, state: accounts.state }).from(accounts).where(inArray(accounts.userId, userIds)) : [];
  const accOf = new Map(accs.map((a) => [a.userId, a]));

  // The funnel: website-counted steps, then the database.
  const stepTotal = (k: FunnelStep) => stats.filter((s) => s.step === k).reduce((n, s) => n + s.n, 0);
  const funnel: { key: string; label: string; hint: string; n: number; measured: 'site' | 'db' }[] = FUNNEL_STEPS.filter((s) => !s.team || team)
    .map((s) => ({ key: s.key, label: s.label, hint: s.hint, n: stepTotal(s.key), measured: 'site' as const }));
  funnel.push({ key: 'submitted', label: team ? 'Sent a team application' : 'Registered', hint: 'Saved registrations', n: regs.length, measured: 'db' });
  if (team) {
    const ids = regs.map((r) => r.id!);
    funnel.push({ key: 'approved', label: 'Approved', hint: 'Applications the organiser approved', n: regs.filter((r) => r.status === 'approved').length, measured: 'db' });
    const uploaded = ids.length ? await db.select({ n: sql<number>`count(distinct ${teamFiles.applicationId})::int` }).from(teamFiles)
      .where(and(inArray(teamFiles.applicationId, ids), eq(teamFiles.kind, 'comic'), sql`${teamFiles.replacedAt} is null`)) : [{ n: 0 }];
    funnel.push({ key: 'uploaded', label: 'Uploaded the comic', hint: 'Approved teams that uploaded their comic', n: uploaded[0]?.n ?? 0, measured: 'db' });
  }

  // Per day: visits and registrations.
  const daysList: string[] = [];
  for (let t = since.getTime() + 86_400_000; t <= now.getTime() + 1; t += 86_400_000) daysList.push(istDay(new Date(t)));
  if (!daysList.includes(istDay(now))) daysList.push(istDay(now));
  const daily = daysList.map((d) => ({
    day: d,
    visits: stats.filter((s) => s.step === 'view' && s.day === d).reduce((n, s) => n + s.n, 0),
    registrations: regs.filter((r) => istDay(r.at) === d).length,
  }));

  // Channels: visits (website) against registrations (the registering account's source).
  const ch = new Map<string, { visits: number; registrations: number }>();
  for (const s of stats.filter((x) => x.step === 'view')) ch.set(s.channel, { visits: (ch.get(s.channel)?.visits ?? 0) + s.n, registrations: ch.get(s.channel)?.registrations ?? 0 });
  for (const r of regs) {
    const k = accOf.get(r.userId)?.channel || 'unknown';
    ch.set(k, { visits: ch.get(k)?.visits ?? 0, registrations: (ch.get(k)?.registrations ?? 0) + 1 });
  }
  const channels = [...ch].map(([k, v]) => ({ key: k, label: channelLabel(k), ...v, conversion: v.visits ? Math.round((v.registrations / v.visits) * 1000) / 10 : null }))
    .sort((a, b) => b.registrations - a.registrations || b.visits - a.visits);

  const tally = (keys: string[]) => {
    const m = new Map<string, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n);
  };
  const groupLabel = (k: string) => comp.team?.groups.find((g) => g.key === k)?.label ?? k;
  return {
    team,
    funnel,
    daily,
    channels,
    totals: { registrations: regs.length, people: regs.reduce((n, r) => n + r.people, 0), visits: stepTotal('view'), conversion: stepTotal('view') ? Math.round((regs.length / stepTotal('view')) * 1000) / 10 : null },
    who: tally(regs.map((r) => TYPE_LABEL[accOf.get(r.userId)?.type ?? ''] ?? 'No profile yet')),
    states: tally(regs.map((r) => stateName(r.state || accOf.get(r.userId)?.state || '') || 'Not given')).slice(0, 10),
    kinds: team ? tally(regs.map((r) => groupLabel(r.extra))) : tally(regs.map((r) => (r.extra === 'group' ? 'Groups' : 'Individuals'))),
    measuredSince: stats.length ? stats.map((s) => s.day).sort()[0] : null,
  };
}
