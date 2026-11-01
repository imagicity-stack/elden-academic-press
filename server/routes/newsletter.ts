// Public newsletter endpoints: subscribe (double opt-in), confirm, unsubscribe.
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { body, HttpError, rateLimit, zEmail, zPhone, zText } from '../lib/http.js';
import { checkNewsletterToken, confirmSubscription, subscribe, unsubscribe } from '../services/newsletter.js';

export const newsletter = new Hono<AppEnv>();

newsletter.post('/subscribe', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({
    email: zEmail,
    phone: zPhone,
    name: zText(120).optional(),
    source: z.enum(['footer', 'newsletter-page', 'home']).default('footer'),
    /** Honeypot: real people never fill this in. */
    website: z.string().max(0).optional(),
  }));
  await rateLimit(deps.db, `subscribe:${c.get('ip')}`, 10, 3600);
  const r = await subscribe(deps, { ...input, ip: c.get('ip'), confirmed: false });
  return c.json({ status: r.status });
});

newsletter.post('/confirm', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ email: z.string().max(200), token: z.string().max(100) }));
  if (!(await confirmSubscription(deps, input.email, input.token, c.get('ip')))) {
    throw new HttpError(400, 'This confirmation link isn’t valid any more. Please subscribe again.', 'invalid_link');
  }
  return c.json({ ok: true });
});

/**
 * Unsubscribe. Works from our page (JSON body) and as the one-click
 * unsubscribe that mail apps send (POST with ?e=&t= in the URL, RFC 8058).
 */
newsletter.post('/unsubscribe', async (c) => {
  const deps = c.get('deps');
  let email = c.req.query('e') ?? '';
  let token = c.req.query('t') ?? '';
  if (!email && c.req.header('content-type')?.includes('application/json')) {
    const input = await body(c, z.object({ email: z.string().max(200), token: z.string().max(100) }));
    ({ email, token } = input);
  }
  if (!checkNewsletterToken(deps.env.ORDER_LINK_SECRET, email, token)) throw new HttpError(400, 'This unsubscribe link isn’t valid.', 'invalid_link');
  await unsubscribe(deps, email);
  return c.json({ ok: true });
});
