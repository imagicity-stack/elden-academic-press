// Shipping with Delhivery (B2C Express Parcel): the shipment statuses we keep, how Delhivery's own
// statuses map onto them, and the labels shown to staff and customers. Shared by the server
// (server/services/shipping.ts), the admin and the order page.
//
// Delhivery reports a shipment as a StatusType + Status pair (developer docs → Package lifecycle):
//   UD (undelivered, forward):  Manifested · Not Picked · In Transit · Pending · Dispatched
//   DL (closed):                Delivered · RTO (returned to us) · DTO
//   RT (returning to us):       In Transit · Pending · Dispatched
//   CN (cancelled):             Canceled · Closed
// plus an NSL StatusCode on each scan; "EOD-…" codes on an undelivered package are failed
// delivery attempts (NDR), which staff can act on (re-attempt, new date, corrected address).

export const SHIPMENT_STATUSES = [
  'manifested', 'in_transit', 'pending', 'out_for_delivery', 'ndr', 'delivered', 'rto', 'returned', 'cancelled', 'lost',
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/** Still moving: tracking is refreshed for these. */
export const ACTIVE_SHIPMENT: ShipmentStatus[] = ['manifested', 'in_transit', 'pending', 'out_for_delivery', 'ndr', 'rto'];
/** Finished: nothing more will happen. */
export const FINAL_SHIPMENT: ShipmentStatus[] = ['delivered', 'returned', 'cancelled', 'lost'];

export const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  manifested: 'Ready for pickup',
  in_transit: 'In transit',
  pending: 'At the delivery hub',
  out_for_delivery: 'Out for delivery',
  ndr: 'Delivery attempt failed',
  delivered: 'Delivered',
  rto: 'Returning to us',
  returned: 'Returned to us',
  cancelled: 'Cancelled',
  lost: 'Lost in transit',
};

/** What a customer sees (no internal wording). */
export const SHIPMENT_CUSTOMER_LABEL: Record<ShipmentStatus, string> = {
  manifested: 'Packed, waiting for the courier',
  in_transit: 'On its way',
  pending: 'Reached your city',
  out_for_delivery: 'Out for delivery today',
  ndr: 'Delivery attempted',
  delivered: 'Delivered',
  rto: 'Being returned to us',
  returned: 'Returned to us',
  cancelled: 'Shipment cancelled',
  lost: 'Delayed: we are checking with the courier',
};

/**
 * "EOD-…" (end of day) and "ST-108" status codes: the courier tried and could not deliver.
 * From Delhivery's NDR API docs (the codes that allow a re-attempt or a new delivery date).
 */
export const NDR_CODES = new Set(['EOD-3', 'EOD-6', 'EOD-11', 'EOD-15', 'EOD-16', 'EOD-43', 'EOD-69', 'EOD-74', 'EOD-86', 'EOD-104', 'ST-108']);
/** Codes that allow "deliver on a later date" (DEFER_DLV). */
export const DEFER_CODES = new Set(['EOD-74', 'EOD-15', 'EOD-11', 'EOD-3', 'EOD-16', 'EOD-6', 'ST-108']);

const norm = (s: string | null | undefined) => (s ?? '').replace(/[\s­-]+/g, ' ').trim().toLowerCase();

/**
 * Our status from Delhivery's StatusType, Status and StatusCode. Unknown combinations return null
 * (the shipment keeps its last known status), so a new status on Delhivery's side never breaks sync.
 */
export function mapDelhiveryStatus(type: string | null | undefined, status: string | null | undefined, code?: string | null): ShipmentStatus | null {
  const t = (type ?? '').trim().toUpperCase();
  const s = norm(status);
  const c = (code ?? '').trim().toUpperCase();
  if (t === 'DL') return s === 'rto' || s === 'dto' ? 'returned' : 'delivered';
  if (t === 'RT') return 'rto';
  if (t === 'CN') return 'cancelled';
  if (t === 'LT' || s === 'lost') return 'lost';
  if (t === 'UD' || t === '') {
    if (s === 'manifested' || s === 'not picked' || s === 'open' || s === 'scheduled') return 'manifested';
    if (s === 'in transit') return 'in_transit';
    if (s === 'dispatched') return 'out_for_delivery';
    if (s === 'pending') return NDR_CODES.has(c) ? 'ndr' : 'pending';
    if (s === 'delivered') return 'delivered';
    if (s === 'rto') return 'returned';
    if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  }
  return null;
}

/** The order's fulfilment step that goes with a shipment status (null: leave the order as it is). */
export function fulfilmentFor(s: ShipmentStatus): 'packed' | 'shipped' | 'delivered' | null {
  if (s === 'manifested') return 'packed';
  if (s === 'delivered') return 'delivered';
  if (s === 'cancelled' || s === 'lost' || s === 'returned') return null;
  return 'shipped';
}

/** Delhivery's public tracking page for a waybill. */
export const delhiveryTrackingUrl = (waybill: string) => `https://www.delhivery.com/track-v2/package/${encodeURIComponent(waybill)}`;

/** One scan, as kept on a shipment and shown in the timeline. */
export interface ShipmentScan {
  /** ISO time (India). */
  at: string;
  status: string;
  type: string;
  code: string;
  location: string;
  note: string;
}

/** What the order page and the customer's tracking show about a shipment. */
export interface PublicShipment {
  carrier: 'Delhivery';
  waybill: string;
  status: ShipmentStatus;
  label: string;
  trackingUrl: string;
  expectedDelivery: string | null;
  deliveredAt: string | null;
  scans: { at: string; label: string; location: string }[];
}

/** NDR actions staff can take (Delhivery's NDR API "act" values). */
export type NdrAction = 'RE-ATTEMPT' | 'DEFER_DLV' | 'EDIT_DETAILS';

/** Label sizes Delhivery prints: 4R is a 4 × 6 inch thermal label, A4 a full sheet. */
export type LabelSize = '4R' | 'A4';
