// Remembers in this browser how the visitor reached the site (see src/shared/attribution.ts),
// so their order can say where it came from. Only the source, never who they are; sent only
// with an order, and forgotten after 90 days.
import { touchFrom, type OrderSource, type Touch } from './shared/attribution';

const KEY = 'elden-source';
const KEEP_MS = 90 * 86_400_000;

function read(now: number): OrderSource {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as OrderSource;
    const fresh = (t?: Touch) => (t && typeof t.at === 'number' && now - t.at < KEEP_MS ? t : undefined);
    return { first: fresh(s.first), last: fresh(s.last) };
  } catch { return {}; }
}

/** Call once when the site loads: notes this visit's source (a direct visit only starts "first"). */
export function recordVisit(now = Date.now()) {
  try {
    const s = read(now);
    const t = touchFrom(location.href, document.referrer, now, location.hostname);
    const next: OrderSource = { first: s.first ?? t ?? { at: now, landing: location.pathname.slice(0, 200) }, last: t ?? s.last };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* private mode or storage blocked: the order just won't have a source */ }
}

/** What to send with an order. */
export const orderSource = (): OrderSource => read(Date.now());
