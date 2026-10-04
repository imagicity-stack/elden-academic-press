export const fmt = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

export const mmss = (n: number) => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(Math.floor(n % 60)).padStart(2, '0');

export const initialsOf = (name: string) =>
  name.replace(/^(Dr\.|Prof\.)\s/, '').split(' ').filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export const offPct = (price: number, mrp: number) => Math.round((1 - price / mrp) * 100) + '% off';

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning,' : h < 17 ? 'Good afternoon,' : 'Good evening,';
}
