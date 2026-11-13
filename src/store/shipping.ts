// Delivery to a PIN code (Delhivery): can we deliver, with cash on delivery, and by when?
// Used on checkout and the book page. The server answers { check: null } when the check is off.
import { useEffect, useState } from 'react';
import { api } from './api';

export interface PinCheck { serviceable: boolean | null; cod: boolean | null; deliveryBy: string | null; days: number | null; oda: boolean }
export type PinState = { status: 'idle' } | { status: 'checking' } | { status: 'done'; pin: string; check: PinCheck | null } | { status: 'error' };

const cache = new Map<string, Promise<PinCheck | null>>();
const KEY = 'elden-pin';

export const validPin = (pin: string) => /^[1-9]\d{5}$/.test(pin);

export function fetchPinCheck(pin: string): Promise<PinCheck | null> {
  let p = cache.get(pin);
  if (!p) {
    p = api<{ check: PinCheck | null }>(`/shipping/pin/${pin}`).then((r) => r.check);
    p.catch(() => cache.delete(pin));
    cache.set(pin, p);
  }
  return p;
}

/** The answer for this PIN code, once it has six digits (asked half a second after typing stops). */
export function usePinCheck(pin: string): PinState {
  const [state, setState] = useState<PinState>({ status: 'idle' });
  useEffect(() => {
    const p = pin.trim();
    if (!validPin(p)) { setState({ status: 'idle' }); return; }
    let live = true;
    setState({ status: 'checking' });
    const timer = setTimeout(() => {
      fetchPinCheck(p).then((check) => {
        if (!live) return;
        setState({ status: 'done', pin: p, check });
        if (check?.serviceable) rememberPin(p);
      }, () => live && setState({ status: 'error' }));
    }, 450);
    return () => { live = false; clearTimeout(timer); };
  }, [pin]);
  return state;
}

/** "Tue, 18 Nov" from "2026-11-18". */
export function deliveryDay(d: string): string {
  const date = new Date(`${d}T12:00:00+05:30`);
  return date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

/** One line for the shopper, or null when there's nothing to say. */
export function pinMessage(s: PinState): { tone: 'ok' | 'bad' | 'muted'; text: string } | null {
  if (s.status === 'checking') return { tone: 'muted', text: 'Checking delivery…' };
  if (s.status !== 'done' || !s.check || s.check.serviceable === null) return null;
  const c = s.check;
  if (!c.serviceable) return { tone: 'bad', text: `Our courier doesn’t deliver to ${s.pin} yet. Try another address, or write to us and we’ll find a way.` };
  const when = c.deliveryBy ? `Delivery by ${deliveryDay(c.deliveryBy)}` : c.days ? `Delivered in about ${c.days} days` : 'We deliver here';
  return { tone: 'ok', text: `${when}${c.oda ? ' (remote area: it can take a little longer)' : ''}${c.cod === false ? '. Cash on delivery isn’t available here.' : '.'}` };
}

export function rememberPin(pin: string) { try { localStorage.setItem(KEY, pin); } catch { /* private mode */ } }
export function rememberedPin(): string { try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; } }
