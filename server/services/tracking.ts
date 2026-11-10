// Server-side events for Meta (Conversions API). Only for visitors who accepted ad
// cookies: the cookie banner sets elden_consent=all, which every request carries.
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../app.js';
import type { Deps } from '../deps.js';
import type { MetaEvent } from '../lib/meta.js';
import type { Order, OrderItem } from './orders.js';
import { registrationEventId, registrationParams } from '../../src/shared/metaEvents.js';

export interface Visit { consent: boolean; ip: string | null; userAgent: string | null; fbp: string | null; fbc: string | null }

const metaCookie = (v: string | undefined) => (v && v.length < 400 && /^fb\.\d+\.\d+\.\S+$/.test(v) ? v : null);

/** What this request tells us: ad consent, and Meta's browser cookies. */
export function visitOf(c: Context<AppEnv>): Visit {
  return {
    consent: getCookie(c, 'elden_consent') === 'all',
    ip: c.get('ip') || null,
    userAgent: c.req.header('user-agent')?.slice(0, 500) ?? null,
    fbp: metaCookie(getCookie(c, '_fbp')),
    fbc: metaCookie(getCookie(c, '_fbc')),
  };
}

/** The browser's event id for the matching Pixel event, if it sent one. */
export const eventIdHeader = (c: Context<AppEnv>) => {
  const v = c.req.header('x-meta-event-id')?.trim();
  return v && /^[\w-]{8,80}$/.test(v) ? v : undefined;
};

/** Send one event to Meta in the background. Never throws, never delays the response. */
export function report(deps: Deps, consent: boolean, event: MetaEvent): Promise<void> | undefined {
  if (!deps.meta || !consent) return;
  const run = deps.meta.send([event]).catch((e) => console.error('[meta]', (e as Error).message));
  if (deps.defer) deps.defer(run); else return run;
}

/** Purchase, from the server the moment payment is confirmed (same event_id as the browser's). */
export function reportPurchase(deps: Deps, o: Order, items: OrderItem[]) {
  const ids = [...new Set(items.map((i) => i.productId ?? i.id))];
  return report(deps, o.adConsent, {
    name: 'Purchase',
    eventId: `purchase-${o.number}`,
    time: o.paidAt ?? deps.now(),
    url: `${deps.env.SITE_URL}/checkout`,
    user: {
      email: o.email, phone: o.phone, name: o.name, city: o.shipCity, state: o.shipState ?? o.billingState, pincode: o.shipPincode,
      ip: o.ip, userAgent: o.userAgent, fbp: o.fbp, fbc: o.fbc,
    },
    custom: {
      value: o.total / 100,
      currency: 'INR',
      order_id: String(o.number),
      content_type: 'product',
      content_ids: ids,
      contents: items.map((i) => ({ id: i.productId ?? i.id, quantity: i.quantity, item_price: i.unitPrice / 100 })),
      num_items: items.reduce((n, i) => n + i.quantity, 0),
      format: [...new Set(items.map((i) => (i.variantKind === 'digital' ? 'ebook' : i.variantKind === 'bundle' ? 'ebook+print' : 'print')))].sort().join(','),
    },
  });
}

/** How long a registration's Meta event may take before we stop waiting for it. */
export const REGISTRATION_META_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/**
 * CompleteRegistration for a competition registration (team, individual or group), called once
 * the registration is saved. Fire-and-forget: it's never awaited by the request, never throws,
 * and gives up after a few seconds, so Meta being slow or down can't hold up or undo a
 * registration (errors are only logged). Same event id as the browser's Pixel event.
 * Only for visitors who accepted ad cookies, and never for an account set to Student.
 */
export function reportRegistration(
  deps: Deps, c: Context<AppEnv>,
  r: { id: string; slug: string; email: string; account: { phone: string; fullName: string; name: string; accountType: string | null } },
): void {
  try {
    if (!deps.meta) return;
    const visit = visitOf(c);
    if (!visit.consent || r.account.accountType === 'student') return;
    const event: MetaEvent = {
      name: 'CompleteRegistration',
      eventId: registrationEventId(r.id),
      time: deps.now(),
      url: `${deps.env.SITE_URL}/competitions/${r.slug}`,
      user: {
        email: r.email, phone: r.account.phone || null, name: r.account.fullName || r.account.name || null,
        // The same external_id as the AccountSignup event: their email.
        externalId: r.email,
        ip: visit.ip, userAgent: visit.userAgent, fbp: visit.fbp, fbc: visit.fbc,
      },
      custom: registrationParams(r.slug),
    };
    const run = withTimeout(Promise.resolve().then(() => deps.meta!.send([event])), REGISTRATION_META_TIMEOUT_MS)
      .catch((e) => console.error('[meta] registration event', (e as Error).message));
    deps.defer?.(run);
  } catch (e) {
    console.error('[meta] registration event', (e as Error).message);
  }
}
