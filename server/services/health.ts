// /api/health: what's connected and what still needs setting up. Names
// settings that are missing or wrong, never their values.
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { adminUsers, settings } from '../db/schema.js';

type Check = 'ok' | 'missing' | 'error';
export interface Health {
  ok: boolean;
  production: boolean;
  payments: boolean;
  simulated: boolean;
  checks: Record<'config' | 'database' | 'storage' | 'adminSignIn' | 'payments' | 'email', Check>;
  todo: string[];
}

const REQUIRED = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ORDER_LINK_SECRET'];
const SETUP_SQL = 'run docs/supabase-setup.sql in Supabase → SQL Editor';
const timeout = () => AbortSignal.timeout(5000);

const pgCode = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.code ?? err.cause?.code;
};

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
    if (!source.SITE_URL) todo.push('Set SITE_URL to https://eldenap.in');
    if (!env.CRON_SECRET) todo.push('Set CRON_SECRET (unpaid orders won’t release their stock without it)');
  }

  let hasOwner = false;
  try {
    const [row] = await db.select({ id: settings.id }).from(settings).where(eq(settings.id, 1));
    if (!row) throw Object.assign(new Error('settings row missing'), { code: '42P01' });
    hasOwner = (await db.select({ id: adminUsers.userId }).from(adminUsers).where(eq(adminUsers.role, 'owner')).limit(1)).length > 0;
    checks.database = 'ok';
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
      const missing = ['covers', 'ebooks', 'resources'].filter((b) => !data.some((d) => d.id === b));
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

  if (env.RESEND_API_KEY) checks.email = 'ok';
  else if (env.onVercel) todo.push('Set RESEND_API_KEY so order emails are sent');

  return {
    ok: checks.config === 'ok' && checks.database === 'ok' && checks.storage === 'ok',
    production: env.isProduction,
    payments: Boolean(razorpay),
    simulated: razorpay?.simulated ?? false,
    checks,
    todo,
  };
}
