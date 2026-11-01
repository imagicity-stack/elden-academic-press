// Everyone who has signed in, read from Supabase Auth with the service-role key.
import { createClient } from '@supabase/supabase-js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  /** Sign-in methods, e.g. ['google'] for customers, ['email'] for staff logins. */
  providers: string[];
  createdAt: Date;
  lastSignInAt: Date | null;
}

const PER_PAGE = 1000;

type SbUser = { id: string; email?: string; created_at: string; last_sign_in_at?: string | null; user_metadata?: unknown; app_metadata?: unknown };
function toAuthUser(u: SbUser): AuthUser {
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const app = (u.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  return {
    id: u.id,
    email: (u.email ?? '').toLowerCase(),
    name: String(meta.full_name ?? meta.name ?? ''),
    avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : typeof meta.picture === 'string' ? meta.picture : null,
    providers: app.providers ?? (app.provider ? [app.provider] : []),
    createdAt: new Date(u.created_at),
    lastSignInAt: u.last_sign_in_at ? new Date(u.last_sign_in_at) : null,
  };
}

/** One user by id (null if not found). */
export function supabaseAuthUser(url: string, serviceKey: string): (id: string) => Promise<AuthUser | null> {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (id) => {
    const { data, error } = await sb.auth.admin.getUserById(id);
    if (error || !data.user) return null;
    return toAuthUser(data.user);
  };
}

export function supabaseAuthUsers(url: string, serviceKey: string): () => Promise<AuthUser[]> {
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return async () => {
    const out: AuthUser[] = [];
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await sb.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw new Error(`Supabase users: ${error.message}`);
      for (const u of data.users) out.push(toAuthUser(u));
      if (data.users.length < PER_PAGE) break;
    }
    return out;
  };
}
