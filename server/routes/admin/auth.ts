// Admin authentication: Supabase Auth sessions (with authenticator-app 2FA)
// plus the admin_users allow-list and roles.
import type { Context, MiddlewareHandler } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { AppEnv } from '../../app';
import { adminUsers, auditLog } from '../../db/schema';
import { HttpError } from '../../lib/http';
import { getSettings } from '../../services/catalog';

export type Role = 'owner' | 'manager' | 'staff';
export interface AdminSession { userId: string; email: string; name: string; role: Role; aal: string; mfaRequired: boolean }

export const DEV_ADMIN_TOKEN = 'dev-owner';
const DEV_ADMIN: AdminSession = { userId: '00000000-0000-0000-0000-000000000000', email: 'dev@localhost', name: 'Developer', role: 'owner', aal: 'aal2', mfaRequired: false };

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | undefined;

/** Verify a Supabase access token. HS256 for legacy projects, JWKS otherwise. */
export async function verifySupabaseToken(token: string, supabaseUrl: string, legacySecret?: string): Promise<JWTPayload & { email?: string; aal?: string }> {
  const opts = { issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`, audience: 'authenticated' };
  if (legacySecret) return (await jwtVerify(token, new TextEncoder().encode(legacySecret), { ...opts, algorithms: ['HS256'] })).payload;
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`;
  if (jwks?.url !== url) jwks = { url, set: createRemoteJWKSet(new URL(url)) };
  return (await jwtVerify(token, jwks.set, opts)).payload;
}

async function authenticate(c: Context<AppEnv>): Promise<AdminSession> {
  const { env, db } = c.get('deps');
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  if (env.devAdmin && token === DEV_ADMIN_TOKEN) return DEV_ADMIN;
  if (!env.SUPABASE_URL) throw new HttpError(503, 'Admin sign-in is not configured.', 'auth_unconfigured');

  let claims;
  try {
    claims = await verifySupabaseToken(token, env.SUPABASE_URL, env.SUPABASE_JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated');
  }
  const userId = String(claims.sub ?? '');
  const email = String(claims.email ?? '').toLowerCase();

  let [row] = await db.select().from(adminUsers).where(eq(adminUsers.userId, userId));
  if (!row && env.ADMIN_OWNER_EMAIL && email === env.ADMIN_OWNER_EMAIL.toLowerCase()) {
    // First sign-in of the configured owner, as long as no owner exists yet.
    const [owner] = await db.select({ id: adminUsers.userId }).from(adminUsers).where(eq(adminUsers.role, 'owner')).limit(1);
    if (!owner) [row] = await db.insert(adminUsers).values({ userId, email, role: 'owner', name: 'Owner' }).onConflictDoNothing().returning();
  }
  if (!row || !row.active) throw new HttpError(403, 'This account doesn’t have access to the store admin.', 'not_admin');

  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    await db.update(adminUsers).set({ lastSeenAt: sql`now()` }).where(eq(adminUsers.userId, userId));
  }
  const s = await getSettings(db);
  return { userId, email: row.email, name: row.name, role: row.role, aal: String(claims.aal ?? 'aal1'), mfaRequired: s.requireMfa };
}

/** Requires a signed-in admin; enforces two-step verification unless `allowAal1`. */
export function requireAdmin(opts: { allowAal1?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = await authenticate(c);
    if (session.mfaRequired && session.aal !== 'aal2' && !opts.allowAal1) {
      throw new HttpError(403, 'Two-step verification is required.', 'mfa_required');
    }
    c.set('admin', session);
    await next();
  };
}

const RANK: Record<Role, number> = { staff: 1, manager: 2, owner: 3 };

export function requireRole(min: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (RANK[c.get('admin').role] < RANK[min]) throw new HttpError(403, `This needs ${min === 'owner' ? 'the store owner' : 'a manager or the owner'}.`, 'forbidden');
    await next();
  };
}

export const can = (role: Role, min: Role) => RANK[role] >= RANK[min];

export async function audit(c: Context<AppEnv>, action: string, entity: string, entityId?: string | number | null, details?: unknown) {
  await c.get('deps').db.insert(auditLog).values({
    actor: c.get('admin').email, action, entity, entityId: entityId == null ? null : String(entityId), details: details ?? null, ip: c.get('ip'),
  });
}
