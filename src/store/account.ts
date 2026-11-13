// Customer sign-in with Google (Supabase Auth), separate from the admin's
// session. supabase-js is only downloaded when someone uses their account.
import { useCallback, useEffect, useState } from 'react';
import { orderSource } from '../attribution';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError, api } from './api';
import { setMetaOff, setStudentSession } from '../consent';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const STORAGE_KEY = 'elden-auth';
/** Local development without Supabase: sign in as any email (the API accepts this only off Vercel). */
const DEV_KEY = 'elden-dev-customer';

/** Google's "Sign in with Google" button (then Google names eldenap.in, not the Supabase address). */
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const accountsEnabled = Boolean(url && anonKey);
export const accountsDevMode = !accountsEnabled && import.meta.env.DEV;
export const googleButtonAvailable = accountsEnabled && Boolean(googleClientId);

interface GoogleId {
  initialize(options: Record<string, unknown>): void;
  renderButton(el: HTMLElement, options: Record<string, unknown>): void;
}
declare global { interface Window { google?: { accounts?: { id?: GoogleId } } } }

export interface LibraryItem {
  itemId: string; productId: string | null; title: string; format: string; orderNumber: number;
  purchasedAt: string; expiresAt: string | null; downloadsLeft: number; canRead: boolean;
  /** Downloads go through POST /account/library/:itemId/download (only signed in). */
  canDownload: boolean;
  /** The e-book's files (several for books in parts). */
  files?: { index: number; label: string; canDownload: boolean }[];
  /** Cash on delivery: unlocks once the books are delivered. */
  awaitingDelivery?: boolean;
}
export interface AccountOrder {
  number: number; createdAt: string; status: string; total: number; invoice: string | null; requiresShipping: boolean; token: string;
  items: { title: string; format: string; quantity: number }[];
}
export type NewsletterStatus = 'pending' | 'subscribed' | 'unsubscribed' | null;
export type AccountType = 'student' | 'parent' | 'teacher' | 'other';
export interface Profile {
  phone: string; fullName: string; city: string; state: string; stateName: string; type: AccountType | null; completed: boolean;
  dob: string | null; institutionType: string; institutionName: string; grade: string; guardianName: string; guardianPhone: string; instagram: string;
  /** What's still needed for this kind of person (see src/shared/profile.ts). */
  missing: string[];
}
export interface MyTeam { id: string; slug: string; title: string; teamName: string; status: string; statusText: string; code: string; createdAt: string }
export interface MyCompetition { id: string; slug: string; title: string; mode: 'individual' | 'group'; groupName: string; people: string[]; createdAt: string }

export interface AccountData {
  customer: { userId: string; email: string; name: string; avatar: string | null };
  /** First visit after signing up. */
  newAccount?: boolean;
  profile: Profile;
  /** May this account be sent to Meta (no for a student under META_MIN_AGE or without a date of birth)? */
  meta: { allowed: boolean };
  /** Competitions this account registered for, newest first. */
  competitions: MyCompetition[];
  /** Team competitions this person registered for, or is a member of. */
  teams: MyTeam[];
  newsletter: NewsletterStatus;
  orders: AccountOrder[];
  library: LibraryItem[];
}

let client: Promise<SupabaseClient> | undefined;
/** Sign-in listeners waiting for the client (it's only downloaded when someone is, or is getting, signed in). */
const pending = new Set<(sb: SupabaseClient) => void>();
function authClient() {
  if (!client) {
    client = import('@supabase/supabase-js').then(({ createClient }) => createClient(url!, anonKey!, {
      auth: { storageKey: STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    }));
    client.then((sb) => { for (const fn of pending) fn(sb); pending.clear(); }, () => {});
  }
  return client;
}

/** Coming back from Google's redirect sign-in (supabase-js reads these from the address). */
const returningFromSignIn = () => /[?&#](code|access_token|error_description)=/.test(location.search + location.hash);
/** Is there anything for supabase-js to do on this page? Most visitors never signed in: don't download it for them. */
const mayHaveSession = () => hasAccountSession() || returningFromSignIn();

/** Cheap check (no network): is someone signed in on this browser? */
export function hasAccountSession() {
  try { return Boolean(localStorage.getItem(STORAGE_KEY) || localStorage.getItem(DEV_KEY)); } catch { return false; }
}

export async function accountToken(): Promise<string | null> {
  if (accountsDevMode) {
    const email = localStorage.getItem(DEV_KEY);
    return email ? `dev-customer:${email}` : null;
  }
  if (!accountsEnabled || !mayHaveSession()) return null;
  const { data } = await (await authClient()).auth.getSession();
  return data.session?.access_token ?? null;
}

/** Fallback when Google's button can't load: Supabase's redirect sign-in (Google then names the Supabase address). */
export async function signInWithGoogle(returnTo = '/account') {
  const sb = await authClient();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}${returnTo}` } });
  if (error) throw error;
}

let gis: Promise<GoogleId> | undefined;
function loadGoogle(): Promise<GoogleId> {
  gis ??= new Promise<GoogleId>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load')));
    s.onerror = () => reject(new Error('Google sign-in did not load'));
    document.head.appendChild(s);
  }).catch((e) => { gis = undefined; throw e; });
  return gis;
}

/** A random nonce for Supabase and its SHA-256 (hex) for Google, so a captured token can't be replayed. */
async function nonces() {
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return { raw, hashed: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') };
}

/** Draws Google's own sign-in button into `el`; the signed-in Google account is then handed to Supabase. */
export async function renderGoogleButton(el: HTMLElement, onSignedIn: () => void, onError: (message: string) => void, isCurrent: () => boolean = () => true) {
  const [google, { raw, hashed }, sb] = await Promise.all([loadGoogle(), nonces(), authClient()]);
  if (!isCurrent()) return;
  el.replaceChildren();
  google.initialize({
    client_id: googleClientId,
    nonce: hashed,
    ux_mode: 'popup',
    context: 'signin',
    itp_support: true,
    callback: async ({ credential }: { credential: string }) => {
      const { error } = await sb.auth.signInWithIdToken({ provider: 'google', token: credential, nonce: raw });
      if (error) onError(error.message); else onSignedIn();
    },
  });
  google.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'rectangular', logo_alignment: 'left', width: Math.min(360, el.clientWidth || 360) });
}

export function devSignIn(email: string) { localStorage.setItem(DEV_KEY, email.trim().toLowerCase()); }

/** Calls the API with the signed-in customer's token when there is one (pages anyone can open). */
export async function optionalAuthApi<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await accountToken();
  return api<T>(path, { ...init, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

/** Calls the API as the signed-in customer. */
export async function authApi<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const token = await accountToken();
  if (!token) throw new ApiError(401, 'Please sign in.', 'unauthenticated');
  return api<T>(path, { ...init, headers: { Authorization: `Bearer ${token}` } });
}

/** Re-run `fn` whenever someone signs in or out on this page. */
export function onAuthChange(fn: () => void): () => void {
  if (!accountsEnabled) return () => {};
  let unsub = () => {};
  let live = true;
  const attach = (sb: SupabaseClient) => {
    if (!live) return;
    unsub = sb.auth.onAuthStateChange((event) => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') fn(); }).data.subscription.unsubscribe;
  };
  // Signed out: listen once the client exists (every sign-in creates it), without downloading it now.
  if (client || mayHaveSession()) authClient().then(attach);
  else pending.add(attach);
  return () => { live = false; pending.delete(attach); unsub(); };
}

export async function signOut() {
  setStudentSession(false);
  setMetaOff(false);
  try { localStorage.removeItem(DEV_KEY); } catch { /* ignore */ }
  if (accountsEnabled) await (await authClient()).auth.signOut();
}

export async function accountApi<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const token = await accountToken();
  if (!token) throw new ApiError(401, 'Please sign in.', 'unauthenticated');
  return api<T>('/account' + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
}

type State = { status: 'loading' } | { status: 'signedOut' } | { status: 'ready'; data: AccountData } | { status: 'error'; message: string };

/** The signed-in customer's profile, orders and library. */
export function useAccount() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      if (!(await accountToken())) { setState({ status: 'signedOut' }); return; }
      // How they reached the site, so a new account records where it came from (Meta ads, Google…).
      const data = await accountApi<AccountData>('', { headers: { 'X-Visit-Source': JSON.stringify(orderSource()) } });
      // A student's own account: no Google Analytics on this browser; Meta only from the minimum age.
      setStudentSession(data.profile.type === 'student');
      setMetaOff(!data.meta.allowed);
      setState({ status: 'ready', data });
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
