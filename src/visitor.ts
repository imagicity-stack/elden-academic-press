// Details a visitor gave us (checkout, sign-in, newsletter, a form), kept in their browser
// only after they accept cookies, so their later Meta and Google events can be matched
// to them too (both hash them before use). "Only essential" erases them.
import { getConsent, isStaff } from './consent';

export interface MatchUser { email?: string; phone?: string; name?: string; city?: string; state?: string; pincode?: string }

const USER = 'elden-meta-user';

export function knownUser(): MatchUser | null {
  if (getConsent() !== 'all') return null;
  try { return JSON.parse(localStorage.getItem(USER) ?? 'null') as MatchUser | null; } catch { return null; }
}

export function rememberUser(u: MatchUser) {
  if (getConsent() !== 'all' || isStaff()) return;
  const clean = Object.fromEntries(Object.entries(u).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim().slice(0, 200)]));
  try { localStorage.setItem(USER, JSON.stringify({ ...knownUser(), ...clean })); } catch { /* ignore */ }
  window.dispatchEvent(new Event('elden:visitor'));
}

export function forgetUser() {
  try { localStorage.removeItem(USER); } catch { /* ignore */ }
}

/** Indian mobile number with the country code, digits only (e.g. 919876543210). */
export function phoneDigits(v: string | undefined) {
  const d = v?.replace(/\D/g, '') ?? '';
  return /^[6-9]\d{9}$/.test(d) ? '91' + d : /^0[6-9]\d{9}$/.test(d) ? '91' + d.slice(1) : d;
}
