// /api/health: what's connected and what still needs setting up. Names
// settings that are missing or wrong, never their values.
import { createClient } from '@supabase/supabase-js';
import { eq, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { accounts, adminUsers, calls, competitionSignups, orders, popups, products, productVariants, settings, subscribers, teamApplications, whatsappMessages } from '../db/schema.js';

type Check = 'ok' | 'missing' | 'error';
export interface Health {
  ok: boolean;
  production: boolean;
  payments: boolean;
  simulated: boolean;
  checks: Record<'config' | 'database' | 'storage' | 'adminSignIn' | 'payments' | 'email', Check>;
  /** Milliseconds for one small database query (the first may include connecting), and where the server runs. */
  speed?: { firstQueryMs: number; queryMs: number; serverRegion: string | null; databaseRegion: string | null };
  todo: string[];
}

const REQUIRED = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDER_LINK_SECRET'];
const SETUP_SQL = 'run docs/supabase-setup.sql in Supabase → SQL Editor';
const timeout = () => AbortSignal.timeout(5000);

export const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};

/** The AWS region in a Supabase pooler address (aws-0-eu-central-1.pooler.supabase.com); never the rest of the URL. */
export function supabaseRegion(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return /^aws-\d+-([a-z]{2}-[a-z]+-\d)\.pooler\.supabase\.com$/.exec(new URL(url).hostname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The Vercel region nearest each Supabase region. */
const VERCEL_NEAR: Record<string, string> = {
  'ap-south-1': 'bom1', 'ap-southeast-1': 'sin1', 'ap-southeast-2': 'syd1', 'ap-northeast-1': 'hnd1', 'ap-northeast-2': 'icn1',
  'eu-central-1': 'fra1', 'eu-central-2': 'fra1', 'eu-west-1': 'dub1', 'eu-west-2': 'lhr1', 'eu-west-3': 'cdg1', 'eu-north-1': 'arn1',
  'us-east-1': 'iad1', 'us-east-2': 'cle1', 'us-west-1': 'sfo1', 'us-west-2': 'pdx1', 'ca-central-1': 'yul1', 'sa-east-1': 'gru1',
};

const LOST = new Set(['CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECT_TIMEOUT',
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', '57P01', '08000', '08003', '08006']);
/** The database couldn't be reached or the connection dropped (not a problem with the query). */
export function connectionLost(e: unknown): boolean {
  const code = pgCode(e);
  if (code && LOST.has(code)) return true;
  const msg = String((e as { cause?: { message?: string } })?.cause?.message ?? (e as Error)?.message ?? '');
  return /max client connections|too many clients|connection terminated|Connection terminated/i.test(msg);
}

export async function healthCheck(getDeps: () => Promise<Deps>, source: Record<string, string | undefined> = process.env): Promise<Health> {
  const todo: string[] = [];
  const checks: Health['checks'] = { config: 'ok', database: 'error', storage: 'error', adminSignIn: 'error', payments: 'missing', email: 'missing' };

  const missing = source.VERCEL ? REQUIRED.filter((k) => !source[k]?.trim()) : [];
  if (missing.length) todo.push(`Add ${missing.join(', ')} in Vercel → Settings → Environment Variables, then redeploy`);

  let deps: Deps;
  try {
    deps = await getDeps();
  } catch (e) {
    // Startup only fails on missing or invalid settings; those messages are our own.
    const msg = (e as Error).message;
    if (!missing.length) todo.push(/^(Set |DATABASE_URL|SUPABASE_)/.test(msg) ? msg : 'The server could not start — see the function logs on Vercel');
    checks.config = 'error';
    return { ok: false, production: false, payments: false, simulated: false, checks, todo };
  }
  const { env, db, razorpay } = deps;

  if (env.onVercel) {
    const site = source.SITE_URL?.trim();
    if (!site) todo.push('Set SITE_URL to https://eldenap.in (links in emails and the sitemap use it)');
    else if (/localhost|127\.0\.0\.1/i.test(site)) todo.push(`SITE_URL is a localhost address: change it to https://eldenap.in and redeploy (until then ${env.SITE_URL} is used)`);
    if (!env.CRON_SECRET) todo.push('Set CRON_SECRET (unpaid orders won’t release their stock without it)');
  }

  let hasOwner = false;
  let speed: Health['speed'];
  try {
    const t0 = Date.now();
    await db.execute(sql`select 1`);
    const t1 = Date.now();
    await db.execute(sql`select 1`);
    const databaseRegion = supabaseRegion(env.DATABASE_URL);
    speed = { firstQueryMs: t1 - t0, queryMs: Date.now() - t1, serverRegion: source.VERCEL_REGION ?? null, databaseRegion };
    // Next to each other a query takes a few milliseconds; every extra one per page adds the distance again.
    const near = databaseRegion ? VERCEL_NEAR[databaseRegion] : undefined;
    if (env.onVercel && near && speed.serverRegion && near !== speed.serverRegion) {
      todo.push(`The server runs in ${speed.serverRegion} but the database is in ${databaseRegion}: set "regions": ["${near}"] in vercel.json so each query takes a few milliseconds instead of ${speed.queryMs}`);
    } else if (env.onVercel && speed.queryMs > 40) {
      todo.push(`Each database query takes ${speed.queryMs} ms: the server (vercel.json "regions") should be in the same region as the Supabase project`);
    }
    const [row] = await db.select({ id: settings.id }).from(settings).where(eq(settings.id, 1));
    if (!row) throw Object.assign(new Error('settings row missing'), { code: '42P01' });
    hasOwner = (await db.select({ id: adminUsers.userId }).from(adminUsers).where(eq(adminUsers.role, 'owner')).limit(1)).length > 0;
    // Databases set up before an update need its file from docs/supabase-updates/ (oldest first).
    const updates: [string, () => Promise<unknown>][] = [
      ['0003_newsletter', async () => {
        await db.select({ n: settings.newsletterDailyLimit }).from(settings).limit(1);
        await db.select({ id: subscribers.id }).from(subscribers).limit(1);
      }],
      ['0004_meta_tracking', () => db.select({ v: orders.adConsent }).from(orders).limit(1)],
      ['0005_ebook_files', () => db.select({ v: productVariants.files }).from(productVariants).limit(1)],
      ['0006_ebook_with_print', () => db.select({ v: products.ebookWithPrint }).from(products).limit(1)],
      ['0007_cash_on_delivery', () => db.select({ v: orders.codAmount }).from(orders).limit(1)],
      ['0008_product_images', () => db.select({ v: products.images }).from(products).limit(1)],
      // The profile's columns on accounts (and the earlier competitions tables, kept unused).
      ['0009_competitions', () => db.select({ v: accounts.accountType }).from(accounts).limit(1)],
      ['0011_simple_competitions', () => db.select({ v: competitionSignups.id }).from(competitionSignups).limit(1)],
      ['0012_doomsday_diaries', async () => {
        await db.select({ v: accounts.dob }).from(accounts).limit(1);
        await db.select({ v: teamApplications.id }).from(teamApplications).limit(1);
      }],
      ['0013_order_source', () => db.select({ v: orders.channel }).from(orders).limit(1)],
      ['0014_popups', () => db.select({ v: popups.id }).from(popups).limit(1)],
      ['0015_calls', () => db.select({ v: calls.id }).from(calls).limit(1)],
      ['0016_subscriber_call_consent', () => db.select({ v: subscribers.callConsent }).from(subscribers).limit(1)],
      ['0017_whatsapp', () => db.select({ v: whatsappMessages.id }).from(whatsappMessages).limit(1)],
    ];
    checks.database = 'ok';
    for (const [file, probe] of updates) {
      try {
        await probe();
      } catch (e) {
        if (!['42P01', '42703'].includes(pgCode(e) ?? '')) throw e;
        checks.database = 'missing';
        todo.push(`The database needs an update: run docs/supabase-updates/${file}.sql in Supabase → SQL Editor`);
      }
    }
  } catch (e) {
    const code = pgCode(e);
    if (code === '42P01') {
      checks.database = 'missing';
      todo.push(`The database has no store tables yet: ${SETUP_SQL}`);
    } else if (code === '28P01') todo.push('DATABASE_URL has the wrong database password');
    else todo.push('Can’t reach the database: check DATABASE_URL (Supabase → Connect → Transaction pooler, port 6543, with your database password in it)');
  }

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (u, i) => fetch(u, { ...i, signal: timeout() }) } });
    const { data, error } = await sb.storage.listBuckets().catch((e: Error) => ({ data: null, error: e }));
    if (error || !data) todo.push('Supabase storage refused the key: SUPABASE_SERVICE_ROLE_KEY must be the secret (service_role) key of the project at SUPABASE_URL');
    else {
      const missing = ['covers', 'ebooks', 'resources', 'competition-entries', 'competition-files', 'competition-media'].filter((b) => !data.some((d) => d.id === b));
      if (missing.length) {
        checks.storage = 'missing';
        todo.push(`Storage buckets missing (${missing.join(', ')}): ${SETUP_SQL}`);
      } else checks.storage = 'ok';
    }

    const signIn: string[] = [];
    if (!source.VITE_SUPABASE_URL || !source.VITE_SUPABASE_ANON_KEY) signIn.push('Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (the publishable / anon key), then redeploy');
    else if (source.VITE_SUPABASE_URL.replace(/\/$/, '') !== env.SUPABASE_URL.replace(/\/$/, '')) signIn.push('VITE_SUPABASE_URL and SUPABASE_URL should be the same address');
    if (!env.ADMIN_OWNER_EMAIL && !hasOwner) signIn.push('Set ADMIN_OWNER_EMAIL to the email of your Supabase user');
    try {
      const res = await fetch(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`, { signal: timeout() });
      if (!res.ok) throw new Error(String(res.status));
      const { keys } = await res.json() as { keys?: unknown[] };
      // No published keys = the project signs with the legacy shared secret.
      if (!keys?.length && !env.SUPABASE_JWT_SECRET) signIn.push('Set SUPABASE_JWT_SECRET (Supabase → Project Settings → JWT Keys → Legacy JWT Secret)');
    } catch {
      signIn.push('Can’t reach SUPABASE_URL: it should look like https://your-project-id.supabase.co');
    }
    todo.push(...signIn);
    checks.adminSignIn = signIn.length ? 'missing' : 'ok';
  } else {
    checks.storage = 'ok'; // local folder
    checks.adminSignIn = env.devAdmin ? 'ok' : 'missing';
  }

  if (razorpay) {
    checks.payments = 'ok';
    if (!razorpay.simulated && !env.RAZORPAY_WEBHOOK_SECRET) {
      checks.payments = 'missing';
      todo.push('Set RAZORPAY_WEBHOOK_SECRET (same secret as the webhook in Razorpay)');
    }
  } else todo.push('Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to take payments');

  if ((env.SMTP_USER && env.SMTP_PASS) || env.RESEND_API_KEY) checks.email = 'ok';
  else if (env.onVercel) todo.push('Set SMTP_USER and SMTP_PASS (Google Workspace app password) so order emails are sent');
  if (env.onVercel && !env.MAIL_TO) todo.push('Set MAIL_TO to your inbox (e.g. hello@eldenap.in): it gets contact forms and a copy of every customer email');
  if (env.VITE_META_PIXEL_ID && !env.META_CAPI_TOKEN) todo.push('Set META_CAPI_TOKEN (Events Manager → dataset → Settings → Conversions API → Generate access token) so purchases reach Meta from the server');
  if (env.META_CAPI_TOKEN && !env.VITE_META_PIXEL_ID) todo.push('Set VITE_META_PIXEL_ID (your dataset ID in Events Manager), then redeploy');
  if (env.META_TEST_EVENT_CODE && env.isProduction) todo.push('META_TEST_EVENT_CODE is set: events go to Test events only. Remove it once testing is done, then redeploy');
  if (env.onVercel && env.SMTP_USER && !source.MAIL_FROM) todo.push('Set MAIL_FROM, e.g. "Elden Academic Press <noreply@eldenap.in>"');

  return {
    ok: checks.config === 'ok' && checks.database === 'ok' && checks.storage === 'ok',
    production: env.isProduction,
    payments: Boolean(razorpay),
    simulated: razorpay?.simulated ?? false,
    checks,
    speed,
    todo,
  };
}
