import { describe, expect, it } from 'vitest';
import { apportion, priceCart, splitInclusive, type CouponRow, type ProductRow, type VariantRow } from '../server/lib/pricing.js';

const v = (kind: VariantRow['kind'], price: number, extra: Partial<VariantRow> = {}): VariantRow => ({
  kind, price, compareAtPrice: null, sku: kind, stock: 10, trackStock: true, weightGrams: 400, taxRate: kind === 'digital' ? 18 : 0, active: true, hasFile: true, ...extra,
});
const product = (id: string, variants: VariantRow[], status: ProductRow['status'] = 'active'): ProductRow => ({ id, slug: id, title: id, status, variants });

const A = '00000000-0000-0000-0000-00000000000a';
const B = '00000000-0000-0000-0000-00000000000b';
const products = new Map([
  [A, product(A, [v('print', 39500), v('digital', 24900), v('bundle', 51900)])],
  [B, product(B, [v('print', 22000, { stock: 2 })])],
]);
const settings = { gstin: '20ABCDE1234F1Z5', stateCode: '20', shippingFlat: 6000, freeShippingAbove: 99900 };
const coupon = (c: Partial<CouponRow>): CouponRow => ({
  code: 'X', description: '', type: 'percent', value: 10, minSubtotal: 0, maxDiscount: null, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0, active: true, ...c,
});

describe('helpers', () => {
  it('splits a GST-inclusive amount', () => {
    expect(splitInclusive(24900, 18)).toEqual({ taxable: 21102, tax: 3798 });
    expect(splitInclusive(39500, 0)).toEqual({ taxable: 39500, tax: 0 });
  });
  it('apportions exactly', () => {
    const parts = apportion(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(apportion(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('priceCart', () => {
  it('prices print + e-book with flat shipping and in-state GST', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'print', quantity: 1 }, { productId: A, kind: 'digital', quantity: 1 }], products, settings });
    expect(q.subtotal).toBe(64400);
    expect(q.shipping).toBe(6000);
    expect(q.total).toBe(70400);
    expect(q.tax).toBe(3798); // only the e-book carries GST
    expect(q.taxBreakup).toEqual({ cgst: 1899, sgst: 1899, igst: 0 });
    expect(q.freeShippingRemaining).toBe(99900 - 64400);
    expect(q.ok).toBe(true);
  });

  it('charges IGST for other states', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'digital', quantity: 1 }], products, settings, placeOfSupply: '27' });
    expect(q.taxBreakup.igst).toBe(q.tax);
    expect(q.requiresShipping).toBe(false);
    expect(q.shipping).toBe(0);
  });

  it('splits a bundle into a tax-free print part and a taxed e-book part', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'bundle', quantity: 1 }], products, settings });
    const [line] = q.lines;
    const ebookPart = Math.round(51900 * 24900 / (39500 + 24900));
    expect(line.taxAmount).toBe(splitInclusive(ebookPart, 18).tax);
    expect(line.taxableValue + line.taxAmount).toBe(51900);
    expect(line.requiresShipping && line.isDigital).toBe(true);
  });

  it('skips GST when the store has no GSTIN', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'digital', quantity: 1 }], products, settings: { ...settings, gstin: '' } });
    expect(q.tax).toBe(0);
  });

  it('gives free shipping above the threshold, after discounts', () => {
    const items = [{ productId: A, kind: 'print' as const, quantity: 3 }];
    expect(priceCart({ items, products, settings }).shipping).toBe(0); // 1185 ≥ 999
    const q = priceCart({ items, products, settings, coupon: coupon({ value: 20 }), couponCode: 'X' });
    expect(q.discount).toBe(23700);
    expect(q.shipping).toBe(6000); // 948 < 999 after discount
  });

  it('applies coupon limits', () => {
    const items = [{ productId: A, kind: 'print' as const, quantity: 2 }];
    expect(priceCart({ items, products, settings, coupon: coupon({ maxDiscount: 5000 }), couponCode: 'X' }).discount).toBe(5000);
    expect(priceCart({ items, products, settings, coupon: coupon({ type: 'fixed', value: 10_000_000 }), couponCode: 'X' }).discount).toBe(79000);
    const tooSmall = priceCart({ items, products, settings, coupon: coupon({ minSubtotal: 500000 }), couponCode: 'X' });
    expect(tooSmall.discount).toBe(0);
    expect(tooSmall.couponError).toMatch(/more to use this code/);
    expect(tooSmall.ok).toBe(false);
    expect(priceCart({ items, products, settings, coupon: coupon({ endsAt: new Date('2020-01-01') }), couponCode: 'X' }).couponError).toMatch(/expired/);
    expect(priceCart({ items, products, settings, coupon: null, couponCode: 'NOPE' }).couponError).toMatch(/isn’t valid/);
  });

  it('spreads a discount over lines so taxes stay right', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'print', quantity: 1 }, { productId: A, kind: 'digital', quantity: 1 }], products, settings, coupon: coupon({ value: 10 }), couponCode: 'X' });
    expect(q.lines.reduce((s, l) => s + l.discount, 0)).toBe(q.discount);
    expect(q.lines[1].taxAmount).toBe(splitInclusive(24900 - q.lines[1].discount, 18).tax);
  });

  it('counts print copies from print lines and bundles together against stock', () => {
    const q = priceCart({ items: [{ productId: B, kind: 'print', quantity: 3 }], products, settings });
    expect(q.lines[0].issue).toEqual({ code: 'insufficient_stock', available: 2 });
    expect(q.ok).toBe(false);
    const zero = new Map([[B, product(B, [v('print', 22000, { stock: 0 })])]]);
    expect(priceCart({ items: [{ productId: B, kind: 'print', quantity: 1 }], products: zero, settings }).lines[0].issue).toEqual({ code: 'out_of_stock' });
  });

  it('merges duplicates and limits e-books to one copy', () => {
    const q = priceCart({ items: [{ productId: A, kind: 'digital', quantity: 5 }, { productId: A, kind: 'print', quantity: 1 }, { productId: A, kind: 'print', quantity: 2 }], products, settings });
    expect(q.lines.find((l) => l.kind === 'digital')!.quantity).toBe(1);
    expect(q.lines.find((l) => l.kind === 'print')!.quantity).toBe(3);
  });

  it('refuses drafts, unknown items and e-books without a file', () => {
    const p = new Map([[A, product(A, [v('print', 100), v('digital', 100, { hasFile: false })], 'draft')]]);
    expect(priceCart({ items: [{ productId: A, kind: 'print', quantity: 1 }], products: p, settings }).lines[0].issue).toEqual({ code: 'unavailable' });
    const p2 = new Map([[A, product(A, [v('print', 100), v('digital', 100, { hasFile: false })])]]);
    expect(priceCart({ items: [{ productId: A, kind: 'digital', quantity: 1 }], products: p2, settings }).lines[0].issue).toEqual({ code: 'unavailable' });
    expect(priceCart({ items: [{ productId: B, kind: 'bundle', quantity: 1 }], products, settings }).lines[0].issue).toEqual({ code: 'unavailable' });
  });
});
