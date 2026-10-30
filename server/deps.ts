import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import { getDb, type DB } from './db/client';
import { products, productVariants, resources } from './db/schema';
import { samplePdf, seedDemo } from './db/seed';
import { loadEnv, type Env } from './env';
import { consoleMailer, resendMailer, type Mailer } from './lib/mail';
import { razorpayHttp, razorpaySimulator, type Razorpay } from './lib/razorpay';
import { localStorage, supabaseStorage, type Storage } from './lib/storage';

export interface Deps {
  env: Env;
  db: DB;
  /** null when payments are not configured. */
  razorpay: Razorpay | null;
  mailer: Mailer;
  storage: Storage;
  now(): Date;
}

// Kept on globalThis so the dev server's hot reloads reuse one database.
const g = globalThis as { __eldenDeps?: Promise<Deps> };

/** Production / local wiring from environment variables (memoised per process). */
export function getDeps(): Promise<Deps> {
  g.__eldenDeps ??= buildDeps(loadEnv()).catch((e) => { g.__eldenDeps = undefined; throw e; });
  return g.__eldenDeps;
}

async function buildDeps(env: Env): Promise<Deps> {
  const db = await getDb(env);
  const razorpay = env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
    ? razorpayHttp(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET)
    : env.paymentSimulator ? razorpaySimulator() : null;
  const mailer = env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : consoleMailer();

  let storage: Storage;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) storage = supabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  else if (env.onVercel) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  else {
    // Relative links, so they work on whatever port the dev server uses.
    const local = localStorage(join(env.PGLITE_DIR, '..', 'uploads'), '');
    storage = local;
    if (!env.DATABASE_URL) await seedLocal(db, local);
  }

  return { env, db, razorpay, mailer, storage, now: () => new Date() };
}

/** First local run: fill the embedded database with the demo catalogue and sample files. */
async function seedLocal(db: DB, storage: ReturnType<typeof localStorage>) {
  const [{ n }] = await db.select({ n: count() }).from(products);
  if (n === 0) {
    console.info('[dev] seeding demo catalogue');
    await seedDemo(db);
  }
  const files = [
    ...(await db.select({ path: productVariants.filePath, name: productVariants.fileName }).from(productVariants))
      .filter((v) => v.path).map((v) => ['ebooks', v.path!, v.name ?? 'Sample'] as const),
    ...(await db.select({ path: resources.filePath, name: resources.title }).from(resources))
      .filter((r) => r.path).map((r) => ['resources', r.path!, r.name] as const),
  ];
  for (const [bucket, path, title] of files) {
    const exists = await access(join(storage.root, bucket, path)).then(() => true, () => false);
    if (!exists) await storage.write(bucket, path, samplePdf(title));
  }
}
