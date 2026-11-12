// Calls by the voice agents: saving checkouts (with consent only), queueing cart-recovery and
// feedback calls, calling hours, the do-not-call list, dialling, and acting on each call's result.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls, checkoutLeads, orders, products } from '../server/db/schema.js';
import { callResultFrom, memoryCalls, sarvamCalls } from '../server/lib/callProvider.js';
import { sarvamCallsFrom } from '../server/deps.js';
import { loadEnv } from '../server/env.js';
import { runCalls } from '../server/services/calls.js';
import { callableNumber, DEFAULT_CALL_SETTINGS, inCallingHours, nextCallingTime } from '../src/shared/calls.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let provider: ReturnType<typeof memoryCalls>;
// Tuesday 10 November 2026, 11:00 in India: inside the default hours (10 to 7, Monday to Saturday).
const TUE_11 = new Date('2026-11-10T11:00:00+05:30');
const at = (iso: string) => t.setClock(new Date(iso));
beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in', CALLS_WEBHOOK_SECRET: 'hook-secret-123' } });
  provider = memoryCalls();
  t.deps.calls = provider;
  t.setClock(TUE_11);
});

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
async function book() {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  return p;
}
const lead = async (o: Partial<{ clientKey: string; phone: string; consent: boolean; email: string }> = {}) => {
  const p = await book();
  return t.call('POST', '/checkout/lead', { body: { clientKey: 'browser-key-0000000001', name: 'Asha Kumari', email: 'asha@example.com', phone: '98765 43210', consent: true, items: [{ productId: p.id, kind: 'print', quantity: 2 }], ...o } });
};
const settings = async (s: Record<string, unknown>) => {
  const r = await t.call('PUT', '/admin/calls/settings', { headers: await admin(), body: s });
  expect(r.status).toBe(200);
};
const webhook = (body: unknown, secret = 'hook-secret-123') => t.call('POST', `/calls/webhook/${secret}`, { body });
const allCalls = () => t.db.select().from(calls);

describe('the rules', () => {
  it('calling hours and numbers', () => {
    const s = DEFAULT_CALL_SETTINGS;
    expect(inCallingHours(s, TUE_11)).toBe(true);
    expect(inCallingHours(s, new Date('2026-11-10T09:59:00+05:30'))).toBe(false);
    expect(inCallingHours(s, new Date('2026-11-10T19:00:00+05:30'))).toBe(false);
    expect(inCallingHours(s, new Date('2026-11-15T12:00:00+05:30'))).toBe(false); // Sunday
    expect(nextCallingTime(s, new Date('2026-11-10T20:00:00+05:30')).toISOString()).toBe(new Date('2026-11-11T10:00:00+05:30').toISOString());
    expect(nextCallingTime(s, new Date('2026-11-14T19:30:00+05:30')).toISOString()).toBe(new Date('2026-11-16T10:00:00+05:30').toISOString()); // Sat evening → Mon
    expect(callableNumber('098765 43210')).toBe('+919876543210');
    expect(callableNumber('+91 98765 43210')).toBe('+919876543210');
    expect(callableNumber('12345')).toBeNull();
    expect(callableNumber('0612 345678')).toBeNull(); // landline
  });

  it('reads a call-end report whatever the wrapper', () => {
    const r = callResultFrom({ data: { interaction_id: 'abc', status: 'completed', duration: 64, metadata: { call_id: '6f1c1f2e-1111-4111-8111-111111111111' }, agent_variables: { call_outcome: 'will_order', wants_link: 'true' }, transcript: [{ role: 'agent', text: 'Namaste' }] } });
    expect(r).toMatchObject({ callId: '6f1c1f2e-1111-4111-8111-111111111111', providerCallId: 'abc', status: 'answered', durationSeconds: 64, variables: { call_outcome: 'will_order' } });
    expect(r.transcript).toBe('agent: Namaste');
    expect(callResultFrom({ status: 'no-answer' }).status).toBe('not_answered');
    expect(callResultFrom({ status: 'busy' }).status).toBe('not_answered');
  });

  it("reads Sarvam's outbound call-end webhook", () => {
    const base = { app_id: 'Elden-Acade-e49b18a7-09b3', app_version: 2, attempt_id: 'att-1', campaign_id: 'camp-1', cohort_id: 'co-1', user_identifier: '6f1c1f2e-1111-4111-8111-111111111111', user_phone_number: '+919876543210' };
    const r = callResultFrom({
      ...base, completion_status: 'completed', connectivity_status: 'connected', duration: 92.4, interaction_id: 'int-9', recording_url: 'https://rec/x.mp3',
      final_agent_variables: { customer_name: 'Asha', call_outcome: 'callback' }, output_agent_variables: { call_outcome: 'will_order', wants_link: 'yes' },
      interaction_transcript: [{ role: 'agent', en_text: 'Hello', indic_text: 'नमस्ते' }, { role: 'user', en_text: 'Yes' }],
    });
    expect(r).toMatchObject({
      callId: base.user_identifier, providerCallId: 'int-9', status: 'answered', durationSeconds: 92, recordingUrl: 'https://rec/x.mp3',
      variables: { customer_name: 'Asha', call_outcome: 'will_order', wants_link: 'yes' },
    });
    expect(r.transcript).toBe('agent: Hello\nuser: Yes');
    expect(callResultFrom({ ...base, completion_status: 'failed', connectivity_status: 'no_answer' })).toMatchObject({ status: 'not_answered', providerCallId: 'att-1' });
    expect(callResultFrom({ ...base, completion_status: 'failed', connectivity_status: 'busy' }).status).toBe('not_answered');
    expect(callResultFrom({ ...base, completion_status: 'failed', connectivity_status: 'failed' }).status).toBe('failed');
  });
});

describe('checkout leads', () => {
  it('are saved only with consent and a mobile number; withdrawing consent stops the call', async () => {
    expect((await lead({ consent: false })).json).toEqual({ saved: false });
    expect((await lead({ phone: '12345' })).json).toEqual({ saved: false });
    expect(await t.db.select().from(checkoutLeads)).toHaveLength(0);
    expect((await lead()).json).toEqual({ saved: true });
    const [l] = await t.db.select().from(checkoutLeads);
    expect(l).toMatchObject({ phone: '+919876543210', consent: true, items: [{ kind: 'print', quantity: 2, title: 'Mathematics Today' }] });
    expect(l.total).toBeGreaterThan(0);
    expect((await lead({ phone: '91234 56789' })).json.saved).toBe(true); // same checkout: updated, not duplicated
    expect(await t.db.select().from(checkoutLeads)).toHaveLength(1);
    // A queued call for it is cancelled when they untick.
    at('2026-11-10T12:30:00+05:30');
    await runCalls(t.deps);
    expect((await allCalls())[0]?.status).toBe('queued');
    await lead({ consent: false });
    expect((await allCalls())[0]).toMatchObject({ status: 'cancelled' });
  });

  it('the finish-your-order link gives the cart back, until it is paid', async () => {
    await lead();
    const [l] = await t.db.select().from(checkoutLeads);
    const r = await t.call('GET', `/checkout/resume/${l.resumeToken}`);
    expect(r.json).toMatchObject({ name: 'Asha Kumari', phone: '9876543210', items: [{ kind: 'print', quantity: 2 }] });
    expect((await t.call('GET', '/checkout/resume/not-a-real-token-123')).status).toBe(404);
  });
});

describe('cart recovery', () => {
  it('queues a call after the delay, dials it in hours with the cart details, and skips it once paid', async () => {
    await settings({ enabled: true, cart: { enabled: true, delayMinutes: 60, discountCode: 'COMEBACK10', discountOffer: '10 percent off the whole order' } });
    await lead();
    expect((await runCalls(t.deps)).queued).toBe(0); // too soon
    at('2026-11-10T12:05:00+05:30');
    const run = await runCalls(t.deps);
    expect(run).toMatchObject({ queued: 1, dialled: 1, connected: true, inHours: true });
    expect(provider.started[0]).toMatchObject({ kind: 'cart', phone: '+919876543210', variables: { customer_name: 'Asha', cart_items: 'Mathematics Today (printed, 2 copies)', discount_code: 'COMEBACK10', discount_offer: '10 percent off the whole order' } });
    expect(provider.started[0].variables.cart_total).toMatch(/^[\d,]+ rupees$/);
    expect((await allCalls())[0]).toMatchObject({ status: 'dialling', attempts: 1, providerCallId: 'test-1' });
    // Running again doesn't queue or dial it twice.
    expect(await runCalls(t.deps)).toMatchObject({ queued: 0, dialled: 0 });
  });

  it('does nothing while switched off or outside the hours, and never calls the do-not-call list', async () => {
    await lead();
    at('2026-11-10T12:05:00+05:30');
    expect(await runCalls(t.deps)).toMatchObject({ queued: 1, dialled: 0, enabled: false }); // master switch off by default
    await settings({ enabled: true });
    at('2026-11-10T20:00:00+05:30');
    expect((await runCalls(t.deps)).dialled).toBe(0);
    const h = await admin();
    expect((await t.call('POST', '/admin/calls/do-not-call', { headers: h, body: { phone: '98765 43210', reason: 'asked by email' } })).status).toBe(200);
    expect((await allCalls())[0]).toMatchObject({ status: 'skipped', note: 'On the do-not-call list' });
    at('2026-11-11T10:30:00+05:30');
    expect((await runCalls(t.deps)).dialled).toBe(0);
    expect(provider.started).toHaveLength(0);
  });

  it('a lead who pays before the call is never called', async () => {
    await settings({ enabled: true });
    await lead();
    at('2026-11-10T11:30:00+05:30');
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const o = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(o.json.razorpay.orderId) });
    const [l] = await t.db.select().from(checkoutLeads);
    expect(l.orderId).toBeTruthy();
    at('2026-11-10T13:00:00+05:30');
    expect(await runCalls(t.deps)).toMatchObject({ queued: 0, dialled: 0 });
  });
});

describe('call results', () => {
  async function dialled() {
    await settings({ enabled: true, cart: { enabled: true, delayMinutes: 60, discountCode: 'COMEBACK10', discountOffer: '10 percent off' } });
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    return (await allCalls())[0];
  }

  it('"send me the link" emails the finish-your-order link (with the coupon if given)', async () => {
    const c = await dialled();
    t.mailer.sent.length = 0;
    expect((await webhook({ metadata: { call_id: c.id }, status: 'completed', duration: 92, variables: { call_outcome: 'will_order', wants_link: true, discount_offered: true, objection: 'Price' }, transcript: 'agent: Namaste' })).json).toEqual({ ok: true, matched: true });
    const [done] = await allCalls();
    expect(done).toMatchObject({ status: 'done', outcome: 'will_order', durationSeconds: 92, transcript: 'agent: Namaste' });
    const mail = t.mailer.sent.find((m) => m.to === 'asha@example.com')!;
    expect(mail.subject).toBe('Your books are waiting: finish your order');
    expect(mail.html).toContain('https://eldenap.in/checkout?resume=');
    expect(mail.html).toContain('COMEBACK10');
  });

  it('"do not call" joins the list; "call me later" queues it again; no answer retries, then gives up', async () => {
    const c = await dialled();
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'callback', callback_time: 'tomorrow evening' } });
    let [row] = await allCalls();
    expect(row).toMatchObject({ status: 'queued', outcome: 'callback' });
    expect(row.note).toContain('tomorrow evening');
    expect(row.dueAt.getTime()).toBeGreaterThan(new Date('2026-11-11T07:00:00+05:30').getTime());
    // Next day: called again, nobody answers twice more, then no more tries.
    at('2026-11-11T10:30:00+05:30');
    await runCalls(t.deps);
    await webhook({ metadata: { call_id: c.id }, status: 'no-answer' });
    [row] = await allCalls();
    expect(row).toMatchObject({ status: 'queued', note: 'No answer' });
    at('2026-11-11T13:00:00+05:30');
    await runCalls(t.deps);
    await webhook({ metadata: { call_id: c.id }, status: 'busy' });
    [row] = await allCalls();
    expect(row.status).toBe('no_answer'); // 3 attempts: the first, and 2 retries
    // Asked not to be called: on the list, never queued again.
    const r = await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'do_not_call' } });
    expect(r.json.matched).toBe(true);
    const list = await t.call('GET', '/admin/calls/do-not-call', { headers: await admin() });
    expect(list.json.items).toMatchObject([{ phone: '+919876543210', source: 'customer' }]);
  });

  it("Sarvam's documented campaign payload is matched and recorded", async () => {
    const c = await dialled();
    const r = await webhook({
      app_id: 'Elden-Acade-e49b18a7-09b3', app_version: 3, experiment: null, attempt_id: '019d392a-4f5a-7db3-904a-6ecebb9aac96',
      campaign_id: 'Elden---Car-4ab29de8-5933', cohort_id: `cart-${c.id}`, completion_status: 'completed', connectivity_status: 'connected',
      next_action_status: null, failure_reason: null, user_identifier: c.id, user_phone_number: '+919876543210', agent_phone_number: '+917965860108',
      duration: 42.5, interaction_id: '20261112/a1b2c3d4-10:30:00-e5f6a7b8', retry_attempt: 0, executed_at: '2026-11-10T12:06:00+05:30',
      start_datetime: '2026-11-10T06:36:00Z', end_datetime: '2026-11-10T06:36:43Z',
      initial_agent_variables: { customer_name: 'Asha' }, final_agent_variables: { call_outcome: 'will_order' }, output_agent_variables: { call_outcome: 'will_order', wants_link: 'true' },
      interaction_transcript: [{ role: 'agent', en_text: 'Namaste Asha ji' }, { role: 'user', en_text: 'Haan, bataiye' }],
      metadata: { purpose: 'cart_recovery_call_end' },
    });
    expect(r.json).toEqual({ ok: true, matched: true });
    const [row] = await allCalls();
    expect(row).toMatchObject({ status: 'done', outcome: 'will_order', durationSeconds: 43, providerCallId: 'test-1', transcript: 'agent: Namaste Asha ji\nuser: Haan, bataiye' });
  });

  it('a call whose webhook never came is completed from Sarvam: by the 10-minute job, or "Fetch result from Sarvam"', async () => {
    const c = await dialled();
    let ready = false;
    provider.lookup = async ({ callId }) => (ready ? {
      user_identifier: callId, connectivity_status: 'connected', duration: 50, recording_url: 'https://rec/2.mp3',
      final_agent_variables: { call_outcome: 'callback', callback_time: 'evening' }, interaction_transcript: [{ role: 'agent', en_text: 'Namaste' }],
    } : null);
    const h = await admin();
    // Too soon, then no result yet: still calling.
    expect((await runCalls(t.deps)).fetched).toBe(0);
    at('2026-11-10T12:10:00+05:30');
    expect((await runCalls(t.deps)).fetched).toBe(0);
    let r = await t.call('POST', `/admin/calls/${c.id}/fetch-result`, { headers: h });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('no final result');
    expect((await allCalls())[0].status).toBe('dialling');
    // Sarvam has it now: the button records it.
    ready = true;
    r = await t.call('POST', `/admin/calls/${c.id}/fetch-result`, { headers: h });
    expect(r.status).toBe(200);
    expect(r.json.call).toMatchObject({ outcome: 'callback', transcript: 'agent: Namaste', recordingUrl: 'https://rec/2.mp3', durationSeconds: 50 });
    // The webhook arriving late changes nothing.
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'callback' } });
    expect((await allCalls()).filter((x) => x.outcome === 'callback')).toHaveLength(1);
  });

  it('the 10-minute job fetches a stuck call by itself', async () => {
    const c = await dialled();
    provider.lookup = async ({ callId }) => ({ user_identifier: callId, connectivity_status: 'connected', duration: 30, final_agent_variables: { call_outcome: 'not_interested' } });
    at('2026-11-10T12:15:00+05:30');
    expect((await runCalls(t.deps)).fetched).toBe(1);
    expect((await allCalls()).find((x) => x.id === c.id)).toMatchObject({ status: 'done', outcome: 'not_interested' });
  });

  it('refuses a webhook without the secret, and ignores unknown calls', async () => {
    expect((await webhook({ status: 'completed' }, 'wrong')).status).toBe(401);
    expect((await webhook({ metadata: { call_id: '00000000-0000-4000-8000-000000000000' }, status: 'completed' })).json).toEqual({ ok: true, matched: false });
  });

  it('a call that never reports back counts as not answered after an hour', async () => {
    await dialled();
    at('2026-11-10T13:10:00+05:30');
    await runCalls(t.deps);
    const [row] = await allCalls();
    expect(row).toMatchObject({ status: 'queued', attempts: 1, note: 'No result from the provider' }); // tried again after retryAfterMinutes
  });

  it('a failing provider is recorded and retried', async () => {
    await settings({ enabled: true });
    provider.fail = true;
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    let [row] = await allCalls();
    expect(row).toMatchObject({ status: 'queued', attempts: 1 });
    expect(row.note).toBe("Couldn't start the call (Tue, 10 Nov, 12:05 pm): provider down");
    // Fixed: the next try goes through and the old error is cleared.
    provider.fail = false;
    at('2026-11-10T14:10:00+05:30');
    await runCalls(t.deps);
    [row] = await allCalls();
    expect(row).toMatchObject({ status: 'dialling', attempts: 2, note: '' });
  });
});

describe('incoming calls', () => {
  // What Sarvam posts when a customer rings one of our numbers (the number's webhook metadata included).
  const incoming = (o: Record<string, unknown>) => ({
    app_id: 'Elden-Acade-e49b18a7-09b3', app_version: 2, deployment_id: 'Elden-Acade-013480d9-c620', interaction_id: 'int-in-1',
    user_phone_number: '+919876543210', agent_phone_number: '+917965860108', duration: 48,
    metadata: { purpose: 'cart_recovery_call_end' }, interaction_transcript: [{ role: 'agent', en_text: 'Namaste' }], ...o,
  });

  it('are recorded against the caller\'s checkout; "send me the link" emails it once, even if reported twice', async () => {
    await lead();
    const [l] = await t.db.select().from(checkoutLeads);
    t.mailer.sent.length = 0;
    const body = incoming({ output_agent_variables: { call_outcome: 'will_order', wants_link: 'true' } });
    expect((await webhook(body)).json).toEqual({ ok: true, matched: true });
    expect((await webhook(body)).json).toEqual({ ok: true, matched: true });
    const rows = await allCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'cart', status: 'done', createdBy: 'inbound', phone: '+919876543210', name: 'Asha Kumari', leadId: null,
      outcome: 'will_order', durationSeconds: 48, providerCallId: 'int-in-1', variables: { lead_id: l.id }, transcript: 'agent: Namaste',
    });
    expect(t.mailer.sent.filter((m) => m.to === 'asha@example.com' && m.subject === 'Your books are waiting: finish your order')).toHaveLength(1);
    // Our own cart call for that checkout can still be made later (it isn't blocked by the incoming one).
    at('2026-11-10T12:05:00+05:30');
    await settings({ enabled: true });
    await runCalls(t.deps);
    expect((await allCalls()).filter((c) => c.createdBy !== 'inbound')).toHaveLength(1);
  });

  it('a short or unknown caller is still recorded, never dialled back, and kept out of the answer rate', async () => {
    await webhook(incoming({ interaction_id: 'int-in-2', user_phone_number: '+919000000001', duration: 4, output_agent_variables: { call_outcome: 'enquiry' } }));
    const [row] = await allCalls();
    expect(row).toMatchObject({ status: 'done', outcome: 'enquiry', name: '', variables: {}, createdBy: 'inbound' });
    const stats = await t.call('GET', '/admin/calls/stats', { headers: await admin() });
    expect(stats.json.cart).toMatchObject({ incoming: 1, attempted: 0, answered: 0 });
  });

  it('a problem reported on the feedback line is flagged and emailed; "do not call" is honoured', async () => {
    t.mailer.sent.length = 0;
    await webhook(incoming({
      interaction_id: 'int-in-3', app_id: 'Elden-Acade-b3786fac-c2ee', deployment_id: 'Elden-Acade-f7ca6069-2b02', metadata: { purpose: 'feedback_call_end' },
      output_agent_variables: { call_outcome: 'do_not_call', issue_reported: 'true', issue_detail: 'Cover torn on Mathematics Today.' },
    }));
    const [row] = await allCalls();
    expect(row).toMatchObject({ kind: 'feedback', issueOpen: true, createdBy: 'inbound' });
    expect(t.mailer.sent.some((m) => m.subject.startsWith('Customer reported a problem') && m.html.includes('Cover torn'))).toBe(true);
    const dnc = await t.call('GET', '/admin/calls/do-not-call', { headers: await admin() });
    expect(dnc.json.items.map((x: { phone: string }) => x.phone)).toContain('+919876543210');
  });

  it('"call me back" on an incoming call repeats our own call for that checkout', async () => {
    await settings({ enabled: true, cart: { enabled: true, delayMinutes: 60, discountCode: '', discountOffer: '' } });
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    const [ours] = await allCalls();
    await webhook({ metadata: { call_id: ours.id }, status: 'no-answer' });
    await webhook(incoming({ interaction_id: 'int-in-4', output_agent_variables: { call_outcome: 'callback', callback_time: 'Thursday morning' } }));
    const [again] = await t.db.select().from(calls).where(eq(calls.id, ours.id));
    expect(again).toMatchObject({ status: 'queued', note: 'Asked to be called back: Thursday morning' });
  });
});

describe('order feedback', () => {
  it('calls buyers who agreed, some days after a delivered order; a reported problem is flagged and emailed', async () => {
    await settings({ enabled: true, cart: { enabled: false, delayMinutes: 60, discountCode: '', discountOffer: '' }, feedback: { enabled: true, daysAfter: 3, newBookIds: [] } });
    await lead();
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const o = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(o.json.razorpay.orderId) });
    await t.db.update(orders).set({ fulfillmentStatus: 'delivered', deliveredAt: new Date('2026-11-12T10:00:00+05:30') });
    at('2026-11-12T11:00:00+05:30');
    expect((await runCalls(t.deps)).queued).toBe(0); // too soon
    at('2026-11-13T11:30:00+05:30');
    expect(await runCalls(t.deps)).toMatchObject({ queued: 1, dialled: 1 });
    expect(provider.started[0]).toMatchObject({ kind: 'feedback', variables: { customer_name: 'Asha', books_bought: 'Mathematics Today', order_type: 'print', new_books: '' } });
    const [c] = await allCalls();
    t.mailer.sent.length = 0;
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'feedback_given', rating: 2, issue_reported: 'true', issue_detail: 'Two pages were torn.' } });
    const [done] = await allCalls();
    expect(done).toMatchObject({ status: 'done', issueOpen: true, outcome: 'feedback_given' });
    expect(t.mailer.sent.some((m) => m.subject.startsWith('Customer reported a problem') && m.html.includes('Two pages were torn.'))).toBe(true);
    // The admin marks it handled.
    const h = await admin();
    expect((await t.call('GET', '/admin/calls?issues=1', { headers: h })).json.total).toBe(1);
    await t.call('POST', `/admin/calls/${c.id}/resolve`, { headers: h });
    expect((await t.call('GET', '/admin/calls?issues=1', { headers: h })).json.total).toBe(0);
    // Not called twice for the same order.
    at('2026-11-14T11:30:00+05:30');
    expect((await runCalls(t.deps)).queued).toBe(0);
  });
});

describe('feedback calls to earlier buyers', () => {
  async function paidOrder() {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const o = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(o.json.razorpay.orderId) });
    await t.db.update(orders).set({ fulfillmentStatus: 'delivered', deliveredAt: new Date('2026-11-10T12:00:00+05:30') });
  }

  it('are called only when switched on, once a month per number, and never if they unticked the box', async () => {
    await settings({ enabled: true, cart: { enabled: false }, feedback: { enabled: true, daysAfter: 3 } });
    await paidOrder();
    await paidOrder();
    at('2026-11-14T11:30:00+05:30');
    expect((await runCalls(t.deps)).queued).toBe(0); // no saved checkout with the tick
    await settings({ feedback: { allBuyers: true, lookbackDays: 30 } });
    expect((await runCalls(t.deps)).queued).toBe(1); // two orders, one call
    const [c] = await allCalls();
    expect(c).toMatchObject({ kind: 'feedback', leadId: null, variables: { customer_name: 'Asha', books_bought: 'Mathematics Today' } });
    expect(c.phone).toMatch(/^\+91\d{10}$/);
  });

  it('someone who unticked the call box is left alone', async () => {
    await settings({ enabled: true, cart: { enabled: false }, feedback: { enabled: true, daysAfter: 3, allBuyers: true, lookbackDays: 30 } });
    await lead();
    await lead({ consent: false });
    await paidOrder();
    at('2026-11-14T11:30:00+05:30');
    const [l] = await t.db.select().from(checkoutLeads);
    expect(l).toMatchObject({ consent: false });
    expect(l.orderId).not.toBeNull();
    expect((await runCalls(t.deps)).queued).toBe(0);
  });
});

describe('Admin → Calls', () => {
  it('settings, stats, call detail; staff only', async () => {
    expect((await t.call('GET', '/admin/calls/settings')).status).toBe(401);
    const h = await admin();
    const s = await t.call('GET', '/admin/calls/settings', { headers: h });
    expect(s.json.settings).toMatchObject({ enabled: false, hours: { start: '10:00', end: '19:00' } });
    expect(s.json.status).toMatchObject({ connected: true, webhook: true, inHours: true });
    expect((await t.call('PUT', '/admin/calls/settings', { headers: h, body: { hours: { start: '19:00', end: '10:00', days: ['Mon'] } } })).status).toBe(400);
    expect((await t.call('PUT', '/admin/calls/settings', { headers: h, body: { cart: { enabled: true, delayMinutes: 60, discountCode: 'X10', discountOffer: '' } } })).status).toBe(400);
    await settings({ enabled: true });
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    const [c] = await allCalls();
    await webhook({ metadata: { call_id: c.id }, status: 'completed', duration: 70, variables: { call_outcome: 'will_order', discount_offered: 'true' } });
    const stats = (await t.call('GET', '/admin/calls/stats?days=30', { headers: h })).json;
    expect(stats.cart).toMatchObject({ total: 1, answered: 1, attempted: 1, answerRate: 1, outcomes: { will_order: 1 } });
    expect(stats.couponsGiven).toBe(1);
    const detail = (await t.call('GET', `/admin/calls/${c.id}`, { headers: h })).json;
    expect(detail.call).toMatchObject({ outcome: 'will_order', durationSeconds: 70 });
    expect(detail.lead).toMatchObject({ email: 'asha@example.com' });
    expect((await t.call('GET', '/admin/calls?kind=cart', { headers: h })).json.items).toHaveLength(1);
  });

  it('"Call now" says why it can\'t dial: paused, not connected, outside hours', async () => {
    const h = await admin();
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps); // queued, not dialled: all calls are paused
    const [c] = await allCalls();
    expect(c.status).toBe('queued');
    let r = await t.call('POST', `/admin/calls/${c.id}/call-now`, { headers: h });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('All calls are paused');
    let st = (await t.call('GET', '/admin/calls/settings', { headers: h })).json.status;
    expect(st.blockers.join(' ')).toContain('All calls are paused');

    await settings({ enabled: true });
    t.deps.calls = null;
    r = await t.call('POST', `/admin/calls/${c.id}/call-now`, { headers: h });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('SARVAM_API_KEY, SARVAM_ORG_ID, SARVAM_WORKSPACE_ID, SARVAM_CART_CAMPAIGN_ID, SARVAM_FEEDBACK_CAMPAIGN_ID are missing in Vercel');

    t.deps.calls = provider;
    at('2026-11-10T20:00:00+05:30');
    r = await t.call('POST', `/admin/calls/${c.id}/call-now`, { headers: h });
    expect(r.status).toBe(409);
    expect(r.json.error).toContain('outside the calling hours');
    expect((await allCalls())[0].status).toBe('queued');
    expect(provider.started).toHaveLength(0);
    // Back in hours: it goes.
    at('2026-11-11T10:30:00+05:30');
    r = await t.call('POST', `/admin/calls/${c.id}/call-now`, { headers: h });
    expect(r.json.call.status).toBe('dialling');
    st = (await t.call('GET', '/admin/calls/settings', { headers: h })).json.status;
    expect(st.blockers).toEqual([]);
  });

  it('shows when the 10-minute job last ran, and when each saved checkout joins the queue', async () => {
    const h = await admin();
    await settings({ enabled: true });
    expect((await t.call('GET', '/admin/calls/settings', { headers: h })).json.status.lastCronRun).toBeNull();
    await lead(); // left at 11:00, the default delay is 60 minutes
    let leads = (await t.call('GET', '/admin/calls/leads', { headers: h })).json;
    expect(leads.delayMinutes).toBe(60);
    expect(leads.items[0]).toMatchObject({ call: null, callDueAt: new Date('2026-11-10T12:00:00+05:30').toISOString() });
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    expect((await t.call('GET', '/admin/calls/settings', { headers: h })).json.status.lastCronRun).toBe(new Date('2026-11-10T12:05:00+05:30').toISOString());
    leads = (await t.call('GET', '/admin/calls/leads', { headers: h })).json;
    expect(leads.items[0]).toMatchObject({ call: { status: 'dialling' }, callDueAt: null });
  });

  it('a test call goes out at once (calls off, outside hours), is recorded, and nothing is acted on', async () => {
    const h = await admin();
    at('2026-11-10T21:30:00+05:30'); // outside the hours, and all calls are paused
    let r = await t.call('POST', '/admin/calls/test', { headers: h, body: { phone: '98765 43210', name: 'Asha Kumari', kind: 'cod_confirm' } });
    expect(r.status).toBe(200);
    expect(provider.started).toHaveLength(1);
    expect(provider.started[0]).toMatchObject({ kind: 'cod_confirm', phone: '+919876543210', variables: { call_purpose: 'cod_confirmation', customer_name: 'Asha', order_number: '1042' } });
    const id = r.json.call.id;
    expect(r.json.call).toMatchObject({ status: 'dialling', createdBy: 'test:owner@eldenap.in', providerCallId: 'test-1' });
    // "Don't call me" on a test call: recorded, but the number isn't added to the list.
    await webhook({ metadata: { call_id: id }, status: 'completed', duration: 40, variables: { call_outcome: 'do_not_call' }, transcript: 'agent: Namaste' });
    const [row] = await allCalls();
    expect(row).toMatchObject({ status: 'done', outcome: 'do_not_call', transcript: 'agent: Namaste' });
    expect((await t.call('GET', '/admin/calls/do-not-call', { headers: h })).json.items).toEqual([]);
    expect(t.mailer.sent).toHaveLength(0);
    // Not counted in the numbers.
    const stats = (await t.call('GET', '/admin/calls/stats?days=30', { headers: h })).json;
    expect(stats.cod.total).toBe(0);
    // Unanswered: not retried.
    r = await t.call('POST', '/admin/calls/test', { headers: h, body: { phone: '98765 43210', kind: 'cart' } });
    expect(provider.started[1].variables).toMatchObject({ call_purpose: 'cart_recovery', customer_name: 'Test' });
    await webhook({ metadata: { call_id: r.json.call.id }, status: 'no-answer' });
    expect((await allCalls()).find((x) => x.id === r.json.call.id)?.status).toBe('no_answer');
    // Sarvam refusing: shown at once.
    provider.fail = true;
    r = await t.call('POST', '/admin/calls/test', { headers: h, body: { phone: '98765 43210', kind: 'feedback' } });
    expect(r.status).toBe(502);
    expect(r.json.error).toContain('provider down');
    expect((await t.call('POST', '/admin/calls/test', { headers: h, body: { phone: '12345', kind: 'cart' } })).status).toBe(400);
  });

  it('"Call now" dials the call clicked, not an older one waiting', async () => {
    const h = await admin();
    await lead();
    await lead({ clientKey: 'browser-key-0000000002', phone: '98765 00000', email: 'b@example.com' });
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps); // both queued (paused)
    await settings({ enabled: true });
    const all = await allCalls();
    const newer = all.find((x) => x.phone === '+919876500000')!;
    await t.db.update(calls).set({ dueAt: new Date('2026-11-10T11:00:00+05:30') }).where(eq(calls.id, all.find((x) => x.id !== newer.id)!.id));
    const r = await t.call('POST', `/admin/calls/${newer.id}/call-now`, { headers: h });
    expect(r.status).toBe(200);
    expect(r.json.call).toMatchObject({ id: newer.id, status: 'dialling' });
    expect(provider.started.map((x) => x.phone)).toEqual(['+919876500000']);
  });
});

vi.setConfig({ testTimeout: 60_000 });

describe('Sarvam (outgoing campaigns)', () => {
  const CALL_ID = '6f1c1f2e-1111-4111-8111-111111111111';
  const cfg = { apiKey: 'sk-test', orgId: 'org-1', workspaceId: 'ws-1', cartCampaignId: 'Elden---Car-4ab29de8-5933', feedbackCampaignId: 'Elden---Ord-7b9b8ed1-4ddd' };
  const reply = (status: number, body: unknown) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const ok = { name: `cart-${CALL_ID}`, cohort_id: 'cart-6f1c-xyz', status: 'processing', result: null };

  it('adds the customer to the cart campaign as a one-person cohort, with our call id', async () => {
    const f = reply(200, ok);
    const r = await sarvamCalls({ ...cfg, fetch: f }).start({ callId: CALL_ID, kind: 'cart', phone: '+919876543210', variables: { customer_name: 'Asha', cart_total: 499 as unknown as string, cod_available: 'yes' } });
    expect(r).toEqual({ providerCallId: 'cart-6f1c-xyz' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://apps.sarvam.ai/api/scheduling/v1/orgs/org-1/workspaces/ws-1/campaigns/Elden---Car-4ab29de8-5933/cohorts/stream');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'X-API-Key': 'sk-test', 'Content-Type': 'application/json' });
    const body = JSON.parse(String(init?.body));
    expect(body.name).toBe(`cart-${CALL_ID}`);
    expect(body.name.length).toBeLessThanOrEqual(50);
    expect(body.users).toEqual([{ user_phone_number: '+919876543210', user_identifier: CALL_ID, app_variables: { customer_name: 'Asha', cart_total: '499', cod_available: 'yes' } }]);
  });

  it('sends feedback calls to the feedback campaign, and falls back to our id without a cohort id', async () => {
    const f = reply(200, {});
    const r = await sarvamCalls({ ...cfg, fetch: f }).start({ callId: CALL_ID, kind: 'feedback', phone: '+919876543210', variables: { customer_name: 'Asha', books_bought: 'Mathematics Today' } });
    expect(String(f.mock.calls[0][0])).toContain('/campaigns/Elden---Ord-7b9b8ed1-4ddd/cohorts/stream');
    expect(r).toEqual({ providerCallId: CALL_ID });
  });

  it('checks the connection without calling anyone: key refused, campaign running, campaign paused', async () => {
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('/campaigns/Elden---Car-4ab29de8-5933')) return new Response(JSON.stringify({ status: 'scheduled', app_version: 3, end_timestamp: '2027-02-07T13:30:00Z' }), { status: 200 });
      if (u.endsWith('/campaigns/Elden---Ord-7b9b8ed1-4ddd')) return new Response(JSON.stringify({ status: 'paused', app_version: 2 }), { status: 200 });
      return new Response('', { status: 500 });
    });
    const r = await sarvamCalls({ ...cfg, fetch: f as unknown as typeof fetch }).check!();
    expect(f.mock.calls[0][0]).toBe('https://apps.sarvam.ai/api/scheduling/v1/orgs/org-1/workspaces/ws-1/campaigns/Elden---Car-4ab29de8-5933');
    expect(r).toEqual([
      { kind: 'cart', campaignId: 'Elden---Car-4ab29de8-5933', ok: true, status: 'scheduled', agentVersion: 3, endsAt: '2027-02-07T13:30:00Z' },
      { kind: 'feedback', campaignId: 'Elden---Ord-7b9b8ed1-4ddd', ok: false, status: 'paused', agentVersion: 2, endsAt: '' },
    ]);
    const refused = await sarvamCalls({ ...cfg, fetch: reply(401, { detail: 'Invalid API key' }) }).check!();
    expect(refused[0]).toMatchObject({ ok: false, error: 'Sarvam 401: Invalid API key' });
  });

  it('Admin → Calls → Test Sarvam connection shows which key the site uses (never the key), and drops pasted quotes', async () => {
    t.deps.env.SARVAM_API_KEY = '"sk_live_abcdefgh1234"';
    t.deps.env.SARVAM_ORG_ID = 'org-1';
    t.deps.env.SARVAM_WORKSPACE_ID = 'ws-1';
    t.deps.env.SARVAM_CART_CAMPAIGN_ID = 'Elden---Car-4ab29de8-5933';
    t.deps.env.SARVAM_FEEDBACK_CAMPAIGN_ID = 'Elden---Ord-7b9b8ed1-4ddd';
    const seen: string[] = [];
    t.deps.calls = sarvamCallsFrom(t.deps.env, (async (_u: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)['X-API-Key']));
      return new Response(JSON.stringify({ status: 'active', app_version: 3 }), { status: 200 });
    }) as typeof fetch);
    const r = await t.call('GET', '/admin/calls/connection-test', { headers: await admin() });
    expect(r.json.key).toEqual({ length: 20, start: 'sk_', end: '1234' });
    expect(JSON.stringify(r.json)).not.toContain('abcdefgh');
    expect(r.json.campaigns.map((c: any) => c.ok)).toEqual([true, true]);
    expect(seen).toEqual(['sk_live_abcdefgh1234', 'sk_live_abcdefgh1234']); // sent without the quotes
  });

  it("looks a call's result up in Sarvam's analytics by our call id (when the webhook didn't arrive)", async () => {
    const urls: string[] = [];
    const f = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      urls.push(u);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (u.endsWith('/campaigns/Elden---Car-4ab29de8-5933')) return json({ app_id: 'Elden-Acade-e49b18a7-09b3', status: 'active' });
      if (u.includes('/attempts?')) return json({ items: [{ attempt_id: 'att-1', interaction_id: '20261112/abc', connectivity_status: 'connected', next_action_status: 'UNKNOWN', duration_in_seconds: 61.2, campaign_id: 'Elden---Car-4ab29de8-5933', cohort_id: 'co-1' }] });
      if (u.includes('/interactions?')) return json({ items: [{ interaction_id: '20261112/abc', duration_in_seconds: 61.2, audio_url: 'https://rec/1.mp3', agent_variables: { call_outcome: 'will_order', wants_link: true }, translate_transcript: [{ role: 'agent', text: 'Namaste' }, { role: 'user', text: 'Haan' }] }] });
      return new Response('', { status: 404 });
    });
    const p = sarvamCalls({ ...cfg, fetch: f as unknown as typeof fetch });
    const r = await p.lookup!({ callId: CALL_ID, kind: 'cod_confirm', since: new Date('2026-11-12T11:00:00Z') });
    const attemptsUrl = new URL(urls.find((u) => u.includes('/attempts?'))!);
    expect(attemptsUrl.pathname).toBe('/api/analytics/v1/org-1/ws-1/Elden-Acade-e49b18a7-09b3/attempts');
    expect(JSON.parse(attemptsUrl.searchParams.get('filter_conditions')!)).toEqual([{ field: 'user_identifier', operator: 'equals', value: CALL_ID }]);
    expect(attemptsUrl.searchParams.get('start_datetime')).toBe('2026-11-12T10:45:00+00:00');
    expect(new URL(urls.find((u) => u.includes('/interactions?'))!).searchParams.get('include_transcript')).toBe('true');
    expect(r).toMatchObject({ user_identifier: CALL_ID, connectivity_status: 'connected', duration: 61.2, recording_url: 'https://rec/1.mp3', final_agent_variables: { call_outcome: 'will_order' }, interaction_transcript: [{ role: 'agent', en_text: 'Namaste' }, { role: 'user', en_text: 'Haan' }] });
    // What the site makes of it.
    expect(callResultFrom(r)).toMatchObject({ callId: CALL_ID, status: 'answered', durationSeconds: 61, transcript: 'agent: Namaste\nuser: Haan', recordingUrl: 'https://rec/1.mp3', variables: { call_outcome: 'will_order' } });

    // Nothing yet, or Sarvam will try again: no result. Not answered and final: a result.
    const attempts = (items: unknown[]) => vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes('/attempts?') ? { items } : { app_id: 'agent-1' }), { status: 200 }));
    const look = (items: unknown[]) => sarvamCalls({ ...cfg, fetch: attempts(items) as unknown as typeof fetch }).lookup!({ callId: CALL_ID, kind: 'cart', since: new Date() });
    expect(await look([])).toBeNull();
    expect(await look([{ connectivity_status: 'no_answer', next_action_status: 'retry' }])).toBeNull();
    expect(await look([{ connectivity_status: 'no_answer', next_action_status: 'UNKNOWN' }])).toMatchObject({ connectivity_status: 'no_answer' });
  });

  it("throws with Sarvam's own message on an error", async () => {
    const start = (f: typeof fetch) => sarvamCalls({ ...cfg, fetch: f }).start({ callId: CALL_ID, kind: 'cart', phone: '+919876543210', variables: {} });
    await expect(start(reply(422, { error: { code: 'invalid_app_variables', message: 'Unknown app_variables: foo' } }))).rejects.toThrow('Sarvam 422: Unknown app_variables: foo');
    await expect(start(reply(422, { detail: [{ msg: 'field required' }] }))).rejects.toThrow('Sarvam 422: field required');
    await expect(start(reply(401, 'Invalid API key'))).rejects.toThrow('Sarvam 401: Invalid API key');
    await expect(start(reply(200, { cohort_id: 'c1', status: 'failed' }))).rejects.toThrow(/rejected/);
  });

  it('a failed start is recorded on the call and retried later', async () => {
    t.deps.calls = sarvamCalls({ ...cfg, fetch: reply(400, { error: { code: 'bad', message: 'Campaign is not active' } }) });
    await settings({ enabled: true, cart: { enabled: true, delayMinutes: 60 } });
    await lead();
    at('2026-11-10T12:05:00+05:30');
    expect(await runCalls(t.deps)).toMatchObject({ queued: 1, dialled: 0 });
    const [c] = await allCalls();
    expect(c).toMatchObject({ status: 'queued', attempts: 1 });
    expect(c.note).toContain('Campaign is not active');
  });

  it('is connected only when the key, workspace and both campaigns are set', async () => {
    const full = { ORDER_LINK_SECRET: 'x', SARVAM_API_KEY: 'k', SARVAM_ORG_ID: 'o', SARVAM_WORKSPACE_ID: 'w', SARVAM_CART_CAMPAIGN_ID: 'c', SARVAM_FEEDBACK_CAMPAIGN_ID: 'f' };
    expect(sarvamCallsFrom(loadEnv(full))?.name).toBe('sarvam');
    expect(sarvamCallsFrom(loadEnv({ ...full, SARVAM_FEEDBACK_CAMPAIGN_ID: '' }))).toBeNull();
    expect(sarvamCallsFrom(loadEnv({ ...full, SARVAM_API_KEY: undefined as unknown as string }))).toBeNull();
    t.deps.calls = sarvamCallsFrom(loadEnv(full));
    const r = await t.call('GET', '/admin/calls/settings', { headers: await admin() });
    expect(r.json.status).toMatchObject({ connected: true, provider: 'sarvam' });
  });
});
