// Delhivery B2C (Express Parcel) API: the calls the store makes, and a simulator for local
// development and tests. Reference: Delhivery's developer docs (one.delhivery.com/developer-portal,
// "B2C"; delhivery-express-api-doc.readme.io), summarised in docs/DELHIVERY.md.
//
// Every call sends `Authorization: Token <API token>`. Production is track.delhivery.com, the test
// system staging-express.delhivery.com (with its own token). Money here is paise; Delhivery takes
// and returns rupees. Delhivery's times have no zone and are India time.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { LabelSize, NdrAction } from '../../src/shared/shipping.js';

export type DelhiveryEnv = 'staging' | 'production';
export const DELHIVERY_HOSTS: Record<DelhiveryEnv, string> = {
  production: 'https://track.delhivery.com',
  staging: 'https://staging-express.delhivery.com',
};

export interface PinInfo {
  pin: string;
  /** Delhivery delivers prepaid parcels here. */
  prepaid: boolean;
  /** …and collects cash on delivery here. */
  cod: boolean;
  /** Out of delivery area: delivered, but it can take longer and cost more. */
  oda: boolean;
  district: string;
  stateCode: string;
  /** Delhivery's note, e.g. an embargo. */
  remark: string;
}

export interface NewShipment {
  /** Our reference for this parcel (unique per shipment): "100023". */
  reference: string;
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pin: string;
  paymentMode: 'Prepaid' | 'COD';
  /** Cash to collect (paise; 0 for prepaid). */
  codAmount: number;
  /** Value of the books (paise). */
  totalAmount: number;
  productsDescription: string;
  quantity: number;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  mode: 'Surface' | 'Express';
  orderDate: Date;
  sellerName: string;
  sellerGstin: string;
  sellerAddress: string;
  invoiceNumber: string;
  hsnCode: string;
}

export interface Created { reference: string; waybill: string }

export interface TrackedScan { at: Date | null; status: string; type: string; code: string; location: string; note: string }
export interface Tracked {
  waybill: string;
  reference: string;
  status: string;
  statusType: string;
  statusCode: string;
  statusLocation: string;
  statusNote: string;
  statusAt: Date | null;
  expectedDelivery: Date | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  attempts: number;
  chargedWeightGrams: number | null;
  scans: TrackedScan[];
}

export interface NdrRequest { waybill: string; action: NdrAction; deferredDate?: string; name?: string; address?: string; phone?: string }
export interface NdrResult { status: string; done: { waybill: string; action: string }[]; failed: { waybill: string; action: string; message: string }[] }

export interface Delhivery {
  env: DelhiveryEnv;
  /** null: Delhivery doesn't deliver to this PIN code. */
  pincode(pin: string): Promise<PinInfo | null>;
  /** Days in transit and the expected delivery date, or nulls when Delhivery has no estimate. */
  expectedTat(input: { originPin: string; destinationPin: string; mode: 'Surface' | 'Express'; pickupAt: Date }): Promise<{ days: number | null; date: Date | null }>;
  /** Approximate charge (paise, GST included) and the weight Delhivery would charge for. */
  charges(input: { originPin: string; destinationPin: string; weightGrams: number; mode: 'Surface' | 'Express'; paymentMode: 'Prepaid' | 'COD'; codAmount: number }): Promise<{ total: number; chargedGrams: number | null } | null>;
  /** Books parcels (manifestation). Throws DelhiveryError with Delhivery's reason when one fails. */
  create(pickupLocation: string, shipments: NewShipment[]): Promise<Created[]>;
  /** The shipping label: a link to Delhivery's PDF (or the PDF itself, in the simulator). */
  label(waybill: string, size: LabelSize): Promise<{ url?: string; pdf?: Uint8Array }>;
  /** Cancels a parcel that hasn't been delivered (before pickup it simply never moves). */
  cancel(waybill: string): Promise<string>;
  /** Up to 50 waybills per call (Delhivery's limit). Unknown waybills are left out. */
  track(waybills: string[]): Promise<Tracked[]>;
  /** Asks Delhivery to collect parcels from the pickup location. */
  pickup(input: { location: string; date: string; time: string; count: number }): Promise<{ pickupId: string; centerName: string }>;
  /** Actions on failed deliveries; Delhivery answers with a request id to check later. */
  ndr(requests: NdrRequest[]): Promise<{ requestId: string }>;
  ndrStatus(requestId: string): Promise<NdrResult>;
}

export class DelhiveryError extends Error {
  constructor(message: string, readonly status = 0, readonly body: unknown = null) {
    super(message);
    this.name = 'DelhiveryError';
  }
}

/** Delhivery's zone-less times are India time. */
export function istDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : /^\d{4}-\d\d-\d\d$/.test(s) ? `${s}T00:00:00+05:30` : `${s.replace(' ', 'T')}+05:30`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const rupees = (paise: number) => Math.round(paise) / 100;
const str = (v: unknown) => (v == null ? '' : String(v)).trim();

/**
 * Delhivery rejects some characters in parcel details (&, #, %, ; and backslash: "our system does
 * not accept special characters in the payload"). Replaced with safe equivalents.
 */
export function clean(v: string, max = 250): string {
  return v.replace(/&/g, ' and ').replace(/#/g, 'No. ').replace(/%/g, ' pc').replace(/[;\\]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The shipments[] entry Delhivery's create API takes. */
export function shipmentPayload(s: NewShipment): Record<string, unknown> {
  const ist = new Date(s.orderDate.getTime() + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
  return {
    name: clean(s.name, 100),
    add: clean(s.address, 480),
    pin: s.pin,
    city: clean(s.city, 80),
    state: clean(s.state, 80),
    country: 'India',
    phone: s.phone,
    order: s.reference,
    payment_mode: s.paymentMode,
    ...(s.paymentMode === 'COD' ? { cod_amount: rupees(s.codAmount) } : {}),
    total_amount: rupees(s.totalAmount),
    products_desc: clean(s.productsDescription, 480),
    quantity: String(s.quantity),
    weight: s.weightGrams,
    shipment_length: s.lengthCm,
    shipment_width: s.breadthCm,
    shipment_height: s.heightCm,
    shipping_mode: s.mode,
    order_date: ist,
    seller_name: clean(s.sellerName, 100),
    seller_add: clean(s.sellerAddress, 250),
    seller_inv: s.invoiceNumber,
    ...(s.sellerGstin ? { seller_gst_tin: s.sellerGstin } : {}),
    hsn_code: s.hsnCode,
    category_of_goods: 'Books',
  };
}

/** Reads one parcel from a tracking response (ShipmentData[].Shipment). */
export function parseTracked(sh: Record<string, any>): Tracked | null {
  const waybill = str(sh.AWB);
  if (!waybill) return null;
  const st = (sh.Status ?? {}) as Record<string, unknown>;
  const scans: TrackedScan[] = (Array.isArray(sh.Scans) ? sh.Scans : []).map((x: any) => x?.ScanDetail ?? x).filter(Boolean).map((d: any) => ({
    at: istDate(d.StatusDateTime ?? d.ScanDateTime),
    status: str(d.Scan ?? d.Status),
    type: str(d.ScanType ?? d.StatusType),
    code: str(d.StatusCode),
    location: str(d.ScannedLocation ?? d.StatusLocation),
    note: str(d.Instructions),
  }));
  const charged = Number(sh.ChargedWeight);
  return {
    waybill,
    reference: str(sh.ReferenceNo),
    status: str(st.Status),
    statusType: str(st.StatusType),
    statusCode: str(st.StatusCode),
    statusLocation: str(st.StatusLocation),
    statusNote: str(st.Instructions),
    statusAt: istDate(st.StatusDateTime),
    expectedDelivery: istDate(sh.ExpectedDeliveryDate) ?? istDate(sh.PromisedDeliveryDate),
    pickedUpAt: istDate(sh.PickUpDate) ?? istDate(sh.PickedupDate),
    deliveredAt: istDate(sh.DeliveryDate),
    attempts: Number(sh.DispatchCount) || 0,
    chargedWeightGrams: Number.isFinite(charged) && charged > 0 ? charged : null,
    scans,
  };
}

/** The first link to a PDF anywhere in a packing-slip response (its key has changed over the years). */
export function findPdfLink(v: unknown): string | undefined {
  if (typeof v === 'string') return /^https:\/\/\S+/.test(v) && /pdf|label|slip|amazonaws|s3/i.test(v) ? v : undefined;
  if (Array.isArray(v)) { for (const x of v) { const f = findPdfLink(x); if (f) return f; } return undefined; }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['pdf_download_link', 'pdf_link', 'pdf_url', 'label_url']) if (typeof o[k] === 'string' && /^https:\/\//.test(o[k] as string)) return o[k] as string;
    for (const x of Object.values(o)) { const f = findPdfLink(x); if (f) return f; }
  }
  return undefined;
}

/** A readable reason from any of Delhivery's error shapes. */
function reason(body: unknown, fallback: string): string {
  if (typeof body === 'string') return body.slice(0, 300) || fallback;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const k of ['rmk', 'error', 'Error', 'detail', 'message', 'remark', 'remarks']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim() && v !== 'true') return v.slice(0, 300);
      if (Array.isArray(v) && v.length) return v.map(String).join('; ').slice(0, 300);
    }
    const first = Object.entries(o).find(([, v]) => typeof v === 'string');
    if (first) return `${first[0]}: ${first[1]}`.slice(0, 300);
  }
  return fallback;
}

export function delhiveryHttp(opts: { token: string; env: DelhiveryEnv; fetch?: typeof fetch; timeoutMs?: number }): Delhivery {
  const base = DELHIVERY_HOSTS[opts.env];
  const f = opts.fetch ?? fetch;
  const headers = { Authorization: `Token ${opts.token}`, Accept: 'application/json' };

  async function call(path: string, init: { method?: string; json?: unknown; form?: Record<string, string> } = {}): Promise<unknown> {
    const h: Record<string, string> = { ...headers };
    let body: string | undefined;
    if (init.json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
    if (init.form) { h['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(init.form).toString(); }
    let res: Response;
    try {
      res = await f(base + path, { method: init.method ?? (body ? 'POST' : 'GET'), headers: h, body, signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000), redirect: 'error' });
    } catch (e) {
      throw new DelhiveryError(`Couldn't reach Delhivery (${(e as Error).name === 'TimeoutError' ? 'no answer in time' : (e as Error).message}).`);
    }
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* plain text */ }
    if (res.status === 401 || res.status === 403) throw new DelhiveryError('Delhivery refused the API token: check DELHIVERY_API_TOKEN (and DELHIVERY_ENV: a staging token only works on staging).', res.status, parsed);
    if (res.status === 429) throw new DelhiveryError('Delhivery asked us to slow down (too many requests). Try again in a minute.', 429, parsed);
    if (!res.ok) throw new DelhiveryError(`Delhivery: ${reason(parsed, `error ${res.status}`)}`, res.status, parsed);
    return parsed;
  }

  return {
    env: opts.env,

    async pincode(pin) {
      const r = await call(`/c/api/pin-codes/json/?filter_codes=${encodeURIComponent(pin)}`) as { delivery_codes?: { postal_code?: Record<string, unknown> }[] };
      const pc = r?.delivery_codes?.[0]?.postal_code;
      if (!pc) return null;
      const yes = (v: unknown) => str(v).toUpperCase() === 'Y';
      const remark = str(pc.remarks ?? pc.remark);
      const embargo = /embargo/i.test(remark);
      const info: PinInfo = {
        pin: str(pc.pin) || pin,
        prepaid: yes(pc.pre_paid) && !embargo,
        cod: (yes(pc.cash) || yes(pc.cod)) && !embargo,
        oda: yes(pc.is_oda),
        district: str(pc.district),
        stateCode: str(pc.state_code),
        remark,
      };
      return info.prepaid || info.cod ? info : null;
    },

    async expectedTat({ originPin, destinationPin, mode, pickupAt }) {
      const ist = new Date(pickupAt.getTime() + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 16);
      const q = new URLSearchParams({ origin_pin: originPin, destination_pin: destinationPin, mot: mode === 'Express' ? 'E' : 'S', pdt: 'B2C', expected_pickup_date: ist });
      const r = await call(`/api/dc/expected_tat?${q}`) as Record<string, unknown>;
      // The answer's shape isn't fixed in the docs: look for a number of days and a date anywhere in it.
      let days: number | null = null; let date: Date | null = null;
      const walk = (v: unknown, key = '') => {
        if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k.toLowerCase()); return; }
        if (days === null && /tat/.test(key) && Number.isFinite(Number(v)) && Number(v) >= 0) days = Number(v);
        if (!date && /date|edd/.test(key) && typeof v === 'string') date = istDate(v);
      };
      walk(r);
      return { days, date };
    },

    async charges({ originPin, destinationPin, weightGrams, mode, paymentMode, codAmount }) {
      const q = new URLSearchParams({
        md: mode === 'Express' ? 'E' : 'S', ss: 'Delivered', d_pin: destinationPin, o_pin: originPin, cgm: String(Math.max(1, Math.round(weightGrams))),
        pt: paymentMode === 'COD' ? 'COD' : 'Pre-paid', cod: String(paymentMode === 'COD' ? rupees(codAmount) : 0),
      });
      const r = await call(`/api/kinko/v1/invoice/charges/.json?${q}`);
      const row = (Array.isArray(r) ? r[0] : r) as Record<string, unknown> | undefined;
      const total = Number(row?.total_amount);
      if (!row || !Number.isFinite(total)) return null;
      const cw = Number(row.charged_weight);
      return { total: Math.round(total * 100), chargedGrams: Number.isFinite(cw) && cw > 0 ? cw : null };
    },

    async create(pickupLocation, shipments) {
      const data = { shipments: shipments.map(shipmentPayload), pickup_location: { name: pickupLocation } };
      const r = await call('/api/cmu/create.json', { form: { format: 'json', data: JSON.stringify(data) } }) as Record<string, any>;
      const packages: Record<string, unknown>[] = Array.isArray(r?.packages) ? r.packages : [];
      const failed = packages.filter((p) => !/success/i.test(str(p.status)) || !str(p.waybill));
      if (!packages.length || failed.length || r?.success === false) {
        const why = failed.length ? failed.map((p) => `${str(p.refnum)}: ${reason({ remarks: p.remarks }, 'rejected')}`).join('; ') : reason(r, 'Delhivery did not book the parcel');
        // Delhivery's way of saying the pickup location name isn't one of this account's warehouses.
        const hint = /ClientWarehouse/i.test(why)
          ? ` Delhivery has no pickup location called "${pickupLocation}" on the account this API token belongs to (${opts.env}). In Delhivery One → Settings → Pickup locations, copy the name exactly (capitals, spaces, dots) into Admin → Shipping → Settings. A staging token only knows warehouses made on staging.`
          : '';
        throw new DelhiveryError(`Delhivery didn't book it: ${why}${hint}`, 200, r);
      }
      return packages.map((p) => ({ reference: str(p.refnum), waybill: str(p.waybill) }));
    },

    async label(waybill, size) {
      const r = await call(`/api/p/packing_slip?wbns=${encodeURIComponent(waybill)}&pdf=true&pdf_size=${size}`);
      const url = findPdfLink(r);
      if (!url) throw new DelhiveryError(`Delhivery has no label for ${waybill} yet.`, 200, r);
      return { url };
    },

    async cancel(waybill) {
      const r = await call('/api/p/edit', { json: { waybill, cancellation: 'true' } }) as Record<string, unknown>;
      if (r?.status === false || /fail/i.test(str(r?.status))) throw new DelhiveryError(`Delhivery didn't cancel it: ${reason(r, 'refused')}`, 200, r);
      return reason({ remark: r?.remark }, 'Cancelled');
    },

    async track(waybills) {
      const out: Tracked[] = [];
      for (let i = 0; i < waybills.length; i += 50) {
        const batch = waybills.slice(i, i + 50);
        const r = await call(`/api/v1/packages/json/?waybill=${batch.map(encodeURIComponent).join(',')}`) as Record<string, any>;
        if (r?.Error && !r?.ShipmentData) throw new DelhiveryError(`Delhivery: ${str(r.Error)}`, 200, r);
        const list = Array.isArray(r?.ShipmentData) ? r.ShipmentData : r?.ShipmentData ? [r.ShipmentData] : [];
        for (const x of list) { const t = parseTracked(x?.Shipment ?? x); if (t) out.push(t); }
      }
      return out;
    },

    async pickup({ location, date, time, count }) {
      const r = await call('/fm/request/new/', { json: { pickup_location: location, pickup_date: date, pickup_time: time, expected_package_count: count } }) as Record<string, unknown>;
      const id = str(r?.pickup_id);
      if (!id) throw new DelhiveryError(`Delhivery didn't book the pickup: ${reason(r, 'no pickup id')}`, 200, r);
      return { pickupId: id, centerName: str(r.incoming_center_name) };
    },

    async ndr(requests) {
      const data = requests.map((q) => ({
        waybill: q.waybill, act: q.action,
        ...(q.action === 'DEFER_DLV' ? { action_data: { deferred_date: q.deferredDate } } : {}),
        ...(q.action === 'EDIT_DETAILS' ? { action_data: Object.fromEntries(Object.entries({ name: q.name, add: q.address ? clean(q.address, 480) : undefined, phone: q.phone }).filter(([, v]) => v)) } : {}),
      }));
      const r = await call('/api/p/update', { json: { data } }) as Record<string, unknown>;
      const id = str(r?.request_id);
      if (!id) throw new DelhiveryError(`Delhivery didn't take the request: ${reason(r, 'no request id')}`, 200, r);
      return { requestId: id };
    },

    async ndrStatus(requestId) {
      const r = await call(`/api/cmu/get_bulk_upl/${encodeURIComponent(requestId)}?verbose=true`) as Record<string, any>;
      const list = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[];
      return {
        status: str(r?.status),
        done: list(r?.success_wbns).map((x) => ({ waybill: str(x.waybill), action: str(x.action) })),
        failed: list(r?.failed_wbns).map((x) => ({ waybill: str(x.waybill), action: str(x.action), message: str(x.message) })),
      };
    },
  };
}

/* ---------------- Simulator ---------------- */

/**
 * Delhivery without Delhivery, for local development (no token, not on Vercel) and tests:
 * books parcels with made-up waybills, prints a simple label, and lets a test move a parcel
 * through its journey with `scan()`.
 */
export function delhiverySimulator(): Delhivery & {
  booked: { pickupLocation: string; payload: Record<string, unknown> }[];
  pickups: { location: string; date: string; time: string; count: number }[];
  cancelled: string[];
  ndrRequests: NdrRequest[];
  /** Adds a scan to a parcel, as Delhivery would. */
  scan(waybill: string, s: { status: string; type: string; code?: string; location?: string; note?: string; at?: Date; attempts?: number; expected?: Date }): void;
  /** PIN codes the simulator treats as not delivered to, or prepaid only. */
  blockedPins: Set<string>;
  prepaidOnlyPins: Set<string>;
  failNext: string | null;
} {
  let n = 0;
  const parcels = new Map<string, Tracked>();
  const sim = {
    env: 'staging' as DelhiveryEnv,
    booked: [] as { pickupLocation: string; payload: Record<string, unknown> }[],
    pickups: [] as { location: string; date: string; time: string; count: number }[],
    cancelled: [] as string[],
    ndrRequests: [] as NdrRequest[],
    blockedPins: new Set<string>(['000000']),
    prepaidOnlyPins: new Set<string>(),
    failNext: null as string | null,

    async pincode(pin: string) {
      if (!/^[1-9]\d{5}$/.test(pin) || sim.blockedPins.has(pin)) return null;
      return { pin, prepaid: true, cod: !sim.prepaidOnlyPins.has(pin), oda: false, district: 'Test district', stateCode: 'JH', remark: '' };
    },
    async expectedTat({ pickupAt }: { pickupAt: Date }) {
      return { days: 4, date: new Date(pickupAt.getTime() + 4 * 86_400_000) };
    },
    async charges({ weightGrams, paymentMode }: { weightGrams: number; paymentMode: 'Prepaid' | 'COD' }) {
      const slabs = Math.max(1, Math.ceil(weightGrams / 500));
      return { total: (4500 + (slabs - 1) * 3500 + (paymentMode === 'COD' ? 3500 : 0)) * 1.18 | 0, chargedGrams: slabs * 500 };
    },
    async create(pickupLocation: string, shipments: NewShipment[]) {
      if (sim.failNext) { const m = sim.failNext; sim.failNext = null; throw new DelhiveryError(`Delhivery didn't book it: ${m}`); }
      return shipments.map((s) => {
        const waybill = `SIM${String(++n).padStart(10, '0')}`;
        sim.booked.push({ pickupLocation, payload: shipmentPayload(s) });
        parcels.set(waybill, {
          waybill, reference: s.reference, status: 'Manifested', statusType: 'UD', statusCode: 'X-UCI', statusLocation: 'Origin', statusNote: 'Manifest uploaded',
          statusAt: new Date(), expectedDelivery: null, pickedUpAt: null, deliveredAt: null, attempts: 0, chargedWeightGrams: null,
          scans: [{ at: new Date(), status: 'Manifested', type: 'UD', code: 'X-UCI', location: 'Origin', note: 'Manifest uploaded' }],
        });
        return { reference: s.reference, waybill };
      });
    },
    async label(waybill: string, size: LabelSize) {
      const doc = await PDFDocument.create();
      const page = size === 'A4' ? doc.addPage([595, 842]) : doc.addPage([288, 432]);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      page.drawText('DELHIVERY (SIMULATOR)', { x: 20, y: page.getHeight() - 40, size: 14, font, color: rgb(0.8, 0.1, 0.1) });
      page.drawText(`AWB ${waybill}`, { x: 20, y: page.getHeight() - 70, size: 16, font });
      page.drawText(`Ref ${parcels.get(waybill)?.reference ?? ''}`, { x: 20, y: page.getHeight() - 95, size: 12, font });
      return { pdf: await doc.save() };
    },
    async cancel(waybill: string) {
      const p = parcels.get(waybill);
      if (!p) throw new DelhiveryError(`Delhivery didn't cancel it: unknown waybill ${waybill}`);
      if (p.statusType === 'DL') throw new DelhiveryError(`Delhivery didn't cancel it: Shipment data cannot be changed as Current status is ${p.status}`);
      sim.cancelled.push(waybill);
      sim.scan(waybill, { status: 'Cancelled', type: 'UD', code: 'X-CNCL', note: 'Shipment has been cancelled' });
      return 'Shipment has been cancelled';
    },
    async track(waybills: string[]) {
      return waybills.map((w) => parcels.get(w)).filter((p): p is Tracked => Boolean(p)).map((p) => structuredClone(p));
    },
    async pickup(input: { location: string; date: string; time: string; count: number }) {
      sim.pickups.push(input);
      return { pickupId: String(4_300_000 + sim.pickups.length), centerName: 'Hazaribagh_DC (Jharkhand)' };
    },
    async ndr(requests: NdrRequest[]) {
      sim.ndrRequests.push(...requests);
      return { requestId: `UPL${Date.now()}` };
    },
    async ndrStatus() {
      return { status: 'Success', done: sim.ndrRequests.map((r) => ({ waybill: r.waybill, action: r.action })), failed: [] };
    },
    scan(waybill: string, s: { status: string; type: string; code?: string; location?: string; note?: string; at?: Date; attempts?: number; expected?: Date }) {
      const p = parcels.get(waybill);
      if (!p) throw new Error(`simulator: no parcel ${waybill}`);
      const at = s.at ?? new Date();
      p.status = s.status; p.statusType = s.type; p.statusCode = s.code ?? ''; p.statusLocation = s.location ?? ''; p.statusNote = s.note ?? ''; p.statusAt = at;
      if (s.attempts !== undefined) p.attempts = s.attempts;
      if (s.expected) p.expectedDelivery = s.expected;
      if (s.type === 'UD' && /transit/i.test(s.status) && !p.pickedUpAt) p.pickedUpAt = at;
      if (s.type === 'DL' && /delivered/i.test(s.status)) p.deliveredAt = at;
      p.scans.push({ at, status: s.status, type: s.type, code: s.code ?? '', location: s.location ?? '', note: s.note ?? '' });
    },
  };
  return sim;
}
