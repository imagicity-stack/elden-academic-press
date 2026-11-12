// Sign-in for the Claude connector (OAuth 2.1 with PKCE and dynamic client registration, as MCP
// asks): one-time codes, access tokens (an hour) and refresh tokens (30 days, a new one each use).
// Only SHA-256 hashes of codes and tokens are stored. A connection acts with the current role of the
// team member who approved it, and stops working when they lose admin access or disconnect it.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Q } from '../db/client.js';
import { adminUsers, mcpAuthCodes, mcpClients, mcpGrants } from '../db/schema.js';
import type { AdminSession } from '../routes/admin/auth.js';

export const ACCESS_TTL_S = 3600;
const REFRESH_TTL_S = 30 * 86_400;
const CODE_TTL_S = 300;
/** A refresh token just swapped still works this long, in case the reply to the swap was lost. */
const ROTATE_GRACE_S = 60;
export const SCOPE = 'store';

const token = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const later = (now: Date, s: number) => new Date(now.getTime() + s * 1000);

/** Where a sign-in may send its code: Claude (claude.ai / claude.com) or this computer (Claude Code, the MCP inspector). */
export function allowedRedirect(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:' && ['claude.ai', 'claude.com'].includes(u.hostname) && u.pathname === '/api/mcp/auth_callback') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
}

export async function registerClient(db: Q, input: { name: string; redirectUris: string[] }) {
  const [row] = await db.insert(mcpClients).values({ id: `eapc_${randomBytes(16).toString('base64url')}`, name: input.name, redirectUris: input.redirectUris }).returning();
  return row;
}

export async function findClient(db: Q, id: string | undefined) {
  if (!id || id.length > 100) return null;
  const [row] = await db.select().from(mcpClients).where(eq(mcpClients.id, id));
  return row ?? null;
}

export interface AuthRequest { clientId: string; redirectUri: string; codeChallenge: string; scope: string }

/** A one-time code for the team member who approved the request (and tidies away old codes). */
export async function issueCode(db: Q, req: AuthRequest, userId: string, now: Date) {
  const code = token('eap_code');
  await db.delete(mcpAuthCodes).where(lt(mcpAuthCodes.expiresAt, now));
  await db.insert(mcpAuthCodes).values({
    codeHash: sha256(code), clientId: req.clientId, userId, redirectUri: req.redirectUri, codeChallenge: req.codeChallenge, scope: req.scope, expiresAt: later(now, CODE_TTL_S),
  });
  return code;
}

export class OAuthError extends Error {
  constructor(readonly error: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'unsupported_grant_type', description: string) {
    super(description);
  }
}

const pkceOk = (verifier: string, challenge: string) => {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
};

const tokens = (now: Date) => {
  const access = token('eap_at');
  const refresh = token('eap_rt');
  return {
    access, refresh,
    row: { accessHash: sha256(access), accessExpiresAt: later(now, ACCESS_TTL_S), refreshHash: sha256(refresh), refreshExpiresAt: later(now, REFRESH_TTL_S) },
  };
};
const reply = (t: ReturnType<typeof tokens>, scope: string) => ({ access_token: t.access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: t.refresh, scope });

async function activeAdmin(db: Q, userId: string) {
  const [row] = await db.select().from(adminUsers).where(and(eq(adminUsers.userId, userId), eq(adminUsers.active, true)));
  return row ?? null;
}

/** authorization_code: the code (once), its PKCE verifier and the same client and redirect address. */
export async function exchangeCode(db: Q, input: { code: string; clientId: string; redirectUri: string; verifier: string }, now: Date) {
  // Deleted as it is read, so a code works once even when two requests race.
  const [code] = await db.delete(mcpAuthCodes).where(eq(mcpAuthCodes.codeHash, sha256(input.code))).returning();
  if (!code || code.expiresAt <= now) throw new OAuthError('invalid_grant', 'The code is not valid or has expired. Please connect again.');
  if (code.clientId !== input.clientId) throw new OAuthError('invalid_grant', 'The code was issued to another app.');
  if (code.redirectUri !== input.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the sign-in request.');
  if (!pkceOk(input.verifier, code.codeChallenge)) throw new OAuthError('invalid_grant', 'code_verifier does not match.');
  if (!(await activeAdmin(db, code.userId))) throw new OAuthError('invalid_grant', 'This account no longer has access to the store admin.');
  const t = tokens(now);
  await db.insert(mcpGrants).values({ clientId: code.clientId, userId: code.userId, scope: code.scope, ...t.row });
  return reply(t, code.scope);
}

/** refresh_token: a new access token and a new refresh token (the old one stops working after a minute). */
export async function refresh(db: Q, input: { refreshToken: string; clientId?: string }, now: Date) {
  const h = sha256(input.refreshToken);
  const [g] = await db.select().from(mcpGrants).where(and(
    isNull(mcpGrants.revokedAt), input.clientId ? eq(mcpGrants.clientId, input.clientId) : undefined,
    or(and(eq(mcpGrants.refreshHash, h), gt(mcpGrants.refreshExpiresAt, now)), and(eq(mcpGrants.prevRefreshHash, h), gt(mcpGrants.rotatedAt, later(now, -ROTATE_GRACE_S)))),
  ));
  if (!g) throw new OAuthError('invalid_grant', 'The connection has expired or was disconnected. Please connect again.');
  if (!(await activeAdmin(db, g.userId))) throw new OAuthError('invalid_grant', 'This account no longer has access to the store admin.');
  const t = tokens(now);
  // A retry with the previous token keeps that one as "previous", so it can't extend itself forever.
  const prev = g.refreshHash === h ? h : g.prevRefreshHash;
  const [u] = await db.update(mcpGrants).set({ ...t.row, prevRefreshHash: prev, rotatedAt: g.refreshHash === h ? now : g.rotatedAt })
    .where(and(eq(mcpGrants.id, g.id), eq(mcpGrants.refreshHash, g.refreshHash))).returning({ id: mcpGrants.id });
  if (!u) throw new OAuthError('invalid_grant', 'The connection was refreshed at the same moment. Please try again.');
  return reply(t, g.scope);
}

/** Disconnect the connection a token belongs to (RFC 7009: unknown tokens are not an error). */
export async function revokeToken(db: Q, value: string, now: Date) {
  const h = sha256(value);
  await db.update(mcpGrants).set({ revokedAt: now }).where(and(isNull(mcpGrants.revokedAt), or(eq(mcpGrants.accessHash, h), eq(mcpGrants.refreshHash, h))));
}

/** The team member an access token acts for, with their current role; null when it isn't (or no longer) valid. */
export async function sessionFor(db: Q, accessToken: string, now: Date): Promise<(AdminSession & { grantId: string }) | null> {
  if (!accessToken.startsWith('eap_at_')) return null;
  const [row] = await db.select({ grant: mcpGrants, admin: adminUsers, client: mcpClients.name }).from(mcpGrants)
    .innerJoin(adminUsers, eq(adminUsers.userId, mcpGrants.userId))
    .innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId))
    .where(and(eq(mcpGrants.accessHash, sha256(accessToken)), isNull(mcpGrants.revokedAt), gt(mcpGrants.accessExpiresAt, now), eq(adminUsers.active, true)));
  if (!row) return null;
  if (!row.grant.lastUsedAt || now.getTime() - row.grant.lastUsedAt.getTime() > 5 * 60_000) {
    await db.update(mcpGrants).set({ lastUsedAt: now }).where(eq(mcpGrants.id, row.grant.id));
  }
  return {
    grantId: row.grant.id, userId: row.admin.userId, email: row.admin.email, name: row.admin.name, role: row.admin.role,
    // Two-step verification was checked when they approved the connection.
    aal: 'aal2', mfaRequired: false,
    via: /claude/i.test(row.client) ? 'Claude' : row.client.slice(0, 40) || 'an app',
  };
}

/** Connections still working: everyone's for the owner, one's own otherwise. */
export async function listGrants(db: Q, forUser: { userId: string; role: string }, now: Date) {
  return db.select({
    id: mcpGrants.id, app: mcpClients.name, email: adminUsers.email, role: adminUsers.role, createdAt: mcpGrants.createdAt, lastUsedAt: mcpGrants.lastUsedAt,
  }).from(mcpGrants).innerJoin(mcpClients, eq(mcpClients.id, mcpGrants.clientId)).innerJoin(adminUsers, eq(adminUsers.userId, mcpGrants.userId))
    .where(and(isNull(mcpGrants.revokedAt), gt(mcpGrants.refreshExpiresAt, now), forUser.role === 'owner' ? undefined : eq(mcpGrants.userId, forUser.userId)))
    .orderBy(sql`${mcpGrants.createdAt} desc`);
}

export async function revokeGrant(db: Q, id: string, by: { userId: string; role: string }, now: Date) {
  const [row] = await db.update(mcpGrants).set({ revokedAt: now })
    .where(and(eq(mcpGrants.id, id), isNull(mcpGrants.revokedAt), by.role === 'owner' ? undefined : eq(mcpGrants.userId, by.userId))).returning();
  return row ?? null;
}
