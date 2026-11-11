// Admin → Cookie consent: how many visitors saw the cookie banner and what they chose, from the
// anonymous counters in consent_stats (no IP addresses or ids are kept).
import { Hono } from 'hono';
import { gte } from 'drizzle-orm';
import type { AppEnv } from '../../app.js';
import { consentStats } from '../../db/schema.js';
import { istDay } from '../../services/competitionAnalytics.js';
import { channelLabel } from '../../../src/shared/attribution.js';
import { DEVICE_LABEL, PAGE_LABEL, TIMING } from '../../../src/shared/consentStats.js';

export const adminConsent = new Hono<AppEnv>();

type Row = typeof consentStats.$inferSelect;
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 1000) / 10 : null);

/** Shown / accepted / essential and the acceptance rate, per value of one dimension. */
function breakdown(rows: Row[], key: (r: Row) => string, label: (k: string) => string) {
  const m = new Map<string, { shown: number; accept: number; essential: number }>();
  for (const r of rows) {
    const k = key(r);
    const x = m.get(k) ?? { shown: 0, accept: 0, essential: 0 };
    if (r.event === 'shown') x.shown += r.n;
    if (r.event === 'accept') x.accept += r.n;
    if (r.event === 'essential') x.essential += r.n;
    m.set(k, x);
  }
  return [...m].map(([k, x]) => ({ key: k, label: label(k), ...x, decided: x.accept + x.essential, acceptRate: pct(x.accept, x.accept + x.essential) }))
    .filter((x) => x.shown || x.accept || x.essential).sort((a, b) => b.shown - a.shown || b.accept - a.accept);
}

adminConsent.get('/', async (c) => {
  const { db, now } = c.get('deps');
  const days = Math.min(3650, Math.max(1, Number(c.req.query('days')) || 30));
  const since = istDay(new Date(now().getTime() - (days - 1) * 86_400_000));
  const rows = await db.select().from(consentStats).where(gte(consentStats.day, since));
  const sum = (e: string) => rows.filter((r) => r.event === e).reduce((n, r) => n + r.n, 0);
  const shown = sum('shown'), accept = sum('accept'), essential = sum('essential');
  const dayList: string[] = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(istDay(new Date(now().getTime() - i * 86_400_000)));
  const daily = dayList.map((d) => {
    const on = rows.filter((r) => r.day === d);
    const s = (e: string) => on.filter((r) => r.event === e).reduce((n, r) => n + r.n, 0);
    return { day: d, shown: s('shown'), accept: s('accept'), essential: s('essential') };
  });
  const decided = rows.filter((r) => r.event === 'accept' || r.event === 'essential');
  return c.json({
    totals: {
      shown, accept, essential, decided: accept + essential,
      noChoice: Math.max(0, shown - accept - essential),
      acceptRate: pct(accept, accept + essential),
      acceptOfShown: pct(accept, shown),
      changedToAll: sum('change_all'), changedToEssential: sum('change_essential'),
    },
    daily,
    byDevice: breakdown(rows, (r) => r.device, (k) => DEVICE_LABEL[k] ?? k),
    byRegion: breakdown(rows, (r) => r.region, (k) => k || 'Unknown').slice(0, 15),
    byChannel: breakdown(rows, (r) => r.channel, (k) => channelLabel(k)),
    byPage: breakdown(rows, (r) => r.page, (k) => PAGE_LABEL[k] ?? k),
    timing: TIMING.map((t) => ({
      key: t.key, label: t.label,
      accept: decided.filter((r) => r.timing === t.key && r.event === 'accept').reduce((n, r) => n + r.n, 0),
      essential: decided.filter((r) => r.timing === t.key && r.event === 'essential').reduce((n, r) => n + r.n, 0),
    })),
  });
});
