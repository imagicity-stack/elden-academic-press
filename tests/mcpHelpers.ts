// Shared by the Claude connector tests: sign in like Claude does, then call the MCP server.
import { createHash, randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { setup, supabaseToken } from './helpers.js';

export type Ctx = Awaited<ReturnType<typeof setup>>;
export const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
export const STAFF = { sub: '22222222-2222-4222-8222-222222222222', email: 'packer@eldenap.in' };
export const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
export const BASE = 'http://localhost';

export const as = async (who: { sub: string; email: string; aal?: string }) => ({ Authorization: `Bearer ${await supabaseToken(who)}` });
export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
export const form = (o: Record<string, string>) => ({ raw: new URLSearchParams(o).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

export function connector(get: () => Ctx) {
  async function register(redirect = CALLBACK) {
    const r = await get().call('POST', '/mcp/oauth/register', { body: { client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' } });
    return r.json.client_id as string;
  }
  /** The whole sign-in, as Claude does it, approved by `who`; returns the tokens. */
  async function connect(who: { sub: string; email: string } = OWNER) {
    const t = get();
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const params = { response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'store', resource: `${BASE}/api/mcp` };
    const approved = await t.call('POST', '/admin/mcp/approve', { body: params, headers: await as(who) });
    expect(approved.status).toBe(200);
    const back = new URL(approved.json.redirect);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('state')).toBe('xyz');
    const tok = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier }));
    expect(tok.status).toBe(200);
    return { clientId, ...tok.json as { access_token: string; refresh_token: string; expires_in: number } };
  }
  let rpcId = 0;
  async function rpc(token: string, method: string, params: Record<string, unknown> = {}) {
    return get().call('POST', '/mcp', { body: { jsonrpc: '2.0', id: ++rpcId, method, params }, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream' } });
  }
  async function tool(token: string, name: string, args: Record<string, unknown> = {}) {
    const r = await rpc(token, 'tools/call', { name, arguments: args });
    expect(r.status).toBe(200);
    const res = r.json.result as { content: { text: string }[]; isError?: boolean };
    let data: any = res.content[0].text;
    try { data = JSON.parse(data); } catch { /* an error message */ }
    return { isError: Boolean(res.isError), data };
  }
  return { register, connect, rpc, tool };
}
