import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, type DB } from '../server/db/client.js';
import * as schema from '../server/db/schema.js';
import { buildSetupSql } from '../server/db/setup-sql.js';
import { verifySupabaseToken } from '../server/routes/admin/auth.js';
import { healthCheck } from '../server/services/health.js';
import { JWT_SECRET, SUPABASE_URL, setup, supabaseToken } from './helpers.js';

describe('Supabase setup script', () => {
  it('is up to date with the migrations (run `npm run db:setup-sql`)', () => {
    expect(readFileSync(new URL('../docs/supabase-setup.sql', import.meta.url), 'utf8')).toBe(buildSetupSql());
  });

  it('sets up a fresh database that later migrations continue from', async () => {
    const pg = new PGlite();
    await pg.exec(buildSetupSql());
    const db = drizzle(pg, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR }); // would fail on "already exists" if it re-ran anything
    expect(await db.select().from(schema.categories)).toHaveLength(6);
    expect(await db.select().from(schema.settings)).toHaveLength(1);
    expect((await pg.query('select count(*)::int as n from drizzle.__drizzle_migrations')).rows).toEqual([{ n: 3 }]);
  });
});

describe('/api/health', () => {
  it('reports a working local setup', async () => {
    const { call } = await setup({ seed: false });
    const res = await call('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ ok: true, payments: true, simulated: true, checks: { database: 'ok' } });
  });

  it('lists every missing Vercel setting at once', async () => {
    const h = await healthCheck(() => Promise.reject(new Error('DATABASE_URL is not set')), { VERCEL: '1', SUPABASE_URL });
    expect(h.ok).toBe(false);
    expect(h.todo).toEqual([expect.stringContaining('DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ORDER_LINK_SECRET')]);
  });

  it('spots a database without the store tables', async () => {
    const { deps } = await setup({ seed: false });
    const empty = drizzle(new PGlite(), { schema }) as unknown as DB;
    const h = await healthCheck(async () => ({ ...deps, db: empty }), {});
    expect(h.checks.database).toBe('missing');
    expect(h.todo.join(' ')).toMatch(/supabase-setup\.sql/);
  });
});

describe('admin sign-in tokens', () => {
  it('needs the legacy JWT secret only for HS256 tokens', async () => {
    const token = await supabaseToken({ sub: '00000000-0000-0000-0000-000000000001', email: 'a@b.in' });
    await expect(verifySupabaseToken(token, SUPABASE_URL)).rejects.toThrow(/SUPABASE_JWT_SECRET/);
    expect((await verifySupabaseToken(token, SUPABASE_URL, JWT_SECRET)).email).toBe('a@b.in');
    await expect(verifySupabaseToken(token, SUPABASE_URL, 'some-other-secret-value-0123456789')).rejects.toThrow();
  });
});

describe('/sitemap.xml', () => {
  it('lists pages and published titles once live, only home and policies before', async () => {
    const { app } = await setup();
    const get = async () => { const res = await app.request('/sitemap.xml'); return { text: await res.text(), headers: res.headers }; };
    const before = process.env.VITE_SITE_LIVE;
    try {
      process.env.VITE_SITE_LIVE = 'false';
      const early = await get();
      expect(early.text).toContain('<loc>https://eldenap.in/</loc>');
      expect(early.text).toContain('<loc>https://eldenap.in/refunds</loc>');
      expect(early.text).not.toContain('/books/');
      process.env.VITE_SITE_LIVE = 'true';
      const live = await get();
      expect(live.headers.get('content-type')).toMatch(/xml/);
      expect(live.text).toMatch(/<loc>https:\/\/eldenap\.in\/books\/[a-z0-9-]+<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
      expect(live.text).toContain('<loc>https://eldenap.in/catalogue</loc>');
    } finally {
      process.env.VITE_SITE_LIVE = before;
    }
  });
});

describe('index.html', () => {
  it('has its inline script allowed by hash in the CSP (update vercel.json when the script changes)', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    const csp = readFileSync(new URL('../vercel.json', import.meta.url), 'utf8');
    expect(scripts).toHaveLength(1);
    expect(csp).toContain(`'sha256-${createHash('sha256').update(scripts[0]).digest('base64')}'`);
  });
});
