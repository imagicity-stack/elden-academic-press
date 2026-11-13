// Razorpay webhooks: the source of truth for payments, even if the customer
// closes the browser before the success page loads.
import { Hono, type Context } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../app.js';
import { orders, refunds, webhookEvents } from '../db/schema.js';
import { sha256 } from '../lib/crypto.js';
import { HttpError } from '../lib/http.js';
import { verifyWebhookSignature, type RzpPayment } from '../lib/razorpay.js';
import { logEvent, markPaid } from '../services/orders.js';
import { safeEqual } from '../lib/crypto.js';
import { delhiveryWebhook } from '../services/shipping.js';

export const webhooks = new Hono<AppEnv>();

/**
 * Delhivery's scan push (set up by Delhivery's team: docs/DELHIVERY.md). The address carries
 * DELHIVERY_WEBHOOK_SECRET (/api/webhooks/delhivery/<secret>), or Delhivery sends it as
 * "Authorization: Bearer <secret>". Always answers 200 for a known sender, as Delhivery expects.
 */
const delhiveryHook = async (c: Context<AppEnv>) => {
  const deps = c.get('deps');
  const secret = deps.env.DELHIVERY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Delhivery webhook not configured');
  const given = c.req.param('secret') ?? (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(given, secret)) throw new HttpError(401, 'Unauthorised');
  let payload: unknown;
  try { payload = await c.req.json(); } catch { throw new HttpError(400, 'Expected JSON'); }
  const result = await delhiveryWebhook(deps, payload);
  return c.json({ status: 'Success', result });
};
webhooks.post('/delhivery/:secret', delhiveryHook);
webhooks.post('/delhivery', delhiveryHook);

webhooks.post('/razorpay', async (c) => {
  const deps = c.get('deps');
  const secret = deps.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Webhook secret not configured');
  const raw = await c.req.text();
  if (!verifyWebhookSignature(raw, c.req.header('x-razorpay-signature') ?? '', secret)) throw new HttpError(400, 'Invalid signature');

  const evt = JSON.parse(raw) as { event: string; payload: Record<string, { entity: Record<string, unknown> }> };
  const id = c.req.header('x-razorpay-event-id') || sha256(raw);
  const [fresh] = await deps.db.insert(webhookEvents).values({ id, event: evt.event, payload: evt }).onConflictDoNothing().returning();
  if (!fresh) {
    const [seen] = await deps.db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
    if (seen?.processedAt) return c.json({ ok: true, duplicate: true });
  }

  try {
    await handle(deps, evt);
    await deps.db.update(webhookEvents).set({ processedAt: sql`now()`, error: null }).where(eq(webhookEvents.id, id));
  } catch (e) {
    await deps.db.update(webhookEvents).set({ error: (e as Error).message }).where(eq(webhookEvents.id, id));
    throw e; // non-2xx makes Razorpay retry
  }
  return c.json({ ok: true });
});

async function handle(deps: AppEnv['Variables']['deps'], evt: { event: string; payload: Record<string, { entity: Record<string, unknown> }> }) {
  const payment = evt.payload.payment?.entity as RzpPayment | undefined;
  const findOrder = async (rzpOrderId: string | undefined) =>
    rzpOrderId ? (await deps.db.select().from(orders).where(eq(orders.razorpayOrderId, rzpOrderId)))[0] : undefined;

  switch (evt.event) {
    case 'payment.authorized': {
      const o = await findOrder(payment?.order_id);
      if (!o || !payment || !deps.razorpay) return;
      const captured = await deps.razorpay.capturePayment(payment.id, payment.amount);
      await markPaid(deps, o.id, captured, 'razorpay');
      return;
    }
    case 'payment.captured':
    case 'order.paid': {
      const o = await findOrder(payment?.order_id);
      if (!o || !payment) return;
      await markPaid(deps, o.id, { ...payment, status: 'captured' }, 'razorpay');
      return;
    }
    case 'payment.failed': {
      const o = await findOrder(payment?.order_id);
      if (o && payment) await logEvent(deps.db, o.id, 'payment_failed', `Payment attempt failed${payment.error_description ? `: ${payment.error_description}` : ''}`, 'razorpay');
      return;
    }
    case 'refund.processed':
    case 'refund.failed': {
      const r = evt.payload.refund?.entity as { id: string; status: string } | undefined;
      if (!r) return;
      await deps.db.update(refunds).set({ status: evt.event === 'refund.processed' ? 'processed' : 'failed', updatedAt: sql`now()` })
        .where(eq(refunds.razorpayRefundId, r.id));
      return;
    }
  }
}
