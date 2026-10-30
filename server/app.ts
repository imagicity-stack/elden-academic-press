// The store API (mounted at /api). Runs as one Vercel function in production
// and inside Vite's dev server locally.
import { Hono } from 'hono';
import type { Deps } from './deps';
import { clientIp, HttpError } from './lib/http';
import { RazorpayError } from './lib/razorpay';
import { admin, type AdminSession } from './routes/admin';
import { cron, dev, forms } from './routes/misc';
import { customerOrders } from './routes/orders';
import { store } from './routes/store';
import { webhooks } from './routes/webhooks';

export type AppEnv = { Variables: { deps: Deps; ip: string; admin: AdminSession } };

export function createApp(getDeps: () => Promise<Deps>) {
  const app = new Hono<AppEnv>().basePath('/api');

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

  app.get('/health', async (c) => {
    const { razorpay, env } = c.get('deps');
    return c.json({ ok: true, payments: Boolean(razorpay), simulated: razorpay?.simulated ?? false, production: env.isProduction });
  });

  app.route('/', store);
  app.route('/', forms);
  app.route('/orders', customerOrders);
  app.route('/webhooks', webhooks);
  app.route('/admin', admin);
  app.route('/cron', cron);
  app.route('/dev', dev);
  return app;
}
