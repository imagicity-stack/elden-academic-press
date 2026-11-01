// Customer sign-in with Google (Supabase Auth), separate from the admin's
// session. supabase-js is only downloaded when someone uses their account.
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, api } from './api';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const STORAGE_KEY = 'elden-auth';
/** Local development without Supabase: sign in as any email (the API accepts this only off Vercel). */
const DEV_KEY = 'elden-dev-customer';

export const accountsEnabled = Boolean(url && anonKey);
export const accountsDevMode = !accountsEnabled && import.meta.env.DEV;

export interface LibraryItem {
  itemId: string; productId: string | null; title: string; format: string; orderNumber: number;
  purchasedAt: string; expiresAt: string | null; downloadsLeft: number; canRead: boolean; downloadUrl: string | null;
}
export interface AccountOrder {
  number: number; createdAt: string; status: string; total: number; invoice: string | null; requiresShipping: boolean; token: string;
  items: { title: string; format: string; quantity: number }[];
}
export interface AccountData {
  customer: { email: string; name: string; avatar: string | null };
  orders: AccountOrder[];
  library: LibraryItem[];
}

let client: Promise<SupabaseClient> | undefined;
function authClient() {
  client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(url!, anonKey!, {
    auth: { storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  }));
  return client;
}

/** Cheap check (no network): is someone signed in on this browser? */
export function hasAccountSession() {
  try { return Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(DEV_KEY)); } catch { return false; }
}

export async function accountToken(): Promise<string | null> {
  if (accountsDevMode) {
    const email = localStorage.getItem(DEV_KEY);
    return email ? `dev-customer:${email}` : null;
  }
  if (!accountsEnabled) return null;
  const { data } = await (await authClient()).auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithGoogle() {
  const sb = await authClient();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/account` } });
  if (error) throw error;
}

export function devSignIn(email: string) { localStorage.setItem(DEV_KEY, email.trim().toLowerCase()); }

export async function signOut() {
  try { localStorage.removeItem(DEV_KEY); } catch { /* ignore */ }
  if (accountsEnabled) await (await authClient()).auth.signOut();
}

export async function accountApi<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await accountToken();
  if (!token) throw new ApiError(401, 'Please sign in.', 'unauthenticated');
  return api<T>('/account' + path, { ...init, headers: { Authorization: `Bearer ${token}` } });
}

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'ready'; data: AccountData } | { status: 'error'; message: string };

/** The signed-in customer's profile, orders and library. */
export function useAccount() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      if (!(await accountToken())) { setState({ status: 'signedOut' }); return; }
      setState({ status: 'ready', data: await accountApi<AccountData>('') });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { await signOut(); setState({ status: 'signedOut' }); }
      else setState({ status: 'error', message: (e as Error).message });
    }
  }, []);
  useEffect(() => {
    load();
    if (!accountsEnabled) return;
    let unsub = () => {};
    authClient().then((sb) => { unsub = sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') load(); }).data.subscription.unsubscribe; });
    return () => unsub();
  }, [load]);
  return { state, reload: load };
}
