// POST /api/meta/event: the browser's copy of an event (same event_id as its Pixel call),
// forwarded to Meta's Conversions API with the visitor's IP and browser. Reaches Meta
// even when an ad blocker stops the Pixel. Only for visitors who accepted ad cookies.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { body, HttpError, rateLimit, zText } from '../lib/http.js';
import { report, visitOf } from '../services/tracking.js';

const zId = z.string().trim().max(80);
const zEvent = z.object({
  name: z.enum(['PageView', 'ViewContent', 'Search', 'CustomizeProduct', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Contact']),
  eventId: z.string().trim().min(8).max(80),
  url: z.url().max(1000),
  custom: z.object({
    value: z.number().min(0).max(1_000_000).optional(),
    currency: z.literal('INR').optional(),
    content_name: zText(200).optional(),
    content_type: z.literal('product').optional(),
    content_ids: z.array(zId).max(50).optional(),
    contents: z.array(z.object({ id: zId, quantity: z.number().int().min(1).max(1000) })).max(50).optional(),
    num_items: z.number().int().min(0).max(1000).optional(),
    search_string: zText(100).optional(),
    format: z.string().regex(/^[a-z+,]{1,40}$/).optional(),
  }).optional(),
});

const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');

export const meta = new Hono<AppEnv>();

meta.post('/event', async (c) => {
  const deps = c.get('deps');
  const visit = visitOf(c);
  if (!deps.meta || !visit.consent) return c.body(null, 204);
  const input = await body(c, zEvent);
  if (host(input.url) !== host(deps.env.SITE_URL)) throw new HttpError(400, 'Unknown page', 'invalid');
  await rateLimit(deps.db, `meta:${c.get('ip')}`, 600, 3600);
  await report(deps, true, { name: input.name, eventId: input.eventId, time: deps.now(), url: input.url, user: visit, custom: input.custom });
  return c.body(null, 204);
});
