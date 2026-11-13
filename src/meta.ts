// Meta Pixel. Loads on every page for every visitor (no cookie choice on this site), never on the admin or for staff.
// Each event has an id; the server sends the same event with the same id (Conversions API),
// so Meta counts it once even when one of the two is blocked.
import { getConsent, isMetaOff, isStaff, metaTestMode, syncConsent } from './consent';
import { knownUser, phoneDigits, type MatchUser } from './visitor';
import { fireOnce, registrationEventId, registrationParams, SIGNUP_EVENT, signupParams } from './shared/metaEvents';
import { ENGAGED_EVENT } from './engagement';
import { pixelLog } from './pixelDebug';
import { ipFromFbi } from './shared/fbi';

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
// Before launch the coming-soon page counts nothing (staff can still test with ?meta-test).
const storeOpen = () => import.meta.env.VITE_SITE_LIVE === 'true' || metaTestMode();
// Never for staff, the admin, or a signed-in student under Meta's minimum age (consent.ts → isMetaOff).
const active = () => Boolean(PIXEL) && storeOpen() && getConsent() === 'all' && !isStaff() && !onAdmin() && !isMetaOff();

/** Why the Pixel sends nothing in this browser (for the debug log), or null when it's on. Nothing personal. */
export function pixelOffReason(): string | null {
  if (!PIXEL) return 'no Pixel id in this build (VITE_META_PIXEL_ID)';
  if (!storeOpen()) return 'the store is not launched (coming-soon page)';
  if (onAdmin()) return 'admin page';
  if (isStaff()) return 'this browser is signed into the admin, so it is not tracked: open the page with ?meta-test, or use a private window';
  if (isMetaOff()) return 'a student under Meta’s minimum age is signed in';
  if (getConsent() !== 'all') return 'no cookie consent';
  return null;
}

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

/** The click id inside an _fbc value (fb.1.<time>.<click id>, sometimes with Meta's own suffix after it). */
const clickIdOf = (fbc: string) => fbc.split('.').slice(3).join('.');

/**
 * Meta's two browser cookies, set before the first event, so the server's copy of the
 * very first page view already carries them (Meta's script would set them a moment later;
 * it keeps cookies that already exist). _fbc only exists after an ad click, and a new ad
 * click replaces an older one (Meta wants the latest click, not the first one ever).
 */
function setMetaCookies() {
  if (!readCookie('_fbp')) setCookie('_fbp', `fb.1.${Date.now()}.${Math.floor(Math.random() * 9e9) + 1e9}`);
  try {
    const saved = JSON.parse(sessionStorage.getItem(FBCLID) ?? 'null') as { id: string; at: number } | null;
    if (!saved) return;
    const current = readCookie('_fbc');
    if (!current || !clickIdOf(current).startsWith(saved.id)) setCookie('_fbc', `fb.1.${saved.at}.${saved.id}`);
  } catch { /* ignore */ }
}

/**
 * Meta's Parameter Builder (meta-capi-param-builder-clientjs), once per page. It keeps _fbc and _fbp
 * right, finds the ad click inside Facebook's and Instagram's own browsers when the address doesn't
 * carry it (where most ad visitors are), and stores the visitor's IPv6 address in _fbi for the
 * server's events (our server is only ever reached over IPv4; Meta matches IPv6 visitors better on
 * IPv6 and flags server events that carry IPv4 when the Pixel saw IPv6).
 *
 * So every server copy (relay) waits until those cookies are ready, at most PARAMS_WAIT_MS, and goes
 * at once if the visitor leaves first. The IPv6 lookup starts the moment the Pixel loads, alongside
 * the builder's download, and an IPv6 address saved earlier (the _fbi cookie, a day) is used straight away.
 */
const PARAMS_WAIT_MS = 3500;
/** The visitor's public address as seen from outside, IPv6 where they have it (IPv4 otherwise). */
export const IP_LOOKUP = 'https://api64.ipify.org';

let ipLookup: Promise<string> | undefined;
function startIpLookup(): Promise<string> {
  ipLookup ??= (async () => {
    const saved = ipFromFbi(readCookie('_fbi'));
    if (saved.includes(':')) { pixelLog('IPv6 address already saved for this browser: server copies use it'); return saved; }
    const t0 = performance.now();
    try {
      const res = await fetch(IP_LOOKUP, { signal: AbortSignal.timeout(3000), credentials: 'omit', cache: 'no-store' });
      const ip = res.ok ? (await res.text()).trim().slice(0, 64) : '';
      const ms = Math.round(performance.now() - t0);
      pixelLog(ip.includes(':') ? `IPv6 address found in ${ms} ms` : ip ? `only IPv4 here (this network has no IPv6) · ${ms} ms` : `IP lookup answered without an address (${res.status}) · ${ms} ms`);
      return ip || saved;
    } catch (e) {
      pixelLog(`IP lookup failed after ${Math.round(performance.now() - t0)} ms (${(e as Error).name}): server copies use the server's IPv4`);
      return saved;
    }
  })();
  return ipLookup;
}

type ParamBuilder = { processAndCollectAllParams(url?: string | null, getIpFn?: () => Promise<string>): Promise<unknown> };
let params: Promise<void> | undefined;
/** Server copies waiting for the cookies (sent when they're ready, after PARAMS_WAIT_MS, or when the visitor leaves). */
let paramsReady = false;
const waiting: (() => void)[] = [];
function releaseWaiting(why: string) {
  if (!waiting.length) { paramsReady = true; return; }
  pixelLog(`${waiting.length} server cop${waiting.length === 1 ? 'y' : 'ies'} sent (${why}); _fbi ${ipFromFbi(readCookie('_fbi')).includes(':') ? 'has IPv6' : 'has no IPv6'}`);
  paramsReady = true;
  while (waiting.length) waiting.shift()!();
}
function collectParams(): Promise<void> {
  if (params) return params;
  startIpLookup();
  const t0 = performance.now();
  params = import('meta-capi-param-builder-clientjs')
    .then((m) => {
      const pb = ((m as { default?: ParamBuilder }).default ?? m) as ParamBuilder;
      return pb.processAndCollectAllParams(location.href, startIpLookup);
    })
    .then(() => {}, () => {})
    .then(() => { pixelLog(`Meta cookies ready in ${Math.round(performance.now() - t0)} ms`); releaseWaiting('cookies ready'); });
  setTimeout(() => { if (!paramsReady) releaseWaiting(`waited ${PARAMS_WAIT_MS / 1000} s`); }, PARAMS_WAIT_MS);
  // Leaving (closing the tab, going to another app): send what's waiting now, rather than lose it.
  addEventListener('pagehide', () => releaseWaiting('visitor leaving'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') releaseWaiting('tab hidden'); });
  return params;
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
  collectParams();
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

function relay(name: Relayed | typeof ENGAGED_EVENT, eventId: string, custom: Record<string, unknown>) {
  const url = location.origin + location.pathname;
  const user = knownUser() ?? undefined;
  const go = () => send(name, eventId, custom, url, user);
  // Until the Parameter Builder's cookies (click id, IPv6) are ready, server copies wait (see collectParams).
  if (paramsReady || !params) go(); else waiting.push(go);
}

function send(name: Relayed | typeof ENGAGED_EVENT, eventId: string, custom: Record<string, unknown>, url: string, user: MatchUser | undefined) {
  fetch('/api/meta/event', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, eventId, url, custom, user }),
  }).catch(() => {});
}

/**
 * Track an event. Relayed events are also sent through our server; for the others
 * (Purchase, Lead, sign-up) the server sends its own copy, so pass its event id.
 */
let lastPageView = '';
export function track(name: EventName, custom: Record<string, unknown> = {}, opts: { eventId?: string } = {}) {
  if (!active()) return;
  // One PageView per page: the route change and the consent arriving can both ask for the same one.
  if (name === 'PageView') {
    const here = location.pathname + location.search;
    if (here === lastPageView) return;
    lastPageView = here;
  }
  load();
  const eventId = opts.eventId ?? newEventId();
  window.fbq!('track', name, custom, { eventID: eventId });
  if (!opts.eventId && (RELAYED as readonly string[]).includes(name)) relay(name as Relayed, eventId, custom);
}

/** A custom event (the Pixel's trackCustom), with the id the server's twin uses. */
export function trackCustom(name: typeof SIGNUP_EVENT | typeof ENGAGED_EVENT, custom: Record<string, unknown>, opts: { eventId: string }) {
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

// Start-up: everyone is counted (no cookie choice on this site), except staff, the admin and
// signed-in students under Meta's minimum age (see active()).
syncConsent();
if (active()) load();

/**
 * EngagedVisit (src/engagement.ts): fbq('trackCustom', 'EngagedVisit', data, { eventID }) with a
 * fresh event id, and the same event through the server (POST /api/meta/event). Returns the id,
 * or why nothing was sent.
 */
export function trackEngagedVisit(data: Record<string, unknown>): { eventId: string } | { reason: string } {
  const off = pixelOffReason();
  if (off) return { reason: off };
  const eventId = newEventId();
  trackCustom(ENGAGED_EVENT, data, { eventId });
  // The server's copy (Conversions API), same event id: Meta counts it once, even if an ad blocker stopped the Pixel.
  relay(ENGAGED_EVENT, eventId, data);
  return { eventId };
}
