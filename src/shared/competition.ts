// Competition rules shared by the server (which decides) and the website (which
// only displays). Pure functions: no database, no browser.
//
// Times are stored in UTC and shown in India time (IST) with "IST" written next
// to them. A window is open from its opening instant up to and including its
// closing instant; the admin's "closes at 11:59 PM" is saved as 23:59:59.999 IST,
// so an entry at 23:59:59 on the deadline day counts and one at 00:00:01 doesn't.

export type CompetitionStatus =
  | 'DRAFT' | 'ARCHIVED'
  /** Published, but before its announcement date: not listed yet. */
  | 'SCHEDULED'
  | 'COMING_SOON'
  | 'REGISTRATION_OPEN' | 'SUBMISSIONS_OPEN' | 'BOTH_OPEN'
  /** Registration has closed and submissions open later. */
  | 'SUBMISSIONS_SOON'
  | 'CLOSED' | 'JUDGING' | 'VOTING' | 'RESULTS_OUT';

type When = Date | string | null | undefined;

export interface CompetitionTimes {
  publishState: 'draft' | 'published' | 'archived';
  announceAt?: When;
  registrationOpensAt?: When;
  registrationClosesAt?: When;
  submissionOpensAt?: When;
  submissionClosesAt?: When;
  submissionGraceMinutes?: number | null;
  judgingStartsAt?: When;
  votingOpensAt?: When;
  votingClosesAt?: When;
  resultsAt?: When;
  resultsPublished?: boolean;
  submissionRequired?: boolean;
}

const ms = (d: When) => (d == null || d === '' ? null : new Date(d).getTime());

function inWindow(t: number, opens: When, closes: When, extraMs = 0) {
  const o = ms(opens);
  const c = ms(closes);
  if (o == null) return false;
  return t >= o && (c == null || t <= c + extraMs);
}

export const registrationOpen = (c: CompetitionTimes, now: Date) =>
  c.publishState === 'published' && inWindow(now.getTime(), c.registrationOpensAt, c.registrationClosesAt);

/** Includes the grace minutes after the deadline. */
export const submissionOpen = (c: CompetitionTimes, now: Date) =>
  c.publishState === 'published' && c.submissionRequired !== false &&
  inWindow(now.getTime(), c.submissionOpensAt, c.submissionClosesAt, (c.submissionGraceMinutes ?? 0) * 60_000);

export function getCompetitionStatus(c: CompetitionTimes, now: Date): CompetitionStatus {
  if (c.publishState === 'draft') return 'DRAFT';
  if (c.publishState === 'archived') return 'ARCHIVED';
  const t = now.getTime();
  const announce = ms(c.announceAt);
  if (announce != null && t < announce) return 'SCHEDULED';

  const reg = registrationOpen(c, now);
  const sub = submissionOpen(c, now);
  if (reg && sub) return 'BOTH_OPEN';
  if (reg) return 'REGISTRATION_OPEN';
  if (sub) return 'SUBMISSIONS_OPEN';

  const regOpens = ms(c.registrationOpensAt);
  const subOpens = c.submissionRequired === false ? null : ms(c.submissionOpensAt);
  const opens = [regOpens, subOpens].filter((x): x is number => x != null);
  if (!opens.length || t < Math.min(...opens)) return 'COMING_SOON';
  if (subOpens != null && t < subOpens) return 'SUBMISSIONS_SOON';
  if (regOpens != null && t < regOpens) return 'COMING_SOON';

  if (c.resultsPublished) return 'RESULTS_OUT';
  if (inWindow(t, c.votingOpensAt, c.votingClosesAt)) return 'VOTING';
  const judging = ms(c.judgingStartsAt);
  if (judging != null && t >= judging) return 'JUDGING';
  return 'CLOSED';
}

/** Shown in the public list (and reachable by link) at all. */
export const isPublic = (s: CompetitionStatus) => s !== 'DRAFT' && s !== 'ARCHIVED' && s !== 'SCHEDULED';

export const STATUS_LABEL: Record<CompetitionStatus, string> = {
  DRAFT: 'Draft', ARCHIVED: 'Archived', SCHEDULED: 'Scheduled', COMING_SOON: 'Coming soon',
  REGISTRATION_OPEN: 'Registration open', SUBMISSIONS_OPEN: 'Submissions open', BOTH_OPEN: 'Open',
  SUBMISSIONS_SOON: 'Submissions open soon', CLOSED: 'Closed', JUDGING: 'Judging', VOTING: 'Voting', RESULTS_OUT: 'Results out',
};

/** Which tab of the public list a competition goes in. */
export function listTab(s: CompetitionStatus): 'open' | 'upcoming' | 'past' | null {
  if (!isPublic(s)) return null;
  if (s === 'REGISTRATION_OPEN' || s === 'SUBMISSIONS_OPEN' || s === 'BOTH_OPEN' || s === 'SUBMISSIONS_SOON') return 'open';
  if (s === 'COMING_SOON') return 'upcoming';
  return 'past';
}

/* ---------------- India time ---------------- */

const IST = 'Asia/Kolkata';

/** "8 Dec 2026, 11:59 PM IST" */
export function istDateTime(d: When): string {
  if (ms(d) == null) return '';
  const s = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(d!)).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
  return `${s} IST`;
}

/** "8 Dec 2026" */
export function istDay(d: When): string {
  if (ms(d) == null) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d!));
}

/* ---------------- Who can enter ---------------- */

export interface GroupRange { id: string; name: string; classMin: number; classMax: number }

/** The group a student of this class goes in, if any. */
export const groupForClass = <G extends GroupRange>(groups: G[], classGrade: number): G | undefined =>
  groups.find((g) => classGrade >= g.classMin && classGrade <= g.classMax);

export const regionAllows = (c: { regionScope: string; states: string[] }, stateCode: string) =>
  c.regionScope !== 'states' || c.states.includes(stateCode);

/** Two groups of one competition may not share a class. */
export function overlappingGroups(groups: Pick<GroupRange, 'name' | 'classMin' | 'classMax'>[]): [string, string] | null {
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j];
      if (a.classMin <= b.classMax && b.classMin <= a.classMax) return [a.name, b.name];
    }
  }
  return null;
}

export const CLASSES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const classLabel = (n: number) => `Class ${n}`;

/** Academic sessions start in April: a class confirmed before this April needs checking again. */
export function classNeedsConfirming(confirmedAt: When, now: Date): boolean {
  const c = ms(confirmedAt);
  if (c == null) return true;
  const april = new Date(Date.UTC(now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1, 3, 1) - 5.5 * 3600_000);
  return c < april.getTime() && now.getTime() >= april.getTime();
}

/** Words in a piece of text (any script, including Devanagari). */
export const countWords = (text: string) => (text.trim().match(/[^\s]+/g) ?? []).length;

export const COMPETITION_TYPES = ['comic', 'story', 'essay', 'drawing', 'poem', 'quiz', 'video', 'photo', 'live_event', 'other'] as const;
export const TYPE_LABEL: Record<(typeof COMPETITION_TYPES)[number], string> = {
  comic: 'Comic', story: 'Story', essay: 'Essay', drawing: 'Drawing', poem: 'Poem', quiz: 'Quiz', video: 'Video', photo: 'Photo', live_event: 'Live event', other: 'Other',
};
