// The Claude connector: a Model Context Protocol server at /api/mcp (Streamable HTTP, stateless,
// JSON replies). Each request carries an access token from the OAuth sign-in (./oauth.ts); tools
// (./tools.ts) run as the team member who approved the connection.
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { HttpError, rateLimit } from '../../lib/http.js';
import { sessionFor } from '../../services/mcpAuth.js';
import { actAs } from '../admin/auth.js';
import { challenge, origin } from './oauth.js';
import { toolsFor } from './catalog.js';
import { PROMPTS, ToolError, type Tool, type ToolCtx } from './tools.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = '2025-06-18';
const MAX_TEXT = 120_000;

export const INSTRUCTIONS = `Elden Academic Press (eldenap.in) back office: sales, orders, products, stock, customers, discount codes, enquiries, WhatsApp, AI voice-agent calls and abandoned checkouts, newsletter and audience, popups, cookie consent, Study Hub, competitions, settings.
- Money fields ending in _inr are rupees (GST included). Dates are India time (IST).
- Sales are paid orders minus refunds. Every order is credited to where the buyer came from (channel: meta_ads, google_ads, search, meta_social, social, email, referral, campaign, direct, unknown) and to its UTM campaign, content (ad) and term (ad set).
- To compare with Meta ads: call get_sales_by_source for the same dates, get spend, purchases and purchase value per campaign from the Meta Ads connector, match Meta campaign names to utm_campaign, and show real ROAS (website revenue ÷ spend) and cost per real order next to what Meta reports.
- New products are drafts. Covers and e-book files are uploaded in the admin (eldenap.in/admin → Products) before publishing with set_product_status.
- You act with the role of the team member who connected you, and every change is in the activity log. Refunds, cancellations, competition decisions (approve/reject teams, results, notices), store settings, staff and deleting can be read but only changed in the admin: point the user there.
- Anything that reaches customers (WhatsApp replies and new-book sends, newsletter sends and schedules, calls, marking orders shipped) needs the user's explicit OK on the exact content first; send a test before any bulk send.`;

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, any> };
const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

function schemaOf(t: Tool) {
  const { $schema: _s, ...schema } = z.toJSONSchema(t.input, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return { type: 'object', properties: {}, ...schema };
}

const describe = (t: Tool) => ({
  name: t.name, title: t.title, description: t.description, inputSchema: schemaOf(t),
  annotations: {
    title: t.title, readOnlyHint: Boolean(t.readOnly), destructiveHint: false,
    idempotentHint: Boolean(t.readOnly || t.idempotent), openWorldHint: Boolean(t.reachesCustomers),
  },
});

/** An admin endpoint's error, as words Claude can pass on. */
function apiError(status: number, body: any): string {
  const msg = typeof body === 'object' && body?.error ? String(body.error) : `The store answered ${status}.`;
  const fields = body?.details && typeof body.details === 'object'
    ? Object.entries(body.details as Record<string, string[]>).map(([k, v]) => `${k}: ${[v].flat().join(', ')}`).join('; ')
    : '';
  return fields ? `${msg} (${fields})` : msg;
}

const text = (value: unknown) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}… [cut: ask for fewer results or a smaller page]` : s;
};

/** `dispatch` runs a request through the whole store API (so admin requests get the usual checks). */
export function mcpServer(dispatch: (req: Request) => Promise<Response>) {
  const r = new Hono<AppEnv>();

  r.all('/', async (c) => {
    const deps = c.get('deps');
    const base = origin(c);
    const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    const session = bearer ? await sessionFor(deps.db, bearer, deps.now()) : null;
    if (!session) {
      return c.json(
        { error: bearer ? 'invalid_token' : 'unauthorized', error_description: bearer ? 'The token is not valid or has expired.' : 'Connect this server from Claude to sign in.' },
        401, { 'WWW-Authenticate': challenge(base, bearer ? 'invalid_token' : undefined) },
      );
    }
    if (c.req.method !== 'POST') return c.json({ error: 'Use POST (this server does not stream).' }, 405, { Allow: 'POST' });
    await rateLimit(deps.db, `mcp:${session.grantId}`, 300, 60);

    let msg: unknown;
    try { msg = await c.req.json(); } catch { return c.json(fail(null, -32700, 'Parse error'), 400); }
    const batch = Array.isArray(msg);
    const out = [];
    const ctx: ToolCtx = { api: (method, path, body) => api(method, path, body), deps, session };
    for (const m of (batch ? msg : [msg]) as Rpc[]) {
      const res = await handle(m, ctx);
      if (res) out.push(res);
    }
    if (!out.length) return c.body(null, 202);
    return c.json(batch ? out : out[0]);

    async function api(method: string, path: string, body?: unknown) {
      const req = actAs(new Request(`${base}/api/admin${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-real-ip': c.get('ip') },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), session!);
      const res = await dispatch(req);
      const raw = await res.text();
      let json: any = raw;
      try { json = JSON.parse(raw); } catch { /* not JSON */ }
      if (!res.ok) throw new ToolError(apiError(res.status, json));
      return json;
    }
  });

  async function handle(m: Rpc, ctx: ToolCtx) {
    const { session } = ctx;
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return fail(null, -32600, 'Invalid request');
    if (!m.method) return null; // a reply from the client: nothing to do
    const isNotification = m.id === undefined;
    if (isNotification) return null;
    const p = m.params ?? {};
    const tools = toolsFor(session.role);
    switch (m.method) {
      case 'initialize':
        return ok(m.id, {
          protocolVersion: VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : LATEST,
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'eldenap-store', title: 'Elden Academic Press', version: '1.0.0' },
          instructions: `${INSTRUCTIONS}\n- Connected as ${session.email} (${session.role}).`,
        });
      case 'ping':
        return ok(m.id, {});
      case 'tools/list':
        return ok(m.id, { tools: tools.map(describe) });
      case 'tools/call': {
        const tool = tools.find((t) => t.name === p.name);
        if (!tool) return fail(m.id, -32602, `Unknown tool: ${String(p.name)}`);
        const args = tool.input.safeParse(p.arguments ?? {});
        if (!args.success) {
          const why = args.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
          return ok(m.id, { content: [{ type: 'text', text: `Invalid arguments: ${why}` }], isError: true });
        }
        try {
          const result = await tool.run(ctx, args.data);
          return ok(m.id, { content: [{ type: 'text', text: text(result) }] });
        } catch (e) {
          if (e instanceof ToolError) return ok(m.id, { content: [{ type: 'text', text: e.message }], isError: true });
          if (e instanceof HttpError) return ok(m.id, { content: [{ type: 'text', text: e.message }], isError: true });
          const ref = randomBytes(4).toString('hex');
          console.error(`[mcp] tool ${tool.name} failed ref=${ref}`, e);
          return ok(m.id, { content: [{ type: 'text', text: `Something went wrong on the store's side (error ${ref}). Try again in a moment.` }], isError: true });
        }
      }
      case 'prompts/list':
        return ok(m.id, { prompts: PROMPTS.map(({ text: _t, ...x }) => x) });
      case 'prompts/get': {
        const pr = PROMPTS.find((x) => x.name === p.name);
        if (!pr) return fail(m.id, -32602, `Unknown prompt: ${String(p.name)}`);
        return ok(m.id, { description: pr.description, messages: [{ role: 'user', content: { type: 'text', text: pr.text(p.arguments ?? {}) } }] });
      }
      case 'resources/list':
        return ok(m.id, { resources: [] });
      case 'resources/templates/list':
        return ok(m.id, { resourceTemplates: [] });
      default:
        return fail(m.id, -32601, `Method not found: ${m.method}`);
    }
  }

  return r;
}
