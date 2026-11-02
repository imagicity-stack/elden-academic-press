import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { accounts, campaignSends, products, settings, subscribers } from '../server/db/schema.js';
import { newsletterToken, processNewsletter, startCampaign } from '../server/services/newsletter.js';
import { address, contact, setup, supabaseToken } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof setup>>;
let t: Ctx;
beforeEach(async () => { t = await setup(); });

const SECRET = 'order-link-secret-for-tests-0123456789';
const OWNER = { sub: '11111111-1111-4111-8111-111111111111', email: 'owner@eldenap.in' };
const admin = async () => ({ Authorization: `Bearer ${await supabaseToken(OWNER)}` });
const customer = async (email = contact.email) =>
  ({ authorization: `Bearer ${await supabaseToken({ sub: '33333333-3333-4333-8333-333333333333', email, provider: 'google', name: 'Asha Verma' })}` });
const linkParams = (html: string, kind: 'confirm' | 'unsubscribe') => {
  const m = new RegExp(`/newsletter\\?${kind}=1&amp;e=([^&]+)&amp;t=([^"&]+)`).exec(html) ?? new RegExp(`/newsletter\\?${kind}=1&e=([^&]+)&t=([^"&\\s)]+)`).exec(html);
  return m ? { email: decodeURIComponent(m[1]), token: m[2] } : null;
};
const status = async (email: string) => (await t.db.select().from(subscribers).where(eq(subscribers.email, email)))[0]?.status;
async function addSubscribers(emails: string[]) {
  for (const email of emails) {
    expect((await t.call('POST', '/admin/newsletter/subscribers', { headers: await admin(), body: { email, consent: true } })).status).toBe(201);
  }
}

describe('newsletter sign-up', () => {
  it('subscribes from the form when the box is ticked, with a welcome email instead of a confirmation', async () => {
    const noPhone = await t.call('POST', '/newsletter/subscribe', { body: { email: 'reader@example.com', consent: true } });
    expect(noPhone.status).toBe(400);
    const noTick = await t.call('POST', '/newsletter/subscribe', { body: { email: 'reader@example.com', phone: '9876543210' } });
    expect(noTick.status).toBe(400);
    expect(noTick.json.details.consent[0]).toMatch(/Tick the box/);

    const r = await t.call('POST', '/newsletter/subscribe', { body: { email: 'Reader@Example.com', phone: '+91 98765-43210', name: 'Ravi', consent: true } });
    expect(r.json).toEqual({ status: 'subscribed' });
    const [row] = await t.db.select().from(subscribers).where(eq(subscribers.email, 'reader@example.com'));
    expect(row).toMatchObject({ status: 'subscribed', phone: '9876543210', source: 'footer' });
    expect(row.consentAt).not.toBeNull();

    const mails = t.mailer.sent.filter((m) => m.to === 'reader@example.com');
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toMatch(/subscribed/i);
    expect(mails[0].subject).not.toMatch(/confirm/i);
    expect(mails[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(linkParams(mails[0].html, 'unsubscribe')?.email).toBe('reader@example.com');

    // Signing up again: no second welcome.
    expect((await t.call('POST', '/newsletter/subscribe', { body: { email: 'reader@example.com', phone: '9876543210', consent: true } })).json).toEqual({ status: 'already' });
    expect(t.mailer.sent.filter((m) => m.to === 'reader@example.com')).toHaveLength(1);
  });

  it('still honours confirmation links sent before', async () => {
    await t.db.insert(subscribers).values({ email: 'old@example.com', status: 'pending', source: 'footer' });
    const token = newsletterToken(SECRET, 'old@example.com');
    expect((await t.call('POST', '/newsletter/confirm', { body: { email: 'old@example.com', token: 'forged' } })).status).toBe(400);
    expect((await t.call('POST', '/newsletter/confirm', { body: { email: 'old@example.com', token } })).status).toBe(200);
    expect(await status('old@example.com')).toBe('subscribed');
  });

  it('ignores bots that fill in the hidden field', async () => {
    const r = await t.call('POST', '/newsletter/subscribe', { body: { email: 'bot@example.com', phone: '9876543210', consent: true, website: 'spam' } });
    expect(r.status).toBe(400);
    expect(await status('bot@example.com')).toBeUndefined();
  });

  it('unsubscribes from the page link and the one-click header', async () => {
    await addSubscribers(['a@example.com', 'b@example.com']);
    const token = newsletterToken(SECRET, 'a@example.com');
    expect((await t.call('POST', '/newsletter/unsubscribe', { body: { email: 'a@example.com', token: 'nope' } })).status).toBe(400);
    expect((await t.call('POST', '/newsletter/unsubscribe', { body: { email: 'a@example.com', token } })).status).toBe(200);
    expect(await status('a@example.com')).toBe('unsubscribed');

    // RFC 8058: the mail app POSTs "List-Unsubscribe=One-Click" to the URL from the header.
    const b = newsletterToken(SECRET, 'b@example.com');
    const res = await t.app.request(`/api/newsletter/unsubscribe?e=${encodeURIComponent('b@example.com')}&t=${b}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
    });
    expect(res.status).toBe(200);
    expect(await status('b@example.com')).toBe('unsubscribed');
  });

  it('never lets staff re-add someone who unsubscribed', async () => {
    await addSubscribers(['gone@example.com']);
    await t.call('POST', '/newsletter/unsubscribe', { body: { email: 'gone@example.com', token: newsletterToken(SECRET, 'gone@example.com') } });
    const [row] = await t.db.select().from(subscribers).where(eq(subscribers.email, 'gone@example.com'));
    const put = await t.call('PUT', `/admin/newsletter/subscribers/${row.id}`, { headers: await admin(), body: { name: '', phone: '', status: 'subscribed' } });
    expect(put.status).toBe(400);
    const imp = await t.call('POST', '/admin/newsletter/subscribers/import', { headers: await admin(), body: { csv: 'Email,Name,Mobile\ngone@example.com,Gone,\nnew@example.com,New One,9876543210\nnot-an-email,,', consent: true } });
    expect(imp.json).toEqual({ added: 1, skipped: 1, invalid: 1 });
    expect(await status('gone@example.com')).toBe('unsubscribed');
    expect(await status('new@example.com')).toBe('subscribed');
    expect((await t.call('POST', '/admin/newsletter/subscribers', { headers: await admin(), body: { email: 'x@example.com' } })).status).toBe(400);
  });
});

describe('accounts and checkout', () => {
  it('signs new accounts up for the newsletter, with a welcome email, and remembers their choices', async () => {
    const h = await customer();
    const first = await t.call('GET', '/account', { headers: h });
    expect(first.json).toMatchObject({ profile: { phone: '' }, newsletter: 'subscribed' });
    const [joined] = await t.db.select().from(subscribers).where(eq(subscribers.email, contact.email));
    expect(joined).toMatchObject({ status: 'subscribed', source: 'signup', name: 'Asha Verma' });
    const welcome = t.mailer.sent.filter((m) => m.to === contact.email && /Welcome/.test(m.subject));
    expect(welcome).toHaveLength(1);
    expect(welcome[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(linkParams(welcome[0].html, 'unsubscribe')?.email).toBe(contact.email);
    expect(t.mailer.sent.some((m) => /confirm/i.test(m.subject))).toBe(false);

    // Coming back is not a new sign-up.
    await t.call('GET', '/account', { headers: h });
    expect(t.mailer.sent.filter((m) => /Welcome/.test(m.subject))).toHaveLength(1);

    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '12345' } })).status).toBe(400);
    expect((await t.call('PUT', '/account/profile', { headers: h, body: { phone: '098765 43210' } })).json).toEqual({ phone: '9876543210' });
    expect((await t.db.select().from(subscribers).where(eq(subscribers.email, contact.email)))[0].phone).toBe('9876543210');

    await t.call('PUT', '/account/newsletter', { headers: h, body: { subscribed: false } });
    expect(await status(contact.email)).toBe('unsubscribed');
    expect((await t.call('GET', '/account', { headers: h })).json).toMatchObject({ profile: { phone: '9876543210' }, newsletter: 'unsubscribed' });
    const on = await t.call('PUT', '/account/newsletter', { headers: h, body: { subscribed: true } });
    expect(on.json.newsletter).toBe('subscribed');
    expect((await t.db.select().from(subscribers).where(eq(subscribers.email, contact.email)))[0].source).toBe('account');
    await t.call('PUT', '/account/newsletter', { headers: h, body: { subscribed: false } });

    const list = await t.call('GET', '/admin/newsletter/accounts', { headers: await admin() });
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0]).toMatchObject({ email: contact.email, phone: '9876543210', newsletter: 'unsubscribed' });
    expect((await t.db.select().from(accounts)).length).toBe(1);
  });

  it('never re-adds someone who unsubscribed, and leaves older accounts alone', async () => {
    await addSubscribers([contact.email]);
    await t.call('POST', '/newsletter/unsubscribe', { body: { email: contact.email, token: newsletterToken(SECRET, contact.email) } });
    t.mailer.sent.length = 0;
    expect((await t.call('GET', '/account', { headers: await customer() })).json.newsletter).toBe('unsubscribed');
    expect(t.mailer.sent).toHaveLength(0);

    // Signed up last month, first visit to the account page today: not a new sign-up.
    t.deps.authUser = async (id) => ({ id, email: 'old@example.com', name: 'Old Timer', avatar: null, providers: ['google'], createdAt: new Date(Date.now() - 30 * 86400_000), lastSignInAt: null });
    const old = { authorization: `Bearer ${await supabaseToken({ sub: '66666666-6666-4666-8666-666666666666', email: 'old@example.com', provider: 'google', name: 'Old Timer' })}` };
    expect((await t.call('GET', '/account', { headers: old })).json.newsletter).toBeNull();
    expect(t.mailer.sent).toHaveLength(0);
  });

  it('subscribes buyers who ticked the box, once they have paid', async () => {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const buy = async (email: string, newsletter?: boolean) => {
      const r = await t.call('POST', '/checkout', { body: { items: [{ productId: p.id, kind: 'print', quantity: 1 }], contact: { ...contact, email }, shipping: address, newsletter } });
      expect(r.status).toBe(201);
      return r.json.razorpay.orderId as string;
    };
    const unpaid = await buy('unpaid@example.com', true);
    expect(await status('unpaid@example.com')).toBeUndefined();
    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(unpaid) });
    expect(await status('unpaid@example.com')).toBe('subscribed');

    await t.call('POST', '/checkout/verify', { body: t.razorpay.simulatePayment(await buy('no@example.com')) });
    expect(await status('no@example.com')).toBeUndefined();
  });
});

describe('campaigns', () => {
  async function campaign(extra: Record<string, unknown> = {}) {
    const r = await t.call('POST', '/admin/newsletter/campaigns', { headers: await admin(), body: { subject: 'New books for 2027', heading: 'Fresh off the press', body: 'Hello **readers**.\n\nSee [the store](https://eldenap.in/catalogue).', ...extra } });
    expect(r.status).toBe(201);
    return r.json.id as string;
  }

  it('previews, tests and sends only to confirmed subscribers, with unsubscribe headers', async () => {
    await addSubscribers(['one@example.com', 'two@example.com']);
    await t.db.insert(subscribers).values({ email: 'pending@example.com', status: 'pending', source: 'footer' });
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const id = await campaign({ productIds: [p.id] });

    const preview = await t.call('POST', '/admin/newsletter/campaigns/preview', { headers: await admin(), body: { subject: '', body: 'Draft **text**', productIds: [p.id] } });
    expect(preview.json.html).toMatch(/<strong[^>]*>text<\/strong>/);
    expect(preview.json.html).toContain('Mathematics Today');

    t.mailer.sent.length = 0;
    const test = await t.call('POST', `/admin/newsletter/campaigns/${id}/test`, { headers: await admin(), body: {} });
    expect(test.json.to).toBe(OWNER.email);
    expect(t.mailer.sent[0].subject).toBe('[Test] New books for 2027');

    t.mailer.sent.length = 0;
    const send = await t.call('POST', `/admin/newsletter/campaigns/${id}/send`, { headers: await admin() });
    expect(send.status).toBe(200);
    expect(send.json.recipients).toBe(2);
    const to = t.mailer.sent.map((m) => m.to).sort();
    expect(to).toEqual(['one@example.com', 'two@example.com']);
    const mail = t.mailer.sent[0];
    expect(mail.headers?.['List-Unsubscribe']).toMatch(/^<https:\/\/eldenap\.in\/api\/newsletter\/unsubscribe\?e=/);
    expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(mail.html).toMatch(/<strong[^>]*>readers<\/strong>/);
    expect(mail.html).toContain('href="https://eldenap.in/catalogue"');
    expect(linkParams(mail.html, 'unsubscribe')?.email).toBe(mail.to);

    const done = await t.call('GET', `/admin/newsletter/campaigns/${id}`, { headers: await admin() });
    expect(done.json).toMatchObject({ status: 'sent', sentCount: 2, failedCount: 0 });
    expect((await t.call('PUT', `/admin/newsletter/campaigns/${id}`, { headers: await admin(), body: { subject: 'Changed' } })).status).toBe(409);
    expect((await t.call('POST', `/admin/newsletter/campaigns/${id}/send`, { headers: await admin() })).status).toBe(409);
  });

  it('keeps to the daily limit and skips people who unsubscribe mid-send', async () => {
    await t.db.update(settings).set({ newsletterDailyLimit: 3 });
    await addSubscribers(['s1@example.com', 's2@example.com', 's3@example.com', 's4@example.com', 's5@example.com']);
    const id = await campaign();
    // Queue it without sending a batch yet (the send endpoint also sends the first batch).
    expect((await startCampaign(t.deps, id))?.recipients).toBe(5);
    await t.call('POST', '/newsletter/unsubscribe', { body: { email: 's2@example.com', token: newsletterToken(SECRET, 's2@example.com') } });

    t.mailer.sent.length = 0;
    const first = await processNewsletter(t.deps);
    expect(first).toMatchObject({ sent: 3, budgetLeft: 0 });
    expect(t.mailer.sent.map((m) => m.to)).not.toContain('s2@example.com');
    expect((await processNewsletter(t.deps)).sent).toBe(0);

    // A day later the rest go out.
    t.setClock(new Date(Date.now() + 86400_000 + 60_000));
    expect((await processNewsletter(t.deps)).sent).toBe(1);
    const sends = await t.db.select().from(campaignSends);
    expect(sends.filter((s) => s.status === 'skipped')).toHaveLength(1);
    const done = await t.call('GET', `/admin/newsletter/campaigns/${id}`, { headers: await admin() });
    expect(done.json).toMatchObject({ status: 'sent', recipients: 5, sentCount: 4 });
  });

  it('starts scheduled campaigns when they are due, from the cron', async () => {
    await addSubscribers(['due@example.com']);
    const id = await campaign();
    const at = new Date(Date.now() + 3600_000).toISOString();
    expect((await t.call('POST', `/admin/newsletter/campaigns/${id}/schedule`, { headers: await admin(), body: { at } })).json.status).toBe('scheduled');
    const cron = { Authorization: 'Bearer cron-secret' };
    expect((await t.call('GET', '/cron/newsletter', { headers: cron })).json.sent).toBe(0);
    t.setClock(new Date(Date.now() + 2 * 3600_000));
    expect((await t.call('GET', '/cron/newsletter', { headers: cron })).json.sent).toBe(1);
    expect((await t.call('GET', '/cron/newsletter')).status).toBe(401);
  });

  it('adds older sign-ups that never confirmed by email to the list, when staff choose to', async () => {
    await t.db.insert(subscribers).values([
      { email: 'old1@example.com', status: 'pending', source: 'footer', createdAt: new Date('2026-09-01') },
      { email: 'old2@example.com', status: 'pending', source: 'footer' },
      { email: 'left@example.com', status: 'unsubscribed', source: 'footer' },
    ]);
    const h = await admin();
    expect((await t.call('GET', '/admin/newsletter/summary', { headers: h })).json).toMatchObject({ pending: 2, unsubscribed: 1 });
    const r = await t.call('POST', '/admin/newsletter/subscribers/add-unconfirmed', { headers: h });
    expect(r.json).toEqual({ added: 2 });
    const [old] = await t.db.select().from(subscribers).where(eq(subscribers.email, 'old1@example.com'));
    expect(old).toMatchObject({ status: 'subscribed' });
    expect(old.consentAt?.toISOString()).toBe(new Date('2026-09-01').toISOString());
    expect(await status('left@example.com')).toBe('unsubscribed'); // people who left stay out
    expect((await t.call('GET', '/admin/newsletter/summary', { headers: h })).json).toMatchObject({ pending: 0, subscribed: 2 });
  });

  it('drafts an announcement from a product', async () => {
    const [p] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const r = await t.call('POST', `/admin/newsletter/campaigns/from-product/${p.id}`, { headers: await admin() });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ heading: 'Just published: Mathematics Today', productIds: [p.id], status: 'draft' });
    expect(r.json.ctaUrl).toBe('https://eldenap.in/books/mathematics-today');
  });

  it('lists everyone who signed in with Google, from Supabase, but not staff logins', async () => {
    const h = await customer();
    await t.call('GET', '/account', { headers: h });
    await t.call('PUT', '/account/profile', { headers: h, body: { phone: '9876543210' } });
    t.deps.authUsers = async () => [
      { id: '33333333-3333-4333-8333-333333333333', email: contact.email, name: 'Asha Verma', avatar: null, providers: ['google'], createdAt: new Date('2026-10-01'), lastSignInAt: new Date('2026-10-02') },
      { id: '44444444-4444-4444-8444-444444444444', email: 'neha@example.com', name: 'Neha Gupta', avatar: 'https://lh3.googleusercontent.com/n', providers: ['google'], createdAt: new Date('2026-10-05'), lastSignInAt: null },
      { id: '55555555-5555-4555-8555-555555555555', email: 'owner@eldenap.in', name: '', avatar: null, providers: ['email'], createdAt: new Date('2026-09-01'), lastSignInAt: new Date() },
    ];
    const [summary, list] = await Promise.all([
      t.call('GET', '/admin/newsletter/summary', { headers: await admin() }),
      t.call('GET', '/admin/newsletter/accounts', { headers: await admin() }),
    ]);
    expect(summary.json.accounts).toBe(2);
    expect(list.json.items.map((a: any) => a.email).sort()).toEqual([contact.email, 'neha@example.com']);
    // Accounts that aren't on the list are counted, so the send dialog can say who is left out.
    expect(summary.json.accountsNotSubscribed).toBe(list.json.items.filter((a: any) => a.newsletter !== 'subscribed').length);
    expect(summary.json.accountsNotSubscribed).toBeGreaterThan(0);
    const asha = list.json.items.find((a: any) => a.email === contact.email);
    expect(asha.phone).toBe('9876543210'); // what the customer added is kept
    expect(list.json.items.find((a: any) => a.email === 'neha@example.com')).toMatchObject({ name: 'Neha Gupta', phone: '', newsletter: null });
  });
});

