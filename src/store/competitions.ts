// Competitions on the website: types for the public API and the family's own data.
import type { CompetitionStatus } from '../shared/competition';

type Iso = string | null;
export interface CompetitionCard {
  id: string; slug: string; title: string; tagline: string; type: string; status: CompetitionStatus;
  thumbnailUrl: string | null; squareUrl: string | null; bannerUrl: string | null; regionScope: string; states: string[]; submissionRequired: boolean;
  dates: { registrationOpensAt: Iso; registrationClosesAt: Iso; submissionOpensAt: Iso; submissionClosesAt: Iso; resultsAt: Iso };
  groups: { id: string; name: string; classMin: number; classMax: number }[];
}
export interface CompetitionPage {
  id: string; slug: string; title: string; tagline: string; type: string; prompt: string; description: string; rulesContent: string; rulesPdfUrl: string | null;
  disclaimer: string; thumbnailUrl: string | null; squareUrl: string | null; bannerUrl: string | null; languages: string[]; organiserName: string;
  faqs: { question: string; answer: string }[]; judges: { name: string; role: string; photoUrl: string | null }[];
  regionScope: string; states: string[]; maxEntriesPerStudent: number; isPaid: boolean; seatCap: number | null; seatsLeft: number | null;
  dates: {
    announceAt: Iso; registrationOpensAt: Iso; registrationClosesAt: Iso; submissionOpensAt: Iso; submissionClosesAt: Iso; submissionGraceMinutes: number;
    judgingStartsAt: Iso; shortlistAt: Iso; votingOpensAt: Iso; votingClosesAt: Iso; resultsAt: Iso;
  };
  publishState: string; resultsPublished: boolean; submissionRequired: boolean;
  submission: {
    types: ('file' | 'text' | 'link')[]; mimeTypes: string[]; maxFileSizeMb: number; maxMainFiles: number;
    extraFiles: { key: string; label: string; helpText: string; required: boolean }[]; minWords: number | null; maxWords: number | null;
    allowEditUntilDeadline: boolean; allowWithdraw: boolean; declarationText: string;
  };
  status: CompetitionStatus;
  groups: { id: string; name: string; letter: string; classMin: number; classMax: number; formatNote: string; minWords: number | null; maxWords: number | null; maxMainFiles: number | null }[];
  fields: { key: string; label: string; type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'number'; options: string[]; required: boolean; helpText: string }[];
  resources: { id: string; title: string; description: string; visibility: 'public' | 'registered_only'; fileName: string }[];
  prizes: { groupId: string | null; rankFrom: number | null; rankTo: number | null; awardName: string; description: string; prizeType: string }[];
  seo: { title: string; description: string; imageUrl: string | null };
  preview?: boolean;
}
export interface MyStudentHere {
  id: string; firstName: string; classGrade: number; relation: 'parent' | 'self'; approvalStatus: string;
  group: { id: string; name: string; formatNote: string } | null; notEligible: string | null;
  registration: { id: string; status: string } | null; submission: { id: string; status: string; entryCode: string } | null;
}
export interface MeHere { signedIn: boolean; account?: { type: 'parent' | 'student' | null; completed: boolean }; students?: MyStudentHere[] }

export interface RegistrationView {
  id: string; status: string; createdAt: string; relation: 'parent' | 'self';
  student: { id: string; firstName: string; classGrade: number };
  group: { name: string; letter: string; formatNote: string; minWords: number | null; maxWords: number | null; maxMainFiles: number | null } | null;
  competition: CompetitionPage;
  deadline: { at: string; label: string } | null;
  canSubmit: boolean;
  resources: { id: string; title: string; description: string; visibility: string; fileName: string; unlocked: boolean }[];
  submissions: { id: string; entryCode: string; status: string; submittedAt: string | null; title: string }[];
  referralUrl: string | null;
  upsell: { headline: string; url: string; title: string | null; coverUrl: string | null } | null;
}

/** The referral code and campaign details a visitor arrived with (kept for this visit). */
export function arrival() {
  try {
    const q = new URLSearchParams(location.search);
    const keep = (k: string, v: string | null) => { if (v) sessionStorage.setItem(`elden-${k}`, v.slice(0, 150)); };
    keep('ref', q.get('ref')?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? null);
    for (const k of ['source', 'medium', 'campaign', 'content', 'term']) keep(`utm_${k}`, q.get(`utm_${k}`));
  } catch { /* ignore */ }
}
export function arrivalData() {
  const get = (k: string) => { try { return sessionStorage.getItem(`elden-${k}`) ?? ''; } catch { return ''; } };
  return {
    ref: get('ref'),
    utm: { source: get('utm_source'), medium: get('utm_medium'), campaign: get('utm_campaign'), content: get('utm_content'), term: get('utm_term') },
  };
}

export const classesLabel = (groups: { classMin: number; classMax: number }[]) => {
  if (!groups.length) return '';
  const lo = Math.min(...groups.map((g) => g.classMin)), hi = Math.max(...groups.map((g) => g.classMax));
  return lo === hi ? `Class ${lo}` : `Classes ${lo}–${hi}`;
};
