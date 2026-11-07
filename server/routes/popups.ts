// Popups on the website: the live ones (cached for a minute at the edge), and counting what
// visitors do with them. Sign-ups are counted by the newsletter route, not here.
import { Hono } from 'hono';
import { and, eq, isNull, lte, gte, or } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { popups } from '../db/schema.js';
import { body, HttpError, rateLimit } from '../lib/http.js';
import { countPopup } from '../services/popups.js';
import type { LivePopup } from '../../src/shared/popups.js';

export const publicPopups = new Hono<AppEnv>();

publicPopups.get('/live', async (c) => {
  const { db, now } = c.get('deps');
  const at = now();
  const rows = await db.select().from(popups).where(and(
    eq(popups.status, 'live'),
    or(isNull(popups.startsAt), lte(popups.startsAt, at)),
    or(isNull(popups.endsAt), gte(popups.endsAt, at)),
  ));
  const items: LivePopup[] = rows.map((p) => ({
    id: p.id, priority: p.priority, content: p.content, design: p.design, trigger: p.trigger, audience: p.audience, frequency: p.frequency,
    startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null,
  }));
  c.header('Cache-Control', 'public, max-age=0, s-maxage=60');
  return c.json({ items });
});

/** Shown, button clicked or closed. Over the limit, it's quietly not counted. */
publicPopups.post('/:id{[0-9a-f-]{36}}/event', async (c) => {
  const deps = c.get('deps');
  const { type } = await body(c, z.object({ type: z.enum(['view', 'click', 'close']) }));
  try {
    await rateLimit(deps.db, `popupev:${c.get('ip')}`, 300, 3600);
  } catch (e) {
    if (e instanceof HttpError && e.status === 429) return c.body(null, 204);
    throw e;
  }
  await countPopup(deps.db, c.req.param('id'), type === 'view' ? 'views' : type === 'click' ? 'clicks' : 'closes', deps.now());
  return c.body(null, 204);
});
