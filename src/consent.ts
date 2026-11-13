// No cookie choice on this website: Google Analytics and Meta advertising run for every visitor
// (the owner's decision, November 2026; there is no banner and no "Cookie settings"). The exceptions
// stay: staff testing the site aren't counted, Google Analytics never loads while a student is signed
// in, and nothing reaches Meta about a signed-in student under Meta's minimum age. The elden_consent
// cookie tells the server the same ("all", "staff" or "essential"), so its Conversions API copies follow.
//
// To bring a choice back, see git history (the CookieBanner component and this file before this change).

export type Consent = 'all' | 'essential';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

/** Every visitor counts as accepting analytics and advertising (exceptions: isStaff, isMetaOff). */
export function getConsent(): Consent {
  return 'all';
}

// Meta test mode: open any page with ?meta-test and, for this tab, a status panel shows
// what the Pixel needs, and an admin sign-in no longer stops tracking (so staff can test).
const TEST = 'elden-meta-test';
try { if (new URLSearchParams(location.search).has('meta-test')) sessionStorage.setItem(TEST, '1'); } catch { /* ignore */ }
export function metaTestMode() {
  try { return sessionStorage.getItem(TEST) === '1'; } catch { return false; }
}
export function leaveMetaTest() {
  try { sessionStorage.removeItem(TEST); } catch { /* ignore */ }
  location.assign(location.pathname);
}

/** Signed in to the admin in this browser: staff checking the site aren't counted (except in test mode). */
export function isStaff() {
  if (metaTestMode()) return false;
  try { return Boolean(localStorage.getItem('elden-admin-auth')); } catch { return false; }
}

function writeCookie(c: Consent | null) {
  // A signed-in student under Meta's minimum age (see isMetaOff) is never reported to Meta from the server either.
  const v = c && (isStaff() ? 'staff' : isMetaOff() ? 'essential' : c);
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = v ? `elden_consent=${v}; Path=/; Max-Age=31536000; SameSite=Lax${secure}` : 'elden_consent=; Path=/; Max-Age=0';
}

/** On start-up: keep the cookie in step (someone may have signed in to the admin since). */
export function syncConsent() { writeCookie(getConsent()); }

/* ---------------- No Google tracking for students ---------------- */
// While a student account is signed in on this browser, Google Analytics and Google Tag
// Manager don't load (index.html checks the same flag) and no Google events are sent.
// Meta has its own rule, by age (isMetaOff below). Signing out clears both.

const STUDENT = 'elden-student';

export function isStudentSession() {
  try { return localStorage.getItem(STUDENT) === '1'; } catch { return false; }
}

export function setStudentSession(on: boolean) {
  try {
    if (on) localStorage.setItem(STUDENT, '1'); else localStorage.removeItem(STUDENT);
  } catch { /* ignore */ }
  syncConsent();
  if (on) {
    // Anything already loaded on this page stops collecting.
    window.gtag?.('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  }
}

/* ---------------- Meta: not for younger students ---------------- */
// A signed-in student under the minimum age (META_MIN_AGE on the server, 13 to start with), or
// one who hasn't given a date of birth: the Meta Pixel stays off and the cookie tells the server
// "essential", so nothing about them reaches Meta, whatever the cookie choice. Older students,
// and everyone else, follow the cookie choice as usual. The server decides (meta.allowed in the
// account and profile answers); signing out clears it.

const META_OFF = 'elden-meta-off';

export function isMetaOff() {
  try { return localStorage.getItem(META_OFF) === '1'; } catch { return false; }
}

export function setMetaOff(on: boolean) {
  try {
    if (on) localStorage.setItem(META_OFF, '1'); else localStorage.removeItem(META_OFF);
  } catch { /* ignore */ }
  syncConsent();
  // A Pixel already loaded on this page stops (or, for someone now allowed who accepted all, resumes).
  const fbq = (window as { fbq?: (...a: unknown[]) => void }).fbq;
  if (on) fbq?.('consent', 'revoke');
  else if (getConsent() === 'all') fbq?.('consent', 'grant');
}
