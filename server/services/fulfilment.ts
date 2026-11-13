// Moving an order through packed → shipped → delivered, with everything that goes with each step:
// the order history, the "shipped" email and WhatsApp, and for cash on delivery the cash collected
// and the free e-book unlocked. Used by staff (Admin → Orders) and by Delhivery's status updates
// (server/services/shipping.ts), so both behave the same.
import { eq, sql } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { orderItems, orders } from '../db/schema.js';
import { getSettings } from './catalog.js';
import { sendEbookUnlocked, sendShipped } from './emails.js';
import { logEvent, type Order } from './orders.js';
import { confirmCodByStaff } from './calls.js';
import { orderWhatsApp } from './whatsapp.js';

export type FulfilmentStep = 'unfulfilled' | 'packed' | 'shipped' | 'delivered';

export interface FulfilmentInput {
  status: FulfilmentStep;
  courier?: string;
  trackingNumber?: string;
  /** '' clears it. */
  trackingUrl?: string;
  /** Tell the customer (shipped email/WhatsApp; e-book links on delivery). */
  notify: boolean;
  /** When it happened (a courier scan's time); default now. */
  at?: Date;
}

const ORDER = { unfulfilled: 0, packed: 1, shipped: 2, delivered: 3 } as const;

/** Is `to` a step forward from the order's current step (never backwards, never the same)? */
export const isForward = (from: string, to: FulfilmentStep) => (ORDER[to] ?? 0) > (ORDER[from as FulfilmentStep] ?? 0);

export async function applyFulfilment(deps: Deps, o: Order, input: FulfilmentInput, actor: string): Promise<Order> {
  // Cash on delivery: packing or shipping an order that wasn't confirmed confirms it (and stops the call).
  if (o.paymentMode === 'cod' && input.status !== 'unfulfilled' && o.codConfirmation && o.codConfirmation !== 'confirmed') {
    await confirmCodByStaff(deps, o.id, actor, `Confirmed by marking it ${input.status}`);
  }
  const now = input.at ?? deps.now();
  const [u] = await deps.db.update(orders).set({
    fulfillmentStatus: input.status,
    courier: input.courier ?? o.courier,
    trackingNumber: input.trackingNumber ?? o.trackingNumber,
    trackingUrl: input.trackingUrl === '' ? null : input.trackingUrl ?? o.trackingUrl,
    packedAt: input.status === 'packed' ? o.packedAt ?? now : input.status === 'unfulfilled' ? null : o.packedAt ?? now,
    shippedAt: input.status === 'shipped' ? o.shippedAt ?? now : input.status === 'delivered' ? o.shippedAt ?? now : null,
    deliveredAt: input.status === 'delivered' ? o.deliveredAt ?? now : null,
    // Cash on delivery: the courier collects the balance when the books are delivered.
    codCollectedAt: o.paymentMode === 'cod' ? (input.status === 'delivered' ? o.codCollectedAt ?? now : null) : null,
    updatedAt: sql`now()`,
  }).where(eq(orders.id, o.id)).returning();
  const label = { unfulfilled: 'Marked as not packed', packed: 'Packed', shipped: `Shipped${u.courier ? ` with ${u.courier}` : ''}${u.trackingNumber ? ` (${u.trackingNumber})` : ''}`, delivered: 'Delivered' }[input.status];
  await logEvent(deps.db, o.id, input.status === 'unfulfilled' ? 'fulfillment' : input.status, label, actor);
  if (input.status === 'shipped' && input.notify && o.fulfillmentStatus !== 'shipped') {
    await sendShipped(deps, u, await getSettings(deps.db));
    await orderWhatsApp(deps, 'shipped', u).catch((e) => console.error('[whatsapp] shipped', (e as Error).message));
  }
  if (input.status === 'delivered' && o.fulfillmentStatus !== 'delivered' && o.paymentMode === 'cod') {
    await logEvent(deps.db, o.id, 'cod_collected', `Cash on delivery: ₹${(o.codAmount / 100).toFixed(2)} collected`, actor);
    // Their free e-book is unlocked now: send the download links.
    const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    if (input.notify && items.some((i) => i.includesEbook)) {
      await sendEbookUnlocked(deps, u, items, await getSettings(deps.db));
      await orderWhatsApp(deps, 'ebook_ready', u).catch((e) => console.error('[whatsapp] e-book ready', (e as Error).message));
    }
  }
  return u;
}
