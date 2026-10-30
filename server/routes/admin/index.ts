import { Hono } from 'hono';
import { and, asc, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { adminUsers, auditLog, enquiries, orderItems, orders, productVariants, products, settings } from '../../db/schema.js';
import { body, HttpError, notFound, query, zText } from '../../lib/http.js';
import { isStateCode } from '../../lib/states.js';
import { getSettings } from '../../services/catalog.js';
import { orderStatusLabel } from '../orders.js';
import { audit, requireAdmin, requireRole } from './auth.js';
import { adminOrders } from './orders.js';
import { adminCoupons, adminCustomers, adminEnquiries, adminResources } from './people.js';
import { adminCategories, adminInventory, adminProducts, adminUploads } from './products.js';

export type { AdminSession } from './auth.js';

export const admin = new Hono<AppEnv>();

/** Who am I — works before two-step verification so the UI knows what to ask for. */
admin.get('/me', requireAdmin({ allowAal1: true }), (c) => {
  const s = c.get('admin');
  return c.json({ ...s, mfaSatisfied: !s.mfaRequired || s.aal === 'aal2' });
});

admin.use('*', requireAdmin());

admin.route('/orders', adminOrders);
admin.route('/products', adminProducts);
admin.route('/inventory', adminInventory);
admin.route('/categories', adminCategories);
admin.route('/uploads', adminUploads);
admin.route('/customers', adminCustomers);
admin.route('/coupons', adminCoupons);
admin.route('/enquiries', adminEnquiries);
admin.route('/resources', adminResources);

const PAID = ['paid', 'partially_refunded', 'refunded'] as const;
const IST_DAY = sql`(${orders.paidAt} at time zone 'Asia/Kolkata')::date`;

admin.get('/dashboard', async (c) => {
  const { db } = c.get('deps');
  const s = await getSettings(db);
  const since = new Date(Date.now() - 31 * 86400_000);
  const net = sql<number>`coalesce(sum(${orders.total} - ${orders.refundedAmount}), 0)::int`;
  const [series, toFulfil, attention, lowStock, newEnquiries, recent, top, abandoned] = await Promise.all([
    db.select({ day: sql<string>`${IST_DAY}::text`, revenue: net, orders: sql<number>`count(*)::int` }).from(orders)
      .where(and(inArray(orders.paymentStatus, PAID), gte(orders.paidAt, since))).groupBy(IST_DAY).orderBy(IST_DAY),
    db.select({ n: count() }).from(orders).where(and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), eq(orders.requiresShipping, true),
      inArray(orders.fulfillmentStatus, ['unfulfilled', 'packed']), isNull(orders.cancelledAt))),
    db.select({ n: count() }).from(orders).where(eq(orders.needsAttention, true)),
    db.select({ productId: products.id, title: products.title, stock: productVariants.stock }).from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(and(eq(productVariants.kind, 'print'), eq(productVariants.active, true), eq(productVariants.trackStock, true), eq(products.status, 'active'), sql`${productVariants.stock} <= ${s.lowStockThreshold}`))
      .orderBy(asc(productVariants.stock)).limit(8),
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, 'new')),
    db.select().from(orders).where(inArray(orders.paymentStatus, PAID)).orderBy(desc(orders.paidAt)).limit(8),
    db.select({ title: orderItems.title, quantity: sql<number>`sum(${orderItems.quantity})::int`, revenue: sql<number>`sum(${orderItems.lineTotal} - ${orderItems.discount})::int` })
      .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(inArray(orders.paymentStatus, ['paid', 'partially_refunded']), gte(orders.paidAt, since)))
      .groupBy(orderItems.title).orderBy(desc(sql`sum(${orderItems.quantity})`)).limit(5),
    db.select({ n: count() }).from(orders).where(and(eq(orders.paymentStatus, 'expired'), gte(orders.createdAt, new Date(Date.now() - 7 * 86400_000)))),
  ]);

  // Fill the last 30 IST days so the chart has no gaps.
  const todayIst = new Date(Date.now() + 330 * 60_000);
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(todayIst.getTime() - (29 - i) * 86400_000).toISOString().slice(0, 10);
    const hit = series.find((r) => r.day === d);
    return { day: d, revenue: hit?.revenue ?? 0, orders: hit?.orders ?? 0 };
  });
  const sum = (from: number) => days.slice(from).reduce((a, d) => ({ revenue: a.revenue + d.revenue, orders: a.orders + d.orders }), { revenue: 0, orders: 0 });
  const m30 = sum(0);
  return c.json({
    today: sum(29), week: sum(23), month: m30, aov: m30.orders ? Math.round(m30.revenue / m30.orders) : 0,
    series: days, toFulfil: toFulfil[0].n, attention: attention[0].n, newEnquiries: newEnquiries[0].n, abandonedWeek: abandoned[0].n,
    lowStock, lowStockThreshold: s.lowStockThreshold, topProducts: top,
    recentOrders: recent.map((o) => ({ id: o.id, number: o.number, name: o.name, total: o.total, paidAt: o.paidAt, status: orderStatusLabel(o) })),
  });
});

/* ---------------- Settings ---------------- */

admin.get('/settings', async (c) => c.json(await getSettings(c.get('deps').db)));

admin.put('/settings', requireRole('owner'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({
    storeName: z.string().trim().min(2).max(120),
    legalName: z.string().trim().min(2).max(200),
    gstin: z.union([z.literal(''), z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')]),
    address: zText(500),
    stateCode: z.string().refine(isStateCode, 'Choose a state'),
    supportEmail: z.email(),
    supportPhone: zText(30).default(''),
    shippingFlat: z.number().int().min(0).max(1_000_000),
    freeShippingAbove: z.number().int().min(0).max(100_000_000),
    orderExpiryMinutes: z.number().int().min(10).max(1440),
    invoicePrefix: z.string().trim().regex(/^[A-Z0-9]{1,6}$/, 'Up to 6 capital letters/numbers'),
    notifyEmails: z.array(z.email()).max(10),
    requireMfa: z.boolean(),
    lowStockThreshold: z.number().int().min(0).max(1000),
    maxDownloads: z.number().int().min(1).max(100),
    downloadExpiryDays: z.number().int().min(0).max(3650),
  }).refine((v) => !v.gstin || v.gstin.startsWith(v.stateCode), { message: 'The GSTIN’s first two digits should match the business state code', path: ['gstin'] }));
  const [row] = await db.update(settings).set({ ...input, updatedAt: sql`now()` }).where(eq(settings.id, 1)).returning();
  await audit(c, 'settings.update', 'settings', 1, input);
  return c.json(row);
});

/* ---------------- Staff ---------------- */

admin.get('/staff', requireRole('owner'), async (c) => {
  const { db } = c.get('deps');
  return c.json({ items: await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt)) });
});

admin.post('/staff', requireRole('owner'), async (c) => {
  const { db, env } = c.get('deps');
  const input = await body(c, z.object({ email: z.email().transform((e) => e.toLowerCase()), name: zText(120).default(''), role: z.enum(['manager', 'staff']) }));
  const [exists] = await db.select().from(adminUsers).where(eq(adminUsers.email, input.email));
  if (exists) throw new HttpError(409, 'That person already has access.');

  let userId: string;
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const invited = await sb.auth.admin.inviteUserByEmail(input.email, { redirectTo: `${env.SITE_URL}/admin` });
    if (invited.data.user) userId = invited.data.user.id;
    else {
      // Already has a Supabase account: look the user up and grant access.
      const link = await sb.auth.admin.generateLink({ type: 'magiclink', email: input.email });
      if (!link.data.user) throw new HttpError(502, invited.error?.message ?? 'Could not invite this person.');
      userId = link.data.user.id;
    }
  } else if (env.onVercel) throw new HttpError(503, 'Supabase is not configured.');
  else userId = randomUUID();

  const [row] = await db.insert(adminUsers).values({ userId, email: input.email, name: input.name, role: input.role }).returning();
  await audit(c, 'staff.invite', 'admin', input.email, { role: input.role });
  return c.json(row, 201);
});

admin.put('/staff/:userId{[0-9a-f-]{36}}', requireRole('owner'), async (c) => {
  const { db } = c.get('deps');
  const userId = c.req.param('userId');
  if (userId === c.get('admin').userId) throw new HttpError(400, 'You can’t change your own access.');
  const input = await body(c, z.object({ role: z.enum(['owner', 'manager', 'staff']), active: z.boolean(), name: zText(120).optional() }));
  const [row] = await db.update(adminUsers).set(input).where(eq(adminUsers.userId, userId)).returning();
  if (!row) throw notFound();
  await audit(c, 'staff.update', 'admin', row.email, input);
  return c.json(row);
});

admin.get('/audit', requireRole('owner'), async (c) => {
  const { db } = c.get('deps');
  const f = query(c, z.object({ page: z.coerce.number().int().min(1).default(1) }));
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(100).offset((f.page - 1) * 100),
    db.select({ total: count() }).from(auditLog),
  ]);
  return c.json({ items: rows, total, page: f.page, limit: 100 });
});
