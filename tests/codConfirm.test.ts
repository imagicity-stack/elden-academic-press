// Cash-on-delivery confirmation calls: every COD order is called (by the cart agent) to confirm
// it before it's shipped. Yes confirms it; no flags it and emails the owner to cancel it by hand,
// keeping the advance; no answer, or no clear answer, flags it and emails too. The team can
// confirm it by hand at any time, which stops the call.
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { calls, orderEvents, orders, products, refunds } from '../server/db/schema.js';
import { memoryCalls, sarvamCalls } from '../server/lib/callProvider.js';
import { memoryWhatsApp } from '../server/lib/whatsapp.js';
import { runCalls } from '../server/services/calls.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let provider: ReturnType<typeof memoryCalls>;
// Tuesday 10 November 2026, 11:00 in India: inside the default calling hours.
const TUE_11 = new Date('2026-11-10T11:00:00+05:30');
const at = (iso: string) => t.setClock(new Date(iso));
beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in', CALLS_WEBHOOK_SECRET: 'hook-secret-123', MAIL_TO: 'owner@eldenap.in' } });
  provider = memoryCalls();
  t.deps.calls = provider;
  t.setClock(TUE_11);
});

const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const webhook = (body: unknown) => t.call('POST', '/calls/webhook/hook-secret-123', { body });
const callsOn = () => t.db.select().from(calls);
const order = async (id: string) => (await t.db.select().from(orders).where(eq(orders.id, id)))[0];
const ownerMails = () => t.mailer.sent.filter((m) => [m.to].flat().includes('owner@eldenap.in'));

async function switchOn(extra: Record<string, unknown> = {}) {
  const r = await t.call('PUT', '/admin/calls/settings', { headers: await admin(), body: { enabled: true, ...extra } });
  expect(r.status).toBe(200);
}

/** A paid COD order (two printed copies): the advance online, the rest in cash. */
async function codOrder(mode: 'cod' | 'online' = 'cod') {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 2 }], contact, shipping: address, paymentMode: mode } });
  expect(r.status).toBe(201);
  const v = await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(r.json.razorpay.orderId) });
  expect(v.json.paymentStatus).toBe('paid');
  return order(r.json.orderId);
}

/** The order's confirmation call, dialled. */
async function dialled() {
  await switchOn();
  const o = await codOrder();
  at('2026-11-10T11:15:00+05:30');
  await runCalls(t.deps);
  const [c] = await callsOn();
  expect(c).toMatchObject({ kind: 'cod_confirm', status: 'dialling', orderId: o.id });
  return { o, c };
}

describe('COD confirmation calls', () => {
  it('queues a call when a COD order is paid, and the cart agent asks about that order', async () => {
    await switchOn();
    const o = await codOrder();
    expect(o.codConfirmation).toBe('pending');
    const [c] = await callsOn();
    expect(c).toMatchObject({ kind: 'cod_confirm', status: 'queued', phone: '+919876543210', orderId: o.id });
    expect(c.dueAt.getTime()).toBe(TUE_11.getTime() + 10 * 60_000); // the default 10 minutes
    expect(c.variables).toMatchObject({ call_purpose: 'cod_confirmation', customer_name: contact.name.split(' ')[0], order_number: String(o.number), order_items: 'Mathematics Today, 2 copies' });
    expect(c.variables.cash_due).toMatch(/^[\d,.]+ rupees$/);
    expect(c.variables.advance_paid).toMatch(/^60(\.00)? rupees$/);

    expect((await runCalls(t.deps)).dialled).toBe(0); // not yet due
    at('2026-11-10T11:11:00+05:30');
    expect((await runCalls(t.deps)).dialled).toBe(1);
    expect(provider.started[0]).toMatchObject({ kind: 'cod_confirm', phone: '+919876543210', variables: { call_purpose: 'cod_confirmation' } });
  });

  it('online orders are not called', async () => {
    await switchOn();
    const o = await codOrder('online');
    expect(o.codConfirmation).toBe('');
    expect(await callsOn()).toHaveLength(0);
  });

  it('"yes" confirms the order (no email to the owner) and sends nothing else', async () => {
    const { o, c } = await dialled();
    t.mailer.sent.length = 0;
    const r = await webhook({ metadata: { call_id: c.id }, status: 'completed', duration: 64, variables: { order_confirmation: 'confirmed', call_outcome: 'will_order' }, transcript: 'agent: Namaste\nuser: Haan, confirm hai' });
    expect(r.json).toEqual({ ok: true, matched: true });
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'confirmed', codConfirmedBy: 'call', needsAttention: false });
    expect((await callsOn())[0]).toMatchObject({ status: 'done', outcome: 'order_confirmed', transcript: 'agent: Namaste\nuser: Haan, confirm hai' });
    const ev = await t.db.select().from(orderEvents).where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.type, 'cod_confirmed')));
    expect(ev).toHaveLength(1);
    expect(ownerMails()).toHaveLength(0);
    // The same report again changes nothing.
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { order_confirmation: 'confirmed' } });
    expect(await t.db.select().from(orderEvents).where(and(eq(orderEvents.orderId, o.id), eq(orderEvents.type, 'cod_confirmed')))).toHaveLength(1);
  });

  it('"no" flags the order and emails the owner the reason and transcript; the owner cancels it, keeping the advance', async () => {
    const { o, c } = await dialled();
    t.mailer.sent.length = 0;
    await webhook({
      metadata: { call_id: c.id }, status: 'completed', duration: 80, recording_url: 'https://rec.example/1.mp3',
      // The agent records a cart outcome too ("not interested"): ignored for confirmation calls.
      variables: { order_confirmation: 'cancel_requested', cancel_reason: 'Ordered by mistake', advance_refund_told: true, call_outcome: 'not_interested' },
      transcript: 'agent: Kya aap order confirm karna chahenge?\nuser: Nahi, galti se ho gaya',
    });
    const flagged = await order(o.id);
    expect(flagged).toMatchObject({ codConfirmation: 'cancel_requested', needsAttention: true, cancelledAt: null });
    expect(flagged.attentionReason).toContain('Ordered by mistake');
    expect((await callsOn())[0].outcome).toBe('cancel_requested');

    const [mail] = ownerMails();
    expect(mail.subject).toBe(`Customer said no: COD order #${o.number} (cancel it)`);
    expect(mail.html).toContain('Ordered by mistake');
    expect(mail.html).toContain('galti se ho gaya'); // the transcript
    expect(mail.html).toContain(`https://eldenap.in/admin/orders/${o.id}`);
    expect(mail.html).toContain('https://rec.example/1.mp3');
    expect(mail.html).toMatch(/Told the advance isn.t refunded[\s\S]*Yes/);
    // Nothing goes to the customer yet.
    expect(t.mailer.sent.filter((m) => m.to === contact.email)).toHaveLength(0);

    // The owner cancels it by hand: nothing refunded, the customer told the advance is kept.
    t.mailer.sent.length = 0;
    const h = await admin();
    expect((await t.call('POST', `/admin/orders/${o.id}/cancel-cod`, { headers: h, body: { reason: '' } })).status).toBe(400); // a reason is required
    const r = await t.call('POST', `/admin/orders/${o.id}/cancel-cod`, { headers: h, body: { reason: 'Customer said no on the confirmation call: Ordered by mistake' } });
    expect(r.status).toBe(200);
    const done = await order(o.id);
    expect(done).toMatchObject({ refundedAmount: 0, paymentStatus: 'paid', needsAttention: false, cancelReason: 'Customer said no on the confirmation call: Ordered by mistake' });
    expect(done.cancelledAt).toBeTruthy();
    expect(await t.db.select().from(refunds)).toHaveLength(0);
    const toCustomer = t.mailer.sent.find((m) => m.to === contact.email)!;
    expect(toCustomer.subject).toBe(`Your order #${o.number} has been cancelled`);
    expect(toCustomer.html).toContain('non-refundable');
    // It can't be cancelled twice, or shipped.
    expect((await t.call('POST', `/admin/orders/${o.id}/cancel-cod`, { headers: h, body: { reason: 'again' } })).status).toBe(409);
    expect((await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'packed' } })).status).toBe(409);
  });

  it('no answer after every try flags the order and emails the owner once', async () => {
    const { o, c } = await dialled();
    t.mailer.sent.length = 0;
    await webhook({ metadata: { call_id: c.id }, status: 'no-answer' });
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'pending', needsAttention: false });
    at('2026-11-10T13:20:00+05:30');
    await runCalls(t.deps);
    await webhook({ metadata: { call_id: c.id }, status: 'busy' });
    at('2026-11-10T15:30:00+05:30');
    await runCalls(t.deps);
    expect(provider.started).toHaveLength(3);
    await webhook({ metadata: { call_id: c.id }, status: 'no-answer' });
    expect((await callsOn())[0].status).toBe('no_answer');
    const flagged = await order(o.id);
    expect(flagged).toMatchObject({ codConfirmation: 'unreachable', needsAttention: true });
    const mails = ownerMails();
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(`COD order #${o.number} not confirmed: no answer`);

    // The owner has the agent call again: the order waits for it, and it's dialled.
    const r = await t.call('POST', `/admin/orders/${o.id}/cod-confirmation`, { headers: await admin(), body: { action: 'call' } });
    expect(r.status).toBe(200);
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'pending', needsAttention: false });
    expect((await callsOn())[0]).toMatchObject({ status: 'dialling', attempts: 1 });
    expect(provider.started).toHaveLength(4);
  });

  it('no clear answer flags the order and emails the owner; "call me later" just calls again', async () => {
    const { o, c } = await dialled();
    t.mailer.sent.length = 0;
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { order_confirmation: 'unclear', call_outcome: 'callback', callback_time: 'evening' } });
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'pending', needsAttention: false });
    expect((await callsOn())[0]).toMatchObject({ status: 'queued', outcome: 'callback' });
    expect(ownerMails()).toHaveLength(0);

    at('2026-11-11T10:30:00+05:30');
    await runCalls(t.deps);
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { order_confirmation: 'unclear' }, transcript: 'user: hello? hello?' });
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'unclear', needsAttention: true });
    const [mail] = ownerMails();
    expect(mail.subject).toBe(`COD order #${o.number} not confirmed on the call`);
    expect(mail.html).toContain('hello? hello?');
  });

  it('confirming by hand stops the call; packing an unconfirmed order confirms it', async () => {
    await switchOn();
    const o = await codOrder();
    const h = await admin();
    const r = await t.call('POST', `/admin/orders/${o.id}/cod-confirmation`, { headers: h, body: { action: 'confirm' } });
    expect(r.status).toBe(200);
    expect(r.json.order).toMatchObject({ codConfirmation: 'confirmed', codConfirmedBy: 'owner@eldenap.in' });
    expect((await callsOn())[0]).toMatchObject({ status: 'cancelled', note: 'Order confirmed by owner@eldenap.in' });
    at('2026-11-10T11:30:00+05:30');
    expect((await runCalls(t.deps)).dialled).toBe(0);
    expect(provider.started).toHaveLength(0);

    // A second order, packed without confirming: confirmed, and its call stops.
    const o2 = await codOrder();
    expect((await t.call('POST', `/admin/orders/${o2.id}/fulfillment`, { headers: h, body: { status: 'packed' } })).status).toBe(200);
    expect(await order(o2.id)).toMatchObject({ codConfirmation: 'confirmed', codConfirmedBy: 'owner@eldenap.in' });
    expect((await t.db.select().from(calls).where(eq(calls.orderId, o2.id)))[0].status).toBe('cancelled');
  });

  it('a call already queued is skipped if the order was confirmed or cancelled meanwhile', async () => {
    await switchOn();
    const o = await codOrder();
    // Confirmed directly in the database (as if by another tab), the call still queued.
    await t.db.update(orders).set({ codConfirmation: 'confirmed', codConfirmedBy: 'staff@eldenap.in' }).where(eq(orders.id, o.id));
    at('2026-11-10T11:15:00+05:30');
    await runCalls(t.deps);
    expect((await callsOn())[0]).toMatchObject({ status: 'skipped', note: 'Already confirmed by staff@eldenap.in' });
    expect(provider.started).toHaveLength(0);
  });

  it('a number on the do-not-call list is never called: the owner is emailed to confirm by hand', async () => {
    await switchOn();
    const h = await admin();
    expect((await t.call('POST', '/admin/calls/do-not-call', { headers: h, body: { phone: contact.phone, reason: 'asked' } })).status).toBe(200);
    t.mailer.sent.length = 0;
    const o = await codOrder();
    expect((await callsOn())[0]).toMatchObject({ kind: 'cod_confirm', status: 'skipped' });
    expect(await order(o.id)).toMatchObject({ codConfirmation: 'pending', needsAttention: true });
    expect(ownerMails().map((m) => m.subject)).toContain(`COD order #${o.number} can’t be confirmed by a call`);
  });

  it('with the confirmation calls off, the order waits for the team and nothing is dialled', async () => {
    await switchOn({ cod_confirm: { enabled: false } });
    const o = await codOrder();
    expect(o.codConfirmation).toBe('pending');
    expect(await callsOn()).toHaveLength(0);
    // Switched on later: a recent order still waiting is picked up.
    await switchOn({ cod_confirm: { enabled: true } });
    at('2026-11-10T11:30:00+05:30');
    expect(await runCalls(t.deps)).toMatchObject({ queued: 1 });
  });

  it('WhatsApp (with the checkout tick): "confirmed" after a yes, nothing after a no', async () => {
    const wa = memoryWhatsApp();
    t.deps.whatsapp = wa;
    expect((await t.call('PUT', '/admin/whatsapp/settings', { headers: await admin(), body: { enabled: true, callFollowup: true } })).status).toBe(200);
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    await t.call('POST', '/checkout/lead', { body: { clientKey: 'browser-key-0000000001', ...contact, consent: true, items: [{ productId: p.id, kind: 'print', quantity: 2 }] } });
    const { o, c } = await dialled();
    await webhook({ metadata: { call_id: c.id }, status: 'completed', variables: { order_confirmation: 'confirmed' } });
    const sent = wa.sent.filter((m) => m.template === 'elden_call_followup');
    expect(sent).toHaveLength(1);
    expect(sent[0].params?.[1]).toContain(`*#${o.number}* is confirmed`);
    expect(sent[0].button).toMatch(new RegExp(`^order/${o.number}\\?t=`));

    const o2 = await codOrder();
    at('2026-11-10T11:30:00+05:30');
    await runCalls(t.deps);
    const [c2] = await t.db.select().from(calls).where(eq(calls.orderId, o2.id));
    await webhook({ metadata: { call_id: c2.id }, status: 'completed', variables: { order_confirmation: 'cancel_requested', cancel_reason: 'changed my mind' } });
    expect(wa.sent.filter((m) => m.template === 'elden_call_followup')).toHaveLength(1);
  });

  it('Sarvam: the confirmation call goes through the cart campaign', async () => {
    const urls: string[] = [];
    const p = sarvamCalls({
      apiKey: 'k', orgId: 'org', workspaceId: 'ws', cartCampaignId: 'cart-camp', feedbackCampaignId: 'fb-camp',
      fetch: (async (url: string) => { urls.push(String(url)); return new Response(JSON.stringify({ cohort_id: 'c1' }), { status: 200 }); }) as unknown as typeof fetch,
    });
    await p.start({ callId: '00000000-0000-4000-8000-000000000001', kind: 'cod_confirm', phone: '+919876543210', variables: { call_purpose: 'cod_confirmation' } });
    await p.start({ callId: '00000000-0000-4000-8000-000000000002', kind: 'feedback', phone: '+919876543210', variables: {} });
    expect(urls[0]).toContain('/campaigns/cart-camp/');
    expect(urls[1]).toContain('/campaigns/fb-camp/');
  });
});
