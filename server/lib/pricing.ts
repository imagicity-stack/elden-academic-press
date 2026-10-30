// Cart pricing. Pure functions: every total the customer pays is computed here,
// on the server, from database prices — never from what the browser sends.

export type Kind = 'print' | 'digital' | 'bundle';

export interface CartLineInput { productId: string; kind: Kind; quantity: number }

export interface VariantRow {
  kind: Kind;
  price: number;
  compareAtPrice: number | null;
  sku: string | null;
  stock: number;
  trackStock: boolean;
  weightGrams: number | null;
  taxRate: number;
  active: boolean;
  hasFile?: boolean;
}

export interface ProductRow {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'active' | 'archived';
  variants: VariantRow[];
}

export interface PricingSettings {
  gstin: string;
  stateCode: string;
  shippingFlat: number;
  freeShippingAbove: number;
}

export interface CouponRow {
  code: string;
  description: string;
  type: 'percent' | 'fixed';
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
}

export const MAX_QTY: Record<Kind, number> = { print: 50, digital: 1, bundle: 1 };

export const FORMAT_LABEL: Record<Kind, string> = { print: 'Printed book', digital: 'E-book', bundle: 'E-book + printed copy' };

export type LineIssue =
  | { code: 'unavailable' }
  | { code: 'out_of_stock' }
  | { code: 'insufficient_stock'; available: number };

export interface QuoteLine {
  productId: string;
  slug: string;
  title: string;
  kind: Kind;
  formatLabel: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  compareAtPrice: number | null;
  lineTotal: number;
  discount: number;
  taxableValue: number;
  taxAmount: number;
  taxRate: number;
  requiresShipping: boolean;
  isDigital: boolean;
  weightGrams: number;
  issue: LineIssue | null;
}

export interface Quote {
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  coupon: { code: string; description: string } | null;
  couponError: string | null;
  shipping: number;
  /** Amount still needed to reach free shipping (0 when reached or not applicable). */
  freeShippingRemaining: number;
  tax: number;
  taxBreakup: { cgst: number; sgst: number; igst: number };
  total: number;
  requiresShipping: boolean;
  hasDigital: boolean;
  weightGrams: number;
  /** True when every line can be bought as priced. */
  ok: boolean;
}

/** Split an amount that already includes GST at `rate` %. */
export function splitInclusive(amount: number, rate: number) {
  if (rate <= 0 || amount <= 0) return { taxable: amount, tax: 0 };
  const taxable = Math.round((amount * 100) / (100 + rate));
  return { taxable, tax: amount - taxable };
}

/** Distribute `total` across `weights` proportionally, in whole paise, exactly summing to `total`. */
export function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

/** Why a coupon can't be used right now, or null if it can. */
export function couponProblem(c: CouponRow, subtotal: number, now: Date): string | null {
  if (!c.active) return 'This code is no longer active.';
  if (c.startsAt && now < c.startsAt) return 'This code is not active yet.';
  if (c.endsAt && now > c.endsAt) return 'This code has expired.';
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return 'This code has been fully used.';
  if (subtotal < c.minSubtotal) return `Add items worth ₹${Math.ceil((c.minSubtotal - subtotal) / 100)} more to use this code.`;
  return null;
}

export function couponDiscount(c: CouponRow, subtotal: number): number {
  const raw = c.type === 'percent' ? Math.floor((subtotal * Math.min(c.value, 100)) / 100) : c.value;
  const capped = c.maxDiscount !== null ? Math.min(raw, c.maxDiscount) : raw;
  return Math.max(0, Math.min(capped, subtotal));
}

/** Merge duplicate lines and clamp quantities to what each format allows. */
export function normaliseCart(items: CartLineInput[]): CartLineInput[] {
  const merged = new Map<string, CartLineInput>();
  for (const it of items) {
    const key = it.productId + ':' + it.kind;
    const prev = merged.get(key);
    const quantity = Math.floor((prev?.quantity ?? 0) + it.quantity);
    merged.set(key, { productId: it.productId, kind: it.kind, quantity: Math.min(Math.max(quantity, 1), MAX_QTY[it.kind]) });
  }
  return [...merged.values()];
}

export function priceCart(args: {
  items: CartLineInput[];
  products: Map<string, ProductRow>;
  settings: PricingSettings;
  coupon?: CouponRow | null;
  couponCode?: string | null;
  /** GST place of supply (customer's state code). Defaults to the seller's state. */
  placeOfSupply?: string | null;
  now?: Date;
}): Quote {
  const { settings } = args;
  const now = args.now ?? new Date();
  const items = normaliseCart(args.items);

  // Print copies wanted per product (print lines + bundles) for the stock check.
  const printWanted = new Map<string, number>();
  for (const it of items) {
    if (it.kind !== 'digital') printWanted.set(it.productId, (printWanted.get(it.productId) ?? 0) + it.quantity);
  }

  const lines: QuoteLine[] = items.map((it) => {
    const p = args.products.get(it.productId);
    const v = (k: Kind) => p?.variants.find((x) => x.kind === k && x.active);
    const variant = v(it.kind);
    const print = v('print');
    const digital = v('digital');
    let issue: LineIssue | null = null;

    const sellable = p && p.status === 'active' && variant &&
      (it.kind !== 'bundle' || (print && digital)) &&
      (it.kind === 'print' || (digital?.hasFile ?? true));
    if (!sellable) issue = { code: 'unavailable' };
    else if (it.kind !== 'digital' && print!.trackStock) {
      const wanted = printWanted.get(it.productId)!;
      if (print!.stock <= 0) issue = { code: 'out_of_stock' };
      else if (print!.stock < wanted) issue = { code: 'insufficient_stock', available: print!.stock };
    }

    const unitPrice = variant?.price ?? 0;
    const weight = it.kind === 'digital' ? 0 : (print?.weightGrams ?? 0) * it.quantity;
    return {
      productId: it.productId,
      slug: p?.slug ?? '',
      title: p?.title ?? 'Unavailable item',
      kind: it.kind,
      formatLabel: FORMAT_LABEL[it.kind],
      sku: variant?.sku ?? null,
      quantity: it.quantity,
      unitPrice,
      compareAtPrice: variant?.compareAtPrice ?? null,
      lineTotal: unitPrice * it.quantity,
      discount: 0,
      taxableValue: 0,
      taxAmount: 0,
      taxRate: 0,
      requiresShipping: it.kind !== 'digital',
      isDigital: it.kind !== 'print',
      weightGrams: weight,
      issue,
    };
  });

  const priced = lines.filter((l) => !l.issue);
  const subtotal = priced.reduce((s, l) => s + l.lineTotal, 0);

  // Coupon
  let discount = 0;
  let coupon: Quote['coupon'] = null;
  let couponError: string | null = null;
  if (args.couponCode) {
    if (!args.coupon) couponError = 'That code isn’t valid.';
    else {
      couponError = couponProblem(args.coupon, subtotal, now);
      if (!couponError) {
        discount = couponDiscount(args.coupon, subtotal);
        coupon = { code: args.coupon.code, description: args.coupon.description };
      }
    }
  }
  apportion(discount, priced.map((l) => l.lineTotal)).forEach((d, i) => { priced[i].discount = d; });

  // GST, included in prices. Bundles are split into their print and e-book parts
  // in proportion to the standalone prices, each taxed at its own rate.
  const registered = settings.gstin.trim() !== '';
  for (const l of priced) {
    const net = l.lineTotal - l.discount;
    if (!registered) { l.taxableValue = net; continue; }
    const p = args.products.get(l.productId)!;
    const rate = (k: Kind) => p.variants.find((x) => x.kind === k)?.taxRate ?? 0;
    if (l.kind === 'bundle') {
      const pp = p.variants.find((x) => x.kind === 'print')!.price;
      const dp = p.variants.find((x) => x.kind === 'digital')!.price;
      const [printPart, digitalPart] = apportion(net, [pp, dp]);
      const a = splitInclusive(printPart, rate('print'));
      const b = splitInclusive(digitalPart, rate('digital'));
      l.taxableValue = a.taxable + b.taxable;
      l.taxAmount = a.tax + b.tax;
      l.taxRate = Math.max(rate('print'), rate('digital'));
    } else {
      const s = splitInclusive(net, rate(l.kind));
      l.taxableValue = s.taxable;
      l.taxAmount = s.tax;
      l.taxRate = rate(l.kind);
    }
  }
  const tax = priced.reduce((s, l) => s + l.taxAmount, 0);
  const intraState = (args.placeOfSupply ?? settings.stateCode) === settings.stateCode;
  const cgst = intraState ? Math.floor(tax / 2) : 0;
  const taxBreakup = intraState ? { cgst, sgst: tax - cgst, igst: 0 } : { cgst: 0, sgst: 0, igst: tax };

  // Shipping: flat rate per order with physical items, free above the threshold.
  const requiresShipping = priced.some((l) => l.requiresShipping);
  const afterDiscount = subtotal - discount;
  const freeAbove = settings.freeShippingAbove;
  const freeReached = freeAbove > 0 && afterDiscount >= freeAbove;
  const shipping = requiresShipping && !freeReached ? settings.shippingFlat : 0;
  const freeShippingRemaining = requiresShipping && freeAbove > 0 && !freeReached ? freeAbove - afterDiscount : 0;

  return {
    lines,
    subtotal,
    discount,
    coupon,
    couponError,
    shipping,
    freeShippingRemaining,
    tax,
    taxBreakup,
    total: afterDiscount + shipping,
    requiresShipping,
    hasDigital: priced.some((l) => l.isDigital),
    weightGrams: priced.reduce((s, l) => s + l.weightGrams, 0),
    ok: lines.length > 0 && lines.every((l) => !l.issue) && !couponError,
  };
}
