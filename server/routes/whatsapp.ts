// WhatsApp: Meta's webhook (incoming messages, and delivery / read / failure of ours) and
// Admin → WhatsApp (inbox, replies, new-books sends, settings). The rules are in services/whatsapp.ts.
import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { whatsappMessages, whatsappOptOuts } from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { body, HttpError, notFound } from '../lib/http.js';
import { verifyWhatsAppSignature } from '../lib/whatsapp.js';
import { audit } from './admin/auth.js';
import {
  canReply, getWhatsAppSettings, needsUpdate, syncTemplates, isOptedOut, lastIncoming, newBooksAudience, processWhatsApp, queueNewBooks, recordWebhook, retryFailed, saveWhatsAppSettings, sendReply, testTemplate, whatsappStats,
} from '../services/whatsapp.js';
import { callableNumber } from '../../src/shared/calls.js';
import { DEFAULT_WA_SETTINGS, WA_REPLY_WINDOW_MS, WA_TEMPLATES, type WaTemplateKey, type WhatsAppSettings } from '../../src/shared/whatsapp.js';

/* ---------------- Meta's webhook ---------------- */

export const publicWhatsApp = new Hono<AppEnv>();

/** Meta checks the address once when it is saved: echo the challenge if the verify token matches. */
publicWhatsApp.get('/webhook', (c) => {
  const token = c.get('deps').env.WHATSAPP_VERIFY_TOKEN;
  if (token && c.req.query('hub.mode') === 'subscribe' && safeEqual(c.req.query('hub.verify_token') ?? '', token)) {
    return c.text(c.req.query('hub.challenge') ?? '');
  }
  throw new HttpError(403, 'Verify token does not match');
});

publicWhatsApp.post('/webhook', async (c) => {
  const deps = c.get('deps');
  const secret = deps.env.WHATSAPP_APP_SECRET;
  if (!secret) throw new HttpError(503, 'WhatsApp app secret not configured');
  const raw = await c.req.text();
  if (!verifyWhatsAppSignature(raw, c.req.header('x-hub-signature-256') ?? '', secret)) throw new HttpError(401, 'Invalid signature');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw new HttpError(400, 'Expected JSON'); }
  // A failure here makes Meta deliver it again; repeats are ignored by message id.
  return c.json({ ok: true, ...(await recordWebhook(deps, payload)) });
});

/* ---------------- Admin → WhatsApp ---------------- */

export const adminWhatsApp = new Hono<AppEnv>();

const zSettings = z.object({
  enabled: z.boolean(),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'A language code such as en, en_US or hi'),
  cartDelayMinutes: z.number().int().min(15).max(1440),
  cart: z.boolean(), orderConfirmed: z.boolean(), shipped: z.boolean(), ebookReady: z.boolean(), callFollowup: z.boolean(),
  templates: z.object(Object.fromEntries(WA_TEMPLATES.map((t) => [t.key, z.string().trim().regex(/^[a-z0-9_]{1,512}$/, 'Template names are lower-case letters, digits and _')])) as Record<string, z.ZodString>).partial(),
}).partial();

adminWhatsApp.get('/settings', async (c) => {
  const deps = c.get('deps');
  const days = 30;
  return c.json({
    settings: await getWhatsAppSettings(deps.db), defaults: DEFAULT_WA_SETTINGS, templates: WA_TEMPLATES,
    status: { connected: Boolean(deps.whatsapp), templates: Boolean(deps.whatsappTemplates), webhook: Boolean(deps.env.WHATSAPP_APP_SECRET && deps.env.WHATSAPP_VERIFY_TOKEN), webhookUrl: `${deps.env.SITE_URL}/api/whatsapp/webhook` },
    stats: await whatsappStats(deps.db, new Date(deps.now().getTime() - days * 86_400_000)),
  });
});

adminWhatsApp.put('/settings', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zSettings);
  const cur = await getWhatsAppSettings(db);
  const next: WhatsAppSettings = { ...cur, ...input, templates: { ...cur.templates, ...input.templates } };
  await saveWhatsAppSettings(db, next, c.get('admin').email);
  await audit(c, 'whatsapp.settings', 'whatsapp', null, input);
  // Switched on: send anything already waiting.
  if (next.enabled && !cur.enabled) await processWhatsApp(c.get('deps'), 20).catch(() => 0);
  return c.json({ settings: next });
});

/** The site's templates and what Meta says about each (approved, pending, rejected, missing). */
adminWhatsApp.get('/templates', async (c) => {
  const deps = c.get('deps');
  if (!deps.whatsappTemplates) throw new HttpError(409, 'Set WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel first.');
  const s = await getWhatsAppSettings(deps.db);
  let found;
  let numbers: { id: string; number: string }[] | null = null;
  try { found = await deps.whatsappTemplates.list(); } catch (e) { throw new HttpError(502, (e as Error).message); }
  try { numbers = await deps.whatsappTemplates.phoneNumbers(); } catch { /* not fatal: shown as unknown */ }
  const phoneNumberId = deps.env.WHATSAPP_PHONE_NUMBER_ID ?? '';
  return c.json({
    language: s.language,
    // The sending number must be in the same WhatsApp account as the templates, or every send fails with 132001.
    account: { id: deps.env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '', phoneNumberId, numberInAccount: numbers ? numbers.some((n) => n.id === phoneNumberId) : null, numbers: numbers ?? [] },
    items: WA_TEMPLATES.map((t) => {
      const name = s.templates[t.key];
      // Only the language the site sends counts: en and en_US are different templates to Meta.
      const lang = s.languages[t.key] || s.language;
      const m = found.find((x) => x.name === name && x.language === lang);
      const others = found.filter((x) => x.name === name && x.language !== lang).map((x) => ({ language: x.language, status: x.status }));
      return {
        key: t.key, name, status: m?.status ?? 'MISSING', language: lang, otherLanguages: others, category: m?.category ?? t.category, rejectedReason: m?.rejectedReason ?? '',
        // Meta's copy differs from the site's current design (Update all templates fixes it).
        outdated: Boolean(m && needsUpdate(t, m, deps.env.SITE_URL)),
      };
    }),
  });
});

/**
 * Diagnose: ask Meta, with the site's own keys, what it sends from and where the templates are.
 * Each step says what it found; a failed step shows Meta's own error.
 */
adminWhatsApp.get('/diagnose', async (c) => {
  const deps = c.get('deps');
  const env = deps.env;
  const s = await getWhatsAppSettings(deps.db);
  const steps: { label: string; ok: boolean | null; detail: string }[] = [];
  const phoneId = env.WHATSAPP_PHONE_NUMBER_ID ?? '';
  const wabaId = env.WHATSAPP_BUSINESS_ACCOUNT_ID ?? '';
  steps.push({ label: 'Settings in Vercel', ok: Boolean(env.WHATSAPP_TOKEN && phoneId && wabaId), detail: `WHATSAPP_PHONE_NUMBER_ID = ${phoneId || '(not set)'}; WHATSAPP_BUSINESS_ACCOUNT_ID = ${wabaId || '(not set)'}; WHATSAPP_TOKEN ${env.WHATSAPP_TOKEN ? 'set' : '(not set)'}; language = ${s.language}` });
  const t = deps.whatsappTemplates;
  if (!t || !phoneId) return c.json({ steps });
  try {
    const n = await t.numberInfo(phoneId);
    steps.push({ label: 'The number the site sends from', ok: true, detail: Object.entries(n).map(([k, v]) => `${k}: ${v}`).join('; ') });
  } catch (e) { steps.push({ label: 'The number the site sends from', ok: false, detail: (e as Error).message }); }
  try {
    const nums = await t.phoneNumbers();
    const inIt = nums.some((x) => x.id === phoneId);
    steps.push({ label: `Numbers in WhatsApp account ${wabaId}`, ok: inIt, detail: `${nums.map((x) => `${x.number} (id ${x.id})`).join(', ') || 'none'}${inIt ? '' : ` — ${phoneId} is NOT one of them, so this account's templates can't be sent from it`}` });
  } catch (e) { steps.push({ label: `Numbers in WhatsApp account ${wabaId}`, ok: false, detail: (e as Error).message }); }
  try {
    const all = await t.list();
    const ours = WA_TEMPLATES.map((x) => s.templates[x.key]);
    const lang = (key: WaTemplateKey) => s.languages[key] || s.language;
    const approved = WA_TEMPLATES.filter((x) => all.some((y) => y.name === s.templates[x.key] && y.language === lang(x.key) && y.status === 'APPROVED'));
    steps.push({ label: `Templates in account ${wabaId}`, ok: approved.length === ours.length, detail: `${approved.length} of ${ours.length} approved in the language the site sends. All templates there: ${all.map((x) => `${x.name} [${x.language}, ${x.status.toLowerCase()}]`).join(', ') || 'none'}` });
    for (const x of WA_TEMPLATES) {
      const name = s.templates[x.key];
      const there = all.filter((y) => y.name === name);
      const ok = there.some((y) => y.language === lang(x.key) && y.status === 'APPROVED');
      steps.push({
        label: `${x.label}: ${name}`, ok,
        detail: `The site sends it in "${lang(x.key)}". In Meta: ${there.map((y) => `${y.language} ${y.status.toLowerCase()}${y.rejectedReason ? ` (${y.rejectedReason})` : ''}`).join(', ') || 'not there'}.${ok ? ' Use "Test" under Templates to send it to your own number.' : ''}`,
      });
    }
  } catch (e) { steps.push({ label: `Templates in account ${wabaId}`, ok: false, detail: (e as Error).message }); }
  return c.json({ steps });
});

/**
 * Update all templates in Meta to the site's designs: edit those that differ, create those that
 * are missing, leave matching ones alone. Meta reviews every edited or new one.
 */
adminWhatsApp.post('/templates/sync', async (c) => {
  const deps = c.get('deps');
  if (!deps.whatsappTemplates) throw new HttpError(409, 'Set WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel first.');
  let results;
  try { results = await syncTemplates(deps); } catch (e) { throw new HttpError(502, (e as Error).message); }
  await audit(c, 'whatsapp.templates_sync', 'whatsapp', null, { results });
  return c.json({ results });
});

/** Send one template now, with its sample values, to a number (yours), and show what Meta answered. */
adminWhatsApp.post('/templates/test', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({ key: z.enum(WA_TEMPLATES.map((t) => t.key) as [WaTemplateKey, ...WaTemplateKey[]]), phone: z.string().max(20) }));
  if (!deps.whatsapp) throw new HttpError(409, 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel first.');
  const phone = callableNumber(input.phone);
  if (!phone) throw new HttpError(400, 'Enter a 10-digit Indian mobile number.');
  const r = await testTemplate(deps, input.key, phone);
  await audit(c, 'whatsapp.template_test', 'whatsapp', r.name, { ok: r.ok, language: r.language });
  return c.json(r);
});

/** Failed messages from the last 3 days go back in the queue and are sent now (after fixing the cause). */
adminWhatsApp.post('/messages/retry-failed', async (c) => {
  const deps = c.get('deps');
  if (!deps.whatsapp) throw new HttpError(409, 'WhatsApp is not connected yet.');
  const s = await getWhatsAppSettings(deps.db);
  if (!s.enabled) throw new HttpError(409, 'Switch WhatsApp on first.');
  const n = await retryFailed(deps);
  await audit(c, 'whatsapp.retry_failed', 'whatsapp', null, { n });
  return c.json({ requeued: n });
});

/** Conversations, newest first: each number's last message and how many of theirs are unread. */
adminWhatsApp.get('/conversations', async (c) => {
  const { db } = c.get('deps');
  const q = c.req.query('q')?.trim().toLowerCase();
  const rows = await db.select({
    phone: whatsappMessages.phone, name: whatsappMessages.name, body: whatsappMessages.body, direction: whatsappMessages.direction,
    status: whatsappMessages.status, at: whatsappMessages.createdAt, seenAt: whatsappMessages.seenAt,
  }).from(whatsappMessages).where(sql`${whatsappMessages.status} <> 'queued'`).orderBy(desc(whatsappMessages.createdAt)).limit(5000);
  const byPhone = new Map<string, { phone: string; name: string; last: string; direction: string; status: string; at: Date; unread: number; lastIncoming: Date | null }>();
  for (const r of rows) {
    let x = byPhone.get(r.phone);
    if (!x) byPhone.set(r.phone, x = { phone: r.phone, name: '', last: r.body, direction: r.direction, status: r.status, at: r.at, unread: 0, lastIncoming: null });
    if (!x.name && r.name) x.name = r.name;
    if (r.direction === 'in') {
      x.lastIncoming ??= r.at;
      if (!r.seenAt) x.unread++;
    }
  }
  const items = [...byPhone.values()].filter((x) => !q || x.phone.includes(q) || x.name.toLowerCase().includes(q)).slice(0, 200);
  return c.json({ items });
});

const phoneParam = (raw: string) => {
  const p = decodeURIComponent(raw);
  if (!/^\+\d{8,15}$/.test(p)) throw notFound('Conversation not found');
  return p;
};

/** One conversation (marks their messages as seen). */
adminWhatsApp.get('/conversations/:phone', async (c) => {
  const deps = c.get('deps');
  const phone = phoneParam(c.req.param('phone'));
  const messages = await deps.db.select().from(whatsappMessages).where(eq(whatsappMessages.phone, phone)).orderBy(desc(whatsappMessages.createdAt)).limit(200);
  await deps.db.update(whatsappMessages).set({ seenAt: deps.now() })
    .where(and(eq(whatsappMessages.phone, phone), eq(whatsappMessages.direction, 'in'), isNull(whatsappMessages.seenAt)));
  const last = await lastIncoming(deps.db, phone);
  return c.json({
    phone, messages: messages.reverse(), optedOut: await isOptedOut(deps.db, phone),
    replyUntil: last ? new Date(last.getTime() + WA_REPLY_WINDOW_MS) : null, canReply: await canReply(deps, phone), connected: Boolean(deps.whatsapp),
  });
});

adminWhatsApp.post('/conversations/:phone/reply', async (c) => {
  const deps = c.get('deps');
  const phone = phoneParam(c.req.param('phone'));
  const { text } = await body(c, z.object({ text: z.string().trim().min(1).max(4000) }));
  if (!deps.whatsapp) throw new HttpError(409, 'WhatsApp is not connected yet.');
  if (await isOptedOut(deps.db, phone)) throw new HttpError(409, 'This customer replied STOP.');
  if (!(await canReply(deps, phone))) throw new HttpError(409, 'More than 24 hours have passed since their last message: WhatsApp only allows a template now.');
  let row;
  try { row = await sendReply(deps, phone, text, c.get('admin').email); } catch (e) { throw new HttpError(502, (e as Error).message); }
  await audit(c, 'whatsapp.reply', 'phone', phone);
  return c.json({ message: row });
});

/** How many people a new-books message would reach. */
adminWhatsApp.get('/new-books/audience', async (c) => c.json({ count: (await newBooksAudience(c.get('deps').db)).length }));

/** Send a new-books message: to one test number, or to everyone in the audience. */
adminWhatsApp.post('/new-books', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({
    message: z.string().trim().min(5).max(600),
    link: z.string().trim().url().max(500),
    testPhone: z.string().max(20).optional(),
  }));
  const s = await getWhatsAppSettings(deps.db);
  if (!deps.whatsapp) throw new HttpError(409, 'WhatsApp is not connected yet.');
  if (!s.enabled) throw new HttpError(409, 'Switch WhatsApp on first.');
  if (!input.link.startsWith(`${deps.env.SITE_URL}/`)) throw new HttpError(400, `The button opens a page on our site: use a link starting with ${deps.env.SITE_URL}/`);
  const testPhone = input.testPhone ? callableNumber(input.testPhone) : null;
  if (input.testPhone && !testPhone) throw new HttpError(400, 'Enter a 10-digit Indian mobile number for the test.');
  const r = await queueNewBooks(deps, { message: input.message, link: input.link, testPhone }, c.get('admin').email);
  await audit(c, testPhone ? 'whatsapp.new_books_test' : 'whatsapp.new_books', 'whatsapp', r.broadcastId, { queued: r.queued });
  return c.json(r);
});

/** Messages the site sent (the log), newest first. */
adminWhatsApp.get('/messages', async (c) => {
  const { db } = c.get('deps');
  const kind = c.req.query('kind');
  const status = c.req.query('status');
  const where = [eq(whatsappMessages.direction, 'out'), kind ? eq(whatsappMessages.kind, kind as never) : undefined, status ? eq(whatsappMessages.status, status as never) : undefined].filter((x) => x !== undefined);
  const items = await db.select({
    id: whatsappMessages.id, phone: whatsappMessages.phone, name: whatsappMessages.name, kind: whatsappMessages.kind, status: whatsappMessages.status,
    body: whatsappMessages.body, error: whatsappMessages.error, dueAt: whatsappMessages.dueAt, sentAt: whatsappMessages.sentAt, createdAt: whatsappMessages.createdAt,
  }).from(whatsappMessages).where(and(...where)).orderBy(desc(whatsappMessages.createdAt)).limit(200);
  return c.json({ items });
});

adminWhatsApp.get('/opt-outs', async (c) => c.json({ items: await c.get('deps').db.select().from(whatsappOptOuts).orderBy(desc(whatsappOptOuts.createdAt)).limit(500) }));

adminWhatsApp.delete('/opt-outs/:phone', async (c) => {
  const phone = phoneParam(c.req.param('phone'));
  await c.get('deps').db.delete(whatsappOptOuts).where(eq(whatsappOptOuts.phone, phone));
  await audit(c, 'whatsapp.opt_out_remove', 'phone', phone);
  return c.json({ ok: true });
});
