// Admin sign-in: Supabase Auth (email + password, then an authenticator-app
// code). Without Supabase settings (local development) a developer login is used.
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Captured before supabase-js consumes it: invite / password-reset links land here. */
export const LINK_TYPE = /type=(invite|recovery)/.exec(window.location.hash)?.[1] as 'invite' | 'recovery' | undefined;

export const supabase: SupabaseClient | null = url && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'elden-admin-auth' } })
  : null;

export const devMode = !supabase && import.meta.env.DEV;
const DEV_KEY = 'elden-admin-dev';

export async function accessToken(): Promise<string | null> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }
  return sessionStorage.getItem(DEV_KEY);
}

export function devSignIn() { sessionStorage.setItem(DEV_KEY, 'dev-owner'); }

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
  sessionStorage.removeItem(DEV_KEY);
}

export async function signIn(email: string, password: string) {
  if (!supabase) throw new Error('Sign-in is not configured.');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
}

export async function sendReset(email: string) {
  if (!supabase) throw new Error('Sign-in is not configured.');
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/admin` });
  if (error) throw new Error(error.message);
}

export async function setPassword(password: string) {
  const { error } = await supabase!.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/* ---------------- Two-step verification (TOTP) ---------------- */

export async function mfaState(): Promise<{ factorId: string | null; enrolled: boolean }> {
  const { data, error } = await supabase!.auth.mfa.listFactors();
  if (error) throw new Error(error.message);
  const verified = data.totp.find((f) => f.status === 'verified');
  return { factorId: verified?.id ?? null, enrolled: Boolean(verified) };
}

export async function mfaEnroll(): Promise<{ factorId: string; qr: string; secret: string }> {
  // Remove half-finished enrolments first so a fresh QR code can be shown.
  const { data: list } = await supabase!.auth.mfa.listFactors();
  for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase!.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase!.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Elden admin ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw new Error(error.message);
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function mfaVerify(factorId: string, code: string) {
  const { error } = await supabase!.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(error.message.includes('Invalid') ? 'That code didn’t match. Check the time on your phone and try again.' : error.message);
}

export function onAuthChange(cb: (session: Session | null, event: string) => void) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event));
  return () => data.subscription.unsubscribe();
}
