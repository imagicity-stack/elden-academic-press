// Competitions, each one built in code on request: add an entry to COMPETITIONS below and
// it appears on /competitions, gets its own page with a registration form at
// /competitions/<slug>, shows in the Competitions section of each person's account, and
// its registrations appear in Admin → Competitions. Used by the website and the server.
//
// People sign in with Google and complete their profile first (name, WhatsApp, city,
// state, "I am a…"); no approval from anyone is needed.

import type { TeamConfig } from './teams';

export type FieldType = 'text' | 'textarea' | 'select' | 'class' | 'number' | 'email' | 'phone';

export interface Field {
  /** Lowercase letters, digits and _; the column name in the export. */
  key: string;
  label: string;
  type?: FieldType;
  /** For "select". */
  options?: string[];
  required?: boolean;
  help?: string;
  placeholder?: string;
}

export interface Competition {
  slug: string;
  title: string;
  /** One line under the title. */
  tagline: string;
  /** The page's main text: **bold**, *italic*, [links](https://…), lists with - or 1., ## headings. */
  about: string;
  /** A picture for the card and link previews (a full https:// URL or a /path in public/). */
  image?: string;
  /** India time, e.g. '2026-12-01T00:00:00+05:30'. Registration is open from opensAt until closesAt. */
  opensAt: string;
  closesAt: string;
  /** Short facts shown as a list, e.g. ['Who can enter', 'Classes 3 to 8']. */
  facts?: [label: string, value: string][];
  prizes?: string[];
  rules?: string[];
  /** Register one person at a time (a parent or teacher can register several). */
  individual?: { participant: Field[]; questions?: Field[] };
  /** Register a group: a group name, then each member. */
  group?: { minMembers: number; maxMembers: number; member: Field[]; questions?: Field[]; nameLabel?: string };
  /** Most registrations one account can make for this competition (default 10). */
  maxPerAccount?: number;
  /** Reachable by its link but not listed on /competitions (to check a page before announcing it). */
  unlisted?: boolean;
  /** A team competition: one application per team, reviewed by the organiser, then uploads. */
  team?: TeamConfig;
  /** A page design of its own (e.g. 'comic'); the rest of the site stays as it is. */
  theme?: 'comic';
  /** Official Instagram handle, without the @. */
  instagram?: string;
}

/** The competitions, newest first. */
export const COMPETITIONS: Competition[] = [
  {
    slug: 'doomsday-diaries',
    title: 'DoomsDay Diaries',
    tagline: 'Comic Creating Challenge · Doom Picked the Wrong Town. Doctor Doom has given your town 24 hours. Create the hero who stops him.',
    about: 'Doctor Doom has given your town 24 hours. Create the hero who stops him. Make a team comic of at least 40 pages by 5 December 2026, 11:59 PM IST.',
    opensAt: '2026-11-06T00:00:00+05:30',
    closesAt: '2026-12-05T23:59:59+05:30',
    theme: 'comic',
    instagram: 'eldenacademicpress',
    maxPerAccount: 10,
    team: {
      ageOn: '2026-11-06',
      minAge: 8,
      maxAge: 24,
      groups: [
        { key: 'junior', label: 'Junior Heroes', min: 8, max: 11 },
        { key: 'rising', label: 'Rising Heroes', min: 12, max: 14 },
        { key: 'senior', label: 'Senior Heroes', min: 15, max: 17 },
        { key: 'open', label: 'Open Heroes', min: 18, max: 24 },
      ],
      minMembers: 2,
      maxMembers: 4,
      roles: [
        { key: 'writer', label: 'Writer' },
        { key: 'artist', label: 'Artist', help: 'pencils and inks' },
        { key: 'colourist', label: 'Colourist' },
        { key: 'letterer', label: 'Letterer' },
      ],
      requiredRoles: ['writer', 'artist'],
      noMixedAdults: true,
      institutionTypes: [
        { key: 'school', label: 'School', same: true, placeholder: 'e.g. DAV Public School, Hazaribagh' },
        { key: 'college', label: 'College', same: true, placeholder: 'e.g. St. Columba’s College, Hazaribagh' },
        { key: 'other', label: 'Other institution', same: false, placeholder: 'Coaching centre, art academy, club or NGO (optional)' },
      ],
      instagramFromAge: 13,
      idDocs: [
        { key: 'school_id', label: 'School or college ID card' },
        { key: 'institution_letter', label: 'Letter from the school, college or institution' },
        { key: 'masked_aadhaar', label: 'Masked Aadhaar (only the last 4 digits showing)' },
        { key: 'govt_id', label: 'Other government photo ID' },
      ],
      files: [
        { kind: 'comic', label: 'Comic (PDF)', help: 'The full comic as one PDF: at least 40 story pages (60 at most), plus the cover, title and credits pages. Up to 100 MB.', minPages: 40, maxMb: 100 },
        { kind: 'sketches', label: 'Rough pencil sketches (PDF)', help: 'Proof of work: your rough pencil sketches or layouts as one PDF of at least 40 pages. Digital artists: screenshots of the working files with layers. Up to 100 MB.', minPages: 40, maxMb: 100 },
      ],
      codePrefix: 'DD',
      submissionDeadline: '2026-12-05T23:59:59+05:30',
      resultsOn: '2026-12-15',
    },
  },
];

export const findCompetition = (slug: string) => COMPETITIONS.find((c) => c.slug === slug) ?? null;
export const listedCompetitions = () => COMPETITIONS.filter((c) => !c.unlisted);

export type Phase = 'upcoming' | 'open' | 'closed';
/** The server's clock decides; the website's copy is for show. */
export function phaseOf(c: Pick<Competition, 'opensAt' | 'closesAt'>, now = Date.now()): Phase {
  if (now < Date.parse(c.opensAt)) return 'upcoming';
  if (now <= Date.parse(c.closesAt)) return 'open';
  return 'closed';
}
export const PHASE_LABEL: Record<Phase, string> = { upcoming: 'Coming soon', open: 'Open', closed: 'Closed' };

export const ACCOUNT_TYPES = [['student', 'Student'], ['parent', 'Parent'], ['teacher', 'Teacher'], ['other', 'Other']] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number][0];
export const accountTypeLabel = (t: string | null | undefined) => ACCOUNT_TYPES.find(([k]) => k === t)?.[1] ?? '';

export const CLASS_OPTIONS = Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`);

/* ---------------- India time ---------------- */

const IST = 'Asia/Kolkata';
/** "8 Dec 2026, 11:59 PM IST" */
export function istDateTime(d: string | Date): string {
  const s = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(d)).replace(/\b(am|pm)\b/, (m) => m.toUpperCase());
  return `${s} IST`;
}
/** "8 Dec 2026" */
export const istDay = (d: string | Date) => new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));

/* ---------------- Checking a registration ---------------- */

export interface SignupInput { mode: 'individual' | 'group'; groupName?: string; answers?: Record<string, unknown>; participants?: Record<string, unknown>[] }
export interface CleanSignup { mode: 'individual' | 'group'; groupName: string; answers: Record<string, string>; participants: Record<string, string>[] }

const clean = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, 2000) : '');

function checkFields(fields: Field[], raw: Record<string, unknown> | undefined, where: string, errors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = clean(raw?.[f.key]);
    if (!v) {
      if (f.required) errors.push(`${where}${f.label} is needed.`);
      continue;
    }
    const type = f.type ?? 'text';
    if (type === 'select' && !(f.options ?? []).includes(v)) errors.push(`${where}${f.label}: choose one of the options.`);
    else if (type === 'class' && !CLASS_OPTIONS.includes(v)) errors.push(`${where}${f.label}: choose a class.`);
    else if (type === 'number' && !/^-?\d+(\.\d+)?$/.test(v)) errors.push(`${where}${f.label} must be a number.`);
    else if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors.push(`${where}${f.label} isn’t a valid email.`);
    else if (type === 'phone' && !/^(\+?91)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, ''))) errors.push(`${where}${f.label} must be a 10-digit mobile number.`);
    else if (type !== 'textarea' && v.length > 200) errors.push(`${where}${f.label} is too long.`);
    out[f.key] = v;
  }
  return out;
}

/** The registration as it will be saved, or what's wrong with it. */
export function checkSignup(c: Competition, input: SignupInput): { ok: true; signup: CleanSignup } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (input.mode === 'individual') {
    if (!c.individual) return { ok: false, errors: ['This competition takes group registrations only.'] };
    const answers = checkFields(c.individual.questions ?? [], input.answers, '', errors);
    const person = checkFields(c.individual.participant, input.participants?.[0], '', errors);
    return errors.length ? { ok: false, errors } : { ok: true, signup: { mode: 'individual', groupName: '', answers, participants: [person] } };
  }
  if (input.mode !== 'group' || !c.group) return { ok: false, errors: ['This competition takes individual registrations only.'] };
  const g = c.group;
  const groupName = clean(input.groupName).slice(0, 120);
  if (!groupName) errors.push(`${g.nameLabel ?? 'Group name'} is needed.`);
  const answers = checkFields(g.questions ?? [], input.answers, '', errors);
  const members = (input.participants ?? []).slice(0, g.maxMembers + 1);
  if (members.length < g.minMembers || members.length > g.maxMembers) {
    errors.push(g.minMembers === g.maxMembers ? `A group has ${g.minMembers} members.` : `A group has ${g.minMembers} to ${g.maxMembers} members.`);
  }
  const participants = members.slice(0, g.maxMembers).map((m, i) => checkFields(g.member, m, `Member ${i + 1}: `, errors));
  return errors.length ? { ok: false, errors } : { ok: true, signup: { mode: 'group', groupName, answers, participants } };
}

/** "Riya Sharma" from a participant's answers (first name / last name / name fields). */
export function personName(p: Record<string, string>) {
  return [p.name, p.full_name, p.first_name, p.last_name, p.student_name].filter(Boolean).join(' ').trim() || Object.values(p)[0] || '';
}
