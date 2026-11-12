// The rest of the back office for the Claude connector: WhatsApp, voice-agent calls and checkout
// leads, newsletter and audience, popups, cookie consent, Study Hub, competition entries, settings
// and staff. Everything can be read. Actions are limited to what the store owner approved:
// WhatsApp replies and new-book sends, newsletter campaigns, voice-agent calls, and small reversible
// changes (popup status, notes, Study Hub publishing). Competition decisions, refunds, cancellations,
// settings and staff stay read-only here.
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { whatsappMessages } from '../../db/schema.js';
import { canReply, isOptedOut, lastIncoming } from '../../services/whatsapp.js';
import { callableNumber } from '../../../src/shared/calls.js';
import { WA_REPLY_WINDOW_MS } from '../../../src/shared/whatsapp.js';
import { COMPETITIONS } from '../../../src/shared/competitions.js';
import { istNow, money, productId, qs, ToolError, type Tool, type ToolCtx } from './tools.js';

const zPage = { page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(100).default(25) };
const clip = (s: unknown, n: number) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n)}… [${t.length - n} more characters]` : t;
};

/** A WhatsApp number as stored (+919876543210): a 10-digit Indian mobile, or a full international number. */
function waPhone(raw: string): string {
  const s = raw.trim().replace(/[\s()-]/g, '');
  if (/^\+\d{8,15}$/.test(s)) return s;
  const indian = callableNumber(s);
  if (indian) return indian;
  throw new ToolError(`"${raw}" isn't a phone number. Use a 10-digit Indian mobile or +<country code><number>.`);
}

const zSlug = z.string().trim().max(100).describe(`Competition slug: ${COMPETITIONS.map((c) => c.slug).join(', ')}`);
function competition(slug: string, team?: boolean) {
  const comp = COMPETITIONS.find((c) => c.slug === slug);
  if (!comp) throw new ToolError(`No competition "${slug}". Known: ${COMPETITIONS.map((c) => c.slug).join(', ')}.`);
  if (team === true && !comp.team) throw new ToolError(`"${slug}" isn't a team competition: use list_competition_registrations.`);
  return comp;
}

const campaignFields = {
  subject: z.string().trim().min(3).max(150),
  preheader: z.string().trim().max(200).optional().describe('Preview text shown after the subject in the inbox'),
  heading: z.string().trim().max(150).optional(),
  body: z.string().trim().max(20_000).optional().describe('Plain text; paragraphs separated by blank lines'),
  cta_label: z.string().trim().max(60).optional().describe('Button text, e.g. "See the book"'),
  cta_url: z.url().max(500).optional().describe('Button link (https://…)'),
  products: z.array(z.string().trim().min(1).max(200)).max(12).optional().describe('Books shown in the email (ids, slugs or exact titles)'),
};
const productIds = (ctx: ToolCtx, refs?: string[]) => Promise.all((refs ?? []).map((r) => productId(ctx, r)));
const campaignOut = (c: Record<string, any>) => ({
  id: c.id, subject: c.subject, status: c.status, preheader: c.preheader, heading: c.heading, body: clip(c.body, 3000), ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl,
  productIds: c.productIds, scheduledAt: c.scheduledAt, startedAt: c.startedAt, sentAt: c.sentAt,
  recipients: c.recipients, sentCount: c.sentCount, failedCount: c.failedCount, createdBy: c.createdBy, createdAt: c.createdAt, updatedAt: c.updatedAt,
});
const popupOut = ({ design: _d, ...p }: Record<string, any>) => p;

export const BACKEND_TOOLS: Tool[] = [
  /* ---------------- WhatsApp (managers and the owner) ---------------- */
  {
    name: 'get_whatsapp_overview',
    title: 'WhatsApp overview',
    description: 'WhatsApp status and numbers: connected or not, which automatic messages are on (abandoned cart, order confirmed, shipped, e-book ready, after a call), messages sent / delivered / read / failed and replies in the last 30 days, and how many people a new-books message would reach.',
    role: 'manager',
    readOnly: true,
    input: z.object({}),
    async run(ctx) {
      const [s, audience] = await Promise.all([ctx.api('GET', '/whatsapp/settings'), ctx.api('GET', '/whatsapp/new-books/audience')]);
      return { status: s.status, settings: s.settings, stats_last_30_days: s.stats, new_books_audience: audience.count };
    },
  },
  {
    name: 'list_whatsapp_templates',
    title: 'WhatsApp templates',
    description: 'The message templates the site uses and what Meta says about each (approved, pending, rejected with reason, missing, outdated), and whether the sending number belongs to the WhatsApp account.',
    role: 'manager',
    readOnly: true,
    input: z.object({}),
    run: (ctx) => ctx.api('GET', '/whatsapp/templates'),
  },
  {
    name: 'list_whatsapp_conversations',
    title: 'WhatsApp inbox',
    description: 'WhatsApp conversations, newest first: each number, name, last message and how many of their messages the team hasn’t opened.',
    role: 'manager',
    readOnly: true,
    input: z.object({ search: z.string().trim().max(60).optional().describe('Name or number') }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/whatsapp/conversations${qs({ q: a.search })}`);
      return r.items.slice(0, 100).map((x: Record<string, any>) => ({ ...x, last: clip(x.last, 300) }));
    },
  },
  {
    name: 'get_whatsapp_conversation',
    title: 'Read a WhatsApp conversation',
    description: 'The messages with one number (latest 100), whether they opted out, and until when a free-text reply is allowed (WhatsApp allows one only within 24 hours of their last message). Reading here does not mark their messages as seen in the admin inbox.',
    role: 'manager',
    readOnly: true,
    input: z.object({ phone: z.string().trim().max(20).describe('10-digit Indian mobile or +<country code><number>') }),
    async run(ctx, a) {
      const phone = waPhone(a.phone);
      const { db } = ctx.deps;
      const rows = await db.select({
        at: whatsappMessages.createdAt, direction: whatsappMessages.direction, kind: whatsappMessages.kind, status: whatsappMessages.status,
        name: whatsappMessages.name, body: whatsappMessages.body, template: whatsappMessages.template, error: whatsappMessages.error, seenAt: whatsappMessages.seenAt,
      }).from(whatsappMessages).where(eq(whatsappMessages.phone, phone)).orderBy(desc(whatsappMessages.createdAt)).limit(100);
      if (!rows.length) throw new ToolError(`No WhatsApp messages with ${phone}.`);
      const last = await lastIncoming(db, phone);
      return {
        phone, name: rows.find((r) => r.direction === 'in' && r.name)?.name ?? rows.find((r) => r.name)?.name ?? '',
        optedOut: await isOptedOut(db, phone), canReplyNow: await canReply(ctx.deps, phone),
        replyAllowedUntil: last ? new Date(last.getTime() + WA_REPLY_WINDOW_MS) : null,
        messages: rows.reverse().map((r) => ({ ...r, body: clip(r.body, 2000) })),
      };
    },
  },
  {
    name: 'list_whatsapp_messages',
    title: 'WhatsApp send log',
    description: 'Messages the site sent (latest 200): kind (cart, order_confirmed, shipped, ebook_ready, call_followup, new_books, reply…), status (queued, sent, delivered, read, failed, skipped) and the error when one failed.',
    role: 'manager',
    readOnly: true,
    input: z.object({ kind: z.string().trim().max(30).optional(), status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed', 'skipped']).optional() }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/whatsapp/messages${qs({ kind: a.kind, status: a.status })}`);
      return r.items.map((m: Record<string, any>) => ({ ...m, body: clip(m.body, 300) }));
    },
  },
  {
    name: 'list_whatsapp_opt_outs',
    title: 'WhatsApp opt-outs',
    description: 'Numbers that replied STOP: the site sends them nothing.',
    role: 'manager',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/whatsapp/opt-outs')).items,
  },
  {
    name: 'reply_whatsapp',
    title: 'Reply on WhatsApp',
    description: 'Sends a free-text WhatsApp reply from the business number. Only works within 24 hours of the customer’s last message and never to someone who opted out (check get_whatsapp_conversation). Show the user the exact text and get their OK before sending.',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({ phone: z.string().trim().max(20), text: z.string().trim().min(1).max(4000) }),
    async run(ctx, a) {
      const phone = waPhone(a.phone);
      const r = await ctx.api('POST', `/whatsapp/conversations/${encodeURIComponent(phone)}/reply`, { text: a.text });
      return { sent: true, phone, status: r.message?.status, at: r.message?.createdAt };
    },
  },
  {
    name: 'send_whatsapp_new_books',
    title: 'Send a new-books WhatsApp message',
    description: 'Sends the "new books" WhatsApp template. With test_phone it goes to that one number only. Without it, it goes to EVERYONE in the new-books audience (the count is in get_whatsapp_overview), once per person. Always send a test first and get the user’s explicit go-ahead for the full send.',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({
      message: z.string().trim().min(5).max(600).describe('The text that fills the template'),
      link: z.url().max(500).describe('A page on eldenap.in the button opens, e.g. https://eldenap.in/books/<slug>'),
      test_phone: z.string().trim().max(20).optional().describe('Send only to this number (a test)'),
    }),
    run: (ctx, a) => ctx.api('POST', '/whatsapp/new-books', { message: a.message, link: a.link, ...(a.test_phone ? { testPhone: a.test_phone } : {}) }),
  },
  {
    name: 'retry_failed_whatsapp',
    title: 'Retry failed WhatsApp messages',
    description: 'Puts messages that failed in the last 3 days back in the queue and sends them now. Use after the cause is fixed (e.g. a template got approved).',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({}),
    run: (ctx) => ctx.api('POST', '/whatsapp/messages/retry-failed', {}),
  },

  /* ---------------- Voice-agent calls and checkout leads (managers and the owner) ---------------- */
  {
    name: 'get_calls_overview',
    title: 'Voice-agent calls overview',
    description: 'The AI voice-agent calls (abandoned cart, cash-on-delivery confirmation, feedback): numbers for the last N days (placed, answered, outcomes, ratings, open issues), whether calling is on and connected, calling hours, anything blocking calls, overdue calls and when the scheduler last ran.',
    role: 'manager',
    readOnly: true,
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    async run(ctx, a) {
      const [stats, s] = await Promise.all([ctx.api('GET', `/calls/stats${qs({ days: a.days })}`), ctx.api('GET', '/calls/settings')]);
      return { days: a.days, stats, status: s.status, settings: s.settings };
    },
  },
  {
    name: 'list_calls',
    title: 'List voice-agent calls',
    description: 'Calls, newest first (queued ones by due time), 50 per page: who, kind, status, outcome, rating, duration, open issue.',
    role: 'manager',
    readOnly: true,
    input: z.object({
      kind: z.enum(['cart', 'cod_confirm', 'feedback']).optional(),
      status: z.string().trim().max(80).optional().describe('One or more, comma-separated: queued, dialling, done, no_answer, failed, skipped, cancelled'),
      outcome: z.string().trim().max(40).optional().describe('e.g. will_order, callback, not_interested, feedback_given, confirmed'),
      open_issues: z.boolean().optional().describe('Only calls where the customer reported a problem not yet handled'),
      search: z.string().trim().max(60).optional().describe('Name or phone'),
      page: z.number().int().min(1).max(1000).default(1),
    }),
    run: (ctx, a) => ctx.api('GET', `/calls${qs({ kind: a.kind, status: a.status, outcome: a.outcome, issues: a.open_issues ? '1' : undefined, q: a.search, page: a.page })}`),
  },
  {
    name: 'get_call',
    title: 'Read a call',
    description: 'One call in full: what the agent recorded (outcome, rating, objections, issue), the transcript, the recording link, the cart or order it was about, and earlier calls to the same number.',
    role: 'manager',
    readOnly: true,
    input: z.object({ call_id: z.uuid() }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/calls/${a.call_id}`);
      return money({ ...r, call: { ...r.call, transcript: clip(r.call.transcript, 8000) } }, ['total', 'codAmount']);
    },
  },
  {
    name: 'list_checkout_leads',
    title: 'Abandoned checkouts',
    description: 'Checkouts of the last 30 days where people typed their details (newest first): name, phone, email, cart and total, whether they paid later, whether they agreed to calls, and their cart call (status or when it is due).',
    role: 'manager',
    readOnly: true,
    input: z.object({ unpaid_only: z.boolean().default(false) }),
    async run(ctx, a) {
      const r = await ctx.api('GET', '/calls/leads');
      return { callDelayMinutes: r.delayMinutes, leads: money(r.items.filter((l: { paid: boolean }) => !a.unpaid_only || !l.paid), ['total']) };
    },
  },
  {
    name: 'list_do_not_call',
    title: 'Do-not-call list',
    description: 'Numbers the voice agents must never call, with the reason.',
    role: 'manager',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/calls/do-not-call')).items,
  },
  {
    name: 'call_now',
    title: 'Call now',
    description: 'Has the voice agent call this customer right away (a queued call, or one that wasn’t answered, failed or was skipped). Only inside calling hours; otherwise it says why. Get the user’s OK first.',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({ call_id: z.uuid() }),
    run: async (ctx, a) => (await ctx.api('POST', `/calls/${a.call_id}/call-now`, {})).call,
  },
  {
    name: 'skip_call',
    title: 'Skip a queued call',
    description: 'Cancels a queued call so it is never made.',
    role: 'manager',
    input: z.object({ call_id: z.uuid() }),
    run: async (ctx, a) => (await ctx.api('POST', `/calls/${a.call_id}/skip`, {})).call,
  },
  {
    name: 'resolve_call_issue',
    title: 'Mark a call issue handled',
    description: 'Marks the problem a customer reported on a call as handled.',
    role: 'manager',
    idempotent: true,
    input: z.object({ call_id: z.uuid() }),
    run: async (ctx, a) => (await ctx.api('POST', `/calls/${a.call_id}/resolve`, {})).call,
  },
  {
    name: 'fetch_call_result',
    title: 'Fetch a call’s result',
    description: 'Asks the call provider for the result of a call still shown as dialling.',
    role: 'manager',
    idempotent: true,
    input: z.object({ call_id: z.uuid() }),
    run: async (ctx, a) => (await ctx.api('POST', `/calls/${a.call_id}/fetch-result`, {})).call,
  },
  {
    name: 'add_do_not_call',
    title: 'Add to do-not-call',
    description: 'Stops the voice agents from ever calling a number.',
    role: 'manager',
    idempotent: true,
    input: z.object({ phone: z.string().trim().max(20), reason: z.string().trim().max(200).default('') }),
    run: (ctx, a) => ctx.api('POST', '/calls/do-not-call', { phone: a.phone, reason: a.reason }),
  },

  /* ---------------- Newsletter, accounts and audience ---------------- */
  {
    name: 'list_subscribers',
    title: 'Newsletter subscribers',
    description: 'Newsletter subscribers with status (subscribed, pending, unsubscribed), source and consent date.',
    readOnly: true,
    input: z.object({ search: z.string().trim().max(100).optional(), status: z.enum(['subscribed', 'pending', 'unsubscribed']).optional(), ...zPage }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/newsletter/subscribers${qs({ q: a.search, status: a.status, page: a.page, limit: a.limit })}`);
      return { total: r.total, page: r.page, subscribers: r.items.map(({ consentIp: _ip, visit: _v, ...x }: Record<string, any>) => x) };
    },
  },
  {
    name: 'list_accounts',
    title: 'Signed-up accounts',
    description: 'People who signed in on the website with Google (students, parents, teachers), newest first: type, class, institution, city/state, where they came from, newsletter status. Students’ contact details and dates of birth are left out.',
    readOnly: true,
    input: z.object({ search: z.string().trim().max(100).optional(), ...zPage }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/newsletter/accounts${qs({ q: a.search, page: a.page, limit: a.limit })}`);
      // Students can be children: their date of birth, guardian's and own contact details stay in the admin.
      return {
        total: r.total, page: r.page,
        accounts: r.items.map(({ dob: _d, guardianName: _gn, guardianPhone: _gp, avatarUrl: _a, phone, whatsapp, ...x }: Record<string, any>) =>
          (x.accountType === 'student' ? x : { ...x, phone, whatsapp })),
      };
    },
  },
  {
    name: 'get_audience',
    title: 'Audience and sign-ups',
    description: 'Everyone who signed up (accounts and newsletter): totals and new sign-ups in the last N days, where they came from (channel, campaign), which form or popup, how complete their profiles are, call/WhatsApp consent, orders and spend.',
    readOnly: true,
    input: z.object({
      days: z.number().int().min(1).max(3650).default(30),
      search: z.string().trim().max(100).optional(),
      channel: z.string().trim().max(30).optional().describe('e.g. meta_ads, search, direct'),
      profile: z.enum(['complete', 'most', 'some', 'barely', 'none']).optional(),
      page: z.number().int().min(1).max(1000).default(1),
    }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/audience${qs({ days: a.days, q: a.search, channel: a.channel, bucket: a.profile, page: a.page })}`);
      return { stats: money(r.stats, ['spent']), total: r.total, page: r.page, people: money(r.items, ['spent']) };
    },
  },
  {
    name: 'list_campaigns',
    title: 'Newsletter campaigns',
    description: 'Email campaigns, newest first: subject, status (draft, scheduled, sending, sent, cancelled), when, and how many were sent or failed.',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/newsletter/campaigns')).items.map((c: Record<string, any>) => ({ ...campaignOut(c), body: clip(c.body, 200) })),
  },
  {
    name: 'get_campaign',
    title: 'Read a campaign',
    description: 'One email campaign in full.',
    readOnly: true,
    input: z.object({ campaign_id: z.uuid() }),
    run: async (ctx, a) => campaignOut(await ctx.api('GET', `/newsletter/campaigns/${a.campaign_id}`)),
  },
  {
    name: 'create_campaign',
    title: 'Draft a newsletter campaign',
    description: 'Creates a draft email campaign (nothing is sent). Then send_campaign_test, and schedule_campaign or send_campaign_now.',
    role: 'manager',
    input: z.object(campaignFields),
    async run(ctx, a) {
      const row = await ctx.api('POST', '/newsletter/campaigns', {
        subject: a.subject, preheader: a.preheader ?? '', heading: a.heading ?? '', body: a.body ?? '', ctaLabel: a.cta_label ?? '', ctaUrl: a.cta_url ?? '',
        productIds: await productIds(ctx, a.products),
      });
      return { created: campaignOut(row) };
    },
  },
  {
    name: 'create_campaign_from_product',
    title: 'Draft a campaign announcing a book',
    description: 'Creates a draft campaign announcing a book, filled in from its product page (subject, heading, text, button, the book card). Edit with update_campaign.',
    role: 'manager',
    input: z.object({ product: z.string().trim().min(1).max(200) }),
    run: async (ctx, a) => ({ created: campaignOut(await ctx.api('POST', `/newsletter/campaigns/from-product/${await productId(ctx, a.product)}`, {})) }),
  },
  {
    name: 'update_campaign',
    title: 'Edit a draft campaign',
    description: 'Changes a draft or scheduled campaign. Only the fields you give change.',
    role: 'manager',
    idempotent: true,
    input: z.object({ campaign_id: z.uuid(), ...z.object(campaignFields).partial().shape }),
    async run(ctx, a) {
      const c = await ctx.api('GET', `/newsletter/campaigns/${a.campaign_id}`);
      const row = await ctx.api('PUT', `/newsletter/campaigns/${a.campaign_id}`, {
        subject: a.subject ?? c.subject, preheader: a.preheader ?? c.preheader, heading: a.heading ?? c.heading, body: a.body ?? c.body,
        ctaLabel: a.cta_label ?? c.ctaLabel, ctaUrl: a.cta_url ?? c.ctaUrl, productIds: a.products ? await productIds(ctx, a.products) : c.productIds,
      });
      return { updated: campaignOut(row) };
    },
  },
  {
    name: 'send_campaign_test',
    title: 'Send a test email',
    description: 'Sends the campaign to one address (default: the connected team member) to check it.',
    role: 'manager',
    input: z.object({ campaign_id: z.uuid(), to: z.email().optional() }),
    run: (ctx, a) => ctx.api('POST', `/newsletter/campaigns/${a.campaign_id}/test`, a.to ? { to: a.to } : {}),
  },
  {
    name: 'schedule_campaign',
    title: 'Schedule a campaign',
    description: 'Schedules a campaign to go to ALL subscribers at a time. Get the user’s explicit OK first.',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({ campaign_id: z.uuid(), at: z.iso.datetime({ offset: true }).describe('e.g. 2026-11-20T10:00:00+05:30') }),
    run: async (ctx, a) => campaignOut(await ctx.api('POST', `/newsletter/campaigns/${a.campaign_id}/schedule`, { at: a.at })),
  },
  {
    name: 'send_campaign_now',
    title: 'Send a campaign now',
    description: 'Starts sending a campaign to ALL subscribers now (in batches). Can’t be undone: send a test first and get the user’s explicit OK.',
    role: 'manager',
    reachesCustomers: true,
    input: z.object({ campaign_id: z.uuid() }),
    run: (ctx, a) => ctx.api('POST', `/newsletter/campaigns/${a.campaign_id}/send`, {}),
  },
  {
    name: 'cancel_campaign',
    title: 'Stop a campaign',
    description: 'Unschedules a scheduled campaign (back to draft) or stops one that is still sending.',
    role: 'manager',
    input: z.object({ campaign_id: z.uuid() }),
    run: async (ctx, a) => campaignOut(await ctx.api('POST', `/newsletter/campaigns/${a.campaign_id}/cancel`, {})),
  },

  /* ---------------- Popups, cookie consent, Study Hub ---------------- */
  {
    name: 'list_popups',
    title: 'Website popups',
    description: 'Popups on the website with status (draft, live, paused), trigger, audience, offer or discount code, and views, clicks, closes and sign-ups in the last 30 days.',
    role: 'manager',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/popups')).items.map(popupOut),
  },
  {
    name: 'get_popup',
    title: 'Popup details',
    description: 'One popup: settings, numbers per day (last 30 days), all-time totals, orders that used its discount code, and anything that stops it showing.',
    role: 'manager',
    readOnly: true,
    input: z.object({ popup_id: z.uuid() }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/popups/${a.popup_id}`);
      return { ...r, popup: popupOut(r.popup), couponOrders: r.couponOrders && money(r.couponOrders, ['revenue']) };
    },
  },
  {
    name: 'set_popup_status',
    title: 'Publish or pause a popup',
    description: 'live = shows on the website; paused or draft = hidden.',
    role: 'manager',
    idempotent: true,
    input: z.object({ popup_id: z.uuid(), status: z.enum(['draft', 'live', 'paused']) }),
    run: async (ctx, a) => popupOut(await ctx.api('POST', `/popups/${a.popup_id}/status`, { status: a.status })),
  },
  {
    name: 'get_cookie_consent_stats',
    title: 'Cookie consent stats',
    description: 'How many visitors saw the cookie banner and what they chose (accept all, essential only, no choice), per day, device, region and channel. Accepting is what lets the Meta Pixel and Google Analytics count a visitor.',
    readOnly: true,
    input: z.object({ days: z.number().int().min(1).max(365).default(30) }),
    run: (ctx, a) => ctx.api('GET', `/consent${qs({ days: a.days })}`),
  },
  {
    name: 'list_study_hub_files',
    title: 'Study Hub files',
    description: 'Free downloads on the Study Hub: title, kind, level, subject, published or not, and the file link.',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/resources')).items,
  },
  {
    name: 'set_study_hub_published',
    title: 'Publish or hide a Study Hub file',
    description: 'Shows or hides a Study Hub download (it needs its file uploaded to be published).',
    idempotent: true,
    input: z.object({ file_id: z.uuid(), published: z.boolean() }),
    async run(ctx, a) {
      const { items } = await ctx.api('GET', '/resources');
      const r = items.find((x: { id: string }) => x.id === a.file_id);
      if (!r) throw new ToolError('No Study Hub file with that id.');
      const row = await ctx.api('PUT', `/resources/${r.id}`, {
        title: r.title, kind: r.kind, level: r.level, subject: r.subject, filePath: r.filePath, fileSize: r.fileSize, published: a.published, sort: r.sort,
      });
      return { id: row.id, title: row.title, published: row.published };
    },
  },
  {
    name: 'update_customer_notes',
    title: 'Add a note to a customer',
    description: 'Adds a note for the team to a customer (they never see it). Earlier notes are kept.',
    input: z.object({ customer_id: z.uuid(), note: z.string().trim().min(1).max(1000) }),
    async run(ctx, a) {
      const { customer } = await ctx.api('GET', `/customers/${a.customer_id}`);
      const notes = [customer.notes, `[${istNow()} IST, ${ctx.session.email} via Claude] ${a.note}`].filter(Boolean).join('\n');
      if (notes.length > 5000) throw new ToolError('The customer’s notes are full (5,000 characters). Tidy them in the admin first.');
      await ctx.api('PUT', `/customers/${a.customer_id}`, { notes });
      return { customer: customer.email, notes };
    },
  },

  /* ---------------- Competition entries (owner; read-only) ---------------- */
  {
    name: 'list_competition_registrations',
    title: 'Competition registrations',
    description: 'Registrations of an individual/group competition: who registered, participants’ names, group, answers to the form, when.',
    role: 'owner',
    readOnly: true,
    input: z.object({ slug: zSlug }),
    async run(ctx, a) {
      const comp = competition(a.slug);
      const r = await ctx.api('GET', `/competitions/${comp.slug}`);
      return {
        competition: r.competition, questions: r.questions, total: r.items.length,
        registrations: r.items.slice(0, 300).map((x: Record<string, any>) => ({
          id: x.id, ref: x.ref, createdAt: x.createdAt, mode: x.mode, groupName: x.groupName, participants: x.names, answers: x.answers,
          registeredBy: { name: x.by.name, email: x.by.email, city: x.by.city, state: x.by.state, type: x.by.type },
        })),
      };
    },
  },
  {
    name: 'list_competition_teams',
    title: 'Competition teams',
    description: 'Teams in a team competition (e.g. the DoomsDay comic competition): code, team and institution, city/state, age group, status (pending, changes_requested, approved, rejected, withdrawn), result, members, uploads, and what is still missing. Read-only: approving, rejecting and results are done in the admin.',
    role: 'owner',
    readOnly: true,
    input: z.object({
      slug: zSlug,
      status: z.string().trim().max(30).optional(),
      age_group: z.string().trim().max(30).optional(),
      state: z.string().trim().max(4).optional().describe('GST state code, e.g. 20 for Jharkhand'),
      city: z.string().trim().max(60).optional(),
      result: z.string().trim().max(30).optional().describe('shortlisted, first, second, third, peoples_choice or none'),
      files: z.enum(['complete', 'missing']).optional(),
      search: z.string().trim().max(100).optional().describe('Team, institution, email, member name or application code'),
    }),
    async run(ctx, a) {
      const comp = competition(a.slug, true);
      const r = await ctx.api('GET', `/competitions/${comp.slug}/teams${qs({ status: a.status, category: a.age_group, state: a.state, city: a.city, result: a.result, files: a.files, q: a.search })}`);
      return { ageGroups: r.groups, institutionTypes: r.institutionTypes, total: r.items.length, teams: r.items.slice(0, 300) };
    },
  },
  {
    name: 'get_competition_team',
    title: 'Competition team details',
    description: 'One team: institution, status and review note, members (name, age, roles, institution, whether their ID and guardian consent are in), uploads, notices it received, the team’s history and what is missing. Members’ contact details, dates of birth and ID documents stay in the admin.',
    role: 'owner',
    readOnly: true,
    input: z.object({ slug: zSlug, team_id: z.uuid() }),
    async run(ctx, a) {
      const comp = competition(a.slug, true);
      const t = await ctx.api('GET', `/competitions/${comp.slug}/teams/${a.team_id}`);
      return {
        ...t,
        registeredBy: { name: t.registeredBy.name, email: t.registeredBy.email, type: t.registeredBy.type, city: t.registeredBy.city },
        members: t.members.map((m: Record<string, any>) => ({
          captain: m.captain, fullName: m.fullName, age: m.age, roles: m.roles, institutionName: m.institutionName, instagram: m.instagram,
          idDocType: m.idDocType, idDocumentGiven: m.idDoc, guardianConsentGiven: Boolean(m.guardianConsentAt),
        })),
      };
    },
  },
  {
    name: 'list_competition_notices',
    title: 'Competition notices',
    description: 'Notices and emails sent to teams of a team competition, newest first.',
    role: 'owner',
    readOnly: true,
    input: z.object({ slug: zSlug }),
    run: async (ctx, a) => (await ctx.api('GET', `/competitions/${competition(a.slug, true).slug}/notices`)).items,
  },
  {
    name: 'get_competition_settings',
    title: 'Competition dates and settings',
    description: 'A team competition’s dates (registration close, submission deadline, results), settings and how many teams are registered.',
    role: 'owner',
    readOnly: true,
    input: z.object({ slug: zSlug }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/competitions/${competition(a.slug, true).slug}/settings`);
      return { settings: r.settings, dates: r.dates, defaults: r.defaults, kit: r.kit };
    },
  },

  /* ---------------- Store settings and staff (read-only) ---------------- */
  {
    name: 'get_store_settings',
    title: 'Store settings',
    description: 'Store settings: business and GST details, support contacts, shipping charge and free-shipping threshold, cash on delivery and its advance, order expiry, e-book download limits, low-stock level, newsletter daily limit. Read-only: changes are made in the admin.',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => money(await ctx.api('GET', '/settings'), ['shippingFlat', 'freeShippingAbove', 'codAdvance', 'codAdvanceMin']),
  },
  {
    name: 'list_staff',
    title: 'Staff',
    description: 'Who has admin access, their role and when they were last active. Read-only.',
    role: 'owner',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/staff')).items,
  },
];
