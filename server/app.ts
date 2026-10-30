// The store API (mounted at /api). Runs as one Vercel function in production
// and inside Vite's dev server locally.
import { Hono } from 'hono';
import type { Deps } from './deps.js';
import { clientIp, HttpError } from './lib/http.js';
import { RazorpayError } from './lib/razorpay.js';
import { admin, type AdminSession } from './routes/admin/index.js';
import { cron, dev, forms } from './routes/misc.js';
import { customerOrders } from './routes/orders.js';
import { store } from './routes/store.js';
import { webhooks } from './routes/webhooks.js';
import { healthCheck, type Health } from './services/health.js';

export type AppEnv = { Variables: { deps: Deps; ip: string; admin: AdminSession } };

export function createApp(getDeps: () => Promise<Deps>) {
  const app = new Hono<AppEnv>().basePath('/api');

  // Before the middleware below, so it can report settings that stop the rest from starting.
  let health: { at: number; result: Promise<Health> } | undefined;
  app.get('/health', async (c) => {
    if (!health || Date.now() - health.at > 10_000) health = { at: Date.now(), result: healthCheck(getDeps) };
    const h = await health.result;
    return c.json(h, h.ok ? 200 : 503, { 'Cache-Control': 'no-store' });
  });

  app.use('*', async (c, next) => {
    c.set('deps', await getDeps());
    c.set('ip', clientIp(c));
    await next();
    if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message, code: err.code, details: err.details }, err.status);
    }
    if (err instanceof RazorpayError) {
      console.error('[razorpay]', err.status, err.message);
      return c.json({ error: 'The payment service returned an error. Please try again.', code: 'gateway_error' }, 502);
    }
    console.error('[api]', c.req.method, c.req.path, err);
    return c.json({ error: 'Something went wrong on our side. Please try again.', code: 'server_error' }, 500);
  });

  app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

  app.route('/', store);
  app.route('/', forms);
  app.route('/orders', customerOrders);
  app.route('/webhooks', webhooks);
  app.route('/admin', admin);
  app.route('/cron', cron);
  app.route('/dev', dev);
  return app;
}
