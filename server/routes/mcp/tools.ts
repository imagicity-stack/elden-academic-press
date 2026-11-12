// What Claude can do with the store: sales, orders, products, stock, customers, discount codes,
// enquiries, competitions (more of the back office is in ./backend.ts; ./catalog.ts lists them all).
// Each tool goes through the admin's own endpoints (server/routes/admin), as the team member who
// connected Claude, so the same checks, roles and activity log apply.
// Never tools, on purpose: refunds, cancellations, competition decisions, settings, staff, deleting.
import { and, desc, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Deps } from '../../deps.js';
import { orders } from '../../db/schema.js';
import { CHANNELS, channelLabel, type Channel } from '../../../src/shared/attribution.js';
import { COMPETITIONS } from '../../../src/shared/competitions.js';
import type { AdminSession, Role } from '../admin/auth.js';

export class ToolError extends Error {}

export interface ToolCtx {
  /** Call an admin endpoint (path after /api/admin) as the connected team member. */
  api<T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, body?: unknown): Promise<T>;
  deps: Deps;
  session: AdminSession;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  input: z.ZodObject;
  /** Least role that can use it (the endpoints check it too). */
  role?: Role;
  readOnly?: boolean;
  /** Emails or messages customers. */
  reachesCustomers?: boolean;
  idempotent?: boolean;
  run(ctx: ToolCtx, args: any): Promise<unknown>;
}

/* ---------------- Helpers ---------------- */

/** Paise to rupees. */
export const inr = (p: number | null | undefined) => (p == null ? null : Math.round(p) / 100);
/** Rupees to paise. */
export const paise = (r: number) => Math.round(r * 100);

/** Turns the named money fields (paise) into `<name>_inr` (rupees), at any depth. */
export function money<T>(value: T, keys: readonly string[]): T {
  if (Array.isArray(value)) return value.map((v) => money(v, keys)) as T;
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (keys.includes(k) && (typeof v === 'number' || v === null)) out[`${k}_inr`] = inr(v as number | null);
    else out[k] = money(v, keys);
  }
  return out as T;
}
export const ORDER_MONEY = ['subtotal', 'discount', 'shipping', 'tax', 'total', 'refundedAmount', 'codAmount', 'unitPrice', 'lineTotal', 'taxableValue', 'taxAmount', 'amount', 'totalSpent'] as const;
const PRODUCT_MONEY = ['price', 'compareAtPrice'] as const;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export const istNow = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16).replace('T', ' ');

/** An order by its number (#100123 or 100123) or id. */
async function orderId(ctx: ToolCtx, ref: string): Promise<string> {
  const r = ref.trim().replace(/^#/, '');
  if (UUID.test(r)) return r;
  if (!/^\d+$/.test(r)) throw new ToolError(`"${ref}" isn't an order number. Use the number shown on the order, e.g. 100123.`);
  const list = await ctx.api<{ items: { id: string; number: number }[] }>('GET', `/orders${qs({ q: r, view: 'all', limit: 5 })}`);
  const hit = list.items.find((o) => o.number === Number(r));
  if (!hit) throw new ToolError(`No order #${r}.`);
  return hit.id;
}

/** A product by id, slug or exact title. */
export async function productId(ctx: ToolCtx, ref: string): Promise<string> {
  const r = ref.trim();
  if (UUID.test(r)) return r;
  const term = r.replace(/-/g, ' ');
  const lists = await Promise.all([
    ctx.api<{ items: { id: string; slug: string; title: string; status: string }[] }>('GET', `/products${qs({ q: r, limit: 50 })}`),
    ctx.api<{ items: { id: string; slug: string; title: string; status: string }[] }>('GET', `/products${qs({ q: term, limit: 50 })}`),
    ctx.api<{ items: { id: string; slug: string; title: string; status: string }[] }>('GET', `/products${qs({ q: r, status: 'archived', limit: 50 })}`),
  ]);
  const items = [...new Map(lists.flatMap((l) => l.items).map((p) => [p.id, p])).values()];
  const exact = items.find((p) => p.slug === r.toLowerCase() || p.title.toLowerCase() === r.toLowerCase());
  if (exact) return exact.id;
  if (items.length === 1) return items[0].id;
  if (!items.length) throw new ToolError(`No product matches "${r}". Use list_products to find it.`);
  throw new ToolError(`"${r}" matches several products: ${items.slice(0, 10).map((p) => `${p.title} (id ${p.id}, ${p.status})`).join('; ')}. Use the id.`);
}

/* ---------------- Product fields (in rupees) ---------------- */

const LEVELS = ['P', 'M', 'S', 'SS', 'C', 'H'] as const;
const zLevel = z.enum(LEVELS).describe('P = Primary (Class 1–5), M = Middle (6–8), S = Secondary (9–10), SS = Senior Secondary (11–12), C = Competitive exams, H = Higher education');
const zRupees = z.number().min(0).max(1_000_000);
const zFormat = {
  price_inr: zRupees.optional().describe('Selling price in rupees, GST included (needed when turning the format on)'),
  compare_at_price_inr: zRupees.nullable().optional().describe('Crossed-out "was" price in rupees'),
  sku: z.string().trim().max(60).optional(),
};
const zProductFields = {
  title: z.string().trim().min(2).max(200),
  series: z.string().trim().max(120).optional().describe('Series name, e.g. "D Brain Boosters"'),
  author: z.string().trim().max(200).optional(),
  blurb: z.string().trim().max(500).optional().describe('One or two lines shown on cards'),
  description: z.string().trim().max(20_000).optional().describe('Full description (plain text, paragraphs separated by blank lines)'),
  level: zLevel,
  class_label: z.string().trim().max(80).optional().describe('e.g. "Class 10"'),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  subject: z.string().trim().max(80).optional(),
  boards: z.array(z.string().trim().min(1).max(40)).max(10).optional().describe('e.g. ["CBSE"]'),
  language: z.string().trim().max(40).optional(),
  pages: z.number().int().min(1).max(10_000).nullable().optional(),
  edition: z.string().trim().max(40).optional().describe('e.g. "2026-27"'),
  isbn: z.string().trim().max(20).optional(),
  highlights: z.array(z.string().trim().max(200)).max(20).optional().describe('Bullet points on the book page'),
  contents: z.array(z.string().trim().max(200)).max(200).optional().describe('Table of contents, one entry per chapter'),
  category_id: z.number().int().nullable().optional().describe('From list_categories'),
  featured: z.boolean().optional(),
  is_new: z.boolean().optional(),
  ebook_with_print: z.boolean().optional().describe('Buyers of the printed copy also get the e-book free'),
  seo_title: z.string().trim().max(120).optional(),
  seo_description: z.string().trim().max(300).optional(),
  print: z.object({
    ...zFormat,
    stock: z.number().int().min(0).max(1_000_000).optional().describe('Only when creating; later use adjust_stock'),
    weight_grams: z.number().int().min(0).max(50_000).nullable().optional(),
    gst_percent: z.number().int().min(0).max(28).optional().describe('Default 0 for printed books'),
  }).nullable().optional().describe('Sell a printed copy. null turns it off.'),
  ebook: z.object({ ...zFormat, gst_percent: z.number().int().min(0).max(28).optional().describe('Default 18 for e-books') })
    .nullable().optional().describe('Sell an e-book (PDF). Its file is uploaded in the admin. null turns it off.'),
  bundle: z.object(zFormat).nullable().optional().describe('E-book plus printed copy at one price (needs both). null turns it off.'),
};

type Detail = { product: Record<string, any>; variants: Record<'print' | 'digital' | 'bundle', Record<string, any> | null> };

/** The admin's product body from what is saved now. */
function bodyFrom(d: Detail | null) {
  const p = d?.product ?? {};
  const v = (k: 'print' | 'digital' | 'bundle') => d?.variants[k] ?? null;
  return {
    title: p.title ?? '', slug: p.slug, series: p.series ?? '', author: p.author ?? '', blurb: p.blurb ?? '', description: p.description ?? '',
    categoryId: p.categoryId ?? null, level: p.level ?? 'S', classLabel: p.classLabel ?? '', grade: p.grade ?? null, boards: p.boards ?? [],
    subject: p.subject ?? '', language: p.language ?? 'English', pages: p.pages ?? null, edition: p.edition ?? '', isbn: p.isbn ?? '',
    highlights: p.highlights ?? [], contents: p.contents ?? [], coverPath: p.coverPath ?? null, coverPalette: p.coverPalette ?? 0,
    images: (p.images ?? []).map((i: { path: string; alt: string }) => ({ path: i.path, alt: i.alt ?? '' })),
    hasCompanion: p.hasCompanion ?? false, isNew: p.isNew ?? false, featured: p.featured ?? false, ebookWithPrint: p.ebookWithPrint ?? false,
    sort: p.sort ?? 0, status: p.status ?? 'draft', seoTitle: p.seoTitle ?? '', seoDescription: p.seoDescription ?? '',
    print: {
      enabled: Boolean(v('print')?.active), price: v('print')?.price ?? 0, compareAtPrice: v('print')?.compareAtPrice ?? null, sku: v('print')?.sku ?? null,
      stock: v('print')?.stock ?? 0, trackStock: v('print')?.trackStock ?? true, weightGrams: v('print')?.weightGrams ?? null, taxRate: v('print')?.taxRate ?? 0,
    },
    digital: {
      enabled: Boolean(v('digital')?.active), price: v('digital')?.price ?? 0, compareAtPrice: v('digital')?.compareAtPrice ?? null, sku: v('digital')?.sku ?? null,
      taxRate: v('digital')?.taxRate ?? 18, filePath: v('digital')?.filePath ?? null, fileName: v('digital')?.fileName ?? null, fileSize: v('digital')?.fileSize ?? null,
      ...(v('digital')?.files?.length ? { files: v('digital')!.files } : {}),
    },
    bundle: { enabled: Boolean(v('bundle')?.active), price: v('bundle')?.price ?? 0, compareAtPrice: v('bundle')?.compareAtPrice ?? null, sku: v('bundle')?.sku ?? null },
  };
}

/** Lays the tool's fields (rupees, snake_case) over the admin body. */
function applyFields(b: ReturnType<typeof bodyFrom>, a: Record<string, any>, creating: boolean) {
  const map: [string, string][] = [
    ['title', 'title'], ['series', 'series'], ['author', 'author'], ['blurb', 'blurb'], ['description', 'description'], ['level', 'level'],
    ['class_label', 'classLabel'], ['grade', 'grade'], ['subject', 'subject'], ['boards', 'boards'], ['language', 'language'], ['pages', 'pages'],
    ['edition', 'edition'], ['isbn', 'isbn'], ['highlights', 'highlights'], ['contents', 'contents'], ['category_id', 'categoryId'],
    ['featured', 'featured'], ['is_new', 'isNew'], ['ebook_with_print', 'ebookWithPrint'], ['seo_title', 'seoTitle'], ['seo_description', 'seoDescription'],
  ];
  const out: Record<string, any> = { ...b };
  for (const [from, to] of map) if (a[from] !== undefined) out[to] = a[from];
  const fmt = (label: string, cur: Record<string, any>, f: Record<string, any> | null | undefined) => {
    if (f === undefined) return cur;
    if (f === null) return { ...cur, enabled: false };
    if (!cur.enabled && f.price_inr === undefined) throw new ToolError(`Give price_inr for the ${label}.`);
    if (!creating && f.stock !== undefined) throw new ToolError('Stock can’t be changed here: use adjust_stock.');
    return {
      ...cur, enabled: true,
      ...(f.price_inr !== undefined ? { price: paise(f.price_inr) } : {}),
      ...(f.compare_at_price_inr !== undefined ? { compareAtPrice: f.compare_at_price_inr === null ? null : paise(f.compare_at_price_inr) } : {}),
      ...(f.sku !== undefined ? { sku: f.sku || null } : {}),
      ...(f.gst_percent !== undefined ? { taxRate: f.gst_percent } : {}),
      ...(f.weight_grams !== undefined ? { weightGrams: f.weight_grams } : {}),
      ...(creating && f.stock !== undefined ? { stock: f.stock } : {}),
    };
  };
  out.print = fmt('printed copy', b.print, a.print);
  out.digital = fmt('e-book', b.digital, a.ebook);
  out.bundle = fmt('bundle', b.bundle, a.bundle);
  return out;
}

const productOut = (d: Detail & { sold?: number; movements?: unknown[] }) => {
  const { product: p, variants } = d;
  const variant = (v: Record<string, any> | null) => v && money({
    id: v.id, active: v.active, price: v.price, compareAtPrice: v.compareAtPrice, sku: v.sku, gstPercent: v.taxRate,
    ...(v.kind === 'print' ? { stock: v.stock, trackStock: v.trackStock, weightGrams: v.weightGrams } : {}),
    ...(v.kind === 'digital' ? { files: (v.files ?? []).map((f: { name: string; title: string }) => f.title || f.name) } : {}),
  }, PRODUCT_MONEY);
  return {
    id: p.id, slug: p.slug, url: `/books/${p.slug}`, title: p.title, status: p.status, series: p.series, author: p.author, level: p.level, classLabel: p.classLabel,
    grade: p.grade, subject: p.subject, boards: p.boards, language: p.language, pages: p.pages, edition: p.edition, isbn: p.isbn, categoryId: p.categoryId,
    blurb: p.blurb, description: p.description, highlights: p.highlights, contents: p.contents, featured: p.featured, isNew: p.isNew, ebookWithPrint: p.ebookWithPrint,
    seoTitle: p.seoTitle, seoDescription: p.seoDescription, hasCover: Boolean(p.coverPath), photos: (p.images ?? []).length, updatedAt: p.updatedAt,
    formats: { print: variant(variants.print), ebook: variant(variants.digital), bundle: variant(variants.bundle) },
    ...(d.sold !== undefined ? { copiesSold: d.sold } : {}),
  };
};

const zChannel = z.enum(CHANNELS.map((c) => c.key) as [Channel, ...Channel[]]);
export const zDate = z.iso.date().describe('YYYY-MM-DD, India time');
const zPage = { page: z.number().int().min(1).max(1000).default(1), limit: z.number().int().min(1).max(100).default(25) };

/* ---------------- Tools ---------------- */

export const TOOLS: Tool[] = [
  {
    name: 'get_store_overview',
    title: 'Store overview',
    description: 'Sales dashboard for the last N days with the previous N days to compare: booked sales, money received, orders, average order value, cash-on-delivery position, a daily (or monthly) series, best sellers, low stock and what needs doing (orders to ship, enquiries).',
    readOnly: true,
    input: z.object({ days: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30).describe('1 = today, 7, 30, 90 or 365 days') }),
    async run(ctx, a) {
      const d = await ctx.api('GET', `/dashboard${qs({ days: a.days })}`);
      const an = d.analytics;
      const k = an.kpis;
      const series: { day: string; booked: number; received: number; orders: number }[] = an.series;
      const grouped = a.days > 31
        ? Object.values(series.reduce<Record<string, { month: string; booked: number; received: number; orders: number }>>((m, s) => {
          const key = s.day.slice(0, 7);
          m[key] ??= { month: key, booked: 0, received: 0, orders: 0 };
          m[key].booked += s.booked; m[key].received += s.received; m[key].orders += s.orders;
          return m;
        }, {})).map((s) => ({ month: s.month, booked_inr: inr(s.booked), received_inr: inr(s.received), orders: s.orders }))
        : series.map((s) => ({ day: s.day, booked_inr: inr(s.booked), received_inr: inr(s.received), orders: s.orders }));
      return {
        period: { days: a.days, from: an.period.from, to: an.period.to },
        sales: {
          booked_inr: inr(k.booked.now), booked_prev_period_inr: inr(k.booked.prev),
          received_inr: inr(k.received.now), received_prev_period_inr: inr(k.received.prev),
          orders: k.orders.now, orders_prev_period: k.orders.prev,
          avg_order_value_inr: inr(k.aov.now), avg_order_value_prev_period_inr: inr(k.aov.prev),
        },
        money: money(an.money, ['prepaid', 'codAdvances', 'codCollected', 'codLost', 'codOutstanding', 'refunds']),
        cash_on_delivery: {
          share_of_orders_percent: an.cod.share, orders: an.cod.orders, value_inr: inr(an.cod.value),
          to_collect_inr: inr(an.cod.outstanding.amount), parcels_to_collect: an.cod.outstanding.parcels,
          ageing: money(an.cod.outstanding.ageing, ['amount']), collection_rate_percent: an.cod.collectionRate, avg_days_to_collect: an.cod.avgDaysToCollect,
        },
        payment_mix: money(an.mix, ['value']),
        [a.days > 31 ? 'monthly' : 'daily']: grouped,
        best_sellers: money(d.topProducts, ['revenue']),
        to_do: { orders_to_pack_or_ship: d.toFulfil, orders_needing_attention: d.attention, new_enquiries: d.newEnquiries, unpaid_checkouts_last_7_days: d.abandonedWeek },
        low_stock: d.lowStock, low_stock_threshold: d.lowStockThreshold,
        recent_orders: money(d.recentOrders, ['total']),
        definitions: 'booked = orders paid in the period minus refunds and cancelled cash-on-delivery balances; received = money that actually reached the store in the period.',
      };
    },
  },
  {
    name: 'get_sales_by_source',
    title: 'Sales by source and campaign',
    description: 'Paid orders and revenue (after refunds) by where buyers came from (Meta ads, Google ads, search, Instagram/Facebook posts, email, direct…), and by UTM campaign, ad (utm_content) and ad set (utm_term). Use this next to the Meta Ads connector to compare what Meta reports with real orders on the website.',
    readOnly: true,
    input: z.object({
      from: zDate.optional().describe('First day (default: 29 days before to)'),
      to: zDate.optional().describe('Last day (default: today)'),
      channel: zChannel.optional().describe('Only this channel for the campaign/ad breakdowns, e.g. meta_ads'),
    }),
    async run(ctx, a) {
      const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
      const now = ctx.deps.now();
      const to = a.to ?? ist(now);
      const from = a.from ?? ist(new Date(Date.parse(`${to}T12:00:00+05:30`) - 29 * 86_400_000));
      if (from > to) throw new ToolError('from must be on or before to.');
      const { db } = ctx.deps;
      const where = and(
        inArray(orders.paymentStatus, ['paid', 'partially_refunded', 'refunded']),
        gte(orders.createdAt, new Date(`${from}T00:00:00+05:30`)), lte(orders.createdAt, new Date(`${to}T23:59:59.999+05:30`)),
      );
      const scoped = a.channel ? and(where, sql`${orders.channel} = ${a.channel}`) : where;
      const revenue = sql<number>`coalesce(sum(${orders.total} - ${orders.refundedAmount}), 0)::int`;
      const n = sql<number>`count(*)::int`;
      // A fixed key written into the SQL (not a parameter), so GROUP BY matches the selected expression.
      type Key = 'campaign' | 'content' | 'term' | 'source' | 'click';
      const field = (k: Key) => sql<string>`${orders.source}->'last'->>${sql.raw(`'${k}'`)}`;
      const by = (k: Key) => db.select({ channel: orders.channel, value: field(k), source: field('source'), orders: n, revenue }).from(orders)
        .where(and(scoped, sql`${field(k)} is not null`)).groupBy(orders.channel, field(k), field('source')).orderBy(desc(revenue)).limit(50);
      const [channels, campaigns, ads, adsets, clickOnly] = await Promise.all([
        db.select({ channel: orders.channel, orders: n, revenue }).from(orders).where(where).groupBy(orders.channel).orderBy(desc(revenue)),
        by('campaign'), by('content'), by('term'),
        // Meta ad clicks whose links had no UTM tags (only the click id).
        db.select({ orders: n, revenue }).from(orders).where(and(scoped, sql`${field('click')} = 'meta'`, sql`${field('campaign')} is null`)),
      ]);
      const total = channels.reduce((t, c) => ({ orders: t.orders + c.orders, revenue: t.revenue + c.revenue }), { orders: 0, revenue: 0 });
      const row = (r: { channel: string; value: string; source: string | null; orders: number; revenue: number }) =>
        ({ name: r.value, channel: r.channel, utm_source: r.source, orders: r.orders, revenue_inr: inr(r.revenue) });
      return {
        from, to, timezone: 'Asia/Kolkata',
        totals: { orders: total.orders, revenue_inr: inr(total.revenue) },
        channels: channels.map((c) => ({ channel: c.channel, label: channelLabel(c.channel), orders: c.orders, revenue_inr: inr(c.revenue), share_of_revenue_percent: total.revenue ? Math.round((c.revenue / total.revenue) * 1000) / 10 : 0 })),
        ...(a.channel ? { breakdowns_for_channel: a.channel } : {}),
        by_utm_campaign: campaigns.map(row),
        by_utm_content_ad: ads.map(row),
        by_utm_term_adset: adsets.map(row),
        meta_clicks_without_utm_tags: { orders: clickOnly[0]?.orders ?? 0, revenue_inr: inr(clickOnly[0]?.revenue ?? 0) },
        how_orders_are_credited: 'Each paid order is credited to the last visit that had a source (UTM tags, an ad click id or a referring site) before buying; later direct visits do not override it. Revenue is order total minus refunds, GST included. Only visits of people who reached the site are counted; Meta also counts view-through and cross-device conversions, so its numbers are usually higher.',
      };
    },
  },
  {
    name: 'list_orders',
    title: 'List orders',
    description: 'Orders, newest first. By default only paid orders; view "abandoned" lists checkouts that were never paid. Refunded orders: payment_status refunded or partially_refunded (get_order shows each refund); cancelled ones have cancelledAt.',
    readOnly: true,
    input: z.object({
      search: z.string().trim().max(100).optional().describe('Order number, name, email, phone or invoice number'),
      view: z.enum(['orders', 'abandoned', 'all']).default('orders'),
      payment_status: z.enum(['pending', 'paid', 'partially_refunded', 'refunded', 'failed', 'expired']).optional(),
      fulfillment_status: z.enum(['unfulfilled', 'packed', 'shipped', 'delivered', 'not_required']).optional().describe('not_required = e-book only'),
      needs_attention: z.boolean().optional(),
      source: zChannel.optional().describe('Where the order came from'),
      from: zDate.optional(), to: zDate.optional(),
      ...zPage,
    }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/orders${qs({
        q: a.search, view: a.view, payment: a.payment_status, fulfillment: a.fulfillment_status, attention: a.needs_attention ? '1' : undefined,
        source: a.source, from: a.from, to: a.to, page: a.page, limit: a.limit,
      })}`);
      return {
        total: r.total, page: r.page, limit: r.limit,
        orders: r.items.map((o: Record<string, any>) => money({
          id: o.id, number: o.number, createdAt: o.createdAt, name: o.name, email: o.email, phone: o.phone, total: o.total, items: o.items, status: o.status,
          paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus, cancelledAt: o.cancelledAt, paymentMode: o.paymentMode, codAmount: o.codAmount, needsAttention: o.needsAttention,
          shipState: o.shipState, source: o.sourceLabel, sourceDetail: o.sourceDetail,
        }, ORDER_MONEY)),
      };
    },
  },
  {
    name: 'get_order',
    title: 'Get an order',
    description: 'One order in full: customer, items, payments, refunds, shipping and tracking, where the buyer came from, and its history.',
    readOnly: true,
    input: z.object({ order: z.string().trim().min(1).max(60).describe('Order number (e.g. 100123) or id') }),
    async run(ctx, a) {
      const d = await ctx.api('GET', `/orders/${await orderId(ctx, a.order)}`);
      const { ip: _ip, fbp: _fbp, fbc: _fbc, userAgent: _ua, razorpayOrderId: _ro, stockReserved: _sr, ...order } = d.order;
      const codCall = d.codCall && { ...d.codCall, transcript: String(d.codCall.transcript ?? '').slice(0, 2000) };
      return money({ order, source: d.source, items: d.items, events: d.events, payments: d.payments, refunds: d.refunds, customer: d.customer, codConfirmationCall: codCall }, ORDER_MONEY);
    },
  },
  {
    name: 'list_products',
    title: 'List products',
    description: 'Books in the catalogue with their formats, prices and stock. Archived books are left out unless status is "archived".',
    readOnly: true,
    input: z.object({
      search: z.string().trim().max(100).optional().describe('Title, author, ISBN, subject, class or SKU'),
      status: z.enum(['draft', 'active', 'archived']).optional().describe('active = on sale'),
      format: z.enum(['print', 'digital', 'bundle']).optional(),
      stock: z.enum(['low', 'out']).optional(),
      ...zPage,
    }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/products${qs({ q: a.search, status: a.status, format: a.format, stock: a.stock, page: a.page, limit: a.limit })}`);
      return {
        total: r.total, page: r.page, limit: r.limit,
        products: r.items.map(({ coverUrl, palette: _p, ...p }: Record<string, any>) => money({ ...p, url: `/books/${p.slug}`, hasCover: Boolean(coverUrl) }, PRODUCT_MONEY)),
      };
    },
  },
  {
    name: 'get_product',
    title: 'Get a product',
    description: 'One book in full: details, formats (printed, e-book, bundle) with prices, stock and e-book files, and copies sold.',
    readOnly: true,
    input: z.object({ product: z.string().trim().min(1).max(200).describe('Product id, slug or exact title') }),
    async run(ctx, a) {
      return productOut(await ctx.api('GET', `/products/${await productId(ctx, a.product)}`));
    },
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description: 'Catalogue categories with their ids (for create_product) and how many books each has.',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/categories')).items,
  },
  {
    name: 'get_inventory',
    title: 'Stock of printed books',
    description: 'Stock of every printed book, lowest first.',
    readOnly: true,
    input: z.object({ search: z.string().trim().max(100).optional(), low_only: z.boolean().default(false) }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/inventory${qs({ q: a.search, low: a.low_only ? '1' : undefined })}`);
      return { lowStockThreshold: r.lowStockThreshold, items: r.items.slice(0, 300) };
    },
  },
  {
    name: 'list_customers',
    title: 'List customers',
    description: 'Customers who have ordered, with order count and total spent.',
    readOnly: true,
    input: z.object({ search: z.string().trim().max(100).optional().describe('Name, email or phone'), sort: z.enum(['recent', 'spent', 'orders']).default('recent'), ...zPage }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/customers${qs({ q: a.search, sort: a.sort, page: a.page, limit: a.limit })}`);
      return { total: r.total, page: r.page, customers: money(r.items, ORDER_MONEY) };
    },
  },
  {
    name: 'get_customer',
    title: 'Get a customer',
    description: 'One customer and their orders.',
    readOnly: true,
    input: z.object({ customer_id: z.uuid() }),
    run: async (ctx, a) => money(await ctx.api('GET', `/customers/${a.customer_id}`), ORDER_MONEY),
  },
  {
    name: 'list_coupons',
    title: 'List discount codes',
    description: 'Discount codes with their value, limits, dates and how often they were used.',
    readOnly: true,
    input: z.object({}),
    async run(ctx) {
      const r = await ctx.api('GET', '/coupons');
      return r.items.map(({ value, ...c }: Record<string, any>) => money({ ...c, ...(c.type === 'percent' ? { percentOff: value } : { amountOff: value }) }, ['amountOff', 'minSubtotal', 'maxDiscount']));
    },
  },
  {
    name: 'list_enquiries',
    title: 'List enquiries',
    description: 'Sample, school/bulk, teacher, distributor, contact and proposal enquiries from the website.',
    readOnly: true,
    input: z.object({
      status: z.enum(['new', 'in_progress', 'closed', 'open']).optional().describe('open = not closed'),
      kind: z.enum(['sample', 'bulk', 'teacher', 'dist', 'contact', 'proposal']).optional(),
      search: z.string().trim().max(100).optional(),
      ...zPage,
    }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/enquiries${qs({ status: a.status, kind: a.kind, q: a.search, page: a.page, limit: a.limit })}`);
      return { total: r.total, page: r.page, enquiries: r.items };
    },
  },
  {
    name: 'get_newsletter_summary',
    title: 'Newsletter audience',
    description: 'How many people are subscribed to the newsletter, pending or unsubscribed, and how many signed-in accounts there are.',
    readOnly: true,
    input: z.object({}),
    run: (ctx) => ctx.api('GET', '/newsletter/summary'),
  },
  {
    name: 'list_competitions',
    title: 'List competitions',
    description: 'Every competition with its dates, phase, page visits, form starts, registrations and team applications (pending / approved).',
    role: 'owner',
    readOnly: true,
    input: z.object({}),
    run: async (ctx) => (await ctx.api('GET', '/competitions')).items,
  },
  {
    name: 'get_competition_stats',
    title: 'Competition analytics',
    description: 'One competition in detail: the registration funnel, registrations per day, which channels they came from, who registers, and for team competitions the teams by status, age group, institution type and state.',
    role: 'owner',
    readOnly: true,
    input: z.object({ slug: z.string().trim().max(100).describe(`Competition slug: ${COMPETITIONS.map((c) => c.slug).join(', ')}`), days: z.number().int().min(1).max(3650).default(30) }),
    async run(ctx, a) {
      const comp = COMPETITIONS.find((c) => c.slug === a.slug);
      if (!comp) throw new ToolError(`No competition "${a.slug}". Known: ${COMPETITIONS.map((c) => c.slug).join(', ')}.`);
      const [analytics, teams] = await Promise.all([
        ctx.api('GET', `/competitions/${comp.slug}/analytics${qs({ days: a.days })}`),
        comp.team ? ctx.api('GET', `/competitions/${comp.slug}/teams/stats`) : Promise.resolve(undefined),
      ]);
      return { competition: { slug: comp.slug, title: comp.title }, analytics, ...(teams ? { teams } : {}) };
    },
  },
  {
    name: 'get_activity_log',
    title: 'Activity log',
    description: 'What was changed in the admin, by whom (changes made through Claude show "via Claude"), newest first, 100 per page.',
    role: 'owner',
    readOnly: true,
    input: z.object({ page: z.number().int().min(1).max(1000).default(1) }),
    async run(ctx, a) {
      const r = await ctx.api('GET', `/audit${qs({ page: a.page })}`);
      return { total: r.total, page: r.page, entries: r.items.map(({ ip: _ip, ...e }: Record<string, any>) => e) };
    },
  },

  /* ---------------- Changes ---------------- */

  {
    name: 'create_product',
    title: 'Create a product',
    description: 'Adds a book as a draft (not on sale yet). Turn on at least one format: print, ebook, or both (bundle needs both). Prices are in rupees, GST included. Covers, photos and e-book files are uploaded in the admin (eldenap.in/admin → Products); then publish with set_product_status.',
    role: 'manager',
    input: z.object({ ...zProductFields }),
    async run(ctx, a) {
      if (!a.print && !a.ebook) throw new ToolError('Turn on at least one format: print or ebook.');
      const body = { ...applyFields(bodyFrom(null), a, true), status: 'draft' };
      delete (body as { slug?: string }).slug;
      const d = await ctx.api('POST', '/products', body);
      return { created: productOut(d), next: 'It is a draft. Upload the cover (and the e-book file) in the admin, then publish it with set_product_status.' };
    },
  },
  {
    name: 'update_product',
    title: 'Edit a product',
    description: 'Changes a book\'s details or prices. Only the fields you give are changed. Prices in rupees. To change stock use adjust_stock; to publish or unpublish use set_product_status.',
    role: 'manager',
    idempotent: true,
    input: z.object({ product: z.string().trim().min(1).max(200).describe('Product id, slug or exact title'), ...z.object(zProductFields).partial().shape }),
    async run(ctx, a) {
      const id = await productId(ctx, a.product);
      const cur: Detail = await ctx.api('GET', `/products/${id}`);
      const { product: _p, ...fields } = a;
      if (!Object.values(fields).some((v) => v !== undefined)) throw new ToolError('Nothing to change: give at least one field.');
      return { updated: productOut(await ctx.api('PUT', `/products/${id}`, applyFields(bodyFrom(cur), fields, false))) };
    },
  },
  {
    name: 'set_product_status',
    title: 'Publish, unpublish or archive',
    description: 'active = on sale on the website; draft = hidden; archived = retired. Publishing needs the e-book file uploaded for books sold as e-books.',
    role: 'manager',
    idempotent: true,
    input: z.object({
      products: z.array(z.string().trim().min(1).max(200)).min(1).max(50).describe('Product ids, slugs or exact titles'),
      status: z.enum(['active', 'draft', 'archived']),
    }),
    async run(ctx, a) {
      const ids = [...new Set(await Promise.all(a.products.map((p: string) => productId(ctx, p))))];
      await ctx.api('POST', '/products/bulk', { ids, action: a.status });
      return { ok: true, status: a.status, products: ids.length };
    },
  },
  {
    name: 'adjust_stock',
    title: 'Adjust stock',
    description: 'Changes the stock of a printed book: add or remove copies (change), or set the counted number (set_to). Logged in the stock history.',
    idempotent: false,
    input: z.object({
      product: z.string().trim().min(1).max(200).describe('Product id, slug or exact title'),
      change: z.number().int().min(-100_000).max(100_000).optional().describe('e.g. 50 when 50 copies arrive, -2 for damaged copies'),
      set_to: z.number().int().min(0).max(1_000_000).optional().describe('The counted stock'),
      reason: z.enum(['received', 'correction', 'damaged', 'returned', 'other']),
      note: z.string().trim().max(300).default(''),
    }),
    async run(ctx, a) {
      if ((a.change === undefined) === (a.set_to === undefined)) throw new ToolError('Give either change or set_to.');
      const d: Detail = await ctx.api('GET', `/products/${await productId(ctx, a.product)}`);
      const print = d.variants.print;
      if (!print) throw new ToolError(`"${d.product.title}" has no printed copy, so it has no stock.`);
      const r = await ctx.api('POST', `/inventory/${print.id}/adjust`, { ...(a.change !== undefined ? { delta: a.change } : { set: a.set_to }), reason: a.reason, note: a.note });
      return { product: d.product.title, stockBefore: print.stock, stockNow: r.stock };
    },
  },
  {
    name: 'create_category',
    title: 'Create a category',
    description: 'Adds a catalogue category.',
    role: 'manager',
    input: z.object({ name: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default('') }),
    run: (ctx, a) => ctx.api('POST', '/categories', { name: a.name, description: a.description, sort: 0 }),
  },
  {
    name: 'create_coupon',
    title: 'Create a discount code',
    description: 'Adds a discount code customers enter at checkout: a percentage (percent_off) or a fixed amount in rupees (amount_off_inr).',
    role: 'manager',
    input: z.object({
      code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3–30 letters, numbers, - or _'),
      description: z.string().trim().max(200).default(''),
      percent_off: z.number().int().min(1).max(100).optional(),
      amount_off_inr: z.number().min(1).max(1_000_000).optional(),
      min_order_inr: z.number().min(0).max(10_000_000).default(0),
      max_discount_inr: z.number().min(1).max(10_000_000).nullable().optional().describe('Cap for percentage codes'),
      starts_at: z.iso.datetime({ offset: true }).nullable().optional().describe('ISO time, e.g. 2026-11-20T00:00:00+05:30'),
      ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
      usage_limit: z.number().int().min(1).max(1_000_000).nullable().optional().describe('Total uses allowed'),
      once_per_customer: z.boolean().default(false),
      active: z.boolean().default(true),
    }),
    async run(ctx, a) {
      if ((a.percent_off === undefined) === (a.amount_off_inr === undefined)) throw new ToolError('Give either percent_off or amount_off_inr.');
      const row = await ctx.api('POST', '/coupons', {
        code: a.code, description: a.description, type: a.percent_off !== undefined ? 'percent' : 'fixed',
        value: a.percent_off ?? paise(a.amount_off_inr), minSubtotal: paise(a.min_order_inr), maxDiscount: a.max_discount_inr ? paise(a.max_discount_inr) : null,
        startsAt: a.starts_at ?? null, endsAt: a.ends_at ?? null, usageLimit: a.usage_limit ?? null, oncePerCustomer: a.once_per_customer, active: a.active,
      });
      return { created: row.code, id: row.id, active: row.active };
    },
  },
  {
    name: 'set_coupon_active',
    title: 'Switch a discount code on or off',
    description: 'Turns a discount code on or off.',
    role: 'manager',
    idempotent: true,
    input: z.object({ code: z.string().trim().toUpperCase().max(30), active: z.boolean() }),
    async run(ctx, a) {
      const { items } = await ctx.api('GET', '/coupons');
      const c = items.find((x: { code: string }) => x.code === a.code);
      if (!c) throw new ToolError(`No discount code ${a.code}.`);
      const row = await ctx.api('PUT', `/coupons/${c.id}`, {
        code: c.code, description: c.description, type: c.type, value: c.value, minSubtotal: c.minSubtotal, maxDiscount: c.maxDiscount,
        startsAt: c.startsAt, endsAt: c.endsAt, usageLimit: c.usageLimit, oncePerCustomer: c.oncePerCustomer, active: a.active,
      });
      return { code: row.code, active: row.active };
    },
  },
  {
    name: 'update_order_fulfillment',
    title: 'Mark an order packed, shipped or delivered',
    description: 'Updates where a paid order with printed books is: packed, shipped (needs a tracking number) or delivered. Marking it shipped emails (and WhatsApps, if set up) the customer their tracking unless notify_customer is false. Delivered on a cash-on-delivery order records the cash as collected.',
    reachesCustomers: true,
    idempotent: true,
    input: z.object({
      order: z.string().trim().min(1).max(60).describe('Order number or id'),
      status: z.enum(['unfulfilled', 'packed', 'shipped', 'delivered']),
      courier: z.string().trim().max(80).optional(),
      tracking_number: z.string().trim().max(80).optional(),
      tracking_url: z.url().max(500).optional(),
      notify_customer: z.boolean().default(true),
    }),
    async run(ctx, a) {
      const r = await ctx.api('POST', `/orders/${await orderId(ctx, a.order)}/fulfillment`, {
        status: a.status, courier: a.courier, trackingNumber: a.tracking_number, trackingUrl: a.tracking_url, notify: a.notify_customer,
      });
      const o = r.order;
      return { number: o.number, fulfillmentStatus: o.fulfillmentStatus, courier: o.courier, trackingNumber: o.trackingNumber, customerNotified: a.status === 'shipped' && a.notify_customer };
    },
  },
  {
    name: 'add_order_note',
    title: 'Add an internal note to an order',
    description: 'Adds a note for the team to an order (customers never see it). Earlier notes are kept.',
    input: z.object({ order: z.string().trim().min(1).max(60), note: z.string().trim().min(1).max(1000) }),
    async run(ctx, a) {
      const id = await orderId(ctx, a.order);
      const d = await ctx.api('GET', `/orders/${id}`);
      const line = `[${istNow()} IST, ${ctx.session.email} via Claude] ${a.note}`;
      const note = [d.order.internalNote, line].filter(Boolean).join('\n');
      if (note.length > 5000) throw new ToolError('The order’s notes are full (5,000 characters). Tidy them in the admin first.');
      await ctx.api('POST', `/orders/${id}/note`, { internalNote: note });
      return { number: d.order.number, internalNote: note };
    },
  },
  {
    name: 'update_enquiry_status',
    title: 'Update an enquiry',
    description: 'Moves an enquiry to new, in_progress or closed.',
    idempotent: true,
    input: z.object({ enquiry_id: z.uuid(), status: z.enum(['new', 'in_progress', 'closed']) }),
    async run(ctx, a) {
      const r = await ctx.api('PATCH', `/enquiries/${a.enquiry_id}`, { status: a.status });
      return { id: r.id, name: r.name, status: r.status, handledBy: r.handledBy };
    },
  },
];


/* ---------------- Prompts ---------------- */

export const PROMPTS = [
  {
    name: 'meta_ads_vs_store',
    title: 'Meta ads vs real orders',
    description: 'Compare what Meta Ads reports with paid orders on eldenap.in, campaign by campaign.',
    arguments: [{ name: 'days', description: 'How many days back (default 7)', required: false }],
    text: (args: Record<string, string>) => {
      const days = Math.min(365, Math.max(1, Number(args.days) || 7));
      return `Compare my Meta (Facebook/Instagram) ads with real orders on eldenap.in for the last ${days} days.
1. Call get_sales_by_source for those dates (and again with channel "meta_ads" for the campaign, ad and ad-set breakdowns).
2. From the Meta Ads connector, get spend, impressions, clicks (link clicks), purchases and purchase value per campaign for the same dates.
3. Match Meta campaigns to utm_campaign (and ads to utm_content). Show one table: campaign, spend, Meta purchases, Meta purchase value, website orders, website revenue, real ROAS (website revenue ÷ spend), cost per real order, and the gap between Meta and the website.
4. Say plainly which campaigns make money and which don't, what share of all sales Meta ads drive, and flag ads whose links are missing UTM tags.
Use rupees. Keep in mind that Meta also counts view-through and cross-device conversions, so its numbers run higher than the website's.`;
    },
  },
  {
    name: 'weekly_store_report',
    title: 'Weekly store report',
    description: 'Sales, best sellers, sources and what needs doing this week.',
    arguments: [],
    text: () => 'Give me this week’s eldenap.in report: call get_store_overview with days 7 and get_sales_by_source for the last 7 days. Summarise sales against the week before, best sellers, where buyers came from, cash on delivery still to collect, low stock, and the orders and enquiries waiting on us. End with the three things to do first.',
  },
];
