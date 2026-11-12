// The visitor's cookie choice: "all" (analytics and ads) or "essential" (cart, sign-in only).
// Kept in this browser, and mirrored in the elden_consent cookie so the server knows too
// (it reports purchases to Meta only for "all"). Staff testing the site are never tracked.

export type Consent = 'all' | 'essential';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

const KEY = 'elden-consent';

/**
 * The site's cookie switch (Admin → Settings → Cookies & tracking), as confirmed by /api/config
 * on this page (never remembered from an earlier visit, so switching it off takes effect before
 * anything is sent). While on, a visitor who hasn't chosen counts as "all"; anyone who chose
 * "Only essential" keeps their choice.
 */
let siteAuto: boolean | null = null;
export const isAutoConsent = () => siteAuto === true;

/** The visitor's own choice, if they made one. */
function chosen(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'all' || v === 'essential' ? v : null;
  } catch {
    return null;
  }
}

/** What applies: their choice, else "all" while the cookie banner is switched off, else none yet. */
export function getConsent(): Consent | null {
  return chosen() ?? (siteAuto ? 'all' : null);
}

/** Has this visitor chosen themselves (as opposed to the banner being switched off)? */
export const hasChosen = () => chosen() !== null;

/**
 * The site's switch, once /api/config answers. Switched off, the banner turns every visitor who
 * hasn't chosen into "accepted": the cookie the server reads, Google's consent and the Meta Pixel
 * follow at once (and the page they're on is counted).
 */
export function applySiteConsentMode(auto: boolean) {
  if (siteAuto === auto) return;
  siteAuto = auto;
  if (hasChosen()) return; // their own choice stands either way
  writeCookie(getConsent());
  if (!auto) return;
  window.gtag?.('consent', 'update', { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', analytics_storage: 'granted' });
  window.dispatchEvent(new CustomEvent<Consent>('elden:consent', { detail: 'all' }));
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

export function setConsent(c: Consent) {
  try { localStorage.setItem(KEY, c); } catch { /* private mode: applies to this visit */ }
  writeCookie(c);
  const g = c === 'all' ? 'granted' : 'denied';
  window.gtag?.('consent', 'update', { ad_storage: g, ad_user_data: g, ad_personalization: g, analytics_storage: g });
  window.dispatchEvent(new CustomEvent<Consent>('elden:consent', { detail: c }));
}

/** On start-up: keep the cookie in step (someone may have signed in to the admin since). */
export function syncConsent() { writeCookie(getConsent()); }

/** Show the cookie choice again (footer link). */
export const openConsent = () => window.dispatchEvent(new Event('elden:consent-open'));

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
