// The account profile ("Complete your profile"): which details each kind of person gives.
// Used by the account page, the sign-up step, competition registration and the server.
import { ageOn } from './teams';

export type ProfileType = 'student' | 'parent' | 'teacher' | 'other';
export const PROFILE_TYPES: [ProfileType, string][] = [['student', 'Student'], ['parent', 'Parent'], ['teacher', 'Teacher'], ['other', 'Other']];
export const INSTITUTION_TYPES: [string, string][] = [['school', 'School'], ['college', 'College'], ['other', 'Other institution']];

export interface ProfileValues {
  type: ProfileType | '' | null; fullName: string; phone: string; city: string; state: string;
  dob: string | null; institutionType: string; institutionName: string; grade: string; guardianName: string; guardianPhone: string; instagram: string;
}
export type ProfileField = keyof Omit<ProfileValues, 'instagram'>;

export const FIELD_LABEL: Record<ProfileField, string> = {
  type: 'I am a', fullName: 'Full name', phone: 'WhatsApp number', city: 'City or town', state: 'State', dob: 'Date of birth',
  institutionType: 'School, college or other', institutionName: 'Name of your school, college or institution', grade: 'Class or year',
  guardianName: 'Parent’s or guardian’s name', guardianPhone: 'Parent’s or guardian’s mobile',
};

/** Today in India (YYYY-MM-DD). */
export const todayIST = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** The fields this person still has to fill in, in the order the form shows them. */
export function missingFields(p: ProfileValues, today = todayIST()): ProfileField[] {
  const out: ProfileField[] = [];
  if (!p.type) out.push('type');
  if (!p.fullName) out.push('fullName');
  if (!p.phone) out.push('phone');
  if (!p.city) out.push('city');
  if (!p.state) out.push('state');
  if (p.type === 'student') {
    if (!p.dob) out.push('dob');
    if (!p.institutionType) out.push('institutionType');
    if (!p.institutionName) out.push('institutionName');
    if (!p.grade) out.push('grade');
    const age = p.dob ? ageOn(p.dob, today) : null;
    if (age !== null && age < 18) {
      if (!p.guardianName) out.push('guardianName');
      if (!p.guardianPhone) out.push('guardianPhone');
    }
  }
  if (p.type === 'teacher') {
    if (!p.institutionType) out.push('institutionType');
    if (!p.institutionName) out.push('institutionName');
  }
  return out;
}
