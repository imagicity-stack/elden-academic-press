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
  /**
   * The same errors, by the field they belong to ("teamName", "members.1.dob"…), so the form can
   * show each under its field. Errors about the whole team (members missing a required role, mixed
   * ages, someone listed twice) have no field and are only in `errors`.
   */
  fields: Record<string, string>;
  /** The age group from the oldest member (null until the dates of birth allow it). */
  group: TeamGroup | null;
  ages: (number | null)[];
  team: TeamInput;
}

/** Everything the rules require of a team. `who` names a member in messages ("Member 2"). */
export function checkTeam(cfg: TeamConfig, raw: TeamInput): TeamCheck {
  const errors: string[] = [];
  const fields: Record<string, string> = {};
  /** One error, under its field (the first error of a field is the one shown there). */
  const add = (msg: string, field?: string) => { errors.push(msg); if (field && !(field in fields)) fields[field] = msg; };
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

  if (team.teamName.length < 2) add('Give your team a name.', 'teamName');
  else if (/https?:|www\.|@/.test(team.teamName)) add('The team name can’t contain links or handles.', 'teamName');
  if (!inst) add('Choose whether the team is from a school, a college or another institution.', 'institutionType');
  else if (inst.same && team.institutionName.length < 2) add(`Name the ${inst.label.toLowerCase()} the team represents.`, 'institutionName');
  if (team.city.length < 2) add('Add the team’s city or town.', 'city');
  if (!team.state) add('Choose the team’s state.', 'state');

  const n = team.members.length;
  if (n < cfg.minMembers || n > cfg.maxMembers) add(`A team has ${cfg.minMembers} to ${cfg.maxMembers} members.`);

  const ages = team.members.map((m) => ageOn(m.dob, cfg.ageOn));
  team.members.forEach((m, i) => {
    const who = i === 0 ? 'Team captain' : `Member ${i + 1}`;
    const f = (k: string) => `members.${i}.${k}`;
    const age = ages[i];
    if (m.fullName.length < 2) add(`${who}: add their full name.`, f('fullName'));
    if (age === null) add(`${who}: add their date of birth.`, f('dob'));
    else if (age < cfg.minAge || age > cfg.maxAge) add(`${who} must be ${cfg.minAge} to ${cfg.maxAge} years old on ${dayLabel(cfg.ageOn)} (they’ll be ${age}).`, f('dob'));
    if (!m.roles.length) add(`${who}: choose at least one role.`, f('roles'));
    if (m.email && !emailOk(m.email)) add(`${who}: the email address isn’t valid.`, f('email'));
    if (m.phone && !mobile(m.phone)) add(`${who}: the phone number must be a 10-digit mobile number.`, f('phone'));
    if (inst && !inst.same && m.institutionName.length < 2) add(`${who}: add their school, college or institution.`, f('institutionName'));
    // The ID document and the Instagram username can be added later (before the team is approved):
    // checked only when given.
    if (m.idDocKey && !cfg.idDocs.some((d) => d.key === m.idDocType)) add(`${who}: choose the type of ID document.`, f('idDocType'));
    if (age !== null && cfg.instagramFromAge !== null && age >= cfg.instagramFromAge && m.instagram && !instaOk(m.instagram)) {
      add(`${who}: the Instagram username isn’t valid.`, f('instagram'));
    }
    if (age !== null && age < 18) {
      if (m.guardianName.length < 2) add(`${who} is under 18: add a parent’s or guardian’s name.`, f('guardianName'));
      if (!m.guardianRelation) add(`${who}: say how the parent or guardian is related.`, f('guardianRelation'));
      if (!mobile(m.guardianPhone)) add(`${who}: add the parent’s or guardian’s 10-digit mobile number.`, f('guardianPhone'));
      if (m.guardianEmail && !emailOk(m.guardianEmail)) add(`${who}: the parent’s or guardian’s email isn’t valid.`, f('guardianEmail'));
      if (!m.guardianConsent) add(`${who}: confirm the parent or guardian agrees.`, f('guardianConsent'));
    } else if (age !== null && !m.email && !m.phone) add(`${who}: add an email address or phone number.`, f('email'));
  });
  const seen = new Set<string>();
  team.members.forEach((m) => {
    const k = `${m.fullName.toLowerCase().replace(/\s+/g, ' ')}|${m.dob}`;
    if (m.fullName && m.dob && seen.has(k)) add(`${m.fullName} is listed twice.`);
    seen.add(k);
  });
  for (const r of cfg.requiredRoles) {
    if (n && !team.members.some((m) => m.roles.includes(r))) { const label = cfg.roles.find((x) => x.key === r)?.label ?? r; add(`Every team needs ${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label}.`); }
  }
  const known = ages.filter((a): a is number => a !== null);
  if (cfg.noMixedAdults && known.some((a) => a < 18) && known.some((a) => a >= 18)) {
    add('Members under 18 and members aged 18 or above can’t be on the same team.');
  }
  const oldest = known.length === n && n ? Math.max(...known) : null;
  const group = oldest !== null ? groupFor(cfg, oldest) : null;
  if (!team.acceptRules) add('Accept the rules and terms on behalf of every team member.', 'acceptRules');
  if (!team.confirmTrue) add('Confirm that the details are true.', 'confirmTrue');
  return { errors: [...new Set(errors)], fields, group, ages, team };
}

/**
 * What a team hasn't given yet that the rules ask for (an ID document; the Instagram username
 * from the set age): for the organisers to review and ask for before approving.
 */
export function teamMissing(cfg: TeamConfig, members: { fullName: string; dob: string; instagram: string; idDocKey: string | null; idDocDeletedAt?: Date | string | null }[]) {
  const out: { member: string; what: 'id' | 'instagram' }[] = [];
  members.forEach((m, i) => {
    const who = m.fullName || (i === 0 ? 'Team captain' : `Member ${i + 1}`);
    if (!m.idDocKey && !m.idDocDeletedAt) out.push({ member: who, what: 'id' });
    const age = ageOn(m.dob, cfg.ageOn);
    if (age !== null && cfg.instagramFromAge !== null && age >= cfg.instagramFromAge && !m.instagram) out.push({ member: who, what: 'instagram' });
  });
  return out;
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
