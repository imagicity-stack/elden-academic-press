import { describe, expect, it } from 'vitest';
import {
  classNeedsConfirming, countWords, getCompetitionStatus, groupForClass, istDateTime, listTab, overlappingGroups, registrationOpen, submissionOpen,
  type CompetitionTimes,
} from '../src/shared/competition.js';

const ist = (s: string) => new Date(`${s}+05:30`);

// Registration 14–30 Nov, submissions 20 Nov – 8 Dec (11:59 PM IST), judging 10 Dec, results 20 Dec.
const base: CompetitionTimes = {
  publishState: 'published',
  announceAt: ist('2026-11-10T00:00:00'),
  registrationOpensAt: ist('2026-11-14T00:00:00'),
  registrationClosesAt: ist('2026-11-30T23:59:59.999'),
  submissionOpensAt: ist('2026-11-20T00:00:00'),
  submissionClosesAt: ist('2026-12-08T23:59:59.999'),
  submissionGraceMinutes: 0,
  judgingStartsAt: ist('2026-12-10T00:00:00'),
  resultsAt: ist('2026-12-20T10:00:00'),
  resultsPublished: false,
};
const at = (s: string, c: CompetitionTimes = base) => getCompetitionStatus(c, ist(s));

describe('getCompetitionStatus', () => {
  it('follows publish state first', () => {
    expect(getCompetitionStatus({ ...base, publishState: 'draft' }, ist('2026-11-20T10:00:00'))).toBe('DRAFT');
    expect(getCompetitionStatus({ ...base, publishState: 'archived' }, ist('2026-11-20T10:00:00'))).toBe('ARCHIVED');
  });

  it('stays hidden before the announcement, then is coming soon', () => {
    expect(at('2026-11-09T23:59:59')).toBe('SCHEDULED');
    expect(listTab(at('2026-11-09T23:59:59'))).toBeNull();
    expect(at('2026-11-10T00:00:00')).toBe('COMING_SOON');
    expect(at('2026-11-13T23:59:59.999')).toBe('COMING_SOON');
    expect(listTab('COMING_SOON')).toBe('upcoming');
  });

  it('opens registration at exactly midnight IST', () => {
    expect(at('2026-11-14T00:00:00')).toBe('REGISTRATION_OPEN');
    expect(registrationOpen(base, ist('2026-11-13T23:59:59.999'))).toBe(false);
    expect(registrationOpen(base, ist('2026-11-14T00:00:00'))).toBe(true);
  });

  it('runs the two windows independently', () => {
    expect(at('2026-11-20T00:00:00')).toBe('BOTH_OPEN');
    expect(at('2026-11-30T23:59:59')).toBe('BOTH_OPEN');
    expect(at('2026-12-01T00:00:01')).toBe('SUBMISSIONS_OPEN');
  });

  it('accepts an entry at 23:59:59 IST on the deadline day, not at 00:00:01 the next day', () => {
    expect(submissionOpen(base, ist('2026-12-08T23:59:00'))).toBe(true);
    expect(submissionOpen(base, ist('2026-12-08T23:59:59'))).toBe(true);
    expect(submissionOpen(base, ist('2026-12-09T00:00:01'))).toBe(false);
    expect(at('2026-12-09T00:00:01')).toBe('CLOSED');
  });

  it('allows the grace minutes after the deadline', () => {
    const g = { ...base, submissionGraceMinutes: 15 };
    expect(submissionOpen(g, ist('2026-12-09T00:14:59'))).toBe(true);
    expect(submissionOpen(g, ist('2026-12-09T00:15:00'))).toBe(false);
  });

  it('waits between windows when submissions open after registration closes', () => {
    const later = { ...base, submissionOpensAt: ist('2026-12-02T00:00:00') };
    expect(at('2026-12-01T12:00:00', later)).toBe('SUBMISSIONS_SOON');
    expect(at('2026-12-02T00:00:00', later)).toBe('SUBMISSIONS_OPEN');
  });

  it('closes, judges, votes and publishes results in order', () => {
    expect(at('2026-12-09T23:59:59')).toBe('CLOSED');
    expect(at('2026-12-10T00:00:00')).toBe('JUDGING');
    const voting = { ...base, votingOpensAt: ist('2026-12-12T00:00:00'), votingClosesAt: ist('2026-12-15T23:59:59.999') };
    expect(at('2026-12-13T12:00:00', voting)).toBe('VOTING');
    expect(at('2026-12-16T00:00:00', voting)).toBe('JUDGING');
    expect(at('2026-12-21T10:00:00')).toBe('JUDGING'); // results date passed but not published yet
    expect(at('2026-12-21T10:00:00', { ...base, resultsPublished: true })).toBe('RESULTS_OUT');
    expect(listTab('RESULTS_OUT')).toBe('past');
  });

  it('ignores the submission window when no submission is needed', () => {
    const regOnly = { ...base, submissionRequired: false };
    expect(at('2026-11-25T10:00:00', regOnly)).toBe('REGISTRATION_OPEN');
    expect(at('2026-12-05T10:00:00', regOnly)).toBe('CLOSED');
  });
});

describe('competition helpers', () => {
  it('writes dates in IST', () => {
    expect(istDateTime(ist('2026-12-08T23:59:59.999'))).toBe('8 Dec 2026, 11:59 PM IST');
    expect(istDateTime(new Date('2026-11-13T18:30:00Z'))).toBe('14 Nov 2026, 12:00 AM IST');
  });

  it('places a class in its group and spots overlapping groups', () => {
    const groups = [{ id: 'a', name: 'Group A', classMin: 3, classMax: 5 }, { id: 'b', name: 'Group B', classMin: 6, classMax: 8 }];
    expect(groupForClass(groups, 5)?.id).toBe('a');
    expect(groupForClass(groups, 6)?.id).toBe('b');
    expect(groupForClass(groups, 9)).toBeUndefined();
    expect(overlappingGroups(groups)).toBeNull();
    expect(overlappingGroups([...groups, { name: 'Group C', classMin: 8, classMax: 10 }])).toEqual(['Group B', 'Group C']);
  });

  it('asks to confirm the class once each April', () => {
    expect(classNeedsConfirming(ist('2026-06-01T10:00:00'), ist('2027-03-31T10:00:00'))).toBe(false);
    expect(classNeedsConfirming(ist('2026-06-01T10:00:00'), ist('2027-04-02T10:00:00'))).toBe(true);
    expect(classNeedsConfirming(ist('2027-04-05T10:00:00'), ist('2027-05-01T10:00:00'))).toBe(false);
  });

  it('counts words in English and Hindi', () => {
    expect(countWords('  The quick   brown fox ')).toBe(4);
    expect(countWords('मेरा नाम रिया है')).toBe(4);
  });
});
