import { SignJWT } from 'jose';
import { createApp } from '../server/app.js';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, type DB } from '../server/db/client.js';
import * as schema from '../server/db/schema.js';
import { seedDemo } from '../server/db/seed.js';
import type { Deps } from '../server/deps.js';
import { loadEnv } from '../server/env.js';
import { memoryMailer } from '../server/lib/mail.js';
import { razorpaySimulator } from '../server/lib/razorpay.js';
import type { Storage } from '../server/lib/storage.js';

export const JWT_SECRET = 'test-jwt-secret-that-is-long-enough-123456';
export const SUPABASE_URL = 'https://test.supabase.co';
export const WEBHOOK_SECRET = 'whsec_test';

export function memoryStorage(): Storage & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    publicUrl: (b, p) => `https://files.test/public/${b}/${p}`,
    signedDownloadUrl: async (b, p, s) => `https://files.test/signed/${b}/${p}?expires=${s}`,
    signedUploadUrl: async (b, p) => ({ url: `https://files.test/upload/${b}/${p}`, token: 'tok', path: p }),
    remove: async () => {},
    read: async (b, p) => files.get(`${b}/${p}`) ?? new TextEncoder().encode('%PDF-1.4 sample e-book'),
    write: async (b, p, data) => { files.set(`${b}/${p}`, data); },
    files,
  } as Storage & { files: Map<string, Uint8Array> };
}

// One migrated (and one seeded) database per test file, cloned for each test.
const templates = new Map<boolean, Promise<PGlite>>();
function template(seed: boolean) {
  if (!templates.has(seed)) {
    templates.set(seed, (async () => {
      const pg = new PGlite();
      const db = drizzle(pg, { schema });
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      if (seed) await seedDemo(db as unknown as DB);
      return pg;
    })());
  }
  return templates.get(seed)!;
}

// With TEST_DATABASE_URL (a Postgres server you can create databases on, e.g.
// postgres://postgres@localhost:55432/postgres), every test runs on a real Postgres through
// postgres.js, as in production, instead of the in-memory one. The two differ in places
// (postgres.js can't send a JS Date in hand-written SQL, for one), so run it before a release:
//   TEST_DATABASE_URL=postgres://… npx vitest run
const PG_URL = process.env.TEST_DATABASE_URL;
const pgTemplates = new Map<boolean, Promise<string>>();
async function realPostgres(seed: boolean): Promise<DB> {
  const { createHash, randomUUID } = await import('node:crypto');
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { default: postgres } = await import('postgres');
  const { migrate: migratePg } = await import('drizzle-orm/postgres-js/migrator');
  const { connectPostgres } = await import('../server/db/client.js');
  const at = (name: string) => { const u = new URL(PG_URL!); u.pathname = `/${name}`; return u.toString(); };
  if (!pgTemplates.has(seed)) {
    pgTemplates.set(seed, (async () => {
      // One migrated (and seeded) template per version of the migrations and seed; shared by the test workers.
      const h = createHash('sha1');
      for (const f of readdirSync(MIGRATIONS_DIR, { recursive: true }).map(String).sort()) if (/\.(sql|json)$/.test(f)) h.update(readFileSync(join(MIGRATIONS_DIR, f)));
      h.update(readFileSync(new URL('../server/db/seed.ts', import.meta.url)));
      const name = `elden_tpl_${seed ? 'seed' : 'empty'}_${h.digest('hex').slice(0, 10)}`;
      const admin = postgres(PG_URL!, { max: 1, onnotice: () => {} });
      try {
        await admin`select pg_advisory_lock(4242)`;
        const [found] = await admin`select 1 from pg_database where datname = ${name}`;
        if (!found) {
          await admin.unsafe(`create database "${name}"`);
          const db = connectPostgres(at(name));
          await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
          if (seed) await seedDemo(db);
          await (db as DB & { $client: { end(): Promise<void> } }).$client.end();
        }
        await admin`select pg_advisory_unlock(4242)`;
      } finally { await admin.end(); }
      return name;
    })());
  }
  const tpl = await pgTemplates.get(seed)!;
  const name = `elden_t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = postgres(PG_URL!, { max: 1, onnotice: () => {} });
  try { await admin.unsafe(`create database "${name}" template "${tpl}"`); } finally { await admin.end(); }
  return connectPostgres(at(name));
}

export async function setup(opts: { env?: Record<string, string>; seed?: boolean } = {}) {
  const db = PG_URL ? await realPostgres(opts.seed !== false)
    : drizzle((await (await template(opts.seed !== false)).clone()) as PGlite, { schema }) as unknown as DB;
  const env = loadEnv({
    ORDER_LINK_SECRET: 'order-link-secret-for-tests-0123456789',
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: JWT_SECRET,
    ADMIN_OWNER_EMAIL: 'owner@eldenap.in',
    CRON_SECRET: 'cron-secret',
    SITE_URL: 'https://eldenap.in',
    ...opts.env,
  });
  const razorpay = razorpaySimulator();
  const mailer = memoryMailer();
  let clock: Date | null = null;
  const deps: Deps = { env, db, razorpay, mailer, storage: memoryStorage(), now: () => clock ?? new Date() };
  const app = createApp(async () => deps);

  async function call(method: string, path: string, init: { body?: unknown; headers?: Record<string, string>; raw?: string } = {}) {
    const res = await app.request('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-real-ip': '10.0.0.1', ...init.headers },
      body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
    });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json, headers: res.headers, text };
  }

  return {
    db, deps, razorpay, mailer, app, call,
    setClock: (d: Date | null) => { clock = d; },
  };
}

export async function supabaseToken(claims: { sub: string; email: string; aal?: string; provider?: string; name?: string }, secret = JWT_SECRET) {
  return new SignJWT({
    email: claims.email, aal: claims.aal ?? 'aal2', role: 'authenticated',
    app_metadata: { provider: claims.provider ?? 'email', providers: [claims.provider ?? 'email'] },
    user_metadata: claims.name ? { full_name: claims.name, avatar_url: 'https://lh3.googleusercontent.com/a/x' } : {},
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(`${SUPABASE_URL}/auth/v1`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));
}

export const contact = { name: 'Asha Kumari', email: 'asha@example.com', phone: '98765 43210' };
export const address = { name: 'Asha Kumari', line1: '12 Lake Road', city: 'Hazaribagh', state: '20', pincode: '825301' };
