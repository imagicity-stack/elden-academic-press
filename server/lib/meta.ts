// Meta Conversions API: the server reports events to Meta directly, so purchases count
// even when the browser blocked the Pixel or the buyer closed the tab. Each event carries
// the same event_id as its browser twin, so Meta counts it once.
// Customer details are normalised and SHA-256 hashed as Meta requires; nothing is sent
// unless the visitor accepted ad cookies.
import { createHash } from 'node:crypto';
import { stateName } from './states.js';

export const GRAPH_VERSION = 'v24.0';

export type MetaEventName = 'PageView' | 'ViewContent' | 'Search' | 'CustomizeProduct' | 'AddToCart' | 'InitiateCheckout' | 'AddPaymentInfo'
  | 'Purchase' | 'Lead' | 'Contact' | 'SubmitApplication' | 'CompleteRegistration' | 'Subscribe'
  /** Custom event: a new account (first Google sign-in). */
  | 'AccountSignup';

export interface MetaUser {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  city?: string | null;
  /** GST state code ('20') or a state name. */
  state?: string | null;
  pincode?: string | null;
  externalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  /** Approximate location from the IP address (Vercel's geolocation). Used only where the
   *  visitor hasn't given their own city, state or PIN code. */
  geo?: { city?: string | null; state?: string | null; pincode?: string | null; country?: string | null } | null;
}

export interface MetaEvent {
  name: MetaEventName;
  eventId: string;
  time: Date;
  url: string;
  user: MetaUser;
  custom?: Record<string, unknown>;
}

export interface Meta { send(events: MetaEvent[]): Promise<void> }

const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const letters = (v: string) => v.toLowerCase().normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');

/** Indian mobile numbers as Meta wants them: country code + number, digits only. */
export function normalisePhone(v: string) {
  const d = v.replace(/\D/g, '');
  if (/^[6-9]\d{9}$/.test(d)) return '91' + d;
  if (/^0[6-9]\d{9}$/.test(d)) return '91' + d.slice(1);
  return d;
}

/** Meta's user_data: contact details hashed; IP, browser and Meta's cookies as they are. */
export function userData(u: MetaUser): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const add = (key: string, value: string | null | undefined) => { if (value) out[key] = [sha(value)]; };
  const email = u.email?.trim().toLowerCase();
  add('em', email);
  add('ph', u.phone ? normalisePhone(u.phone) : null);
  const parts = (u.name ?? '').trim().split(/\s+/).filter(Boolean);
  add('fn', parts.length ? letters(parts[0]) : null);
  add('ln', parts.length > 1 ? letters(parts[parts.length - 1]) : null);
  // What they told us first; otherwise where their IP address points (so even a first visit
  // carries a matching key: Meta needs at least one of em, ph, fn, ln, ct, st, zp…).
  const own = Boolean(u.city || u.state || u.pincode);
  const geo = own ? null : u.geo ?? null;
  const city = u.city || geo?.city;
  add('ct', city ? letters(city) : null);
  const stateRaw = u.state || geo?.state;
  const state = stateRaw ? stateName(stateRaw) ?? stateRaw : null;
  add('st', state ? letters(state) : null);
  const pin = u.pincode || geo?.pincode;
  add('zp', pin ? pin.replace(/\s/g, '').toLowerCase() : null);
  const country = own || email || u.phone ? 'in' : geo?.country?.toLowerCase() ?? null;
  add('country', country && /^[a-z]{2}$/.test(country) ? country : null);
  add('external_id', u.externalId ? u.externalId.trim().toLowerCase() : email);
  if (u.ip) out.client_ip_address = u.ip;
  if (u.userAgent) out.client_user_agent = u.userAgent;
  if (u.fbp) out.fbp = u.fbp;
  if (u.fbc) out.fbc = u.fbc;
  return out;
}

export function toPayload(e: MetaEvent) {
  return {
    event_name: e.name,
    event_time: Math.floor(e.time.getTime() / 1000),
    event_id: e.eventId,
    event_source_url: e.url,
    action_source: 'website',
    user_data: userData(e.user),
    ...(e.custom && Object.keys(e.custom).length ? { custom_data: e.custom } : {}),
  };
}

export function metaHttp(pixelId: string, token: string, testCode?: string, fetchImpl: typeof fetch = fetch): Meta {
  return {
    async send(events) {
      if (!events.length) return;
      const res = await fetchImpl(`https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: events.map(toPayload), access_token: token, ...(testCode ? { test_event_code: testCode } : {}) }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Meta ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
    },
  };
}

/** Collects events in memory (tests). */
export function memoryMeta(): Meta & { sent: MetaEvent[] } {
  const sent: MetaEvent[] = [];
  return { sent, async send(events) { sent.push(...events); } };
}
