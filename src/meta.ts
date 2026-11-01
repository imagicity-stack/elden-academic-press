// Meta Pixel. Loads only after the visitor accepts cookies, never on the admin or for staff.
// Each event has an id; the server sends the same event with the same id (Conversions API),
// so Meta counts it once even when one of the two is blocked.
import { getConsent, isStaff, syncConsent, type Consent } from './consent';

const PIXEL = (import.meta.env.VITE_META_PIXEL_ID as string | undefined)?.trim();

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void; queue: unknown[][]; push: unknown; loaded: boolean; version: string; disablePushState?: boolean;
};
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

/** Events the server also accepts from the browser (POST /api/meta/event). */
const RELAYED = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo'] as const;
type Relayed = (typeof RELAYED)[number];
type EventName = Relayed | 'Purchase' | 'Lead' | 'CompleteRegistration';

/** How a format is named in events, so audiences can tell e-book and print buyers apart. */
export const formatName = (kind: string) => (kind === 'digital' ? 'ebook' : kind === 'bundle' ? 'ebook+print' : 'print');
/** All formats in a cart or order, e.g. "ebook,print". */
export const formatList = (kinds: string[]) => [...new Set(kinds.map(formatName))].sort().join(',');

const onAdmin = () => /^\/admin(\/|$)/.test(location.pathname);
const active = () => Boolean(PIXEL) && getConsent() === 'all' && !isStaff() && !onAdmin();

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

function setClickCookie() {
  if (readCookie('_fbc')) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(FBCLID) ?? 'null') as { id: string; at: number } | null;
    if (saved) document.cookie = `_fbc=fb.1.${saved.at}.${saved.id}; Path=/; Max-Age=7776000; SameSite=Lax${cookieDomain()}${location.protocol === 'https:' ? '; Secure' : ''}`;
  } catch { /* ignore */ }
}

let loaded = false;
function load() {
  if (loaded || !PIXEL) return;
  loaded = true;
  setClickCookie();
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
  n('init', PIXEL);
}

function relay(name: Relayed, eventId: string, custom: Record<string, unknown>) {
  fetch('/api/meta/event', {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, eventId, url: location.origin + location.pathname, custom }),
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
    for (const name of ['_fbp', '_fbc']) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
      document.cookie = `${name}=; Path=/; Max-Age=0${cookieDomain()}`;
    }
  }
});
