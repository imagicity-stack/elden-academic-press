// Shipping printed books with Delhivery: booking parcels, labels, pickups, live tracking (Delhivery's
// push webhook plus a 30-minute sync as the safety net), failed deliveries (NDR) and returns (RTO).
// E-books never ship. Each Delhivery status moves the order on through the same steps staff use
// (server/services/fulfilment.ts): booked → packed, picked up → shipped (email + WhatsApp to the
// customer), delivered → delivered (cash on delivery collected, free e-book unlocked).
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import type { Deps } from '../deps.js';
import { orderItems, orders, pickupRequests, settings as settingsTable, shipments } from '../db/schema.js';
import { DelhiveryError, istDate, type Delhivery, type NewShipment, type PinInfo, type Tracked, type TrackedScan } from '../lib/delhivery.js';
import { HttpError } from '../lib/http.js';
import { stateName } from '../lib/states.js';
import { getSettings } from './catalog.js';
import { applyFulfilment, isForward } from './fulfilment.js';
import { logEvent, type Order } from './orders.js';
import {
  ACTIVE_SHIPMENT, DEFER_CODES, delhiveryTrackingUrl, FINAL_SHIPMENT, fulfilmentFor, mapDelhiveryStatus, SHIPMENT_CUSTOMER_LABEL, SHIPMENT_LABEL,
  type LabelSize, type NdrAction, type PublicShipment, type ShipmentScan, type ShipmentStatus,
} from '../../src/shared/shipping.js';

export type Shipment = typeof shipments.$inferSelect;
type Settings = typeof settingsTable.$inferSelect;

const ACTOR = 'Delhivery';
const ATTN = {
  ndr: 'Delivery failed',
  rto: 'Returning to us',
  returned: 'Returned to us',
  lost: 'Delhivery reports the parcel lost',
  booking: 'Couldn’t book with Delhivery',
};

/* ---------------- Setup ---------------- */

/** What's missing before parcels can be booked (empty = ready). */
export function shippingBlockers(deps: Pick<Deps, 'delhivery' | 'env'>, s: Settings): string[] {
  const out: string[] = [];
  if (!deps.delhivery) out.push('Add DELHIVERY_API_TOKEN in Vercel (Project → Settings → Environment Variables) and redeploy.');
  if (!s.delhiveryEnabled) out.push('Switch on “Ship with Delhivery” in Admin → Shipping → Settings.');
  if (!s.delhiveryPickupLocation.trim()) out.push('Enter your pickup location’s name exactly as registered with Delhivery.');
  if (!/^[1-9]\d{5}$/.test(s.delhiveryOriginPin)) out.push('Enter the 6-digit PIN code books are picked up from.');
  return out;
}

function client(deps: Deps): Delhivery {
  if (!deps.delhivery) throw new HttpError(503, 'Delhivery isn’t connected: add DELHIVERY_API_TOKEN in Vercel and redeploy.', 'delhivery_off');
  return deps.delhivery;
}

/** Delhivery's errors become readable 502s; everything else passes through. */
async function viaDelhivery<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (e) {
    if (e instanceof DelhiveryError) throw new HttpError(502, e.message, 'delhivery');
    throw e;
  }
}

/* ---------------- PIN codes and delivery dates ---------------- */

const pinCache = new Map<string, { at: number; info: PinInfo | null }>();
const tatCache = new Map<string, { at: number; days: number | null; date: Date | null }>();
const SIX_HOURS = 6 * 3600_000;

/** Delhivery's answer for a PIN code (cached 6 hours per server). Throws DelhiveryError if Delhivery can't be reached. */
export async function pinInfo(deps: Deps, pin: string): Promise<PinInfo | null> {
  const hit = pinCache.get(pin);
  if (hit && deps.now().getTime() - hit.at < SIX_HOURS) return hit.info;
  const info = await client(deps).pincode(pin);
  pinCache.set(pin, { at: deps.now().getTime(), info });
  if (pinCache.size > 5000) pinCache.delete(pinCache.keys().next().value!);
  return info;
}

/** Next pickup: today if booked before 2 pm India time, else tomorrow (Sundays move to Monday). */
export function nextPickup(now: Date): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const day = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 11 - 5, 30)); // 11:00 IST… shown as a date only
  if (ist.getUTCHours() >= 14) day.setUTCDate(day.getUTCDate() + 1);
  if (new Date(day.getTime() + 5.5 * 3600_000).getUTCDay() === 0) day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

/** Expected delivery date to a PIN code from the pickup location (cached 6 hours), or null. */
export async function deliveryDate(deps: Deps, s: Settings, pin: string): Promise<{ days: number | null; date: Date | null }> {
  const key = `${s.delhiveryOriginPin}>${pin}:${s.delhiveryMode}`;
  const hit = tatCache.get(key);
  if (hit && deps.now().getTime() - hit.at < SIX_HOURS) return hit;
  const pickupAt = nextPickup(deps.now());
  const r = await client(deps).expectedTat({ originPin: s.delhiveryOriginPin, destinationPin: pin, mode: s.delhiveryMode, pickupAt });
  const date = r.date ?? (r.days !== null ? new Date(pickupAt.getTime() + r.days * 86_400_000) : null);
  const v = { at: deps.now().getTime(), days: r.days, date };
  tatCache.set(key, v);
  if (tatCache.size > 5000) tatCache.delete(tatCache.keys().next().value!);
  return v;
}

export interface PinCheck {
  /** null: we couldn't ask Delhivery (checkout goes ahead). */
  serviceable: boolean | null;
  cod: boolean | null;
  /** "YYYY-MM-DD", India time. */
  deliveryBy: string | null;
  days: number | null;
  oda: boolean;
}

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** For checkout and the book page: can Delhivery deliver here, with cash on delivery, and by when? */
export async function checkPin(deps: Deps, pin: string): Promise<PinCheck | null> {
  const s = await getSettings(deps.db);
  if (!s.delhiveryEnabled || !s.delhiveryCheckoutCheck || !deps.delhivery) return null;
  const none: PinCheck = { serviceable: null, cod: null, deliveryBy: null, days: null, oda: false };
  let info: PinInfo | null;
  try { info = await pinInfo(deps, pin); } catch (e) {
    console.warn('[delhivery] pin check', (e as Error).message);
    return none; // Delhivery down: never stop a sale over it
  }
  if (!info) return { ...none, serviceable: false, cod: false };
  let tat: { days: number | null; date: Date | null } = { days: null, date: null };
  if (/^[1-9]\d{5}$/.test(s.delhiveryOriginPin)) {
    try { tat = await deliveryDate(deps, s, pin); } catch (e) { console.warn('[delhivery] delivery date', (e as Error).message); }
  }
  return { serviceable: true, cod: info.cod, deliveryBy: tat.date ? istDay(tat.date) : null, days: tat.days, oda: info.oda };
}

/**
 * At checkout (server side): refuse a PIN code Delhivery doesn't deliver to, and cash on delivery
 * where it doesn't collect cash. When Delhivery can't be asked, the order goes ahead.
 */
export async function assertDeliverable(deps: Deps, pin: string, cod: boolean) {
  const r = await checkPin(deps, pin);
  if (!r || r.serviceable === null) return;
  if (!r.serviceable) throw new HttpError(400, `Our courier doesn’t deliver to PIN code ${pin} yet. Please use another address, or write to us and we’ll find a way.`, 'pin_not_serviceable');
  if (cod && r.cod === false) throw new HttpError(400, `Cash on delivery isn’t available for PIN code ${pin}. Please pay online instead.`, 'cod_not_serviceable');
}

/* ---------------- The parcel ---------------- */

type Item = typeof orderItems.$inferSelect;

export interface ParcelDefaults {
  weightGrams: number; lengthCm: number; breadthCm: number; heightCm: number;
  mode: 'Surface' | 'Express'; paymentMode: 'Prepaid' | 'COD'; codAmount: number; declaredValue: number;
  quantity: number; description: string;
}

/** What goes in the box: the printed books only, their weight with the packing, value and cash to collect. */
export function parcelFor(o: Order, items: Item[], s: Settings): ParcelDefaults {
  const books = items.filter((i) => i.requiresShipping && !i.isDigital);
  if (!books.length) throw new HttpError(409, 'This order has no printed books to ship.');
  const weight = books.reduce((g, i) => g + (i.weightGrams > 0 ? i.weightGrams : s.shipDefaultBookGrams * i.quantity), 0) + s.shipPackagingGrams;
  const value = books.reduce((v, i) => v + Math.max(0, i.lineTotal - i.discount), 0);
  const cod = o.paymentMode === 'cod' && o.codAmount > 0;
  return {
    weightGrams: Math.max(50, weight),
    lengthCm: s.shipLengthCm, breadthCm: s.shipBreadthCm, heightCm: s.shipHeightCm,
    mode: s.delhiveryMode,
    paymentMode: cod ? 'COD' : 'Prepaid',
    codAmount: cod ? o.codAmount : 0,
    declaredValue: Math.max(100, value + (books.length === items.filter((i) => i.requiresShipping).length ? o.shipping : 0)),
    quantity: books.reduce((n, i) => n + i.quantity, 0),
    description: books.map((i) => `${i.title}${i.quantity > 1 ? ` x${i.quantity}` : ''}`).join(', '),
  };
}

/** Indian mobile number as Delhivery wants it: 10 digits. */
const phone10 = (p: string) => { const d = p.replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d; };

/* ---------------- Booking ---------------- */

const booking = new Set<string>();

export interface ShipInput { weightGrams?: number; lengthCm?: number; breadthCm?: number; heightCm?: number; mode?: 'Surface' | 'Express' }

/** Books the order's parcel with Delhivery and marks the order packed. */
export async function createShipment(deps: Deps, orderId: string, input: ShipInput, actor: string): Promise<Shipment> {
  const dl = client(deps);
  const s = await getSettings(deps.db);
  const blockers = shippingBlockers(deps, s);
  if (blockers.length) throw new HttpError(409, blockers[0], 'shipping_not_ready');
  if (booking.has(orderId)) throw new HttpError(409, 'This order is being booked right now.', 'busy');
  booking.add(orderId);
  try {
    const [o] = await deps.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o) throw new HttpError(404, 'Order not found');
    if (o.cancelledAt || !['paid', 'partially_refunded'].includes(o.paymentStatus)) throw new HttpError(409, 'Only paid, active orders can be shipped.');
    if (!o.requiresShipping) throw new HttpError(409, 'This order has nothing to ship.');
    if (o.fulfillmentStatus === 'delivered') throw new HttpError(409, 'This order has already been delivered.');
    if (!o.shipPincode || !/^[1-9]\d{5}$/.test(o.shipPincode)) throw new HttpError(400, 'The delivery address has no valid PIN code: correct it first.');
    const existing = await deps.db.select().from(shipments).where(and(eq(shipments.orderId, o.id), notInArray(shipments.status, ['cancelled', 'returned', 'lost'])));
    if (existing.length) throw new HttpError(409, `Already booked with Delhivery: AWB ${existing[0].waybill}. Cancel it first to book again.`, 'already_shipped');
    const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    const p = parcelFor(o, items, s);
    const parcel = {
      weightGrams: Math.round(input.weightGrams ?? p.weightGrams), lengthCm: input.lengthCm ?? p.lengthCm,
      breadthCm: input.breadthCm ?? p.breadthCm, heightCm: input.heightCm ?? p.heightCm, mode: input.mode ?? p.mode,
    };
    const [{ n }] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(shipments).where(eq(shipments.orderId, o.id));
    const reference = n ? `${o.number}-${n + 1}` : String(o.number);
    const req: NewShipment = {
      reference,
      name: o.shipName || o.name,
      phone: phone10(o.phone),
      address: [o.shipLine1, o.shipLine2].filter(Boolean).join(', '),
      city: o.shipCity ?? '',
      state: stateName(o.shipState ?? o.billingState) ?? '',
      pin: o.shipPincode,
      paymentMode: p.paymentMode,
      codAmount: p.codAmount,
      totalAmount: p.declaredValue,
      productsDescription: p.description,
      quantity: p.quantity,
      ...parcel,
      orderDate: o.paidAt ?? o.createdAt,
      sellerName: s.legalName || s.storeName,
      sellerGstin: s.gstin,
      sellerAddress: s.address,
      invoiceNumber: o.invoiceNumber ?? String(o.number),
      hsnCode: s.shipHsnCode || '4901',
    };
    const [created] = await viaDelhivery(() => dl.create(s.delhiveryPickupLocation, [req]));
    // The estimate and delivery date are extras: a booking never fails over them.
    const [charge, tat] = await Promise.allSettled([
      dl.charges({ originPin: s.delhiveryOriginPin, destinationPin: o.shipPincode, weightGrams: parcel.weightGrams, mode: parcel.mode, paymentMode: p.paymentMode, codAmount: p.codAmount }),
      deliveryDate(deps, { ...s, delhiveryMode: parcel.mode }, o.shipPincode),
    ]);
    const now = deps.now();
    const [row] = await deps.db.insert(shipments).values({
      orderId: o.id, waybill: created.waybill, reference, env: dl.env, paymentMode: p.paymentMode, codAmount: p.codAmount,
      declaredValue: p.declaredValue, ...parcel,
      chargeEstimate: charge.status === 'fulfilled' ? charge.value?.total ?? null : null,
      chargedWeightGrams: charge.status === 'fulfilled' ? charge.value?.chargedGrams ?? null : null,
      expectedDeliveryAt: tat.status === 'fulfilled' ? tat.value.date : null,
      statusAt: now, scans: [{ at: now.toISOString(), status: 'Manifested', type: 'UD', code: '', location: '', note: 'Booked with Delhivery' }],
      createdBy: actor,
    }).returning();
    const trackingUrl = delhiveryTrackingUrl(created.waybill);
    if (isForward(o.fulfillmentStatus, 'packed')) {
      await applyFulfilment(deps, o, { status: 'packed', courier: 'Delhivery', trackingNumber: created.waybill, trackingUrl, notify: false }, actor);
    } else {
      await deps.db.update(orders).set({ courier: 'Delhivery', trackingNumber: created.waybill, trackingUrl, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
    }
    // A booking that failed earlier is fixed now.
    if (o.needsAttention && o.attentionReason?.startsWith(ATTN.booking)) {
      await deps.db.update(orders).set({ needsAttention: false, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
    }
    const cod = p.paymentMode === 'COD' ? `, collect ₹${(p.codAmount / 100).toFixed(2)}` : ', prepaid';
    await logEvent(deps.db, o.id, 'shipment', `Booked with Delhivery: AWB ${created.waybill} (${parcel.mode}, ${parcel.weightGrams} g${cod})`, actor, { waybill: created.waybill });
    return row;
  } finally {
    booking.delete(orderId);
  }
}

/**
 * After an order is paid (cash on delivery: once confirmed), book it straight away when
 * "Book automatically" is on. A failure flags the order for the team instead.
 */
export async function autoShip(deps: Deps, orderId: string) {
  const s = await getSettings(deps.db);
  if (!s.delhiveryAutoShip || shippingBlockers(deps, s).length) return;
  const [o] = await deps.db.select().from(orders).where(eq(orders.id, orderId));
  if (!o || !o.requiresShipping || o.cancelledAt || o.fulfillmentStatus !== 'unfulfilled') return;
  if (o.paymentMode === 'cod' && o.codConfirmation !== 'confirmed') return;
  try {
    await createShipment(deps, orderId, {}, ACTOR);
  } catch (e) {
    if (e instanceof HttpError && ['already_shipped', 'busy'].includes(e.code ?? '')) return;
    const reason = `${ATTN.booking}: ${(e as Error).message}`.slice(0, 500);
    await deps.db.update(orders).set({ needsAttention: true, attentionReason: reason, updatedAt: sql`now()` }).where(eq(orders.id, orderId));
    await logEvent(deps.db, orderId, 'attention', reason, ACTOR);
  }
}

/** Same, without holding up the caller (payment webhooks, confirmation calls). */
export function autoShipLater(deps: Deps, orderId: string) {
  const run = autoShip(deps, orderId).catch((e) => console.error('[delhivery] auto-ship', (e as Error).message));
  if (deps.defer) deps.defer(run); else return run;
}

/* ---------------- Cancelling ---------------- */

export async function cancelShipment(deps: Deps, shipmentId: string, actor: string): Promise<Shipment> {
  const [sh] = await deps.db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!sh) throw new HttpError(404, 'Shipment not found');
  if (FINAL_SHIPMENT.includes(sh.status)) throw new HttpError(409, `This shipment is already ${SHIPMENT_LABEL[sh.status].toLowerCase()}.`);
  if (!['manifested', 'in_transit', 'pending', 'ndr'].includes(sh.status)) throw new HttpError(409, 'Delhivery only cancels parcels before they go out for delivery.');
  const remark = await viaDelhivery(() => client(deps).cancel(sh.waybill));
  const beforePickup = sh.status === 'manifested';
  const now = deps.now();
  // Before pickup it simply never moves. After pickup Delhivery brings it back (RTO): tracking carries on.
  const [u] = await deps.db.update(shipments).set(beforePickup
    ? { status: 'cancelled', cancelledAt: now, carrierStatus: 'Cancelled', statusAt: now, updatedAt: now }
    : { cancelledAt: now, updatedAt: now }).where(eq(shipments.id, sh.id)).returning();
  const [o] = await deps.db.select().from(orders).where(eq(orders.id, sh.orderId));
  if (beforePickup && o && o.trackingNumber === sh.waybill && o.fulfillmentStatus === 'packed') {
    await deps.db.update(orders).set({ fulfillmentStatus: 'unfulfilled', packedAt: null, trackingNumber: null, trackingUrl: null, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
  }
  await logEvent(deps.db, sh.orderId, 'shipment', beforePickup
    ? `Delhivery shipment ${sh.waybill} cancelled (${remark})`
    : `Asked Delhivery to cancel ${sh.waybill}: it was already picked up, so it comes back to us`, actor);
  return u;
}

/* ---------------- Labels ---------------- */

/** One PDF with the labels of these shipments (Delhivery's own labels, merged in order). */
export async function labelsPdf(deps: Deps, shipmentIds: string[], size: LabelSize): Promise<Uint8Array> {
  if (!shipmentIds.length) throw new HttpError(400, 'Choose at least one shipment.');
  const rows = await deps.db.select().from(shipments).where(inArray(shipments.id, shipmentIds));
  const live = shipmentIds.map((id) => rows.find((r) => r.id === id)).filter((r): r is Shipment => Boolean(r) && r!.status !== 'cancelled');
  if (!live.length) throw new HttpError(404, 'No labels to print: the shipments are cancelled or missing.');
  const dl = client(deps);
  const out = await PDFDocument.create();
  for (const sh of live) {
    const l = await viaDelhivery(() => dl.label(sh.waybill, size));
    let bytes = l.pdf;
    if (!bytes && l.url) {
      if (!/^https:\/\//.test(l.url)) throw new HttpError(502, 'Delhivery sent a label link we can’t open.', 'delhivery');
      const res = await fetch(l.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new HttpError(502, `Couldn’t download the label for ${sh.waybill} (${res.status}).`, 'delhivery');
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    const doc = await PDFDocument.load(bytes!);
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
  }
  return out.save();
}

/* ---------------- Tracking ---------------- */

const toScan = (x: TrackedScan): ShipmentScan => ({ at: (x.at ?? new Date(0)).toISOString(), status: x.status, type: x.type, code: x.code, location: x.location, note: x.note });

/** The scans so far plus any new ones, oldest first, without repeats. */
export function mergeScans(old: ShipmentScan[], fresh: TrackedScan[]): ShipmentScan[] {
  const key = (s: ShipmentScan) => `${s.at}|${s.status}|${s.type}|${s.code}|${s.location}`;
  const seen = new Set(old.map(key));
  const all = [...old];
  for (const s of fresh.map(toScan)) if (!seen.has(key(s))) { seen.add(key(s)); all.push(s); }
  return all.sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
}

/** Applies what Delhivery says about a parcel: the shipment, then the order (customer told when it moves on). */
export async function applyTracking(deps: Deps, sh: Shipment, t: Tracked, source: 'webhook' | 'sync') {
  const now = deps.now();
  const mapped = mapDelhiveryStatus(t.statusType, t.status, t.statusCode);
  // A parcel we cancelled before pickup stays cancelled; anything else follows Delhivery.
  const status: ShipmentStatus = sh.status === 'cancelled' && mapped !== 'delivered' ? 'cancelled' : mapped ?? sh.status;
  const scans = mergeScans(sh.scans, t.scans.length ? t.scans : t.status ? [{ at: t.statusAt, status: t.status, type: t.statusType, code: t.statusCode, location: t.statusLocation, note: t.statusNote }] : []);
  const at = t.statusAt ?? now;
  const moved = status !== sh.status;
  const [u] = await deps.db.update(shipments).set({
    status,
    carrierStatus: t.status || sh.carrierStatus,
    carrierStatusType: t.statusType || sh.carrierStatusType,
    statusCode: t.statusCode,
    statusLocation: t.statusLocation,
    statusNote: t.statusNote.slice(0, 500),
    statusAt: t.statusAt ?? sh.statusAt,
    scans,
    expectedDeliveryAt: t.expectedDelivery ?? sh.expectedDeliveryAt,
    pickedUpAt: sh.pickedUpAt ?? t.pickedUpAt ?? (['in_transit', 'pending', 'out_for_delivery', 'ndr', 'delivered'].includes(status) ? at : null),
    deliveredAt: status === 'delivered' ? sh.deliveredAt ?? t.deliveredAt ?? at : sh.deliveredAt,
    rtoAt: status === 'rto' || status === 'returned' ? sh.rtoAt ?? at : sh.rtoAt,
    returnedAt: status === 'returned' ? sh.returnedAt ?? at : sh.returnedAt,
    attempts: Math.max(sh.attempts, t.attempts),
    chargedWeightGrams: t.chargedWeightGrams ?? sh.chargedWeightGrams,
    lastSyncedAt: now,
    syncError: null,
    updatedAt: now,
  }).where(eq(shipments.id, sh.id)).returning();
  if (!moved) return u;

  const where = t.statusLocation ? ` (${t.statusLocation})` : '';
  await logEvent(deps.db, sh.orderId, 'shipment', `Delhivery: ${SHIPMENT_LABEL[status]}${where}${t.statusNote && status !== 'manifested' ? `: ${t.statusNote}` : ''}`.slice(0, 500), ACTOR, { waybill: sh.waybill, source, code: t.statusCode });
  if (status === 'cancelled') return u;

  const [o] = await deps.db.select().from(orders).where(eq(orders.id, sh.orderId));
  if (!o || o.cancelledAt || o.trackingNumber !== sh.waybill) return u; // an older parcel of this order
  const step = fulfilmentFor(status);
  if (step && isForward(o.fulfillmentStatus, step)) {
    await applyFulfilment(deps, o, { status: step, courier: 'Delhivery', trackingNumber: sh.waybill, trackingUrl: delhiveryTrackingUrl(sh.waybill), notify: true, at }, ACTOR);
  }
  // The team's to-do: failed deliveries, returns and lost parcels need someone; a delivery clears them.
  const flag = status === 'ndr' ? `${ATTN.ndr} (attempt ${Math.max(1, t.attempts)}): ${t.statusNote || 'see the Delhivery panel'}`
    : status === 'rto' ? `${ATTN.rto}: ${t.statusNote || 'Delhivery is bringing the parcel back'}`
    : status === 'returned' ? `${ATTN.returned}: refund the customer or ship again`
    : status === 'lost' ? `${ATTN.lost}: raise a claim with Delhivery` : null;
  if (flag) {
    await deps.db.update(orders).set({ needsAttention: true, attentionReason: flag.slice(0, 500), updatedAt: sql`now()` }).where(eq(orders.id, o.id));
  } else if (o.needsAttention && Object.values(ATTN).some((a) => o.attentionReason?.startsWith(a)) && ['out_for_delivery', 'delivered', 'in_transit'].includes(status)) {
    await deps.db.update(orders).set({ needsAttention: false, updatedAt: sql`now()` }).where(eq(orders.id, o.id));
  }
  return u;
}

/** Refreshes active parcels from Delhivery (the cron job; oldest-checked first). */
export async function syncShipments(deps: Deps, limit = 400): Promise<{ checked: number; updated: number; errors: number }> {
  if (!deps.delhivery) return { checked: 0, updated: 0, errors: 0 };
  const dl = deps.delhivery;
  const rows = await deps.db.select().from(shipments)
    .where(and(inArray(shipments.status, ACTIVE_SHIPMENT), eq(shipments.env, dl.env)))
    .orderBy(sql`${shipments.lastSyncedAt} asc nulls first`).limit(limit);
  let updated = 0; let errors = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    let found: Tracked[];
    try { found = await dl.track(batch.map((r) => r.waybill)); } catch (e) {
      errors += batch.length;
      await deps.db.update(shipments).set({ syncError: (e as Error).message.slice(0, 300), lastSyncedAt: deps.now() }).where(inArray(shipments.id, batch.map((r) => r.id)));
      continue;
    }
    for (const sh of batch) {
      const t = found.find((f) => f.waybill === sh.waybill);
      if (!t) { await deps.db.update(shipments).set({ lastSyncedAt: deps.now() }).where(eq(shipments.id, sh.id)); continue; }
      try {
        const u = await applyTracking(deps, sh, t, 'sync');
        if (u.status !== sh.status) updated++;
      } catch (e) {
        errors++;
        console.error('[delhivery] apply', sh.waybill, (e as Error).message);
      }
    }
  }
  await checkNdrRequests(deps).catch((e) => console.error('[delhivery] NDR status', (e as Error).message));
  return { checked: rows.length, updated, errors };
}

/** One shipment now (the "Refresh" button). */
export async function refreshShipment(deps: Deps, shipmentId: string): Promise<Shipment> {
  const [sh] = await deps.db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!sh) throw new HttpError(404, 'Shipment not found');
  const [t] = await viaDelhivery(() => client(deps).track([sh.waybill]));
  if (!t) throw new HttpError(404, `Delhivery doesn’t know AWB ${sh.waybill} (booked on ${sh.env}?).`);
  return applyTracking(deps, sh, t, 'sync');
}

/**
 * Delhivery's push (scan) webhook. Its payload is { Shipment: { AWB, ReferenceNo, Status: { Status,
 * StatusType, StatusDateTime, StatusLocation, Instructions }, NSLCode, PickUpDate } }. Unknown
 * waybills are ignored (answered 200 so Delhivery doesn't retry forever).
 */
export async function delhiveryWebhook(deps: Deps, payload: unknown): Promise<'applied' | 'unknown' | 'ignored'> {
  const list = Array.isArray(payload) ? payload : [payload];
  let applied = false; let unknown = false;
  for (const item of list) {
    const shp = (item as Record<string, any>)?.Shipment ?? item;
    const awb = String(shp?.AWB ?? shp?.Waybill ?? '').trim();
    if (!awb) continue;
    const [sh] = await deps.db.select().from(shipments).where(eq(shipments.waybill, awb));
    if (!sh) { unknown = true; continue; }
    const st = shp.Status ?? {};
    const statusAt = istDate(st.StatusDateTime);
    const t: Tracked = {
      waybill: awb, reference: String(shp.ReferenceNo ?? ''), status: String(st.Status ?? ''), statusType: String(st.StatusType ?? ''),
      statusCode: String(shp.NSLCode ?? st.StatusCode ?? ''), statusLocation: String(st.StatusLocation ?? ''), statusNote: String(st.Instructions ?? ''),
      statusAt, expectedDelivery: istDate(shp.ExpectedDeliveryDate ?? shp.EDD), pickedUpAt: null, deliveredAt: null,
      attempts: Number(shp.DispatchCount) || 0, chargedWeightGrams: null, scans: [],
    };
    await applyTracking(deps, sh, t, 'webhook');
    applied = true;
  }
  return applied ? 'applied' : unknown ? 'unknown' : 'ignored';
}

/* ---------------- Pickups ---------------- */

/** Parcels booked but not yet handed over, waiting for a pickup request. */
export async function awaitingPickup(deps: Deps): Promise<Shipment[]> {
  const env = deps.delhivery?.env ?? 'production';
  return deps.db.select().from(shipments).where(and(eq(shipments.status, 'manifested'), eq(shipments.env, env))).orderBy(asc(shipments.createdAt));
}

export async function requestPickup(deps: Deps, input: { date: string; time: string; count?: number }, actor: string) {
  const s = await getSettings(deps.db);
  const blockers = shippingBlockers(deps, s);
  if (blockers.length) throw new HttpError(409, blockers[0], 'shipping_not_ready');
  const today = istDay(deps.now());
  if (!/^\d{4}-\d\d-\d\d$/.test(input.date) || input.date < today) throw new HttpError(400, 'Choose today or a later date for the pickup.');
  if (!/^\d\d:\d\d$/.test(input.time)) throw new HttpError(400, 'Choose a pickup time.');
  const waiting = (await awaitingPickup(deps)).filter((x) => !x.pickupRequestId);
  const count = input.count ?? waiting.length;
  if (count < 1) throw new HttpError(409, 'There are no parcels waiting for a pickup.');
  const r = await viaDelhivery(() => client(deps).pickup({ location: s.delhiveryPickupLocation, date: input.date, time: `${input.time}:00`, count }));
  const [row] = await deps.db.insert(pickupRequests).values({
    pickupId: r.pickupId, location: s.delhiveryPickupLocation, pickupDate: input.date, pickupTime: `${input.time}:00`, packageCount: count, centerName: r.centerName, createdBy: actor,
  }).returning();
  if (waiting.length) await deps.db.update(shipments).set({ pickupRequestId: row.id, updatedAt: deps.now() }).where(inArray(shipments.id, waiting.map((w) => w.id)));
  return row;
}

/* ---------------- Failed deliveries (NDR) ---------------- */

export interface NdrInput { action: NdrAction; deferredDate?: string; name?: string; address?: string; phone?: string }

export async function ndrAction(deps: Deps, shipmentId: string, input: NdrInput, actor: string): Promise<Shipment> {
  const [sh] = await deps.db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!sh) throw new HttpError(404, 'Shipment not found');
  if (!['ndr', 'pending'].includes(sh.status)) throw new HttpError(409, 'Delhivery takes these instructions only after a failed delivery attempt.');
  if (input.action === 'DEFER_DLV') {
    if (!input.deferredDate || !/^\d{4}-\d\d-\d\d$/.test(input.deferredDate)) throw new HttpError(400, 'Choose the new delivery date.');
    if (sh.statusCode && !DEFER_CODES.has(sh.statusCode)) throw new HttpError(409, `Delhivery doesn’t allow a new date for this failure (${sh.statusCode}): ask for a re-attempt instead.`);
    const first = sh.scans.find((x) => x.status.toLowerCase() === 'pending' && /^EOD|^ST-108/.test(x.code))?.at ?? sh.statusAt?.toISOString() ?? deps.now().toISOString();
    const max = istDay(new Date(new Date(first).getTime() + 6 * 86_400_000));
    if (input.deferredDate <= istDay(deps.now()) || input.deferredDate > max) throw new HttpError(400, `Delhivery allows a date up to ${max} (six days after the first failed attempt).`);
  }
  if (input.action === 'EDIT_DETAILS' && !input.name && !input.address && !input.phone) throw new HttpError(400, 'Enter the corrected name, address or phone number.');
  const { requestId } = await viaDelhivery(() => client(deps).ndr([{ waybill: sh.waybill, action: input.action, deferredDate: input.deferredDate, name: input.name, address: input.address, phone: input.phone ? phone10(input.phone) : undefined }]));
  const now = deps.now();
  const [u] = await deps.db.update(shipments).set({ ndrAction: input.action, ndrRequestId: requestId, ndrActionAt: now, ndrResult: null, updatedAt: now }).where(eq(shipments.id, sh.id)).returning();
  const what = input.action === 'RE-ATTEMPT' ? 'deliver again' : input.action === 'DEFER_DLV' ? `deliver on ${input.deferredDate}` : 'use corrected details';
  await logEvent(deps.db, sh.orderId, 'shipment', `Asked Delhivery to ${what} (${sh.waybill})`, actor, { requestId });
  return u;
}

/** Checks Delhivery's answer to NDR instructions sent in the last two days. */
export async function checkNdrRequests(deps: Deps) {
  if (!deps.delhivery) return;
  const since = new Date(deps.now().getTime() - 2 * 86_400_000);
  const open = await deps.db.select().from(shipments).where(and(isNull(shipments.ndrResult), sql`${shipments.ndrRequestId} is not null`, sql`${shipments.ndrActionAt} > ${since}`)).limit(50);
  for (const sh of open) {
    const r = await deps.delhivery.ndrStatus(sh.ndrRequestId!);
    const failed = r.failed.find((f) => f.waybill === sh.waybill);
    const done = r.done.some((d) => d.waybill === sh.waybill);
    if (!failed && !done) continue;
    const result = failed ? `Refused: ${failed.message || 'not allowed now'}` : 'Accepted';
    await deps.db.update(shipments).set({ ndrResult: result, updatedAt: deps.now() }).where(eq(shipments.id, sh.id));
    await logEvent(deps.db, sh.orderId, 'shipment', `Delhivery ${failed ? 'refused' : 'accepted'} the instruction for ${sh.waybill}${failed ? `: ${failed.message}` : ''}`, ACTOR);
  }
}

/* ---------------- Views ---------------- */

/** What a customer sees on their order page. */
export function publicShipment(sh: Shipment): PublicShipment {
  return {
    carrier: 'Delhivery',
    waybill: sh.waybill,
    status: sh.status,
    label: SHIPMENT_CUSTOMER_LABEL[sh.status],
    trackingUrl: delhiveryTrackingUrl(sh.waybill),
    expectedDelivery: sh.status === 'delivered' || !sh.expectedDeliveryAt ? null : istDay(sh.expectedDeliveryAt),
    deliveredAt: sh.deliveredAt?.toISOString() ?? null,
    scans: sh.scans.filter((x) => x.status && x.at > '1971').slice(-30).reverse().map((x) => ({
      at: x.at,
      label: x.note && !/manifest uploaded|booked with delhivery/i.test(x.note) ? x.note.split('|')[0].trim().slice(0, 120) : x.status,
      location: x.location.replace(/_/g, ' ').replace(/\s*\(.*\)\s*$/, ''),
    })),
  };
}

/** The order's current parcel (the latest one that isn't cancelled), for the order page. */
export async function currentShipment(deps: Deps, orderId: string): Promise<Shipment | null> {
  const rows = await deps.db.select().from(shipments).where(and(eq(shipments.orderId, orderId), ne(shipments.status, 'cancelled'))).orderBy(desc(shipments.createdAt)).limit(1);
  return rows[0] ?? null;
}
