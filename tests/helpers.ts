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

export function memoryStorage(): Storage {
  return {
    publicUrl: (b, p) => `https://files.test/public/${b}/${p}`,
    signedDownloadUrl: async (b, p, s) => `https://files.test/signed/${b}/${p}?expires=${s}`,
    signedUploadUrl: async (b, p) => ({ url: `https://files.test/upload/${b}/${p}`, token: 'tok', path: p }),
    remove: async () => {},
  };
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

export async function setup(opts: { env?: Record<string, string>; seed?: boolean } = {}) {
  const pg = (await (await template(opts.seed !== false)).clone()) as PGlite;
  const db = drizzle(pg, { schema }) as unknown as DB;
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

export async function supabaseToken(claims: { sub: string; email: string; aal?: string }, secret = JWT_SECRET) {
  return new SignJWT({ email: claims.email, aal: claims.aal ?? 'aal2', role: 'authenticated' })
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
