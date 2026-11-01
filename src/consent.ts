// The visitor's cookie choice: "all" (analytics and ads) or "essential" (cart, sign-in only).
// Kept in this browser, and mirrored in the elden_consent cookie so the server knows too
// (it reports purchases to Meta only for "all"). Staff testing the site are never tracked.

export type Consent = 'all' | 'essential';

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

const KEY = 'elden-consent';

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'all' || v === 'essential' ? v : null;
  } catch {
    return null;
  }
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
  const v = c && (isStaff() ? 'staff' : c);
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
