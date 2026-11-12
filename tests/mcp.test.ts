// The Claude connector: OAuth discovery, registration, approval, tokens, and the store tools.
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { adminUsers, auditLog, mcpGrants, orders, products } from '../server/db/schema.js';
import { address, contact, setup } from './helpers.js';
import { as, BASE, CALLBACK, connector, form, OWNER, pkce, STAFF, type Ctx } from './mcpHelpers.js';

let t: Ctx;
const { register, connect, rpc, tool } = connector(() => t);

beforeEach(async () => {
  t = await setup();
  // The owner signs in once (becoming the owner); a staff member is added.
  await t.call('GET', '/admin/me', { headers: await as(OWNER) });
  await t.db.insert(adminUsers).values({ userId: STAFF.sub, email: STAFF.email, role: 'staff' });
});

describe('discovery', () => {
  it('points a connector without a token to the sign-in', async () => {
    const r = await t.call('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${BASE}/.well-known/oauth-protected-resource/api/mcp"`);

    const res = await (await t.app.request('/.well-known/oauth-protected-resource/api/mcp')).json();
    expect(res).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [BASE] });
    const as = await (await t.app.request('/.well-known/oauth-authorization-server')).json();
    expect(as).toMatchObject({
      issuer: BASE, authorization_endpoint: `${BASE}/api/mcp/oauth/authorize`, token_endpoint: `${BASE}/api/mcp/oauth/token`,
      registration_endpoint: `${BASE}/api/mcp/oauth/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
    });
  });
});

describe('sign-in', () => {
  it('registers only Claude’s callback and localhost', async () => {
    const bad = await t.call('POST', '/mcp/oauth/register', { body: { redirect_uris: ['https://evil.example/cb'] } });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('invalid_redirect_uri');
    expect((await t.call('POST', '/mcp/oauth/register', { body: { redirect_uris: ['https://claude.ai/somewhere-else'] } })).status).toBe(400);
    expect(await register()).toMatch(/^eapc_/);
    expect(await register('http://localhost:33418/callback')).toMatch(/^eapc_/);
  });

  it('sends the person to the admin to approve, and never to an unregistered address', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 's1' });
    const r = await t.app.request(`/api/mcp/oauth/authorize?${q}`);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe(`/admin/connect?${q}`);

    q.set('redirect_uri', 'https://claude.com/api/mcp/auth_callback');
    const other = await t.app.request(`/api/mcp/oauth/authorize?${q}`);
    expect(other.status).toBe(400);
    expect(await other.text()).toContain('didn’t register');

    q.set('redirect_uri', CALLBACK);
    q.delete('code_challenge');
    const noPkce = await t.app.request(`/api/mcp/oauth/authorize?${q}`);
    expect(noPkce.status).toBe(302);
    expect(noPkce.headers.get('location')).toContain('error=invalid_request');
  });

  it('shows the approval screen only to signed-in team members, with two-step verification', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256' });
    expect((await t.call('GET', `/admin/mcp/request?${q}`)).status).toBe(401);
    expect((await t.call('GET', `/admin/mcp/request?${q}`, { headers: await as({ ...OWNER, aal: 'aal1' }) })).status).toBe(403);
    const r = await t.call('GET', `/admin/mcp/request?${q}`, { headers: await as(OWNER) });
    expect(r.json).toEqual({ app: 'Claude', email: OWNER.email, role: 'owner' });
  });

  it('declines back to the app', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const r = await t.call('POST', '/admin/mcp/deny', { body: { response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: challenge, code_challenge_method: 'S256', state: 'q' }, headers: await as(OWNER) });
    expect(r.json.redirect).toBe(`${CALLBACK}?error=access_denied&error_description=The+request+was+declined.&state=q`);
  });

  it('swaps a code once, and only with its PKCE verifier', async () => {
    const clientId = await register();
    const get = async () => {
      const p = pkce();
      const a = await t.call('POST', '/admin/mcp/approve', { body: { response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, code_challenge: p.challenge, code_challenge_method: 'S256' }, headers: await as(OWNER) });
      return { ...p, code: new URL(a.json.redirect).searchParams.get('code')! };
    };
    const one = await get();
    const wrong = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: one.code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: pkce().verifier }));
    expect(wrong.status).toBe(400);
    expect(wrong.json.error).toBe('invalid_grant');

    const two = await get();
    const good = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: two.code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: two.verifier }));
    expect(good.status).toBe(200);
    expect(good.json).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(good.json.access_token).toMatch(/^eap_at_/);
    const again = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: two.code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: two.verifier }));
    expect(again.json.error).toBe('invalid_grant');

    // The client id as HTTP Basic auth works too.
    const four = await get();
    const basic = await t.call('POST', '/mcp/oauth/token', {
      raw: new URLSearchParams({ grant_type: 'authorization_code', code: four.code, redirect_uri: CALLBACK, code_verifier: four.verifier }).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${clientId}:`).toString('base64')}` },
    });
    expect(basic.status).toBe(200);
    expect((await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: 'x', redirect_uri: CALLBACK, code_verifier: 'y' }))).json.error).toBe('invalid_client');

    // Codes expire after five minutes.
    const three = await get();
    t.setClock(new Date(Date.now() + 6 * 60_000));
    const late = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'authorization_code', code: three.code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: three.verifier }));
    expect(late.json.error).toBe('invalid_grant');
  });

  it('refreshes with a new refresh token each time', async () => {
    const c = await connect();
    const r1 = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId }));
    expect(r1.status).toBe(200);
    expect(r1.json.refresh_token).not.toBe(c.refresh_token);
    // The old access token stops working; the new one works.
    expect((await rpc(c.access_token, 'ping')).status).toBe(401);
    expect((await rpc(r1.json.access_token, 'ping')).status).toBe(200);
    // A lost reply: the previous refresh token still works for a minute…
    const retry = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId }));
    expect(retry.status).toBe(200);
    // …but not after.
    t.setClock(new Date(Date.now() + 2 * 60_000));
    const stale = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId }));
    expect(stale.json.error).toBe('invalid_grant');
    // Another app can't use it.
    const other = await register();
    const stolen = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'refresh_token', refresh_token: retry.json.refresh_token, client_id: other }));
    expect(stolen.json.error).toBe('invalid_grant');
  });

  it('stops working when disconnected, expired, or the person loses access', async () => {
    const a = await connect();
    expect((await rpc(a.access_token, 'ping')).status).toBe(200);
    const list = await t.call('GET', '/admin/mcp/connections', { headers: await as(OWNER) });
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0]).toMatchObject({ app: 'Claude', email: OWNER.email });
    expect((await t.call('DELETE', `/admin/mcp/connections/${list.json.items[0].id}`, { headers: await as(OWNER) })).status).toBe(200);
    expect((await rpc(a.access_token, 'ping')).status).toBe(401);

    const b = await connect(STAFF);
    await t.db.update(adminUsers).set({ active: false }).where(eq(adminUsers.userId, STAFF.sub));
    expect((await rpc(b.access_token, 'ping')).status).toBe(401);
    const refreshed = await t.call('POST', '/mcp/oauth/token', form({ grant_type: 'refresh_token', refresh_token: b.refresh_token, client_id: b.clientId }));
    expect(refreshed.json.error).toBe('invalid_grant');

    const c = await connect();
    t.setClock(new Date(Date.now() + 61 * 60_000));
    const expired = await rpc(c.access_token, 'ping');
    expect(expired.status).toBe(401);
    expect(expired.headers.get('www-authenticate')).toContain('error="invalid_token"');

    // Revoking through OAuth works too.
    t.setClock(null);
    const d = await connect();
    await t.call('POST', '/mcp/oauth/revoke', form({ token: d.refresh_token }));
    expect((await rpc(d.access_token, 'ping')).status).toBe(401);
  });

  it('only stores hashes, and its tokens open nothing but the connector', async () => {
    const c = await connect();
    const [g] = await t.db.select().from(mcpGrants);
    expect(JSON.stringify(g)).not.toContain(c.access_token);
    expect(JSON.stringify(g)).not.toContain(c.refresh_token);
    expect((await t.call('GET', '/admin/dashboard', { headers: { Authorization: `Bearer ${c.access_token}` } })).status).toBe(401);
  });
});

describe('MCP server', () => {
  it('speaks MCP', async () => {
    const { access_token: tok } = await connect();
    const init = await rpc(tok, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai', version: '1' } });
    expect(init.json.result.protocolVersion).toBe('2025-06-18');
    expect(init.json.result.capabilities.tools).toBeDefined();
    expect(init.json.result.instructions).toContain('owner@eldenap.in (owner)');
    const note = await t.call('POST', '/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' }, headers: { Authorization: `Bearer ${tok}` } });
    expect(note.status).toBe(202);
    const list = await rpc(tok, 'tools/list');
    const names = list.json.result.tools.map((x: { name: string }) => x.name);
    expect(names).toEqual(expect.arrayContaining(['get_store_overview', 'get_sales_by_source', 'create_product', 'update_product', 'list_competitions']));
    expect(names).not.toEqual(expect.arrayContaining(['refund_order']));
    for (const x of list.json.result.tools) {
      expect(x.inputSchema.type).toBe('object');
      expect(x.annotations.destructiveHint).toBe(false);
    }
    expect((await rpc(tok, 'nope/method')).json.error.code).toBe(-32601);
    expect((await rpc(tok, 'prompts/list')).json.result.prompts.map((p: { name: string }) => p.name)).toContain('meta_ads_vs_store');
    const prompt = await rpc(tok, 'prompts/get', { name: 'meta_ads_vs_store', arguments: { days: '14' } });
    expect(prompt.json.result.messages[0].content.text).toContain('last 14 days');
    expect((await t.call('GET', '/mcp', { headers: { Authorization: `Bearer ${tok}` } })).status).toBe(405);
  });

  it('gives staff only what staff can do', async () => {
    const { access_token: tok } = await connect(STAFF);
    const names = (await rpc(tok, 'tools/list')).json.result.tools.map((x: { name: string }) => x.name);
    expect(names).toContain('update_order_fulfillment');
    expect(names).not.toContain('create_product');
    expect(names).not.toContain('get_activity_log');
    expect((await rpc(tok, 'tools/call', { name: 'create_product', arguments: {} })).json.error.code).toBe(-32602);
  });

  it('reports sales in rupees, by source and campaign', async () => {
    const { access_token: tok } = await connect();
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    await t.db.update(orders).set({
      channel: 'meta_ads', source: { last: { at: Date.now(), source: 'facebook', medium: 'paid', campaign: 'Board Booster Nov', content: 'Reel 1', term: 'Parents 30-45', click: 'meta' } },
    }).where(eq(orders.id, r.json.orderId));

    const s = await tool(tok, 'get_sales_by_source', {});
    expect(s.isError, JSON.stringify(s.data)).toBe(false);
    expect(s.data.totals).toEqual({ orders: 1, revenue_inr: r.json.total / 100 });
    expect(s.data.channels[0]).toMatchObject({ channel: 'meta_ads', label: 'Meta ads', orders: 1, share_of_revenue_percent: 100 });
    expect(s.data.by_utm_campaign[0]).toMatchObject({ name: 'Board Booster Nov', utm_source: 'facebook', orders: 1 });
    expect(s.data.by_utm_content_ad[0].name).toBe('Reel 1');
    expect(s.data.by_utm_term_adset[0].name).toBe('Parents 30-45');

    const o = await tool(tok, 'get_store_overview', { days: 7 });
    expect(o.data.sales.orders).toBe(1);
    expect(o.data.sales.booked_inr).toBe(r.json.total / 100);
    expect(o.data.daily).toHaveLength(7);

    const list = await tool(tok, 'list_orders', { source: 'meta_ads' });
    expect(list.data.orders[0]).toMatchObject({ number: r.json.number, total_inr: r.json.total / 100, source: 'Meta ads' });
    const one = await tool(tok, 'get_order', { order: `#${r.json.number}` });
    expect(one.data.order.number).toBe(r.json.number);
    expect(one.data.order.ip).toBeUndefined();
    expect(one.data.items[0].unitPrice_inr).toBeGreaterThan(0);
    expect((await tool(tok, 'get_order', { order: '999999' })).data).toBe('No order #999999.');
  });

  it('adds, edits, publishes and stocks a product, logged as via Claude', async () => {
    const { access_token: tok } = await connect();
    const bad = await tool(tok, 'create_product', { title: 'X' });
    expect(bad.isError).toBe(true);
    expect(bad.data).toContain('Invalid arguments');

    const made = await tool(tok, 'create_product', {
      title: 'Board Booster Class X Science', series: 'D Brain Boosters', level: 'S', class_label: 'Class 10', grade: 10, subject: 'Science', boards: ['CBSE'],
      edition: '2026-27', highlights: ['30-day drill', '2 full mocks'], print: { price_inr: 249, stock: 40 }, ebook: { price_inr: 199 },
    });
    expect(made.isError).toBe(false);
    const p = made.data.created;
    expect(p).toMatchObject({ title: 'Board Booster Class X Science', status: 'draft', series: 'D Brain Boosters' });
    expect(p.formats.print).toMatchObject({ price_inr: 249, stock: 40, gstPercent: 0 });
    expect(p.formats.ebook).toMatchObject({ price_inr: 199, gstPercent: 18 });
    expect(p.formats.bundle).toBeNull();

    const edited = await tool(tok, 'update_product', { product: p.slug, blurb: 'Score more in boards', ebook: { price_inr: 179 } });
    expect(edited.data.updated).toMatchObject({ blurb: 'Score more in boards', title: p.title });
    expect(edited.data.updated.formats.ebook.price_inr).toBe(179);
    expect(edited.data.updated.formats.print.price_inr).toBe(249);
    expect((await tool(tok, 'update_product', { product: p.id, print: { stock: 5 } })).data).toContain('adjust_stock');

    // An e-book can't go on sale without its file; print-only can.
    const pub = await tool(tok, 'set_product_status', { products: [p.id], status: 'active' });
    expect(pub.isError).toBe(true);
    expect(pub.data).toContain('Upload the e-book file');
    await tool(tok, 'update_product', { product: p.id, ebook: null });
    expect((await tool(tok, 'set_product_status', { products: [p.title], status: 'active' })).data).toEqual({ ok: true, status: 'active', products: 1 });

    const st = await tool(tok, 'adjust_stock', { product: p.id, change: 10, reason: 'received', note: 'New print run' });
    expect(st.data).toEqual({ product: p.title, stockBefore: 40, stockNow: 50 });

    const got = await tool(tok, 'get_product', { product: p.id });
    expect(got.data).toMatchObject({ status: 'active', copiesSold: 0 });

    const log = await t.db.select().from(auditLog);
    expect(log.map((l) => l.actor)).toContain('owner@eldenap.in (via Claude)');
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(['mcp.connect', 'product.create', 'product.update', 'product.bulk', 'inventory.adjust']));
  });

  it('creates discount codes in rupees and switches them off', async () => {
    const { access_token: tok } = await connect();
    const c = await tool(tok, 'create_coupon', { code: 'boards50', amount_off_inr: 50, min_order_inr: 199 });
    expect(c.data).toMatchObject({ created: 'BOARDS50', active: true });
    const list = await tool(tok, 'list_coupons');
    expect(list.data.find((x: { code: string }) => x.code === 'BOARDS50')).toMatchObject({ type: 'fixed', amountOff_inr: 50, minSubtotal_inr: 199 });
    expect((await tool(tok, 'set_coupon_active', { code: 'BOARDS50', active: false })).data).toEqual({ code: 'BOARDS50', active: false });
  });

  it('notes and ships orders', async () => {
    const { access_token: tok } = await connect(STAFF);
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
    await tool(tok, 'add_order_note', { order: String(r.json.number), note: 'Customer asked for quick delivery' });
    const n2 = await tool(tok, 'add_order_note', { order: String(r.json.number), note: 'Called back' });
    expect(n2.data.internalNote.split('\n')).toHaveLength(2);
    expect((await tool(tok, 'update_order_fulfillment', { order: String(r.json.number), status: 'shipped' })).data).toContain('tracking number');
    const shipped = await tool(tok, 'update_order_fulfillment', { order: String(r.json.number), status: 'shipped', courier: 'India Post', tracking_number: 'EE123456789IN' });
    expect(shipped.data).toMatchObject({ fulfillmentStatus: 'shipped', trackingNumber: 'EE123456789IN', customerNotified: true });
  });
});
