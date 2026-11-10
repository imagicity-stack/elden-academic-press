// WhatsApp (Meta Cloud API): the client, the webhook, cart reminders, order updates, the message
// after a Sarvam call, new-books sends, the inbox and STOP.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { calls, orders, products, whatsappMessages, whatsappOptOuts } from '../server/db/schema.js';
import { hmacHex } from '../server/lib/crypto.js';
import { memoryCalls } from '../server/lib/callProvider.js';
import { memoryWhatsApp, parseWebhook, verifyWhatsAppSignature, whatsappHttp, whatsappTemplatesHttp } from '../server/lib/whatsapp.js';
import { runCalls } from '../server/services/calls.js';
import { nextDaytime, runWhatsApp, templateComponents } from '../server/services/whatsapp.js';
import { WA_TEMPLATES } from '../src/shared/whatsapp.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

const reply = (status: number, body: unknown) => vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

describe('the Cloud API client', () => {
  it('sends a template with its body variables and the button\'s path, as digits-only "to"', async () => {
    const f = reply(200, { messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] });
    const r = await whatsappHttp({ token: 'tok', phoneNumberId: '123456', fetch: f }).sendTemplate('+919876543210', 'elden_order_confirmed', 'en', ['Asha', '1042', '₹798.00 \\n  ok'], 'order/1042?t=abc');
    expect(r).toEqual({ id: 'wamid.ABC' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/123456/messages');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer tok' });
    expect(JSON.parse(String(init?.body))).toEqual({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '919876543210', type: 'template',
      template: {
        name: 'elden_order_confirmed', language: { code: 'en' },
        components: [
          { type: 'body', parameters: ['Asha', '1042', '₹798.00 \\n ok'].map((text) => ({ type: 'text', text })) },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'order/1042?t=abc' }] },
        ],
      },
    });
  });

  it("throws Meta's own message", async () => {
    const f = reply(400, { error: { message: 'Template name does not exist in the translation', code: 132001, error_data: { details: 'template name (x) does not exist in en' } } });
    await expect(whatsappHttp({ token: 't', phoneNumberId: '1', fetch: f }).sendText('+919876543210', 'hi'))
      .rejects.toThrow('WhatsApp 400 (132001): Template name does not exist in the translation: template name (x) does not exist in en');
  });

  it('creates, edits and lists templates in the WhatsApp Business Account', async () => {
    const f = reply(200, { id: '99', status: 'PENDING', category: 'UTILITY' });
    const api = whatsappTemplatesHttp({ token: 't', businessAccountId: 'waba1', fetch: f });
    const components = templateComponents(WA_TEMPLATES.find((x) => x.key === 'ebook_ready')!, 'https://eldenap.in');
    await api.create({ name: 'elden_ebook_ready', language: 'en', category: 'UTILITY', components });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v24.0/waba1/message_templates');
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({ name: 'elden_ebook_ready', language: 'en', category: 'UTILITY' });
    expect(sent.components.map((c: any) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
    expect(sent.components[3].buttons[0]).toEqual({ type: 'URL', text: 'Download my e-book', url: 'https://eldenap.in/{{1}}', example: ['https://eldenap.in/order/1042?t=abc123'] });
    await api.edit('1234', components);
    expect(f.mock.calls[1][0]).toBe('https://graph.facebook.com/v24.0/1234');
    expect(JSON.parse(String(f.mock.calls[1][1]?.body))).toEqual({ components });
    const l = reply(200, { data: [{ name: 'elden_ebook_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', rejected_reason: 'NONE' }] });
    expect(await whatsappTemplatesHttp({ token: 't', businessAccountId: 'waba1', fetch: l }).list()).toEqual([{ id: '', name: 'elden_ebook_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', rejectedReason: '', components: [] }]);
  });

  it('reads webhook deliveries and checks their signature', () => {
    const body = { entry: [{ changes: [{ field: 'messages', value: {
      contacts: [{ wa_id: '919876543210', profile: { name: 'Asha K' } }],
      messages: [{ id: 'wamid.in1', from: '919876543210', timestamp: '1794300000', type: 'text', text: { body: 'Is COD available?' } }],
      statuses: [{ id: 'wamid.out1', status: 'failed', timestamp: '1794300001', errors: [{ code: 131026, title: 'Message undeliverable' }] }],
    } }] }] };
    const p = parseWebhook(body);
    expect(p.messages).toMatchObject([{ waId: 'wamid.in1', from: '+919876543210', name: 'Asha K', text: 'Is COD available?' }]);
    expect(p.statuses).toMatchObject([{ waId: 'wamid.out1', status: 'failed', error: '131026: Message undeliverable' }]);
    const raw = JSON.stringify(body);
    expect(verifyWhatsAppSignature(raw, `sha256=${hmacHex('app-secret', raw)}`, 'app-secret')).toBe(true);
    expect(verifyWhatsAppSignature(raw, 'sha256=00', 'app-secret')).toBe(false);
  });

  it('waits for daytime in India', () => {
    expect(nextDaytime(new Date('2026-11-10T11:00:00+05:30')).toISOString()).toBe(new Date('2026-11-10T11:00:00+05:30').toISOString());
    expect(nextDaytime(new Date('2026-11-10T22:30:00+05:30')).toISOString()).toBe(new Date('2026-11-11T09:00:00+05:30').toISOString());
    expect(nextDaytime(new Date('2026-11-11T06:00:00+05:30')).toISOString()).toBe(new Date('2026-11-11T09:00:00+05:30').toISOString());
  });
});

/* ---------------- The site ---------------- */

let t: Awaited<ReturnType<typeof setup>>;
let wa: ReturnType<typeof memoryWhatsApp>;
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken({ ...OWNER, provider: 'email', aal: 'aal2' })}` });
const at = (iso: string) => t.setClock(new Date(iso));
const msgs = () => t.db.select().from(whatsappMessages);
const waSettings = async (s: Record<string, unknown>) => {
  const r = await t.call('PUT', '/admin/whatsapp/settings', { headers: await admin(), body: s });
  expect(r.status).toBe(200);
};
const hook = (body: unknown, secret = 'app-secret') => {
  const raw = JSON.stringify(body);
  return t.call('POST', '/whatsapp/webhook', { raw, headers: { 'X-Hub-Signature-256': `sha256=${hmacHex(secret, raw)}` } });
};
const incoming = (text: string, id = `wamid.in-${Math.random()}`) => hook({ entry: [{ changes: [{ value: {
  contacts: [{ wa_id: '919876543210', profile: { name: 'Asha K' } }],
  messages: [{ id, from: '919876543210', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: text } }],
} }] }] });
async function lead(consent = true) {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  return t.call('POST', '/checkout/lead', { body: { clientKey: 'browser-key-0000000001', name: 'Asha Kumari', email: 'asha@example.com', phone: '98765 43210', consent, items: [{ productId: p.id, kind: 'print', quantity: 2 }] } });
}
async function pay() {
  const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
  const o = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact, shipping: address } });
  await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(o.json.razorpay.orderId) });
  const [order] = await t.db.select().from(orders).where(eq(orders.razorpayOrderId, o.json.razorpay.orderId));
  return order;
}

beforeEach(async () => {
  t = await setup({ env: { SITE_URL: 'https://eldenap.in', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify-me', CALLS_WEBHOOK_SECRET: 'hook-secret-123' } });
  wa = memoryWhatsApp();
  t.deps.whatsapp = wa;
  at('2026-11-10T11:00:00+05:30');
});

describe('the webhook', () => {
  it('answers Meta\'s check only with the verify token', async () => {
    const ok = await t.call('GET', '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
    expect(ok).toMatchObject({ status: 200, text: '12345' });
    expect((await t.call('GET', '/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status).toBe(403);
  });

  it('refuses unsigned deliveries, stores customers\' messages once, and tracks ours to "read"', async () => {
    expect((await hook({ entry: [] }, 'wrong')).status).toBe(401);
    await incoming('Is COD available?', 'wamid.in1');
    await incoming('Is COD available?', 'wamid.in1'); // delivered twice
    expect(await msgs()).toMatchObject([{ direction: 'in', phone: '+919876543210', name: 'Asha K', body: 'Is COD available?', status: 'received' }]);
    // Reply from the inbox (inside 24 hours), then Meta reports read before delivered.
    const h = await admin();
    const r = await t.call('POST', `/admin/whatsapp/conversations/${encodeURIComponent('+919876543210')}/reply`, { headers: h, body: { text: 'Yes, cash on delivery is available.' } });
    expect(r.status).toBe(200);
    expect(wa.sent.at(-1)).toEqual({ to: '+919876543210', text: 'Yes, cash on delivery is available.' });
    const id = r.json.message.waId;
    await hook({ entry: [{ changes: [{ value: { statuses: [{ id, status: 'read', timestamp: '1' }] } }] }] });
    await hook({ entry: [{ changes: [{ value: { statuses: [{ id, status: 'delivered', timestamp: '1' }] } }] }] });
    const [mine] = (await msgs()).filter((m) => m.direction === 'out');
    expect(mine.status).toBe('read');
    // The inbox lists the conversation; opening it marks it seen.
    const list = await t.call('GET', '/admin/whatsapp/conversations', { headers: h });
    expect(list.json.items).toMatchObject([{ phone: '+919876543210', name: 'Asha K', unread: 1 }]);
    const thread = await t.call('GET', `/admin/whatsapp/conversations/${encodeURIComponent('+919876543210')}`, { headers: h });
    expect(thread.json).toMatchObject({ canReply: true, optedOut: false });
    expect(thread.json.messages).toHaveLength(2);
    expect((await t.call('GET', '/admin/whatsapp/conversations', { headers: h })).json.items[0].unread).toBe(0);
  });

  it('a reply after 24 hours is refused (only templates then)', async () => {
    await incoming('Hello');
    at('2026-11-12T11:00:00+05:30');
    const r = await t.call('POST', `/admin/whatsapp/conversations/${encodeURIComponent('+919876543210')}/reply`, { headers: await admin(), body: { text: 'Hi' } });
    expect(r.status).toBe(409);
  });

  it('STOP opts them out (with a confirmation) and drops what was waiting; START undoes it', async () => {
    await waSettings({ enabled: true, cart: true, cartDelayMinutes: 30 });
    await lead();
    at('2026-11-10T11:40:00+05:30');
    t.deps.whatsapp = null; // queued, not sent
    expect((await runWhatsApp(t.deps)).queued).toBe(1);
    t.deps.whatsapp = wa;
    await incoming('STOP');
    expect(await t.db.select().from(whatsappOptOuts)).toMatchObject([{ phone: '+919876543210' }]);
    expect(wa.sent.at(-1)?.text).toContain('Reply START');
    expect((await msgs()).find((m) => m.kind === 'cart')).toMatchObject({ status: 'skipped', error: 'Replied STOP' });
    await incoming('start');
    expect(await t.db.select().from(whatsappOptOuts)).toEqual([]);
  });
});

describe('automatic messages', () => {
  it('nothing goes out while switched off', async () => {
    await lead();
    at('2026-11-10T12:00:00+05:30');
    expect(await runWhatsApp(t.deps)).toMatchObject({ queued: 0, sent: 0, enabled: false });
    await pay();
    expect(wa.sent).toEqual([]);
  });

  it('cart reminder after the delay, in daytime, once; skipped once paid', async () => {
    await waSettings({ enabled: true, cart: true, cartDelayMinutes: 30 });
    await lead();
    at('2026-11-10T11:20:00+05:30');
    expect((await runWhatsApp(t.deps)).queued).toBe(0); // too soon
    at('2026-11-10T11:40:00+05:30');
    expect(await runWhatsApp(t.deps)).toMatchObject({ queued: 1, sent: 1 });
    expect(wa.sent[0]).toMatchObject({ to: '+919876543210', template: 'elden_cart_reminder', language: 'en' });
    expect(wa.sent[0].params).toEqual(['Asha', 'Mathematics Today x2', expect.stringMatching(/^₹/)]);
    expect(wa.sent[0].button).toMatch(/^checkout\?resume=/);
    expect((await runWhatsApp(t.deps)).queued).toBe(0);
  });

  it('a late-night checkout is reminded the next morning', async () => {
    await waSettings({ enabled: true, cart: true, cartDelayMinutes: 30 });
    at('2026-11-10T22:00:00+05:30');
    await lead();
    at('2026-11-10T22:40:00+05:30');
    expect(await runWhatsApp(t.deps)).toMatchObject({ queued: 1, sent: 0 });
    at('2026-11-11T09:05:00+05:30');
    expect((await runWhatsApp(t.deps)).sent).toBe(1);
  });

  it('order confirmed and shipped, only for buyers who ticked the box', async () => {
    await waSettings({ enabled: true, orderConfirmed: true, shipped: true });
    await lead();
    const o = await pay();
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0]).toMatchObject({ template: 'elden_order_confirmed', params: ['Asha', String(o.number), expect.stringMatching(/^₹/)], button: expect.stringMatching(new RegExp(`^order/${o.number}\\?t=`)) });
    const h = await admin();
    await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'packed' } });
    await t.call('POST', `/admin/orders/${o.id}/fulfillment`, { headers: h, body: { status: 'shipped', courier: 'India Post', trackingNumber: 'EK123456789IN', notify: true } });
    expect(wa.sent[1]).toMatchObject({ template: 'elden_order_shipped' });
    expect(wa.sent[1].params?.[2]).toBe('Courier: India Post · Tracking number: EK123456789IN');
  });

  it('no consent at checkout: no order messages', async () => {
    await waSettings({ enabled: true, orderConfirmed: true });
    await pay();
    expect(wa.sent).toEqual([]);
  });

  it('a failed send is recorded with Meta\'s reason', async () => {
    await waSettings({ enabled: true, orderConfirmed: true });
    wa.fail = 'WhatsApp 400 (132001): Template name does not exist';
    await lead();
    await pay();
    const [m] = await msgs();
    expect(m.status).toBe('failed');
    expect(m.error).toMatch(/^WhatsApp 400 \(132001\): Template name does not exist/);
  });
});

describe('after a Sarvam call', () => {
  const callHook = (body: unknown) => t.call('POST', '/calls/webhook/hook-secret-123', { body });
  async function dialledCall() {
    const h = await admin();
    await t.call('PUT', '/admin/calls/settings', { headers: h, body: { enabled: true, maxRetries: 0, cart: { enabled: true, delayMinutes: 60, discountCode: 'COMEBACK10', discountOffer: '10 percent off' } } });
    t.deps.calls = memoryCalls();
    await lead();
    at('2026-11-10T12:05:00+05:30');
    await runCalls(t.deps);
    return (await t.db.select().from(calls))[0];
  }

  it('answered: a thank-you with the link (and the coupon given on the call)', async () => {
    await waSettings({ enabled: true, callFollowup: true });
    const c = await dialledCall();
    await callHook({ metadata: { call_id: c.id }, status: 'completed', duration: 80, variables: { call_outcome: 'will_order', wants_link: true, discount_offered: true } });
    expect(wa.sent).toHaveLength(1);
    expect(wa.sent[0]).toMatchObject({ template: 'elden_call_followup' });
    expect(wa.sent[0].params?.[1]).toBe('Your cart is saved: tap the button below to finish your order. Use code *COMEBACK10* at checkout.');
    expect(wa.sent[0].button).toMatch(/^checkout\?resume=.*&coupon=COMEBACK10$/);
    // The same report again: no second message.
    await callHook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'will_order' } });
    expect(wa.sent).toHaveLength(1);
  });

  it('unanswered on the last try: "we tried to call you"', async () => {
    await waSettings({ enabled: true, callFollowup: true });
    const c = await dialledCall();
    await callHook({ metadata: { call_id: c.id }, connectivity_status: 'no_answer' });
    expect(wa.sent[0]).toMatchObject({ template: 'elden_missed_call' });
    expect(wa.sent[0].params?.[1]).toBe('the books in your cart');
  });

  it('"do not call me": no WhatsApp either', async () => {
    await waSettings({ enabled: true, callFollowup: true });
    const c = await dialledCall();
    await callHook({ metadata: { call_id: c.id }, status: 'completed', variables: { call_outcome: 'do_not_call' } });
    expect(wa.sent).toEqual([]);
  });
});

describe('new books', () => {
  it('goes to subscribers who allowed calls/WhatsApp, a test first, once each', async () => {
    const h = await admin();
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'a@example.com', phone: '9876543210', consent: true, callConsent: true } });
    await t.call('POST', '/newsletter/subscribe', { body: { email: 'b@example.com', phone: '9876500000', consent: true, callConsent: false } });
    expect((await t.call('GET', '/admin/whatsapp/new-books/audience', { headers: h })).json.count).toBe(1);
    const body = { message: 'Mathematics Today 2027 is out.', link: 'https://eldenap.in/books' };
    expect((await t.call('POST', '/admin/whatsapp/new-books', { headers: h, body })).status).toBe(409); // switched off
    await waSettings({ enabled: true });
    const test = await t.call('POST', '/admin/whatsapp/new-books', { headers: h, body: { ...body, testPhone: '9999988888' } });
    expect(test.json.queued).toBe(1);
    expect(wa.sent[0]).toMatchObject({ to: '+919999988888', template: 'elden_new_books', params: ['there', 'Mathematics Today 2027 is out.'], button: 'books' });
    // The button only opens pages on our own site.
    expect((await t.call('POST', '/admin/whatsapp/new-books', { headers: h, body: { ...body, link: 'https://example.com/x', testPhone: '9999988888' } })).status).toBe(400);
    const all = await t.call('POST', '/admin/whatsapp/new-books', { headers: h, body });
    expect(all.json.queued).toBe(1);
    expect(wa.sent[1]).toMatchObject({ to: '+919876543210' });
  });
});

describe('templates', () => {
  it('follows Meta\'s rules: no variable at the start or end, none side by side, short buttons', () => {
    for (const x of WA_TEMPLATES) {
      expect(x.text).not.toMatch(/^\{\{|\}\}$/);
      expect(x.text).not.toMatch(/\}\}\s*\{\{/);
      expect(x.text.match(/\{\{\d+\}\}/g)).toHaveLength(x.vars.length);
      expect(x.samples).toHaveLength(x.vars.length);
      expect(x.header.length).toBeLessThanOrEqual(60);
      expect(x.header).not.toMatch(/\{\{|[*_~]|\p{Extended_Pictographic}/u);
      expect(x.footer.length).toBeLessThanOrEqual(60);
      expect(x.button.label.length).toBeLessThanOrEqual(25);
      expect(x.text.length).toBeLessThanOrEqual(1024);
      expect(`${x.text} ${x.footer}`).not.toMatch(/\bstop\b/i); // no "reply STOP" lines
    }
  });

  it('updates all of them in Meta: edits the changed, creates the missing, leaves the matching', async () => {
    const created: string[] = [];
    const edited: string[] = [];
    const current = templateComponents(WA_TEMPLATES.find((x) => x.key === 'shipped')!, 'https://eldenap.in');
    t.deps.whatsappTemplates = {
      async list() {
        return [
          { id: 'tpl-1', name: 'elden_order_confirmed', language: 'en', status: 'APPROVED', category: 'UTILITY', rejectedReason: '', components: [{ type: 'BODY', text: 'old text' }] },
          { id: 'tpl-2', name: 'elden_order_shipped', language: 'en', status: 'APPROVED', category: 'UTILITY', rejectedReason: '', components: current },
        ];
      },
      async create(x) { created.push(x.name); return { id: '1', status: 'PENDING' }; },
      async edit(id) { edited.push(id); },
      async phoneNumbers() { return [{ id: 'other-number', number: '+1 555-000-0000' }]; },
      async numberInfo() { return {}; },
    };
    const h = await admin();
    const list = await t.call('GET', '/admin/whatsapp/templates', { headers: h });
    expect(list.json.items.find((x: any) => x.key === 'order_confirmed')).toMatchObject({ status: 'APPROVED', outdated: true });
    expect(list.json.items.find((x: any) => x.key === 'shipped')).toMatchObject({ status: 'APPROVED', outdated: false });
    expect(list.json.items.find((x: any) => x.key === 'cart').status).toBe('MISSING');
    expect(list.json.account.numberInAccount).toBe(false); // WHATSAPP_PHONE_NUMBER_ID isn't one of the account's numbers
    const r = await t.call('POST', '/admin/whatsapp/templates/sync', { headers: h });
    expect(r.json.results.find((x: any) => x.key === 'shipped').result).toBe('already up to date');
    expect(edited).toEqual(['tpl-1']);
    expect(created).toHaveLength(5);
  });
});

describe('template language', () => {
  it('a template approved only in en_US does not count for "en", and says so', async () => {
    t.deps.whatsappTemplates = {
      async list() { return [{ name: 'elden_new_books', language: 'en_US', status: 'APPROVED', category: 'MARKETING', rejectedReason: '' }]; },
      async create() { return { id: '1', status: 'PENDING' }; },
      async edit() {},
      async phoneNumbers() { return []; },
      async numberInfo() { return {}; },
    };
    const r = await t.call('GET', '/admin/whatsapp/templates', { headers: await admin() });
    expect(r.json.items.find((x: any) => x.key === 'new_books')).toMatchObject({ status: 'MISSING', otherLanguages: [{ language: 'en_US', status: 'APPROVED' }] });
  });

  it('a 132001 failure explains where to look', async () => {
    await waSettings({ enabled: true, orderConfirmed: true });
    wa.fail = 'WhatsApp 404 (132001): Template name does not exist in the translation';
    await lead();
    await pay();
    expect((await msgs())[0].error).toContain('Admin → WhatsApp → Settings → Templates');
  });
});

describe('diagnose', () => {
  it('reports the number the site sends from and whether it is in the templates\' account', async () => {
    t.deps.env.WHATSAPP_TOKEN = 'tok';
    t.deps.env.WHATSAPP_PHONE_NUMBER_ID = '111';
    t.deps.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '999';
    t.deps.whatsappTemplates = {
      async list() { return [{ name: 'elden_new_books', language: 'en', status: 'APPROVED', category: 'MARKETING', rejectedReason: '' }]; },
      async create() { return { id: '1', status: 'PENDING' }; },
      async edit() {},
      async phoneNumbers() { return [{ id: '222', number: '+1 555-747-5125' }]; },
      async numberInfo(id) { if (id !== '111') throw new Error('bad'); return { display_phone_number: '+91 70000 00000' }; },
    };
    const r = await t.call('GET', '/admin/whatsapp/diagnose', { headers: await admin() });
    expect(r.json.steps.map((x: any) => x.ok)).toEqual([true, true, false, false]);
    expect(r.json.steps[2].detail).toContain('111 is NOT one of them');
  });
});
