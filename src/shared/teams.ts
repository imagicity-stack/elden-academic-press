// Team competitions (DoomsDay Diaries first): the rules a team must meet, checked the same
// way in the registration form (for instant feedback) and on the server (the final word).

export interface TeamGroup { key: string; label: string; min: number; max: number }
export interface TeamFileSpec { kind: string; label: string; help: string; minPages: number; maxMb: number }

export interface TeamConfig {
  /** Ages are counted on this day (YYYY-MM-DD). */
  ageOn: string;
  minAge: number;
  maxAge: number;
  /** Age groups; a team's group is set by its oldest member. */
  groups: TeamGroup[];
  minMembers: number;
  maxMembers: number;
  roles: { key: string; label: string; help?: string }[];
  /** Every team needs these roles (one person may hold several). */
  requiredRoles: string[];
  /** Members under 18 and members aged 18 or above can't be on the same team. */
  noMixedAdults: boolean;
  /** For "same", every member is from the team's institution; otherwise each member names their own. */
  institutionTypes: { key: string; label: string; same: boolean; placeholder: string }[];
  /** Members this age or older give their Instagram username. */
  instagramFromAge: number | null;
  idDocs: { key: string; label: string }[];
  /** Files an approved team uploads before the deadline. */
  files: TeamFileSpec[];
  /** Application numbers look like DD-0007. */
  codePrefix: string;
  /** Uploads close (India time). Registration closes at the competition's closesAt. */
  submissionDeadline: string;
  resultsOn: string;
}

export interface MemberInput {
  fullName: string; dob: string; email: string; phone: string; institutionName: string; roles: string[]; instagram: string;
  idDocType: string; idDocKey: string;
  guardianName: string; guardianRelation: string; guardianPhone: string; guardianEmail: string; guardianConsent: boolean;
}
export interface TeamInput {
  teamName: string; institutionType: string; institutionName: string; city: string; state: string;
  members: MemberInput[]; acceptRules: boolean; confirmTrue: boolean;
}

export const emptyMember = (): MemberInput => ({
  fullName: '', dob: '', email: '', phone: '', institutionName: '', roles: [], instagram: '', idDocType: '', idDocKey: '',
  guardianName: '', guardianRelation: '', guardianPhone: '', guardianEmail: '', guardianConsent: false,
});

/** Age in whole years on `on` (both YYYY-MM-DD); null for a date that isn't real. */
export function ageOn(dob: string, on: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(on);
  if (!m || !n) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(y, mo - 1, d));
  if (real.getUTCFullYear() !== y || real.getUTCMonth() !== mo - 1 || real.getUTCDate() !== d) return null;
  const [y2, mo2, d2] = [Number(n[1]), Number(n[2]), Number(n[3])];
  return y2 - y - (mo2 < mo || (mo2 === mo && d2 < d) ? 1 : 0);
}

export const groupFor = (cfg: TeamConfig, age: number) => cfg.groups.find((g) => age >= g.min && age <= g.max) ?? null;

/** 10-digit Indian mobile number, or '' if it isn't one. */
export function mobile(v: string) {
  const d = (v ?? '').replace(/[\s-]/g, '').replace(/^(\+91|0091|0)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
const emailOk = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const instaOk = (v: string) => /^@?[A-Za-z0-9._]{1,30}$/.test(v);
const trim = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface TeamCheck {
  errors: string[];
  /** The age group from the oldest member (null until the dates of birth allow it). */
  group: TeamGroup | null;
  ages: (number | null)[];
  team: TeamInput;
}

/** Everything the rules require of a team. `who` names a member in messages ("Member 2"). */
export function checkTeam(cfg: TeamConfig, raw: TeamInput): TeamCheck {
  const errors: string[] = [];
  const inst = cfg.institutionTypes.find((x) => x.key === raw.institutionType);
  const team: TeamInput = {
    teamName: trim(raw.teamName, 60), institutionType: inst?.key ?? '', institutionName: trim(raw.institutionName, 120),
    city: trim(raw.city, 60), state: trim(raw.state, 4), acceptRules: Boolean(raw.acceptRules), confirmTrue: Boolean(raw.confirmTrue),
    members: (raw.members ?? []).slice(0, cfg.maxMembers + 1).map((m) => ({
      fullName: trim(m.fullName, 80), dob: trim(m.dob, 10), email: trim(m.email, 120).toLowerCase(), phone: mobile(m.phone) || trim(m.phone, 20),
      institutionName: trim(m.institutionName, 120), roles: [...new Set((m.roles ?? []).filter((r) => cfg.roles.some((x) => x.key === r)))],
      instagram: trim(m.instagram, 31).replace(/^@/, ''), idDocType: trim(m.idDocType, 30), idDocKey: trim(m.idDocKey, 300),
      guardianName: trim(m.guardianName, 80), guardianRelation: trim(m.guardianRelation, 40), guardianPhone: mobile(m.guardianPhone) || trim(m.guardianPhone, 20),
      guardianEmail: trim(m.guardianEmail, 120).toLowerCase(), guardianConsent: Boolean(m.guardianConsent),
    })),
  };

  if (team.teamName.length < 2) errors.push('Give your team a name.');
  else if (/https?:|www\.|@/.test(team.teamName)) errors.push('The team name can’t contain links or handles.');
  if (!inst) errors.push('Choose whether the team is from a school, a college or another institution.');
  else if (inst.same && team.institutionName.length < 2) errors.push(`Name the ${inst.label.toLowerCase()} the team represents.`);
  if (team.city.length < 2) errors.push('Add the team’s city or town.');
  if (!team.state) errors.push('Choose the team’s state.');

  const n = team.members.length;
  if (n < cfg.minMembers || n > cfg.maxMembers) errors.push(`A team has ${cfg.minMembers} to ${cfg.maxMembers} members.`);

  const ages = team.members.map((m) => ageOn(m.dob, cfg.ageOn));
  team.members.forEach((m, i) => {
    const who = i === 0 ? 'Team captain' : `Member ${i + 1}`;
    const age = ages[i];
    if (m.fullName.length < 2) errors.push(`${who}: add their full name.`);
    if (age === null) errors.push(`${who}: add their date of birth.`);
    else if (age < cfg.minAge || age > cfg.maxAge) errors.push(`${who} must be ${cfg.minAge} to ${cfg.maxAge} years old on ${dayLabel(cfg.ageOn)} (they’ll be ${age}).`);
    if (!m.roles.length) errors.push(`${who}: choose at least one role.`);
    if (m.email && !emailOk(m.email)) errors.push(`${who}: the email address isn’t valid.`);
    if (m.phone && !mobile(m.phone)) errors.push(`${who}: the phone number must be a 10-digit mobile number.`);
    if (inst && !inst.same && m.institutionName.length < 2) errors.push(`${who}: add their school, college or institution.`);
    if (!cfg.idDocs.some((d) => d.key === m.idDocType)) errors.push(`${who}: choose the type of ID document.`);
    if (!m.idDocKey) errors.push(`${who}: upload their ID document.`);
    if (age !== null && cfg.instagramFromAge !== null && age >= cfg.instagramFromAge) {
      if (!m.instagram) errors.push(`${who}: add their Instagram username (needed from age ${cfg.instagramFromAge}).`);
      else if (!instaOk(m.instagram)) errors.push(`${who}: the Instagram username isn’t valid.`);
    }
    if (age !== null && age < 18) {
      if (m.guardianName.length < 2) errors.push(`${who} is under 18: add a parent’s or guardian’s name.`);
      if (!m.guardianRelation) errors.push(`${who}: say how the parent or guardian is related.`);
      if (!mobile(m.guardianPhone)) errors.push(`${who}: add the parent’s or guardian’s 10-digit mobile number.`);
      if (m.guardianEmail && !emailOk(m.guardianEmail)) errors.push(`${who}: the parent’s or guardian’s email isn’t valid.`);
      if (!m.guardianConsent) errors.push(`${who}: confirm the parent or guardian agrees.`);
    } else if (age !== null && !m.email && !m.phone) errors.push(`${who}: add an email address or phone number.`);
  });
  const seen = new Set<string>();
  team.members.forEach((m) => {
    const k = `${m.fullName.toLowerCase().replace(/\s+/g, ' ')}|${m.dob}`;
    if (m.fullName && m.dob && seen.has(k)) errors.push(`${m.fullName} is listed twice.`);
    seen.add(k);
  });
  for (const r of cfg.requiredRoles) {
    if (n && !team.members.some((m) => m.roles.includes(r))) errors.push(`Every team needs a ${cfg.roles.find((x) => x.key === r)?.label ?? r}.`);
  }
  const known = ages.filter((a): a is number => a !== null);
  if (cfg.noMixedAdults && known.some((a) => a < 18) && known.some((a) => a >= 18)) {
    errors.push('Members under 18 and members aged 18 or above can’t be on the same team.');
  }
  const oldest = known.length === n && n ? Math.max(...known) : null;
  const group = oldest !== null ? groupFor(cfg, oldest) : null;
  if (!team.acceptRules) errors.push('Accept the rules and terms on behalf of every team member.');
  if (!team.confirmTrue) errors.push('Confirm that the details are true.');
  return { errors: [...new Set(errors)], group, ages, team };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "6 November 2026" from YYYY-MM-DD. */
export function dayLabel(d: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : d;
}

export const STATUS_TEXT: Record<string, string> = {
  pending: 'Pending verification', changes_requested: 'Changes requested', approved: 'Approved', rejected: 'Not approved', withdrawn: 'Withdrawn',
};
export const RESULT_TEXT: Record<string, string> = {
  shortlisted: 'Shortlisted', first: '1st place', second: '2nd place', third: '3rd place', peoples_choice: 'People’s Choice',
};
export const applicationCode = (cfg: Pick<TeamConfig, 'codePrefix'>, no: number) => `${cfg.codePrefix}-${String(no).padStart(4, '0')}`;
