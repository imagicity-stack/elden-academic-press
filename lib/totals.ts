import type { Course } from './types';

/** Cart maths shared by cart and checkout. Mirrors place_order() in SQL. */
export function cartTotals(items: Course[], couponPercent = 0) {
  const sub = items.reduce((a, c) => a + c.price, 0);
  const mrp = items.reduce((a, c) => a + c.mrp, 0);
  const coupon = Math.round((sub * couponPercent) / 100);
  return { mrp, disc: mrp - sub, coupon, total: sub - coupon, saved: mrp - sub + coupon };
}
