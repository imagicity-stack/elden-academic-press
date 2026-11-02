import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../env.js';
import * as schema from './schema.js';

export type DB = PostgresJsDatabase<typeof schema>;
/** A database handle or an open transaction — both run the same queries. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Q = DB | Tx;

export const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations', import.meta.url));

/** Seconds an unused database connection stays open before it is closed. */
export const IDLE_SECONDS = 5;

/** Production / Supabase: postgres.js through Supabase's transaction pooler. */
export function connectPostgres(url: string): DB {
  const client = postgres(url, {
    prepare: false, max: 3, idle_timeout: IDLE_SECONDS, max_lifetime: 5 * 60, connect_timeout: 8,
  });
  return drizzlePostgres(client, { schema });
}

/**
 * Vercel pauses a server instance once its requests and background work finish, and wakes
 * it for later visitors. A database connection left open across a pause is usually dead on
 * waking, and the first query on it hangs until the request times out. So after each request
 * the instance is kept running until its idle connections have closed (what Vercel's
 * attachDatabasePool does for other drivers). A newer request restarts the wait.
 */
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let idleDone: (() => void) | undefined;
export function stayUpUntilConnectionsClose(waitUntil: (p: Promise<unknown>) => void) {
  if (idleTimer) { clearTimeout(idleTimer); idleDone?.(); }
  const p = new Promise<void>((resolve) => { idleDone = resolve; });
  idleTimer = setTimeout(() => { idleTimer = undefined; idleDone?.(); }, IDLE_SECONDS * 1000 + 500);
  waitUntil(p);
}
export const afterConnectionsClose = () => new Promise<void>((r) => setTimeout(r, IDLE_SECONDS * 1000 + 500));

/** Embedded Postgres (PGlite) for local development and tests. Pass no dir for in-memory. */
export async function connectPglite(dir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (dir) await mkdir(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // The query builder API is identical across drivers.
  return db as unknown as DB;
}

let shared: Promise<DB> | undefined;

export function getDb(env: Env): Promise<DB> {
  if (!shared) {
    if (env.DATABASE_URL) shared = Promise.resolve(connectPostgres(env.DATABASE_URL));
    else if (env.onVercel) throw new Error('DATABASE_URL is not set');
    else shared = connectPglite(env.PGLITE_DIR);
  }
  return shared;
}
