// OAuth for the Claude connector: discovery documents, dynamic client registration, the sign-in
// (approved by a signed-in team member at /admin/connect) and the token endpoint.
// Claude finds all of this by itself from the connector address, https://eldenap.in/api/mcp.
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { adminUsers } from '../../db/schema.js';
import { HttpError, rateLimit } from '../../lib/http.js';
import { actorOf, audit } from '../admin/auth.js';
import {
  allowedRedirect, exchangeCode, findClient, issueCode, listGrants, OAuthError, refresh, registerClient, revokeGrant, revokeToken, SCOPE, type AuthRequest,
} from '../../services/mcpAuth.js';

export const MCP_PATH = '/api/mcp';
export const origin = (c: Context) => new URL(c.req.url).origin;

/** RFC 9728: what protects the connector and who signs in to it. */
export const protectedResource = (base: string) => ({
  resource: base + MCP_PATH,
  authorization_servers: [base],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Elden Academic Press store',
});

/** RFC 8414: the sign-in endpoints. */
export const authorizationServer = (base: string) => ({
  issuer: base,
  authorization_endpoint: `${base}${MCP_PATH}/oauth/authorize`,
  token_endpoint: `${base}${MCP_PATH}/oauth/token`,
  registration_endpoint: `${base}${MCP_PATH}/oauth/register`,
  revocation_endpoint: `${base}${MCP_PATH}/oauth/revoke`,
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  scopes_supported: [SCOPE],
});

/** The header that tells a connector without a (valid) token where to sign in. */
export const challenge = (base: string, error?: string) =>
  `Bearer realm="eldenap"${error ? `, error="${error}"` : ''}, resource_metadata="${base}/.well-known/oauth-protected-resource${MCP_PATH}"`;

const oauthError = (c: Context, e: OAuthError | { error: string; message: string }, status: 400 | 401 = 400) =>
  c.json({ error: e.error, error_description: e.message }, status, { 'Cache-Control': 'no-store' });

/** Form fields (as OAuth sends them) or JSON. */
async function fields(c: Context): Promise<Record<string, string>> {
  const type = c.req.header('content-type') ?? '';
  const raw = type.includes('application/json') ? await c.req.json().catch(() => ({})) : await c.req.parseBody().catch(() => ({}));
  return Object.fromEntries(Object.entries(raw ?? {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

export const oauth = new Hono<AppEnv>();

/* ---------------- Dynamic client registration (RFC 7591) ---------------- */

const zRegister = z.object({
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
  client_name: z.string().trim().max(120).optional(),
});

oauth.post('/register', async (c) => {
  const { db } = c.get('deps');
  await rateLimit(db, `mcp-register:${c.get('ip')}`, 20, 3600);
  const parsed = zRegister.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) return c.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris is required.' }, 400);
  const bad = parsed.data.redirect_uris.find((u) => !allowedRedirect(u));
  if (bad) return c.json({ error: 'invalid_redirect_uri', error_description: `Only Claude's own callback address and localhost can be used (not ${bad.slice(0, 100)}).` }, 400);
  const client = await registerClient(db, { name: parsed.data.client_name || 'Unnamed app', redirectUris: parsed.data.redirect_uris });
  return c.json({
    client_id: client.id, client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000), client_name: client.name, redirect_uris: client.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE,
  }, 201, { 'Cache-Control': 'no-store' });
});

/* ---------------- Sign-in request ---------------- */

const zAuthorize = z.object({
  response_type: z.string().optional(),
  client_id: z.string().max(100),
  redirect_uri: z.string().max(500).optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().max(200).optional(),
  resource: z.string().max(500).optional(),
});
type AuthorizeParams = z.infer<typeof zAuthorize>;

/**
 * Checks a sign-in request. Problems with the app or its return address are shown here (never sent on
 * to an address we can't trust); the rest go back to the app as OAuth errors.
 */
export async function checkRequest(c: Context<AppEnv>, raw: unknown): Promise<{ ok: true; req: AuthRequest; clientName: string; state?: string } | { ok: false; fatal?: string; redirect?: string }> {
  const parsed = zAuthorize.safeParse(raw);
  if (!parsed.success) return { ok: false, fatal: 'This sign-in link is incomplete. Start connecting again from Claude.' };
  const p: AuthorizeParams = parsed.data;
  const client = await findClient(c.get('deps').db, p.client_id);
  if (!client) return { ok: false, fatal: 'This app isn’t registered with the store (or its registration was removed). Remove the connector in Claude and add it again.' };
  const redirectUri = p.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri) || !allowedRedirect(redirectUri)) {
    return { ok: false, fatal: 'The app asked to return to an address it didn’t register. Start connecting again from Claude.' };
  }
  const back = (error: string, description: string) => {
    const u = new URL(redirectUri);
    u.searchParams.set('error', error);
    u.searchParams.set('error_description', description);
    if (p.state) u.searchParams.set('state', p.state);
    return { ok: false as const, redirect: u.toString() };
  };
  if (p.response_type !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.');
  if (!p.code_challenge || p.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) {
    return back('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
  }
  if (p.resource && p.resource.replace(/\/$/, '') !== origin(c) + MCP_PATH) return back('invalid_target', 'Unknown resource.');
  return { ok: true, req: { clientId: client.id, redirectUri, codeChallenge: p.code_challenge, scope: SCOPE }, clientName: client.name, state: p.state };
}

const page = (title: string, text: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#13213c"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;

/** Sends the team member to the admin, which signs them in (with two-step verification) and asks them to approve. */
oauth.get('/authorize', async (c) => {
  const check = await checkRequest(c, c.req.query());
  if (!check.ok) {
    if (check.redirect) return c.redirect(check.redirect, 302);
    return c.html(page('Can’t connect', check.fatal ?? 'Something is wrong with this sign-in link.'), 400);
  }
  return c.redirect(`/admin/connect?${new URL(c.req.url).searchParams.toString()}`, 302);
});

/* ---------------- Tokens ---------------- */

oauth.post('/token', async (c) => {
  const { db, now } = c.get('deps');
  await rateLimit(db, `mcp-token:${c.get('ip')}`, 60, 60);
  const f = await fields(c);
  // Some apps send their id as HTTP Basic auth instead of a form field (there is no secret to check).
  const basic = /^Basic\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  if (!f.client_id && basic) f.client_id = decodeURIComponent(Buffer.from(basic, 'base64').toString('utf8').split(':')[0] ?? '');
  try {
    if (f.client_id && !(await findClient(db, f.client_id))) throw new OAuthError('invalid_client', 'Unknown client_id.');
    if (f.grant_type === 'authorization_code') {
      if (!f.client_id) throw new OAuthError('invalid_client', 'client_id is required.');
      if (!f.code || !f.code_verifier || !f.redirect_uri) throw new OAuthError('invalid_request', 'code, code_verifier and redirect_uri are required.');
      return c.json(await exchangeCode(db, { code: f.code, clientId: f.client_id, redirectUri: f.redirect_uri, verifier: f.code_verifier }, now()), 200, { 'Cache-Control': 'no-store' });
    }
    if (f.grant_type === 'refresh_token') {
      if (!f.refresh_token) throw new OAuthError('invalid_request', 'refresh_token is required.');
      // The refresh token alone is enough to find its connection (when given, the client must match).
      return c.json(await refresh(db, { refreshToken: f.refresh_token, clientId: f.client_id || undefined }, now()), 200, { 'Cache-Control': 'no-store' });
    }
    throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.');
  } catch (e) {
    if (e instanceof OAuthError) return oauthError(c, e, e.error === 'invalid_client' ? 401 : 400);
    throw e;
  }
});

oauth.post('/revoke', async (c) => {
  const { db, now } = c.get('deps');
  const f = await fields(c);
  if (f.token) await revokeToken(db, f.token, now());
  return c.body(null, 200);
});

/* ---------------- Admin: approve, and the list of connections ---------------- */

export const adminMcp = new Hono<AppEnv>();

/** What the approval screen shows: which app, acting as whom. */
adminMcp.get('/request', async (c) => {
  const check = await checkRequest(c, c.req.query());
  if (!check.ok) {
    if (check.redirect) throw new HttpError(400, 'The app’s sign-in request can’t be used.', 'oauth_redirect', { redirect: check.redirect });
    throw new HttpError(400, check.fatal ?? 'Invalid request');
  }
  const me = c.get('admin');
  return c.json({ app: check.clientName, email: me.email, role: me.role });
});

adminMcp.post('/approve', async (c) => {
  const { db, now } = c.get('deps');
  const check = await checkRequest(c, await c.req.json().catch(() => ({})));
  if (!check.ok) {
    if (check.redirect) return c.json({ redirect: check.redirect });
    throw new HttpError(400, check.fatal ?? 'Invalid request');
  }
  const me = c.get('admin');
  if (me.via) throw new HttpError(403, 'An app can’t approve a connection.');
  // Local development only: the developer login isn't a real admin row, and the code needs one.
  if (c.get('deps').env.devAdmin) await db.insert(adminUsers).values({ userId: me.userId, email: me.email, name: me.name, role: me.role }).onConflictDoNothing();
  const code = await issueCode(db, check.req, me.userId, now());
  const u = new URL(check.req.redirectUri);
  u.searchParams.set('code', code);
  if (check.state) u.searchParams.set('state', check.state);
  await audit(c, 'mcp.connect', 'mcp', check.req.clientId, { app: check.clientName });
  return c.json({ redirect: u.toString() });
});

adminMcp.post('/deny', async (c) => {
  const check = await checkRequest(c, await c.req.json().catch(() => ({})));
  if (!check.ok) {
    if (check.redirect) return c.json({ redirect: check.redirect });
    throw new HttpError(400, check.fatal ?? 'Invalid request');
  }
  const u = new URL(check.req.redirectUri);
  u.searchParams.set('error', 'access_denied');
  u.searchParams.set('error_description', 'The request was declined.');
  if (check.state) u.searchParams.set('state', check.state);
  return c.json({ redirect: u.toString() });
});

adminMcp.get('/connections', async (c) => {
  const { db, now } = c.get('deps');
  return c.json({ items: await listGrants(db, c.get('admin'), now()) });
});

adminMcp.delete('/connections/:id{[0-9a-f-]{36}}', async (c) => {
  const { db, now } = c.get('deps');
  const me = c.get('admin');
  if (me.via) throw new HttpError(403, 'An app can’t change connections.');
  const row = await revokeGrant(db, c.req.param('id'), me, now());
  if (!row) throw new HttpError(404, 'Connection not found');
  await audit(c, 'mcp.disconnect', 'mcp', row.id, { by: actorOf(me) });
  return c.json({ ok: true });
});
