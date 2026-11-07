// Admin → Popups: create from a template, edit, publish or pause, duplicate, delete, and the
// numbers (shown, clicked, closed, signed up; orders with the popup's discount code).
// Managers and the owner. Everything saved is checked against src/shared/popups.ts's shapes.
import { Hono, type Context } from 'hono';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { coupons, orders, popupStats, popups } from '../../db/schema.js';
import { body, HttpError, notFound } from '../../lib/http.js';
import { istDay, publishProblems, zPopupFields } from '../../services/popups.js';
import { blankPopup, TEMPLATES } from '../../../src/shared/popups.js';
import { audit } from './auth.js';

export const adminPopups = new Hono<AppEnv>();

const ID = '[0-9a-f-]{36}';
type Row = typeof popups.$inferSelect;
const PAID = ['paid', 'partially_refunded', 'refunded'] as const;

const view = (p: Row) => ({
  id: p.id, name: p.name, status: p.status, priority: p.priority,
  content: p.content, design: p.design, trigger: p.trigger, audience: p.audience, frequency: p.frequency,
  startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null,
  createdAt: p.createdAt, updatedAt: p.updatedAt, createdBy: p.createdBy,
});

async function load(c: Context<AppEnv>) {
  const [p] = await c.get('deps').db.select().from(popups).where(eq(popups.id, c.req.param('id')!));
  if (!p) throw notFound('Popup not found');
  return p;
}

/** Things worth knowing before publishing: a discount code that doesn't exist or has ended. */
async function warnings(db: AppEnv['Variables']['deps']['db'], p: Pick<Row, 'content'>, now: Date) {
  const code = p.content.coupon;
  if (!code || !['subscribe', 'coupon'].includes(p.content.goal)) return [];
  const [cp] = await db.select().from(coupons).where(eq(coupons.code, code));
  if (!cp) return [`There's no discount code ${code} yet: add it in Discounts, or visitors will be shown a code that doesn't work.`];
  if (!cp.active || (cp.endsAt && cp.endsAt < now)) return [`The discount code ${code} is switched off or has ended.`];
  if (cp.usageLimit !== null && cp.usedCount >= cp.usageLimit) return [`The discount code ${code} has reached its usage limit.`];
  return [];
}

/** Every popup with its last 30 days' numbers. */
adminPopups.get('/', async (c) => {
  const { db, now } = c.get('deps');
  const since = istDay(new Date(now().getTime() - 29 * 86_400_000));
  const [rows, stats] = await Promise.all([
    db.select().from(popups).orderBy(desc(popups.updatedAt)),
    db.select({
      popupId: popupStats.popupId, views: sql<number>`sum(${popupStats.views})::int`, clicks: sql<number>`sum(${popupStats.clicks})::int`,
      closes: sql<number>`sum(${popupStats.closes})::int`, conversions: sql<number>`sum(${popupStats.conversions})::int`,
    }).from(popupStats).where(gte(popupStats.day, since)).groupBy(popupStats.popupId),
  ]);
  return c.json({
    items: rows.map((p) => ({ ...view(p), stats: stats.find((s) => s.popupId === p.id) ?? { views: 0, clicks: 0, closes: 0, conversions: 0 } })),
  });
});

/** A new draft, from a template (or blank). */
adminPopups.post('/', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ name: z.string().trim().min(1, 'Give it a name').max(80), template: z.string().max(40).optional() }));
  const t = TEMPLATES.find((x) => x.key === input.template)?.popup ?? blankPopup();
  const [p] = await db.insert(popups).values({
    name: input.name, content: t.content, design: t.design, trigger: t.trigger, audience: t.audience, frequency: t.frequency,
    createdBy: c.get('admin').email,
  }).returning();
  await audit(c, 'popup.create', 'popup', p.name);
  return c.json(view(p), 201);
});

/** One popup, its numbers by day (last 30 days) and orders that used its discount code. */
adminPopups.get(`/:id{${ID}}`, async (c) => {
  const { db, now } = c.get('deps');
  const p = await load(c);
  const since = istDay(new Date(now().getTime() - 29 * 86_400_000));
  const days = await db.select().from(popupStats).where(and(eq(popupStats.popupId, p.id), gte(popupStats.day, since))).orderBy(popupStats.day);
  const [all] = await db.select({
    views: sql<number>`coalesce(sum(${popupStats.views}), 0)::int`, clicks: sql<number>`coalesce(sum(${popupStats.clicks}), 0)::int`,
    closes: sql<number>`coalesce(sum(${popupStats.closes}), 0)::int`, conversions: sql<number>`coalesce(sum(${popupStats.conversions}), 0)::int`,
  }).from(popupStats).where(eq(popupStats.popupId, p.id));
  let couponOrders = null;
  if (p.content.coupon) {
    const [o] = await db.select({ orders: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${orders.total} - ${orders.refundedAmount}), 0)::int` })
      .from(orders).where(and(eq(orders.couponCode, p.content.coupon), inArray(orders.paymentStatus, PAID), gte(orders.createdAt, p.createdAt)));
    couponOrders = { code: p.content.coupon, ...o };
  }
  return c.json({ popup: view(p), days, totals: all, couponOrders, warnings: await warnings(db, p, now()) });
});

adminPopups.put(`/:id{${ID}}`, async (c) => {
  const deps = c.get('deps');
  const p = await load(c);
  const input = await body(c, zPopupFields(deps.storage.publicUrl('covers', '')).extend({
    name: z.string().trim().min(1, 'Give it a name').max(80), priority: z.number().int().min(-100).max(100),
  }));
  if (p.status === 'live') {
    const problems = publishProblems(input);
    if (problems.length) throw new HttpError(400, problems.join(' '), 'not_ready');
  }
  const [row] = await deps.db.update(popups).set({
    name: input.name, priority: input.priority, content: input.content, design: input.design, trigger: input.trigger, audience: input.audience, frequency: input.frequency,
    startsAt: input.startsAt ? new Date(input.startsAt) : null, endsAt: input.endsAt ? new Date(input.endsAt) : null, updatedAt: deps.now(),
  }).where(eq(popups.id, p.id)).returning();
  await audit(c, 'popup.update', 'popup', row.name);
  return c.json({ popup: view(row), warnings: await warnings(deps.db, row, deps.now()) });
});

/** Publish, pause or back to draft. */
adminPopups.post(`/:id{${ID}}/status`, async (c) => {
  const deps = c.get('deps');
  const p = await load(c);
  const { status } = await body(c, z.object({ status: z.enum(['draft', 'live', 'paused']) }));
  if (status === 'live') {
    const problems = publishProblems(p);
    if (problems.length) throw new HttpError(400, problems.join(' '), 'not_ready');
  }
  const [row] = await deps.db.update(popups).set({ status, updatedAt: deps.now() }).where(eq(popups.id, p.id)).returning();
  await audit(c, `popup.${status === 'live' ? 'publish' : status === 'paused' ? 'pause' : 'unpublish'}`, 'popup', row.name);
  return c.json(view(row));
});

adminPopups.post(`/:id{${ID}}/duplicate`, async (c) => {
  const { db } = c.get('deps');
  const p = await load(c);
  const [row] = await db.insert(popups).values({
    name: `${p.name} (copy)`.slice(0, 80), priority: p.priority, content: p.content, design: p.design, trigger: p.trigger, audience: p.audience, frequency: p.frequency,
    startsAt: p.startsAt, endsAt: p.endsAt, createdBy: c.get('admin').email,
  }).returning();
  await audit(c, 'popup.duplicate', 'popup', row.name);
  return c.json(view(row), 201);
});

adminPopups.delete(`/:id{${ID}}`, async (c) => {
  const { db } = c.get('deps');
  const p = await load(c);
  await db.delete(popups).where(eq(popups.id, p.id));
  await audit(c, 'popup.delete', 'popup', p.name);
  return c.json({ ok: true });
});
