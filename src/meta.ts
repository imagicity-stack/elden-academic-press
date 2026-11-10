// Meta Pixel. Loads only after the visitor accepts cookies, never on the admin or for staff.
// Each event has an id; the server sends the same event with the same id (Conversions API),
// so Meta counts it once even when one of the two is blocked.
import { getConsent, isMetaOff, isStaff, syncConsent, type Consent } from './consent';
import { forgetUser, knownUser, phoneDigits, type MatchUser } from './visitor';
import { fireOnce, registrationEventId, registrationParams, SIGNUP_EVENT, signupParams } from './shared/metaEvents';

export { rememberUser } from './visitor';

const PIXEL = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim();

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void; queue: unknown[][]; push: unknown; loaded: boolean; version: string; disablePushState?: boolean;
};
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

/** Events the server also accepts from the browser (POST /api/meta/event). */
const RELAYED = ['PageView', 'ViewContent', 'Search', 'CustomizeProduct', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Contact'] as const;
type Relayed = (typeof RELAYED)[number];
type EventName = Relayed | 'Purchase' | 'Lead' | 'SubmitApplication' | 'CompleteRegistration' | 'Subscribe';

/** Which Meta event each website form counts as (the server uses the same mapping). */
export const formEvent = (form: string): 'Contact' | 'SubmitApplication' | 'Lead' =>
  (form === 'contact' ? 'Contact' : form === 'proposal' || form === 'dist' ? 'SubmitApplication' : 'Lead');

/** How a format is named in events, so audiences can tell e-book and print buyers apart. */
export const formatName = (kind: string) => (kind === 'digital' ? 'ebook' : kind === 'bundle' ? 'ebook+print' : 'print');
/** All formats in a cart or order, e.g. "ebook,print". */
export const formatList = (kinds: string[]) => [...new Set(kinds.map(formatName))].sort().join(',');

const onAdmin = () => /^\/admin(\/|$)/.test(location.pathname);
// Never for staff, the admin, or a signed-in student under Meta's minimum age (consent.ts → isMetaOff).
const active = () => Boolean(PIXEL) && getConsent() === 'all' && !isStaff() && !onAdmin() && !isMetaOff();

export const newEventId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

// An ad click lands with ?fbclid=…; remember it for this visit, so the click still counts
// if the visitor accepts cookies on a later page.
const FBCLID = 'elden-fbclid';
try {
  const id = new URLSearchParams(location.search).get('fbclid');
  if (id) sessionStorage.setItem(FBCLID, JSON.stringify({ id, at: Date.now() }));
} catch { /* ignore */ }

const cookieDomain = () => (/(^|\.)eldenap\.in$/.test(location.hostname) ? '; Domain=eldenap.in' : '');
const readCookie = (name: string) => document.cookie.split('; ').find((c) => c.startsWith(name + '='))?.slice(name.length + 1);

const setCookie = (name: string, value: string) => {
  document.cookie = `${name}=${value}; Path=/; Max-Age=7776000; SameSite=Lax${cookieDomain()}${location.protocol === 'https:' ? '; Secure' : ''}`;
};

/**
 * Meta's two browser cookies, set before the first event, so the server's copy of the
 * very first page view already carries them (Meta's script would set them a moment later;
 * it keeps cookies that already exist). _fbc only exists after an ad click.
 */
function setMetaCookies() {
  if (!readCookie('_fbp')) setCookie('_fbp', `fb.1.${Date.now()}.${Math.floor(Math.random() * 9e9) + 1e9}`);
  if (readCookie('_fbc')) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(FBCLID) ?? 'null') as { id: string; at: number } | null;
    if (saved) setCookie('_fbc', `fb.1.${saved.at}.${saved.id}`);
  } catch { /* ignore */ }
}

/** The Pixel's "advanced matching" fields, normalised the way Meta asks (it hashes them). */
function pixelMatch(u: MatchUser | null): Record<string, string> {
  if (!u) return {};
  const out: Record<string, string> = {};
  const email = u.email?.toLowerCase();
  if (email) { out.em = email; out.external_id = email; }
  const ph = phoneDigits(u.phone);
  if (ph) out.ph = ph;
  const parts = (u.name ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts[0]) out.fn = parts[0];
  if (parts.length > 1) out.ln = parts[parts.length - 1];
  if (u.city) out.ct = u.city.toLowerCase().replace(/[^\p{L}]/gu, '');
  if (u.pincode) out.zp = u.pincode.replace(/\s/g, '');
  if (Object.keys(out).length) out.country = 'in';
  return out;
}

let loaded = false;
function load() {
  if (loaded || !PIXEL || isMetaOff()) return;
  loaded = true;
  setMetaCookies();
  // Meta's standard loader, written out so no inline script is needed.
  const n = function (...args: unknown[]) {
    if (n.callMethod) n.callMethod(...args); else n.queue.push(args);
  } as Fbq;
  n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
  // We send page views ourselves (with ids); stop the Pixel counting route changes again.
  n.disablePushState = true;
  window.fbq = n;
  window._fbq ??= n;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://connect.facebook.net/en_US/fbevents.js';
  document.head.appendChild(s);
  // Only the events we send on purpose: no automatic "button click" guesses (SubscribedButtonClick).
  n('set', 'autoConfig', false, PIXEL);
  n('init', PIXEL, pixelMatch(knownUser()));
}

function relay(name: Relayed, eventId: string, custom: Record<string, unknown>) {
  fetch('/api/meta/event', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, eventId, url: location.origin + location.pathname, custom, user: knownUser() ?? undefined }),
  }).catch(() => {});
}

/**
 * Track an event. Relayed events are also sent through our server; for the others
 * (Purchase, Lead, sign-up) the server sends its own copy, so pass its event id.
 */
export function track(name: EventName, custom: Record<string, unknown> = {}, opts: { eventId?: string } = {}) {
  if (!active()) return;
  load();
  const eventId = opts.eventId ?? newEventId();
  window.fbq!('track', name, custom, { eventID: eventId });
  if (!opts.eventId && (RELAYED as readonly string[]).includes(name)) relay(name as Relayed, eventId, custom);
}

/** A custom event (the Pixel's trackCustom), with the id the server's twin uses. */
export function trackCustom(name: typeof SIGNUP_EVENT, custom: Record<string, unknown>, opts: { eventId: string }) {
  if (!active()) return;
  load();
  window.fbq!('trackCustom', name, custom, { eventID: opts.eventId });
}

const storage = () => { try { return window.localStorage; } catch { return null; } };

/**
 * CompleteRegistration for a competition registration, called with the id from the registration
 * form's success response (never on page load). The server sends the same event with the same
 * id. Once per registration in this browser, after the success screen has shown, and a blocked
 * or failing Pixel can't break anything.
 */
export function trackRegistration(registrationId: string, slug: string) {
  setTimeout(() => fireOnce(storage(), `elden-reg-tracked:${registrationId}`,
    () => track('CompleteRegistration', registrationParams(slug), { eventId: registrationEventId(registrationId) })), 0);
}

/**
 * AccountSignup, with the id the server gives when the profile first says who this is (PUT
 * /profile → meta.signupEventId; none for a student under Meta's minimum age). Once per browser.
 */
export function trackSignup(eventId: string) {
  setTimeout(() => fireOnce(storage(), `elden-signup-tracked:${eventId}`,
    () => trackCustom(SIGNUP_EVENT, signupParams(), { eventId })), 0);
}

// Contact: someone taps your email address, phone number or WhatsApp link.
document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.('a[href^="mailto:"], a[href^="tel:"], a[href*="wa.me/"], a[href*="api.whatsapp.com"]') as HTMLAnchorElement | null;
  if (!a) return;
  const href = a.getAttribute('href') ?? '';
  track('Contact', { content_name: href.startsWith('mailto:') ? 'email' : href.startsWith('tel:') ? 'phone' : 'whatsapp' });
}, true);

// Start-up, and changes of mind.
syncConsent();
if (active()) load();
window.addEventListener('elden:consent', (e) => {
  const c = (e as CustomEvent<Consent>).detail;
  if (c === 'all') {
    if (loaded) window.fbq?.('consent', 'grant'); // changed their mind back
    track('PageView'); // the page they're on
  } else if (loaded) {
    window.fbq?.('consent', 'revoke');
    forgetUser();
    for (const name of ['_fbp', '_fbc']) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
      document.cookie = `${name}=; Path=/; Max-Age=0${cookieDomain()}`;
    }
  }
});
