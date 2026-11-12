// The Claude connector across the back office: WhatsApp, calls, newsletter, audience, competitions,
// settings, and what each role sees.
import { beforeEach, describe, expect, it } from 'vitest';
import { accounts, adminUsers, auditLog, calls, subscribers, whatsappMessages } from '../server/db/schema.js';
import { memoryWhatsApp } from '../server/lib/whatsapp.js';
import { setup } from './helpers.js';
import { as, connector, OWNER, STAFF, type Ctx } from './mcpHelpers.js';

let t: Ctx;
const { connect, rpc, tool } = connector(() => t);

beforeEach(async () => {
  t = await setup();
  await t.call('GET', '/admin/me', { headers: await as(OWNER) });
  await t.db.insert(adminUsers).values({ userId: STAFF.sub, email: STAFF.email, role: 'staff' });
});

describe('the whole back office', () => {
  it('reads everything, and leaves refunds, competition decisions and settings read-only', async () => {
    const { access_token: tok } = await connect();
    const names: string[] = (await rpc(tok, 'tools/list')).json.result.tools.map((x: { name: string }) => x.name);
    for (const n of ['get_whatsapp_overview', 'get_whatsapp_conversation', 'reply_whatsapp', 'send_whatsapp_new_books', 'get_calls_overview', 'get_call', 'list_checkout_leads',
      'call_now', 'list_subscribers', 'list_accounts', 'get_audience', 'create_campaign', 'send_campaign_now', 'list_popups', 'get_cookie_consent_stats',
      'list_study_hub_files', 'list_competition_teams', 'get_competition_team', 'get_store_settings', 'list_staff']) expect(names).toContain(n);
    for (const n of names) expect(n).not.toMatch(/refund|cancel_order|review_team|set_result|notice_send|update_settings|delete/);
    expect(names).toHaveLength(new Set(names).size);

    const settings = await tool(tok, 'get_store_settings');
    expect(settings.data.shippingFlat_inr).toBeTypeOf('number');
    expect((await tool(tok, 'list_staff')).data[0]).toMatchObject({ email: OWNER.email, role: 'owner' });
    expect((await tool(tok, 'get_cookie_consent_stats', { days: 7 })).data.totals).toBeDefined();
    expect((await tool(tok, 'list_competition_teams', { slug: 'doomsday-diaries' })).data).toMatchObject({ total: 0, teams: [] });
    expect((await tool(tok, 'get_competition_settings', { slug: 'doomsday-diaries' })).data.dates).toBeDefined();
    expect((await tool(tok, 'list_competition_teams', { slug: 'nope' })).data).toContain('No competition');
    expect(Array.isArray((await tool(tok, 'list_study_hub_files')).data)).toBe(true);
  });

  it('reads and replies on WhatsApp without marking the inbox as seen', async () => {
    const wa = memoryWhatsApp();
    t.deps.whatsapp = wa;
    const { access_token: tok } = await connect();
    await t.db.insert(whatsappMessages).values({ phone: '+919876543210', name: 'Asha K', direction: 'in', kind: 'inbound', status: 'received', body: 'Is COD available?', waId: 'wamid.in1' });

    const inbox = await tool(tok, 'list_whatsapp_conversations');
    expect(inbox.data[0]).toMatchObject({ phone: '+919876543210', unread: 1 });
    const thread = await tool(tok, 'get_whatsapp_conversation', { phone: '98765 43210' });
    expect(thread.data).toMatchObject({ phone: '+919876543210', name: 'Asha K', optedOut: false, canReplyNow: true });
    expect(thread.data.messages[0].body).toBe('Is COD available?');
    expect((await tool(tok, 'list_whatsapp_conversations')).data[0].unread).toBe(1);

    const sent = await tool(tok, 'reply_whatsapp', { phone: '+919876543210', text: 'Yes, cash on delivery is available.' });
    expect(sent.data).toMatchObject({ sent: true, phone: '+919876543210' });
    expect(wa.sent.at(-1)).toEqual({ to: '+919876543210', text: 'Yes, cash on delivery is available.' });
    expect((await t.db.select().from(auditLog)).map((l) => `${l.actor} ${l.action}`)).toContain('owner@eldenap.in (via Claude) whatsapp.reply');
    expect((await tool(tok, 'get_whatsapp_conversation', { phone: '12345' })).data).toContain('isn\'t a phone number');
  });

  it('reads calls and leads, and skips or resolves a call', async () => {
    const { access_token: tok } = await connect();
    const [queued] = await t.db.insert(calls).values({ kind: 'cart', status: 'queued', phone: '+919876543210', name: 'Asha K', dueAt: new Date(Date.now() + 3600_000) }).returning();
    const [done] = await t.db.insert(calls).values({
      kind: 'feedback', status: 'done', phone: '+919812345678', name: 'Ravi', dueAt: new Date(), outcome: 'feedback_given',
      transcript: 'Agent: Hello! '.repeat(1000), issueOpen: true, result: { rating: '4', issue_detail: 'Late delivery' },
    }).returning();
    const overview = await tool(tok, 'get_calls_overview', { days: 7 });
    expect(overview.data.status).toMatchObject({ connected: false });
    const list = await tool(tok, 'list_calls', { open_issues: true });
    expect(list.data.items.map((c: { id: string }) => c.id)).toEqual([done.id]);
    const one = await tool(tok, 'get_call', { call_id: done.id });
    expect(one.data.call.result.issue_detail).toBe('Late delivery');
    expect(one.data.call.transcript.length).toBeLessThan(8100);
    expect((await tool(tok, 'resolve_call_issue', { call_id: done.id })).data.issueOpen).toBe(false);
    expect((await tool(tok, 'skip_call', { call_id: queued.id })).data.status).toBe('skipped');
    expect((await tool(tok, 'list_checkout_leads')).data).toMatchObject({ leads: [] });
    expect((await tool(tok, 'add_do_not_call', { phone: '9812345678', reason: 'Asked not to be called' })).data).toEqual({ ok: true, phone: '+919812345678' });
  });

  it('drafts, tests and sends a newsletter campaign', async () => {
    const { access_token: tok } = await connect();
    await t.db.insert(subscribers).values({ email: 'parent@example.com', name: 'Priya', status: 'subscribed', source: 'footer' });
    const draft = await tool(tok, 'create_campaign_from_product', { product: 'mathematics-today' });
    expect(draft.data.created).toMatchObject({ status: 'draft', subject: 'New from Elden: Mathematics Today' });
    const id = draft.data.created.id;
    expect((await tool(tok, 'update_campaign', { campaign_id: id, subject: 'Maths, sorted for Class 8' })).data.updated.subject).toBe('Maths, sorted for Class 8');
    expect((await tool(tok, 'send_campaign_test', { campaign_id: id })).data).toEqual({ ok: true, to: OWNER.email });
    const sent = await tool(tok, 'send_campaign_now', { campaign_id: id });
    expect(sent.isError).toBe(false);
    expect((await tool(tok, 'list_campaigns')).data[0]).toMatchObject({ id, status: expect.stringMatching(/sending|sent/) });
    expect((await tool(tok, 'send_campaign_now', { campaign_id: id })).data).toContain('already been sent');
    expect((await tool(tok, 'list_subscribers', { status: 'subscribed' })).data.subscribers[0]).not.toHaveProperty('consentIp');
  });

  it('leaves students\' private details out of the account list', async () => {
    const { access_token: tok } = await connect();
    await t.db.insert(accounts).values([
      { userId: '33333333-3333-4333-8333-333333333333', email: 'kid@example.com', name: 'Kid', phone: '9800000001', accountType: 'student', dob: '2012-05-01', guardianName: 'Mum', guardianPhone: '9800000002', grade: '8' },
      { userId: '44444444-4444-4444-8444-444444444444', email: 'mum@example.com', name: 'Mum', phone: '9800000002', accountType: 'parent' },
    ]);
    const r = await tool(tok, 'list_accounts');
    const kid = r.data.accounts.find((a: { email: string }) => a.email === 'kid@example.com');
    const mum = r.data.accounts.find((a: { email: string }) => a.email === 'mum@example.com');
    expect(kid).toMatchObject({ accountType: 'student', grade: '8' });
    for (const k of ['dob', 'phone', 'whatsapp', 'guardianName', 'guardianPhone']) expect(kid).not.toHaveProperty(k);
    expect(mum.phone).toBe('9800000002');
  });

  it('keeps managers out of owner-only areas and staff out of messaging', async () => {
    await t.db.insert(adminUsers).values({ userId: '55555555-5555-4555-8555-555555555555', email: 'manager@eldenap.in', role: 'manager' });
    const m = await connect({ sub: '55555555-5555-4555-8555-555555555555', email: 'manager@eldenap.in' });
    const mt: string[] = (await rpc(m.access_token, 'tools/list')).json.result.tools.map((x: { name: string }) => x.name);
    expect(mt).toEqual(expect.arrayContaining(['reply_whatsapp', 'send_campaign_now', 'call_now']));
    expect(mt).not.toEqual(expect.arrayContaining(['list_competition_teams']));
    expect(mt).not.toContain('list_staff');
    const s = await connect(STAFF);
    const st: string[] = (await rpc(s.access_token, 'tools/list')).json.result.tools.map((x: { name: string }) => x.name);
    for (const n of ['reply_whatsapp', 'send_whatsapp_new_books', 'create_campaign', 'call_now', 'list_whatsapp_conversations', 'get_calls_overview']) expect(st).not.toContain(n);
    expect(st).toContain('get_audience');
  });
});
