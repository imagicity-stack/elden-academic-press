import { Hono } from 'hono';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { coupons, customers, enquiries, orders, resources } from '../../db/schema.js';
import { toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound, query, zText } from '../../lib/http.js';
import { orderStatusLabel } from '../orders.js';
import { audit, requireRole } from './auth.js';

const likeOf = (q: string) => `%${q.replace(/[%_]/g, '\\$&')}%`;
const zPage = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) };

/* ---------------- Customers ---------------- */

export const adminCustomers = new Hono<AppEnv>();

adminCustomers.get('/', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, z.object({ q: z.string().trim().max(100).optional(), sort: z.enum(['recent', 'spent', 'orders']).default('recent'), ...zPage }));
  const where = f.q ? or(ilike(customers.name, likeOf(f.q)), ilike(customers.email, likeOf(f.q)), ilike(customers.phone, likeOf(f.q))) : undefined;
  const order = f.sort === 'spent' ? desc(customers.totalSpent) : f.sort === 'orders' ? desc(customers.ordersCount) : desc(customers.lastOrderAt);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(customers).where(where).orderBy(order).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(customers).where(where),
  ]);
  return c.json({ items: rows, total, page: f.page, limit: f.limit });
});

adminCustomers.get('/export.csv', async (c) => {
  const { db } = c.get('deps');
  const rows = await db.select().from(customers).orderBy(desc(customers.lastOrderAt)).limit(50_000);
  const csv = toCsv(rows, [['Name', (r) => r.name], ['Email', (r) => r.email], ['Phone', (r) => r.phone], ['Orders', (r) => r.ordersCount],
    ['Total spent', (r) => (r.totalSpent / 100).toFixed(2)], ['First order', (r) => r.firstOrderAt], ['Last order', (r) => r.lastOrderAt]]);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="customers.csv"' });
});

adminCustomers.get('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const [cust] = await db.select().from(customers).where(eq(customers.id, c.req.param('id')));
  if (!cust) throw notFound('Customer not found');
  const rows = await db.select().from(orders).where(eq(orders.email, cust.email)).orderBy(desc(orders.createdAt)).limit(200);
  return c.json({
    customer: cust,
    orders: rows.map((o) => ({ id: o.id, number: o.number, createdAt: o.createdAt, total: o.total, status: orderStatusLabel(o), paymentStatus: o.paymentStatus, fulfillmentStatus: o.fulfillmentStatus })),
  });
});

adminCustomers.put('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ notes: zText(5000) }));
  const [row] = await db.update(customers).set({ notes: input.notes, updatedAt: sql`now()` }).where(eq(customers.id, c.req.param('id'))).returning();
  if (!row) throw notFound();
  return c.json({ customer: row });
});

/* ---------------- Coupons ---------------- */

export const adminCoupons = new Hono<AppEnv>();

const zCoupon = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, 'Use 3–30 letters, numbers, - or _'),
  description: zText(200).default(''),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  minSubtotal: z.number().int().min(0).default(0),
  maxDiscount: z.number().int().positive().nullable().optional(),
  startsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  endsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  oncePerCustomer: z.boolean().default(false),
  active: z.boolean().default(true),
}).refine((v) => v.type !== 'percent' || v.value <= 100, { message: 'A percentage can be at most 100', path: ['value'] });

const couponValues = (v: z.infer<typeof zCoupon>) => ({
  ...v, maxDiscount: v.maxDiscount ?? null, usageLimit: v.usageLimit ?? null,
  startsAt: v.startsAt ? new Date(v.startsAt) : null, endsAt: v.endsAt ? new Date(v.endsAt) : null,
});

adminCoupons.get('/', async (c) => {
  const { db } = c.get('deps');
  return c.json({ items: await db.select().from(coupons).orderBy(desc(coupons.active), desc(coupons.createdAt)) });
});

adminCoupons.post('/', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zCoupon);
  const [row] = await db.insert(coupons).values(couponValues(input)).onConflictDoNothing().returning();
  if (!row) throw new HttpError(409, 'That code already exists.');
  await audit(c, 'coupon.create', 'coupon', row.code, input);
  return c.json(row, 201);
});

adminCoupons.put('/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zCoupon);
  const [row] = await db.update(coupons).set({ ...couponValues(input), updatedAt: sql`now()` }).where(eq(coupons.id, c.req.param('id'))).returning()
    .catch(() => { throw new HttpError(409, 'That code already exists.'); });
  if (!row) throw notFound();
  await audit(c, 'coupon.update', 'coupon', row.code, input);
  return c.json(row);
});

adminCoupons.delete('/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const [row] = await db.select().from(coupons).where(eq(coupons.id, c.req.param('id')));
  if (!row) throw notFound();
  // Used codes stay on old orders, so they are switched off rather than deleted.
  if (row.usedCount > 0) await db.update(coupons).set({ active: false, updatedAt: sql`now()` }).where(eq(coupons.id, row.id));
  else await db.delete(coupons).where(eq(coupons.id, row.id));
  await audit(c, 'coupon.delete', 'coupon', row.code);
  return c.json({ deactivated: row.usedCount > 0 });
});

/* ---------------- Enquiries ---------------- */

export const adminEnquiries = new Hono<AppEnv>();

const zEnqList = z.object({
  kind: z.enum(['sample', 'bulk', 'teacher', 'dist', 'contact', 'proposal']).optional(),
  status: z.enum(['new', 'in_progress', 'closed', 'open']).optional(),
  q: z.string().trim().max(100).optional(),
  ...zPage,
});
const enqWhere = (f: z.infer<typeof zEnqList>) => {
  const w: (SQL | undefined)[] = [];
  if (f.kind) w.push(eq(enquiries.kind, f.kind));
  if (f.status === 'open') w.push(sql`${enquiries.status} <> 'closed'`);
  else if (f.status) w.push(eq(enquiries.status, f.status));
  if (f.q) w.push(or(ilike(enquiries.name, likeOf(f.q)), ilike(enquiries.email, likeOf(f.q)), ilike(enquiries.institution, likeOf(f.q)), ilike(enquiries.phone, likeOf(f.q))));
  return and(...w);
};

adminEnquiries.get('/', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, zEnqList);
  const where = enqWhere(f);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(enquiries).where(where).orderBy(desc(enquiries.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(enquiries).where(where),
  ]);
  return c.json({ items: rows.map(({ ip: _ip, ...r }) => r), total, page: f.page, limit: f.limit });
});

adminEnquiries.get('/export.csv', async (c) => {
  const { db } = c.get('deps');
  const rows = await db.select().from(enquiries).where(enqWhere(query(c, zEnqList))).orderBy(desc(enquiries.createdAt)).limit(50_000);
  const csv = toCsv(rows, [['Date', (r) => r.createdAt], ['Type', (r) => r.kind], ['Status', (r) => r.status], ['Name', (r) => r.name], ['Email', (r) => r.email],
    ['Phone', (r) => r.phone], ['Institution', (r) => r.institution], ['City', (r) => r.city], ['Role', (r) => r.role], ['Title', (r) => r.title],
    ['Message', (r) => r.message], ['Details', (r) => (r.data ? JSON.stringify(r.data) : '')]]);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="enquiries.csv"' });
});

adminEnquiries.patch('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ status: z.enum(['new', 'in_progress', 'closed']) }));
  const [row] = await db.update(enquiries).set({ status: input.status, handledBy: c.get('admin').email, updatedAt: sql`now()` }).where(eq(enquiries.id, c.req.param('id'))).returning();
  if (!row) throw notFound();
  return c.json(row);
});

/* ---------------- Study Hub resources ---------------- */

export const adminResources = new Hono<AppEnv>();

const zResource = z.object({
  title: z.string().trim().min(3).max(200),
  kind: z.string().trim().min(2).max(60),
  level: z.enum(['P', 'M', 'S', 'SS', 'C', 'H']),
  subject: zText(80).default(''),
  filePath: z.string().max(300).nullable().optional(),
  fileSize: z.number().int().nullable().optional(),
  published: z.boolean().default(false),
  sort: z.number().int().default(0),
}).refine((r) => !r.published || r.filePath, { message: 'Upload the file before publishing', path: ['filePath'] });

adminResources.get('/', async (c) => {
  const { db, storage } = c.get('deps');
  const rows = await db.select().from(resources).orderBy(asc(resources.sort), desc(resources.createdAt));
  return c.json({ items: rows.map((r) => ({ ...r, url: r.filePath ? storage.publicUrl('resources', r.filePath) : null })) });
});

adminResources.post('/', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zResource);
  const [row] = await db.insert(resources).values({ ...input, filePath: input.filePath ?? null, fileSize: input.fileSize ?? null }).returning();
  await audit(c, 'resource.create', 'resource', row.id, { title: row.title });
  return c.json(row, 201);
});

adminResources.put('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zResource);
  const [row] = await db.update(resources).set({ ...input, filePath: input.filePath ?? null, fileSize: input.fileSize ?? null, updatedAt: sql`now()` })
    .where(eq(resources.id, c.req.param('id'))).returning();
  if (!row) throw notFound();
  await audit(c, 'resource.update', 'resource', row.id, { title: row.title });
  return c.json(row);
});

adminResources.delete('/:id{[0-9a-f-]{36}}', async (c) => {
  const { db } = c.get('deps');
  await db.delete(resources).where(eq(resources.id, c.req.param('id')));
  await audit(c, 'resource.delete', 'resource', c.req.param('id'));
  return c.json({ ok: true });
});
