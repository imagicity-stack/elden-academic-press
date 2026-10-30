// Enquiry forms, scheduled jobs and local-development helpers.
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { enquiries, orders } from '../db/schema.js';
import { safeEqual } from '../lib/crypto.js';
import { body, HttpError, notFound, rateLimit, zEmail, zName, zText } from '../lib/http.js';
import type { localStorage } from '../lib/storage.js';
import { eq } from 'drizzle-orm';
import { getSettings } from '../services/catalog.js';
import { sendEnquiryNotice } from '../services/emails.js';
import { expireOrders } from '../services/orders.js';

/* ---------------- Enquiry forms ---------------- */

export const forms = new Hono<AppEnv>();

const zOptionalEmail = z.union([zEmail, z.literal('')]).optional();

forms.post('/enquiries', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, z.object({
    kind: z.enum(['sample', 'bulk', 'teacher', 'dist', 'contact', 'proposal']),
    name: zName,
    email: zOptionalEmail,
    phone: zText(20).optional(),
    institution: zText(200).optional(),
    city: zText(100).optional(),
    role: zText(100).optional(),
    title: zText(300).optional(),
    message: zText(5000).optional(),
    data: z.record(z.string().max(60), z.string().max(500)).optional(),
    website: z.string().max(0).optional(), // honeypot
  }).refine((v) => v.email || v.phone, { message: 'Give an email or a phone number', path: ['email'] }));
  await rateLimit(deps.db, `enquiry:${c.get('ip')}`, 8, 3600);
  const [e] = await deps.db.insert(enquiries).values({
    kind: input.kind, name: input.name, email: input.email ?? '', phone: input.phone ?? '', institution: input.institution ?? '',
    city: input.city ?? '', role: input.role ?? '', title: input.title ?? '', message: input.message ?? '', data: input.data ?? null, ip: c.get('ip'),
  }).returning();
  await sendEnquiryNotice(deps, e, await getSettings(deps.db));
  return c.json({ ok: true }, 201);
});

/* ---------------- Scheduled jobs (Vercel Cron) ---------------- */

export const cron = new Hono<AppEnv>();

cron.use('*', async (c, next) => {
  const secret = c.get('deps').env.CRON_SECRET;
  const auth = c.req.header('authorization') ?? '';
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorised');
  await next();
});

cron.get('/expire-orders', async (c) => c.json({ expired: await expireOrders(c.get('deps')) }));

/* ---------------- Local development only ---------------- */

export const dev = new Hono<AppEnv>();

dev.use('*', async (c, next) => {
  if (c.get('deps').env.onVercel) throw notFound();
  await next();
});

/** Stand-in for Razorpay's payment window when the simulator is on. */
dev.post('/simulate-payment', async (c) => {
  const deps = c.get('deps');
  const rzp = deps.razorpay as (NonNullable<typeof deps.razorpay> & { simulatePayment?: (id: string, o?: { fail?: boolean; method?: string }) => unknown }) | null;
  if (!rzp?.simulated || !rzp.simulatePayment) throw notFound();
  const input = await body(c, z.object({ razorpayOrderId: z.string(), fail: z.boolean().optional(), method: z.string().optional() }));
  const [o] = await deps.db.select({ id: orders.id }).from(orders).where(eq(orders.razorpayOrderId, input.razorpayOrderId));
  if (!o) throw notFound();
  return c.json(rzp.simulatePayment(input.razorpayOrderId, { fail: input.fail, method: input.method }));
});

/** Serves and accepts files for the local storage stand-in. */
dev.on(['GET', 'PUT'], '/files/:bucket/*', async (c) => {
  const store = c.get('deps').storage as ReturnType<typeof localStorage>;
  if (!('root' in store)) throw notFound();
  const bucket = c.req.param('bucket');
  const path = normalize(decodeURIComponent(c.req.path.split(`/files/${bucket}/`)[1] ?? ''));
  if (!['covers', 'ebooks', 'resources'].includes(bucket) || path.startsWith('..') || path.includes('\0')) throw notFound();
  if (c.req.method === 'PUT') {
    const [exp, sig] = (c.req.query('upload') ?? '').split('.');
    if (!store.verify(bucket, path, exp, sig)) throw new HttpError(403, 'Upload link expired');
    await store.write(bucket as 'covers', path, new Uint8Array(await c.req.arrayBuffer()));
    return c.json({ ok: true });
  }
  if (bucket === 'ebooks' && !store.verify(bucket, path, c.req.query('exp') ?? '', c.req.query('sig') ?? '')) throw new HttpError(403, 'Link expired');
  const data = await readFile(join(store.root, bucket, path)).catch(() => null);
  if (!data) throw notFound();
  const type = path.endsWith('.pdf') ? 'application/pdf' : path.match(/\.(png|jpe?g|webp)$/)?.[1] ? `image/${path.split('.').pop()!.replace('jpg', 'jpeg')}` : 'application/octet-stream';
  return c.body(data, 200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
});
