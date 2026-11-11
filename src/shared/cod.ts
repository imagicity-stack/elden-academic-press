// Cash on delivery: the advance paid online. Set by the store owner (Admin → Settings → Cash on
// delivery) as a flat amount, or as a percentage of the order total with an optional minimum.
// Used by checkout (to show it) and by the server (to charge it), so both always agree.

export type CodAdvanceType = 'flat' | 'percent';
export interface CodRule {
  type: CodAdvanceType;
  /** Flat advance, paise. */
  advance: number;
  /** Percentage, in basis points (1000 = 10%). */
  bps: number;
  /** Percentage only: never less than this (paise; 0 = no minimum). */
  min: number;
}

/** The advance for an order of this total (paise): whole rupees, rounded up, never more than the total. */
export function codAdvanceFor(total: number, r: CodRule): number {
  const raw = r.type === 'percent' ? Math.max(Math.ceil((total * r.bps) / 10_000 / 100) * 100, r.min) : r.advance;
  return Math.min(Math.max(raw, 0), total);
}

/** "₹60" or "10% of the order (at least ₹50)", for the admin. */
export function describeCod(r: CodRule, inr: (p: number) => string): string {
  if (r.type === 'flat') return `${inr(r.advance)} per order`;
  return `${(r.bps / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}% of the order total${r.min ? `, at least ${inr(r.min)}` : ''}`;
}
