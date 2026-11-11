// POST /api/consent/track: the cookie banner reports, anonymously, that it was shown or what was
// chosen. The server adds one to a counter (day, device type, approximate region, channel, page,
// time to decide). The IP address and browser string are read to work those out, then discarded.
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { consentStats } from '../db/schema.js';
import { body, rateLimit } from '../lib/http.js';
import { isoStateName } from '../lib/states.js';
import { istDay } from '../services/competitionAnalytics.js';
import { orderChannel } from '../../src/shared/attribution.js';
import { CONSENT_EVENTS, pageGroup, timingOf } from '../../src/shared/consentStats.js';
import { zSource } from './store.js';

export const consent = new Hono<AppEnv>();

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|whatsapp/i;
export function deviceOf(ua: string) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

consent.post('/track', async (c) => {
  const deps = c.get('deps');
  const ua = c.req.header('user-agent') ?? '';
  if (!ua || BOT.test(ua)) return c.body(null, 204);
  await rateLimit(deps.db, `consent:${c.get('ip')}`, 60, 3600);
  const input = await body(c, z.object({
    event: z.enum(CONSENT_EVENTS as [string, ...string[]]),
    path: z.string().max(300).default('/'),
    seconds: z.number().min(0).max(10 * 365 * 86_400).nullable().optional(),
    visit: zSource,
  }));
  const country = c.req.header('x-vercel-ip-country')?.toUpperCase() ?? '';
  const region = country === 'IN' ? isoStateName(c.req.header('x-vercel-ip-country-region')) ?? 'India' : /^[A-Z]{2}$/.test(country) ? country : '';
  const row = {
    day: istDay(deps.now()),
    event: input.event,
    device: deviceOf(ua),
    region,
    channel: input.visit && (input.visit.first || input.visit.last) ? orderChannel(input.visit).channel : 'direct',
    page: pageGroup(input.path),
    timing: input.event === 'shown' ? '' : timingOf(input.seconds ?? null),
    n: 1,
  };
  await deps.db.insert(consentStats).values(row).onConflictDoUpdate({
    target: [consentStats.day, consentStats.event, consentStats.device, consentStats.region, consentStats.channel, consentStats.page, consentStats.timing],
    set: { n: sql`${consentStats.n} + 1` },
  });
  return c.body(null, 204);
});
