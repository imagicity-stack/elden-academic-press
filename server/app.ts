// The store API (mounted at /api). Runs as one Vercel function in production
// and inside Vite's dev server locally.
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { Deps } from './deps.js';
import { clientIp, HttpError } from './lib/http.js';
import { RazorpayError } from './lib/razorpay.js';
import { account, type Customer } from './routes/account.js';
import { competitions } from './routes/competitions.js';
import { competitionInfo, teams } from './routes/teams.js';
import { bookPage, competitionPage } from './routes/og.js';
import { admin, type AdminSession } from './routes/admin/index.js';
import { cron, dev, forms } from './routes/misc.js';
import { handleCspReport } from './routes/cspReport.js';
import { publicPopups } from './routes/popups.js';
import { meta } from './routes/meta.js';
import { newsletter } from './routes/newsletter.js';
import { customerOrders } from './routes/orders.js';
import { store } from './routes/store.js';
import { productFeedXml } from './routes/feeds.js';
import { sitemapXml } from './routes/sitemap.js';
import { webhooks } from './routes/webhooks.js';
import { tagCatalog } from './lib/cdn.js';
import { connectionLost, healthCheck, pgCode, type Health } from './services/health.js';

export type AppEnv = { Variables: { deps: Deps; ip: string; admin: AdminSession; customer: Customer } };

export function createApp(getDeps: () => Promise<Deps>) {
  const root = new Hono<AppEnv>();
  const app = root.basePath('/api');

  // Outside /api (vercel.json rewrites /sitemap.xml here); both share one router.
  root.get('/sitemap.xml', async (c) => {
    const xml = await sitemapXml(await getDeps(), process.env.VITE_SITE_LIVE === 'true');
    await tagCatalog();
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=3600' });
  });

  // A competition's page with its own link-preview tags (vercel.json sends /competitions/<slug> here).
  root.get('/competitions/:slug', async (c) => {
    const slug = c.req.param('slug');
    try {
      const html = await competitionPage(await getDeps(), slug, new URL(c.req.url).origin);
      // Ad visitors land here: the edge keeps answering at once while it refreshes in the background.
      if (html) return c.html(html, 200, { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400' });
    } catch (e) {
      console.warn('[og] competition page', (e as Error).message);
    }
    // Not found or not ready: the app's own page (the trailing slash skips this route).
    return c.redirect(`/competitions/${encodeURIComponent(slug)}/`, 302);
  });

  // A book's page with its own link-preview tags, structured data and content (vercel.json sends /books/<slug> here).
  root.get('/books/:slug', async (c) => {
    const slug = c.req.param('slug');
    try {
      const page = await bookPage(await getDeps(), slug, new URL(c.req.url).origin);
      await tagCatalog(); // saving a book in the admin clears it
      return c.html(page.html, page.status, { 'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=86400' });
    } catch (e) {
      console.warn('[og] book page', (e as Error).message);
    }
    // Something failed: the app's own page (the trailing slash skips this route).
    return c.redirect(`/books/${encodeURIComponent(slug)}/`, 302);
  });

  // Product feed for Google Merchant Center and Meta Commerce Manager (vercel.json rewrites /feeds/* here).
  root.get('/feeds/products.xml', async (c) => {
    const xml = await productFeedXml(await getDeps());
    await tagCatalog();
    return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=3600' });
  });

  // Before the middleware below, so it can report settings that stop the rest from starting.
  let health: { at: number; result: Promise<Health> } | undefined;
  app.get('/health', async (c) => {
    if (!health || Date.now() - health.at > 10_000) health = { at: Date.now(), result: healthCheck(getDeps) };
    const h = await health.result;
    return c.json(h, h.ok ? 200 : 503, { 'Cache-Control': 'no-store' });
  });

  // What the Content Security Policy blocked (no database needed, so before the middleware below).
  app.post('/csp-report', (c) => handleCspReport(c.req.raw));

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
    // A short reference, shown to the visitor and in the log line, to find this error in Vercel → Logs.
    const ref = randomBytes(4).toString('hex');
    console.error(`[api] error ref=${ref}`, c.req.method, c.req.path, err);
    // A missing table or column: the code is newer than the database.
    if (['42P01', '42703'].includes(pgCode(err) ?? '')) {
      return c.json({
        error: 'The database needs an update. Open /api/health to see which file to run in Supabase → SQL Editor.',
        code: 'database_update_needed',
      }, 503);
    }
    // Couldn't reach the database (or its connection dropped): safe for the browser to retry.
    if (connectionLost(err)) {
      return c.json({ error: 'The store is busy for a moment. Please try again.', code: 'db_unavailable', ref }, 503, { 'Retry-After': '1' });
    }
    return c.json({ error: `Something went wrong on our side. Please try again. (Error ${ref})`, code: 'server_error', ref }, 500);
  });

  app.notFound((c) => c.json({ error: 'Not found', code: 'not_found' }, 404));

  app.route('/', store);
  app.route('/', forms);
  app.route('/orders', customerOrders);
  app.route('/webhooks', webhooks);
  app.route('/admin', admin);
  app.route('/account', account);
  app.route('/competitions', teams);
  app.route('/competitions', competitions);
  app.route('/competition-info', competitionInfo);
  app.route('/newsletter', newsletter);
  app.route('/popups', publicPopups);
  app.route('/meta', meta);
  app.route('/cron', cron);
  app.route('/dev', dev);
  return app;
}
