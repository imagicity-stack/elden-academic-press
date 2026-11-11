// Admin → Dashboard: sales and money for a period (with the previous period to compare), and
// cash on delivery kept apart: advances paid online, cash collected, cash still to collect
// (with its age) and cash lost to refused or cancelled parcels.
//
// Definitions (amounts in paise):
// - Booked sales: orders paid in the period, their total, minus refunds, minus the cash of
//   cash-on-delivery orders cancelled before it was collected.
// - Received: what reached us in the period: the online part of orders paid in the period
//   (prepaid totals and cash-on-delivery advances, minus refunds), plus cash collected in the period.
// - Cash to collect: now, across every open cash-on-delivery order (not limited to the period).
import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import type { Q } from '../db/client.js';
import { orders } from '../db/schema.js';

type Order = typeof orders.$inferSelect;
const PAID = ['paid', 'partially_refunded', 'refunded'] as const;
const IST = 330 * 60_000;
const DAY = 86_400_000;
export const istDay = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
/** Midnight India time, n days before today's (0 = today). */
const istMidnight = (now: Date, daysBack: number) => new Date(Date.parse(`${istDay(now)}T00:00:00+05:30`) - daysBack * DAY);

const isCod = (o: Order) => o.paymentMode === 'cod';
const lostCash = (o: Order) => (isCod(o) && !o.codCollectedAt && o.cancelledAt ? o.codAmount : 0);
const booked = (o: Order) => o.total - o.refundedAmount - lostCash(o);
const onlinePart = (o: Order) => Math.max(0, o.total - o.codAmount - o.refundedAmount);

export async function dashboardMoney(db: Q, days: number, now: Date) {
  const from = istMidnight(now, days - 1);
  const prevFrom = new Date(from.getTime() - days * DAY);
  const inRange = (d: Date | null, a: Date, b: Date) => Boolean(d && d >= a && d < b);
  const end = new Date(now.getTime() + 1);

  // Orders paid in this or the previous period, and cash-on-delivery orders whose cash moved in them.
  const rows = await db.select().from(orders).where(and(inArray(orders.paymentStatus, [...PAID]), or(
    gte(orders.paidAt, prevFrom),
    and(eq(orders.paymentMode, 'cod'), or(gte(orders.codCollectedAt, prevFrom), gte(orders.cancelledAt, prevFrom))),
  )));
  // Every open cash-on-delivery order (cash still to collect), whenever it was placed.
  const open = await db.select().from(orders).where(and(
    inArray(orders.paymentStatus, ['paid', 'partially_refunded']), eq(orders.paymentMode, 'cod'), isNull(orders.codCollectedAt), isNull(orders.cancelledAt),
  )).orderBy(asc(orders.paidAt));

  const window = (a: Date, b: Date) => {
    const paid = rows.filter((o) => inRange(o.paidAt, a, b));
    const bookedSum = paid.reduce((n, o) => n + booked(o), 0);
    const online = paid.reduce((n, o) => n + onlinePart(o), 0);
    const collected = rows.filter((o) => isCod(o) && inRange(o.codCollectedAt, a, b)).reduce((n, o) => n + o.codAmount, 0);
    const count = paid.filter((o) => !(o.paymentStatus === 'refunded' && o.cancelledAt)).length;
    return { booked: bookedSum, received: online + collected, orders: count, aov: count ? Math.round(bookedSum / count) : 0, paid };
  };
  const cur = window(from, end);
  const prev = window(prevFrom, from);

  // The money in this period, split.
  const prepaid = cur.paid.filter((o) => !isCod(o)).reduce((n, o) => n + onlinePart(o), 0);
  const advances = cur.paid.filter(isCod).reduce((n, o) => n + onlinePart(o), 0);
  const collected = rows.filter((o) => isCod(o) && inRange(o.codCollectedAt, from, end));
  const lost = rows.filter((o) => isCod(o) && !o.codCollectedAt && inRange(o.cancelledAt, from, end));
  const outstanding = open.reduce((n, o) => n + o.codAmount, 0);
  const refunds = cur.paid.reduce((n, o) => n + o.refundedAmount, 0);

  // Cash still to collect, by how long it has been waiting.
  const age = (o: Order) => (o.shippedAt ? Math.floor((now.getTime() - o.shippedAt.getTime()) / DAY) : null);
  const bucket = (label: string, f: (o: Order) => boolean) => {
    const xs = open.filter(f);
    return { label, parcels: xs.length, amount: xs.reduce((n, o) => n + o.codAmount, 0) };
  };
  const ageing = [
    bucket('Not shipped yet', (o) => !o.shippedAt),
    bucket('Shipped 0–3 days ago', (o) => age(o) !== null && age(o)! <= 3),
    bucket('Shipped 4–7 days ago', (o) => age(o) !== null && age(o)! >= 4 && age(o)! <= 7),
    bucket('Shipped 8+ days ago', (o) => age(o) !== null && age(o)! >= 8),
  ];

  // Collection: of the cash-on-delivery orders settled in the period, how many paid in cash, and how fast.
  const settled = collected.length + lost.length;
  const daysToCollect = collected.filter((o) => o.paidAt).map((o) => (o.codCollectedAt!.getTime() - o.paidAt!.getTime()) / DAY);
  const codPaid = cur.paid.filter(isCod);

  // Per day: booked, received, orders.
  const dayKeys = Array.from({ length: days }, (_, i) => istDay(new Date(from.getTime() + i * DAY + 12 * 3600_000)));
  const series = dayKeys.map((d) => {
    const paid = cur.paid.filter((o) => istDay(o.paidAt!) === d);
    const cash = collected.filter((o) => istDay(o.codCollectedAt!) === d).reduce((n, o) => n + o.codAmount, 0);
    return {
      day: d,
      booked: paid.reduce((n, o) => n + booked(o), 0),
      received: paid.reduce((n, o) => n + onlinePart(o), 0) + cash,
      orders: paid.length,
    };
  });

  return {
    period: { days, from, to: now },
    kpis: {
      booked: { now: cur.booked, prev: prev.booked },
      received: { now: cur.received, prev: prev.received },
      orders: { now: cur.orders, prev: prev.orders },
      aov: { now: cur.aov, prev: prev.aov },
    },
    money: {
      prepaid, codAdvances: advances,
      codCollected: collected.reduce((n, o) => n + o.codAmount, 0),
      codLost: lost.reduce((n, o) => n + o.codAmount, 0),
      codOutstanding: outstanding,
      refunds,
    },
    cod: {
      orders: codPaid.length,
      share: cur.paid.length ? Math.round((codPaid.length / cur.paid.length) * 1000) / 10 : null,
      value: codPaid.reduce((n, o) => n + o.total, 0),
      outstanding: { amount: outstanding, parcels: open.length, ageing },
      collectedOrders: collected.length,
      lostOrders: lost.length,
      collectionRate: settled ? Math.round((collected.length / settled) * 1000) / 10 : null,
      avgDaysToCollect: daysToCollect.length ? Math.round((daysToCollect.reduce((a, b) => a + b, 0) / daysToCollect.length) * 10) / 10 : null,
      oldest: open.slice(0, 6).map((o) => ({
        id: o.id, number: o.number, name: o.name, codAmount: o.codAmount, paidAt: o.paidAt, shippedAt: o.shippedAt,
        fulfillmentStatus: o.fulfillmentStatus, waitingDays: Math.floor((now.getTime() - (o.paidAt ?? o.createdAt).getTime()) / DAY),
      })),
    },
    mix: {
      online: { orders: cur.paid.length - codPaid.length, value: cur.paid.filter((o) => !isCod(o)).reduce((n, o) => n + o.total, 0) },
      cod: { orders: codPaid.length, value: codPaid.reduce((n, o) => n + o.total, 0) },
    },
    series,
  };
}

