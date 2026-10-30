// Razorpay webhooks: the source of truth for payments, even if the customer
// closes the browser before the success page loads.
import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { AppEnv } from '../app';
import { orders, refunds, webhookEvents } from '../db/schema';
import { sha256 } from '../lib/crypto';
import { HttpError } from '../lib/http';
import { verifyWebhookSignature, type RzpPayment } from '../lib/razorpay';
import { logEvent, markPaid } from '../services/orders';

export const webhooks = new Hono<AppEnv>();

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
