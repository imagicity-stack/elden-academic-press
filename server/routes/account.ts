// Customer accounts: Google sign-in through Supabase Auth. Orders and e-books
// belong to an account through the verified email address used at checkout.
// Staff access is separate (admin_users allow-list), so a customer account
// never reaches the admin.
import { createHash } from 'node:crypto';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../app.js';
import { accounts, orderItems, orders, subscribers } from '../db/schema.js';
import { body, HttpError, notFound, rateLimit, zPhone } from '../lib/http.js';
import { getSettings } from '../services/catalog.js';
import { subscribe, subscribeNewAccount, unsubscribe } from '../services/newsletter.js';
import { orderToken } from '../services/orders.js';
import { report, visitOf } from '../services/tracking.js';
import { verifySupabaseToken } from './admin/auth.js';
import { orderStatusLabel } from './orders.js';
import { downloadLimit, ebookAwaitsDelivery, fileLabel, filesForItems } from '../services/ebooks.js';

export interface Customer { userId: string; email: string; name: string; avatar: string | null }

/** Local development only (never on Vercel): "Bearer dev-customer:someone@example.com". */
const DEV_PREFIX = 'dev-customer:';

/** The signed-in customer, or null when the request carries no sign-in at all. Throws for a bad one. */
export async function readCustomer(c: Context<AppEnv>): Promise<Customer | null> {
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) return null;
  await requireCustomer(c, async () => {});
  return c.get('customer');
}

export const requireCustomer: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { env } = c.get('deps');
  const token = /^Bearer (.+)$/.exec(c.req.header('authorization') ?? '')?.[1];
  if (!token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  if (env.devAdmin && token.startsWith(DEV_PREFIX)) {
    const email = token.slice(DEV_PREFIX.length).toLowerCase();
    const h = createHash('sha256').update(email).digest('hex');
    c.set('customer', { userId: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, email, name: 'Developer', avatar: null });
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

/** A first visit that is a real sign-up (not an older account opening the page for the first time). */
async function justSignedUp(deps: AppEnv['Variables']['deps'], userId: string) {
  const user = deps.authUser ? await deps.authUser(userId).catch(() => null) : null;
  return !user || deps.now().getTime() - user.createdAt.getTime() < 24 * 3600_000;
}
account.use('*', requireCustomer);

const OWNED = ['paid', 'partially_refunded', 'refunded'] as const;

/** Everything for the account page: profile, orders and the e-book / journal library. */
account.get('/', async (c) => {
  const deps = c.get('deps');
  const { db, env, now } = deps;
  const me = c.get('customer');
  // Remember everyone who signs in (with the mobile number they add below).
  const [known] = await db.select({ userId: accounts.userId }).from(accounts).where(eq(accounts.userId, me.userId));
  const [profile] = await db.insert(accounts).values({ userId: me.userId, email: me.email, name: me.name, avatarUrl: me.avatar })
    .onConflictDoUpdate({ target: accounts.userId, set: { email: me.email, name: me.name, avatarUrl: me.avatar, lastSeenAt: now() } })
    .returning();
  // First sign-in: a new account also joins the newsletter (the sign-in page says so),
  // and counts as a registration for Meta (the page fires the Pixel's twin with this id).
  const newAccount = !known && await justSignedUp(deps, me.userId);
  // Every account is on the newsletter from sign-up (unless they unsubscribed).
  await subscribeNewAccount(deps, me, c.get('ip'));
  if (newAccount) {
    const visit = visitOf(c);
    await report(deps, visit.consent, {
      name: 'CompleteRegistration', eventId: `signup-${me.userId}`, time: now(), url: `${env.SITE_URL}/account`,
      user: { ...visit, email: me.email, name: me.name, externalId: me.email }, custom: { content_name: 'Google sign-in', status: 'complete' },
    });
  }
  const [sub] = await db.select({ status: subscribers.status }).from(subscribers).where(eq(subscribers.email, me.email));
  const s = await getSettings(db);
  const mine = await db.select().from(orders).where(and(eq(orders.email, me.email), inArray(orders.paymentStatus, OWNED)))
    .orderBy(desc(orders.createdAt)).limit(200);
  const items = mine.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, mine.map((o) => o.id))) : [];
  const files = await filesForItems(db, items);
  const token = (id: string) => orderToken(env.ORDER_LINK_SECRET, id);

  const library = new Map<string, unknown>();
  for (const o of mine) {
    if (o.paymentStatus === 'refunded' || o.cancelledAt || !o.paidAt) continue;
    const expiresAt = s.downloadExpiryDays > 0 ? new Date(o.paidAt.getTime() + s.downloadExpiryDays * 86400_000) : null;
    for (const i of items.filter((x) => x.orderId === o.id && (files.get(x.id)?.length ?? 0) > 0)) {
      const key = i.productId ?? i.id;
      if (library.has(key)) continue; // newest purchase of a title wins (orders are newest first)
      // Cash on delivery: the free e-book unlocks once the books are delivered.
      const awaitingDelivery = ebookAwaitsDelivery(o);
      const open = !awaitingDelivery && (!expiresAt || expiresAt > now());
      const fs = files.get(i.id) ?? [];
      const limit = downloadLimit(s, fs.length);
      const canDownload = open && i.downloadsUsed < limit;
      library.set(key, {
        itemId: i.id, productId: i.productId, title: i.title, format: i.formatLabel,
        orderNumber: o.number, purchasedAt: o.paidAt, expiresAt,
        downloadsLeft: Math.max(0, limit - i.downloadsUsed),
        canRead: open && fs.length > 0,
        awaitingDelivery,
        downloadUrl: canDownload && fs.length ? `/api/orders/${o.number}/download/${i.id}?t=${token(o.id)}` : null,
        files: fs.map((f, k) => ({
          index: k, label: fileLabel(f, k, fs.length),
          downloadUrl: canDownload ? `/api/orders/${o.number}/download/${i.id}?t=${token(o.id)}&f=${k}` : null,
        })),
      });
    }
  }

  return c.json({
    customer: me,
    newAccount,
    profile: { phone: profile.phone },
    newsletter: sub?.status ?? null,
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
    .where(and(eq(orderItems.id, c.req.param('itemId')), eq(orders.email, me.email), inArray(orders.paymentStatus, ['paid', 'partially_refunded'])));
  if (!row || row.order.cancelledAt || !row.order.paidAt) throw notFound('This e-book isn’t in your library.');
  if (ebookAwaitsDelivery(row.order)) throw new HttpError(403, 'Your free e-book unlocks once your books are delivered.', 'awaiting_delivery');
  if (s.downloadExpiryDays > 0 && row.order.paidAt.getTime() + s.downloadExpiryDays * 86400_000 < now().getTime()) {
    throw new HttpError(410, 'Access to this e-book has expired. Please contact us.');
  }
  // ?f= picks one of the e-book's files (0 = the first).
  const fs = (await filesForItems(db, [row.item])).get(row.item.id) ?? [];
  const file = fs[Math.max(0, Number.parseInt(c.req.query('f') ?? '0', 10) || 0)];
  if (!file) throw new HttpError(404, 'This e-book file is not available. Please contact us.');
  return c.json({ url: await storage.signedDownloadUrl('ebooks', file.path, 300) });
});

/** The mobile number the customer adds to their account. */
account.put('/profile', async (c) => {
  const { db } = c.get('deps');
  const me = c.get('customer');
  const input = await body(c, z.object({ phone: zPhone }));
  const [row] = await db.update(accounts).set({ phone: input.phone, updatedAt: sql`now()` }).where(eq(accounts.userId, me.userId)).returning();
  if (!row) throw notFound('Account not found');
  await db.update(subscribers).set({ phone: input.phone, updatedAt: sql`now()` }).where(eq(subscribers.email, me.email));
  return c.json({ phone: row.phone });
});

/** Newsletter on / off. A signed-in Google account has a proven email, so no confirmation email is needed. */
account.put('/newsletter', async (c) => {
  const deps = c.get('deps');
  const me = c.get('customer');
  const input = await body(c, z.object({ subscribed: z.boolean() }));
  if (input.subscribed) {
    const [profile] = await deps.db.select().from(accounts).where(eq(accounts.userId, me.userId));
    await subscribe(deps, { email: me.email, name: me.name, phone: profile?.phone, source: 'account', ip: c.get('ip') });
  } else {
    await unsubscribe(deps, me.email);
  }
  return c.json({ newsletter: input.subscribed ? 'subscribed' : 'unsubscribed' });
});
