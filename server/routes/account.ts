// Customer accounts: Google sign-in through Supabase Auth. Orders and e-books
// belong to an account through the verified email address used at checkout.
// Staff access is separate (admin_users allow-list), so a customer account
// never reaches the admin.
import { Hono, type MiddlewareHandler } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppEnv } from '../app.js';
import { orderItems, orders, productVariants } from '../db/schema.js';
import { HttpError, notFound, rateLimit } from '../lib/http.js';
import { getSettings } from '../services/catalog.js';
import { orderToken } from '../services/orders.js';
import { verifySupabaseToken } from './admin/auth.js';
import { orderStatusLabel } from './orders.js';

export interface Customer { userId: string; email: string; name: string; avatar: string | null }

/** Local development only (never on Vercel): "Bearer dev-customer:someone@example.com". */
const DEV_PREFIX = 'dev-customer:';

const requireCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { env } = c.get('deps');
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  if (env.devAdmin && token.startsWith(DEV_PREFIX)) {
    c.set('customer', { userId: 'dev', email: token.slice(DEV_PREFIX.length).toLowerCase(), name: 'Developer', avatar: null });
    return next();
  }
  if (!env.SUPABASE_URL) throw new HttpError(503, 'Sign-in is not configured.', 'auth_unconfigured');
  let claims: Awaited<ReturnType<typeof verifySupabaseToken>>;
  try {
    claims = await verifySupabaseToken(token, env.SUPABASE_URL, env.SUPABASE_JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has expired. Please sign in again.', 'unauthenticated');
  }
  const meta = (claims.user_metadata ?? {}) as Record<string, unknown>;
  const app = (claims.app_metadata ?? {}) as { provider?: string; providers?: string[] };
  // Orders are matched by email, so the address must be proven: Google accounts are, others once confirmed.
  const verified = app.provider === 'google' || Boolean(app.providers?.includes('google')) || meta.email_verified === true;
  const email = String(claims.email ?? '').toLowerCase();
  if (!email || !verified) throw new HttpError(403, 'Please confirm your email address first.', 'email_unverified');
  c.set('customer', {
    userId: String(claims.sub),
    email,
    name: String(meta.full_name ?? meta.name ?? ''),
    avatar: typeof meta.avatar_url === 'string' ? meta.avatar_url : typeof meta.picture === 'string' ? meta.picture : null,
  });
  await next();
};

export const account = new Hono<AppEnv>();
account.use('*', requireCustomer);

const OWNED = ['paid', 'partially_refunded', 'refunded'] as const;

/** Everything for the account page: profile, orders and the e-book / journal library. */
account.get('/', async (c) => {
  const { db, env, now } = c.get('deps');
  const me = c.get('customer');
  const s = await getSettings(db);
  const mine = await db.select().from(orders).where(and(eq(orders.email, me.email), inArray(orders.paymentStatus, OWNED)))
    .orderBy(desc(orders.createdAt)).limit(200);
  const items = mine.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, mine.map((o) => o.id))) : [];
  const token = (id: string) => orderToken(env.ORDER_LINK_SECRET, id);

  const library = new Map<string, unknown>();
  for (const o of mine) {
    if (o.paymentStatus === 'refunded' || o.cancelledAt || !o.paidAt) continue;
    const expiresAt = s.downloadExpiryDays > 0 ? new Date(o.paidAt.getTime() + s.downloadExpiryDays * 86400_000) : null;
    for (const i of items.filter((x) => x.orderId === o.id && x.isDigital)) {
      const key = i.productId ?? i.id;
      if (library.has(key)) continue; // newest purchase of a title wins (orders are newest first)
      const open = !expiresAt || expiresAt > now();
      library.set(key, {
        itemId: i.id, productId: i.productId, title: i.title, format: i.formatLabel,
        orderNumber: o.number, purchasedAt: o.paidAt, expiresAt,
        downloadsLeft: Math.max(0, s.maxDownloads - i.downloadsUsed),
        canRead: open,
        downloadUrl: open && i.downloadsUsed < s.maxDownloads ? `/api/orders/${o.number}/download/${i.id}?t=${token(o.id)}` : null,
      });
    }
  }

  return c.json({
    customer: me,
    orders: mine.map((o) => ({
      number: o.number, createdAt: o.createdAt, status: orderStatusLabel(o), total: o.total, invoice: o.invoiceNumber,
      requiresShipping: o.requiresShipping, token: token(o.id),
      items: items.filter((i) => i.orderId === o.id).map((i) => ({ title: i.title, format: i.formatLabel, quantity: i.quantity })),
    })),
    library: [...library.values()],
  });
});

/** Open a purchased e-book in the browser's reader: a short-lived link, not counted as a download. */
account.post('/library/:itemId/read', async (c) => {
  const { db, storage, now } = c.get('deps');
  const me = c.get('customer');
  await rateLimit(db, `read:${me.email}`, 60, 3600);
  const s = await getSettings(db);
  const [row] = await db.select({ item: orderItems, order: orders }).from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.id, c.req.param('itemId')), eq(orderItems.isDigital, true), eq(orders.email, me.email), inArray(orders.paymentStatus, ['paid', 'partially_refunded'])));
  if (!row || row.order.cancelledAt || !row.order.paidAt) throw notFound('This e-book isn’t in your library.');
  if (s.downloadExpiryDays > 0 && row.order.paidAt.getTime() + s.downloadExpiryDays * 86400_000 < now().getTime()) {
    throw new HttpError(410, 'Access to this e-book has expired. Please contact us.');
  }
  const [v] = row.item.productId
    ? await db.select().from(productVariants).where(and(eq(productVariants.productId, row.item.productId), eq(productVariants.kind, 'digital')))
    : [];
  if (!v?.filePath) throw new HttpError(404, 'This e-book file is not available. Please contact us.');
  return c.json({ url: await storage.signedDownloadUrl('ebooks', v.filePath, 300) });
});
