import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { count } from 'drizzle-orm';
import { afterConnectionsClose, getDb, type DB } from './db/client.js';
import { products, productVariants, resources } from './db/schema.js';
import { samplePdf, seedDemo } from './db/seed.js';
import { loadEnv, type Env } from './env.js';
import { waitUntil } from '@vercel/functions';
import { supabaseAuthUser, supabaseAuthUsers, type AuthUser } from './lib/authUsers.js';
import { consoleMailer, resendMailer, smtpMailer, type Mailer } from './lib/mail.js';
import { metaHttp, type Meta } from './lib/meta.js';
import { sarvamCalls, type CallProvider } from './lib/callProvider.js';
import { whatsappHttp, whatsappTemplatesHttp, type WaTemplates, type WhatsApp } from './lib/whatsapp.js';
import { razorpayHttp, razorpaySimulator, type Razorpay } from './lib/razorpay.js';
import { localStorage, supabaseStorage, type Storage } from './lib/storage.js';

export interface Deps {
  env: Env;
  db: DB;
  /** null when payments are not configured. */
  razorpay: Razorpay | null;
  mailer: Mailer;
  storage: Storage;
  now(): Date;
  /** Run work after the response is sent (emails). Unset = the caller waits for it. */
  defer?(task: Promise<unknown>): void;
  /** Everyone signed up in Supabase Auth. Unset when Supabase isn't configured (local development). */
  authUsers?(): Promise<AuthUser[]>;
  /** One Supabase Auth user (for the date they signed up). */
  authUser?(id: string): Promise<AuthUser | null>;
  /** Meta Conversions API; unset when not configured. */
  meta?: Meta | null;
  /** Places the voice-agent calls (Admin → Calls); unset until the provider is connected. */
  calls?: CallProvider | null;
  /** Sends WhatsApp messages (Admin → WhatsApp); unset until the token and number are set. */
  whatsapp?: WhatsApp | null;
  /** The WhatsApp account's message templates; unset without the token and account id. */
  whatsappTemplates?: WaTemplates | null;
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
  const mailer = env.SMTP_USER && env.SMTP_PASS
    ? smtpMailer({ host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.MAIL_FROM })
    : env.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY, env.MAIL_FROM) : consoleMailer();

  let storage: Storage;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) storage = supabaseStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  else if (env.onVercel) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  else {
    // Relative links, so they work on whatever port the dev server uses.
    const local = localStorage(join(env.PGLITE_DIR, '..', 'uploads'), '');
    storage = local;
    if (!env.DATABASE_URL) await seedLocal(db, local);
  }

  // On Vercel, emails (with their PDFs) go out after the response, so paying customers aren't kept waiting.
  const sbAdmin = env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? [env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY] as const : null;
  const authUsers = sbAdmin ? supabaseAuthUsers(...sbAdmin) : undefined;
  const authUser = sbAdmin ? supabaseAuthUser(...sbAdmin) : undefined;
  const meta = env.VITE_META_PIXEL_ID && env.META_CAPI_TOKEN ? metaHttp(env.VITE_META_PIXEL_ID, env.META_CAPI_TOKEN, env.META_TEST_EVENT_CODE) : null;
  const calls = sarvamCallsFrom(env);
  const whatsapp = env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? whatsappHttp({ token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID }) : null;
  const whatsappTemplates = env.WHATSAPP_TOKEN && env.WHATSAPP_BUSINESS_ACCOUNT_ID ? whatsappTemplatesHttp({ token: env.WHATSAPP_TOKEN, businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID }) : null;
  return { env, db, razorpay, mailer, storage, authUsers, authUser, meta, calls, whatsapp, whatsappTemplates, now: () => new Date(), defer: env.onVercel ? (task) => waitUntil(task.finally(afterConnectionsClose)) : undefined };
}

/** Outgoing calls through Sarvam, once its key, workspace and both campaign ids are set; else null. */
export function sarvamCallsFrom(env: Env, fetchImpl?: typeof fetch): CallProvider | null {
  const { SARVAM_API_KEY: apiKey, SARVAM_ORG_ID: orgId, SARVAM_WORKSPACE_ID: workspaceId, SARVAM_CART_CAMPAIGN_ID: cartCampaignId, SARVAM_FEEDBACK_CAMPAIGN_ID: feedbackCampaignId } = env;
  if (!apiKey || !orgId || !workspaceId || !cartCampaignId || !feedbackCampaignId) return null;
  return sarvamCalls({ apiKey, orgId, workspaceId, cartCampaignId, feedbackCampaignId, fetch: fetchImpl });
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
