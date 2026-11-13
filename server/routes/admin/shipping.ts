// Admin → Shipping: Delhivery bookings, labels, pickups, tracking and failed deliveries.
import { Hono } from 'hono';
import { and, asc, count, desc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import { orderItems, orders, pickupRequests, settings, shipments } from '../../db/schema.js';
import { body, HttpError, notFound, zText } from '../../lib/http.js';
import { DelhiveryError } from '../../lib/delhivery.js';
import { getSettings } from '../../services/catalog.js';
import {
  awaitingPickup, cancelShipment, createShipment, deliveryDate, labelsPdf, ndrAction, parcelFor, pinInfo, refreshShipment, requestPickup, shippingBlockers, syncShipments,
} from '../../services/shipping.js';
import { SHIPMENT_STATUSES } from '../../../src/shared/shipping.js';
import { audit, requireRole } from './auth.js';

export const adminShipping = new Hono<AppEnv>();

const settingsView = (s: typeof settings.$inferSelect) => ({
  enabled: s.delhiveryEnabled, pickupLocation: s.delhiveryPickupLocation, originPin: s.delhiveryOriginPin, mode: s.delhiveryMode,
  autoShip: s.delhiveryAutoShip, checkoutCheck: s.delhiveryCheckoutCheck, lengthCm: s.shipLengthCm, breadthCm: s.shipBreadthCm,
  heightCm: s.shipHeightCm, packagingGrams: s.shipPackagingGrams, defaultBookGrams: s.shipDefaultBookGrams, hsnCode: s.shipHsnCode,
});

/** Paid orders with printed books that have no live Delhivery parcel yet. */
const toShipWhere = and(
  inArray(orders.paymentStatus, ['paid', 'partially_refunded']),
  isNull(orders.cancelledAt),
  eq(orders.requiresShipping, true),
  inArray(orders.fulfillmentStatus, ['unfulfilled', 'packed']),
  notExists(sql`(select 1 from ${shipments} where ${shipments.orderId} = ${orders.id} and ${shipments.status} not in ('cancelled', 'returned', 'lost'))`),
);

adminShipping.get('/', async (c) => {
  const deps = c.get('deps');
  const s = await getSettings(deps.db);
  const status = c.req.query('status');
  const shipWhere = status && (SHIPMENT_STATUSES as readonly string[]).includes(status) ? eq(shipments.status, status as typeof SHIPMENT_STATUSES[number]) : undefined;
  const [counts, toShip, list, pickups, waiting] = await Promise.all([
    deps.db.select({ status: shipments.status, n: count() }).from(shipments).groupBy(shipments.status),
    deps.db.select({
      id: orders.id, number: orders.number, name: orders.name, city: orders.shipCity, pincode: orders.shipPincode, total: orders.total,
      paymentMode: orders.paymentMode, codAmount: orders.codAmount, codConfirmation: orders.codConfirmation, paidAt: orders.paidAt,
      fulfillmentStatus: orders.fulfillmentStatus, needsAttention: orders.needsAttention, attentionReason: orders.attentionReason,
    }).from(orders).where(toShipWhere).orderBy(asc(orders.paidAt)).limit(200),
    deps.db.select({
      id: shipments.id, waybill: shipments.waybill, status: shipments.status, carrierStatus: shipments.carrierStatus, statusLocation: shipments.statusLocation,
      statusNote: shipments.statusNote, statusAt: shipments.statusAt, paymentMode: shipments.paymentMode, codAmount: shipments.codAmount,
      weightGrams: shipments.weightGrams, mode: shipments.mode, chargeEstimate: shipments.chargeEstimate, expectedDeliveryAt: shipments.expectedDeliveryAt,
      attempts: shipments.attempts, ndrAction: shipments.ndrAction, ndrResult: shipments.ndrResult, pickupRequestId: shipments.pickupRequestId,
      syncError: shipments.syncError, lastSyncedAt: shipments.lastSyncedAt, createdAt: shipments.createdAt, env: shipments.env,
      orderId: orders.id, orderNumber: orders.number, name: orders.name, city: orders.shipCity, pincode: orders.shipPincode, phone: orders.phone,
    }).from(shipments).innerJoin(orders, eq(orders.id, shipments.orderId)).where(shipWhere).orderBy(desc(shipments.createdAt)).limit(300),
    deps.db.select().from(pickupRequests).orderBy(desc(pickupRequests.createdAt)).limit(10),
    awaitingPickup(deps),
  ]);
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  return c.json({
    settings: settingsView(s),
    blockers: shippingBlockers(deps, s),
    connected: Boolean(deps.delhivery),
    env: deps.delhivery?.env ?? null,
    simulator: Boolean(deps.delhivery) && !deps.env.DELHIVERY_API_TOKEN,
    webhook: deps.env.DELHIVERY_WEBHOOK_SECRET ? `${site}/api/webhooks/delhivery/…` : null,
    counts: Object.fromEntries(counts.map((r) => [r.status, r.n])),
    toShip,
    shipments: list,
    pickups,
    awaitingPickup: { total: waiting.length, unrequested: waiting.filter((w) => !w.pickupRequestId).length },
  });
});

const zSettings = z.object({
  enabled: z.boolean(),
  pickupLocation: zText(120),
  originPin: z.union([z.string().regex(/^[1-9]\d{5}$/, 'A 6-digit PIN code'), z.literal('')]),
  mode: z.enum(['Surface', 'Express']),
  autoShip: z.boolean(),
  checkoutCheck: z.boolean(),
  lengthCm: z.number().int().min(1).max(200),
  breadthCm: z.number().int().min(1).max(200),
  heightCm: z.number().int().min(1).max(200),
  packagingGrams: z.number().int().min(0).max(5000),
  defaultBookGrams: z.number().int().min(10).max(10000),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, '4 to 8 digits'),
});

adminShipping.put('/settings', requireRole('manager'), async (c) => {
  const deps = c.get('deps');
  const v = await body(c, zSettings);
  await getSettings(deps.db);
  const [s] = await deps.db.update(settings).set({
    delhiveryEnabled: v.enabled, delhiveryPickupLocation: v.pickupLocation, delhiveryOriginPin: v.originPin, delhiveryMode: v.mode,
    delhiveryAutoShip: v.autoShip, delhiveryCheckoutCheck: v.checkoutCheck, shipLengthCm: v.lengthCm, shipBreadthCm: v.breadthCm,
    shipHeightCm: v.heightCm, shipPackagingGrams: v.packagingGrams, shipDefaultBookGrams: v.defaultBookGrams, shipHsnCode: v.hsnCode, updatedAt: sql`now()`,
  }).where(eq(settings.id, 1)).returning();
  await audit(c, 'shipping.settings', 'settings', '1', v);
  return c.json({ settings: settingsView(s), blockers: shippingBlockers(deps, s) });
});

/** "Test connection": asks Delhivery about the pickup PIN code (proves the token and the environment). */
adminShipping.post('/test', async (c) => {
  const deps = c.get('deps');
  const s = await getSettings(deps.db);
  if (!deps.delhivery) throw new HttpError(503, 'Delhivery isn’t connected: add DELHIVERY_API_TOKEN in Vercel and redeploy.');
  const pin = /^[1-9]\d{5}$/.test(s.delhiveryOriginPin) ? s.delhiveryOriginPin : '110001';
  try {
    const info = await deps.delhivery.pincode(pin);
    return c.json({ ok: true, env: deps.delhivery.env, pin, serviceable: Boolean(info), message: info ? `Connected to Delhivery (${deps.delhivery.env}). PIN ${pin} is served${info.cod ? ', with cash on delivery' : ''}.` : `Connected to Delhivery (${deps.delhivery.env}), but it doesn’t list PIN ${pin}.` });
  } catch (e) {
    return c.json({ ok: false, env: deps.delhivery.env, pin, message: (e as Error).message }, e instanceof DelhiveryError ? 200 : 500);
  }
});

/** Before booking: the parcel as it would go, Delhivery's charge estimate and delivery date. */
adminShipping.get('/orders/:id/quote', async (c) => {
  const deps = c.get('deps');
  const [o] = await deps.db.select().from(orders).where(eq(orders.id, c.req.param('id')));
  if (!o) throw notFound('Order not found');
  const s = await getSettings(deps.db);
  const items = await deps.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
  const parcel = parcelFor(o, items, s);
  const pin = o.shipPincode ?? '';
  const out: { parcel: typeof parcel; serviceable: boolean | null; cod: boolean | null; charge: number | null; deliveryBy: string | null; warning: string | null } = {
    parcel, serviceable: null, cod: null, charge: null, deliveryBy: null, warning: null,
  };
  if (deps.delhivery && /^[1-9]\d{5}$/.test(pin)) {
    const [info, charge, tat] = await Promise.allSettled([
      pinInfo(deps, pin),
      /^[1-9]\d{5}$/.test(s.delhiveryOriginPin) ? deps.delhivery.charges({ originPin: s.delhiveryOriginPin, destinationPin: pin, weightGrams: parcel.weightGrams, mode: parcel.mode, paymentMode: parcel.paymentMode, codAmount: parcel.codAmount }) : Promise.resolve(null),
      /^[1-9]\d{5}$/.test(s.delhiveryOriginPin) ? deliveryDate(deps, s, pin) : Promise.resolve({ days: null, date: null }),
    ]);
    if (info.status === 'fulfilled') { out.serviceable = Boolean(info.value); out.cod = info.value?.cod ?? false; }
    if (charge.status === 'fulfilled') out.charge = charge.value?.total ?? null;
    if (tat.status === 'fulfilled' && tat.value.date) out.deliveryBy = new Date(tat.value.date.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    if (out.serviceable === false) out.warning = `Delhivery doesn’t deliver to PIN ${pin}.`;
    else if (parcel.paymentMode === 'COD' && out.cod === false) out.warning = `Delhivery doesn’t collect cash at PIN ${pin}: ask the customer to pay online, or ship another way.`;
  }
  return c.json(out);
});

const zShip = z.object({
  weightGrams: z.number().int().min(50).max(50_000).optional(),
  lengthCm: z.number().int().min(1).max(200).optional(),
  breadthCm: z.number().int().min(1).max(200).optional(),
  heightCm: z.number().int().min(1).max(200).optional(),
  mode: z.enum(['Surface', 'Express']).optional(),
});

adminShipping.post('/orders/:id/ship', async (c) => {
  const deps = c.get('deps');
  const input = await body(c, zShip);
  const sh = await createShipment(deps, c.req.param('id'), input, c.get('admin').email);
  await audit(c, 'shipment.create', 'order', c.req.param('id'), { waybill: sh.waybill, ...input });
  return c.json({ shipment: sh });
});

/** Book several orders at once, with the usual parcel for each. */
adminShipping.post('/bulk-ship', async (c) => {
  const deps = c.get('deps');
  const { orderIds } = await body(c, z.object({ orderIds: z.array(z.uuid()).min(1).max(50) }));
  const results: { orderId: string; waybill?: string; shipmentId?: string; error?: string }[] = [];
  for (const id of orderIds) {
    try {
      const sh = await createShipment(deps, id, {}, c.get('admin').email);
      results.push({ orderId: id, waybill: sh.waybill, shipmentId: sh.id });
    } catch (e) {
      results.push({ orderId: id, error: (e as Error).message });
    }
  }
  await audit(c, 'shipment.bulk_create', 'orders', null, { count: orderIds.length, booked: results.filter((r) => r.waybill).length });
  return c.json({ results });
});

adminShipping.post('/shipments/:id/cancel', async (c) => {
  const sh = await cancelShipment(c.get('deps'), c.req.param('id'), c.get('admin').email);
  await audit(c, 'shipment.cancel', 'shipment', sh.waybill);
  return c.json({ shipment: sh });
});

adminShipping.post('/shipments/:id/refresh', async (c) => c.json({ shipment: await refreshShipment(c.get('deps'), c.req.param('id')) }));

const zNdr = z.object({
  action: z.enum(['RE-ATTEMPT', 'DEFER_DLV', 'EDIT_DETAILS']),
  deferredDate: z.string().regex(/^\d{4}-\d\d-\d\d$/).optional(),
  name: zText(100).optional(),
  address: zText(480).optional(),
  phone: z.string().trim().regex(/^(\+?91)?[6-9]\d{9}$/, 'A 10-digit Indian mobile number').optional(),
});

adminShipping.post('/shipments/:id/ndr', async (c) => {
  const input = await body(c, zNdr);
  const sh = await ndrAction(c.get('deps'), c.req.param('id'), input, c.get('admin').email);
  await audit(c, 'shipment.ndr', 'shipment', sh.waybill, input);
  return c.json({ shipment: sh });
});

/** Labels as one PDF: ?ids=<shipment id>,<shipment id>&size=4R|A4. */
adminShipping.get('/labels.pdf', async (c) => {
  const ids = (c.req.query('ids') ?? '').split(',').map((x) => x.trim()).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100);
  const size = c.req.query('size') === 'A4' ? 'A4' : '4R';
  const pdf = await labelsPdf(c.get('deps'), ids, size);
  return c.body(pdf as unknown as ArrayBuffer, 200, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="delhivery-labels-${ids.length}.pdf"`,
    'Cache-Control': 'no-store',
  });
});

adminShipping.post('/pickup', async (c) => {
  const input = await body(c, z.object({ date: z.string(), time: z.string(), count: z.number().int().min(1).max(500).optional() }));
  const p = await requestPickup(c.get('deps'), input, c.get('admin').email);
  await audit(c, 'shipment.pickup', 'pickup', p.pickupId, input);
  return c.json({ pickup: p });
});

/** "Refresh all": tracking for every active parcel now. */
adminShipping.post('/sync', async (c) => c.json(await syncShipments(c.get('deps'))));
