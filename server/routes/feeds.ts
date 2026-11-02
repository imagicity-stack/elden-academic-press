// /feeds/products.xml: the catalogue as a Google Merchant Center feed (RSS 2.0 with g: fields),
// which Meta's Commerce Manager reads too. Printed books with a cover image, priced in INR,
// with the ISBN as GTIN. Each item's id is the product id, the same id that analytics and
// Meta events send, so ads can show people the exact book they looked at.
import type { Deps } from '../deps.js';
import { loadCatalog, type CatalogItem } from '../services/catalog.js';

const BRAND = 'Elden Academic Press';
/** Google product taxonomy: Media > Books > Print Books. */
const PRINT_BOOKS = '543543';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const money = (paise: number) => `${(paise / 100).toFixed(2)} INR`;

/** A valid ISBN-13 (from ISBN-13 or ISBN-10), or null. */
export function isbn13(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  const check13 = (d: string) => (10 - (d.slice(0, 12).split('').reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
  if (/^97[89]\d{10}$/.test(s)) return check13(s) === Number(s[12]) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) {
    const sum10 = s.split('').reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (10 - i), 0);
    if (sum10 % 11) return null;
    const base = '978' + s.slice(0, 9);
    return base + check13(base + '0');
  }
  return null;
}

function item(b: CatalogItem, site: string): string | null {
  const print = b.formats.print;
  if (!print || !b.coverUrl) return null;
  const abs = (u: string) => (u.startsWith('/') ? site + u : u);
  const image = abs(b.coverUrl);
  // Google takes up to 10 more photos.
  const more = (b.images ?? []).slice(0, 10).map((i) => abs(i.url));
  const title = clean(`${b.title}${b.classLabel ? ` — ${b.classLabel}` : ''} (${print.includesEbook ? 'Printed book + free e-book' : 'Printed book'})`, 150);
  const description = clean(b.description || b.blurb || b.title, 5000);
  const onSale = print.compareAt && print.compareAt > print.price;
  const gtin = b.isbn ? isbn13(b.isbn) : null;
  const type = [b.category?.name, b.classLabel || b.subject].filter(Boolean).join(' > ');
  const f = (k: string, v: string) => `      <g:${k}>${esc(v)}</g:${k}>`;
  return [
    '    <item>',
    f('id', b.id),
    f('title', title),
    f('description', description),
    f('link', `${site}/books/${encodeURIComponent(b.slug)}`),
    f('image_link', image),
    ...more.map((u) => f('additional_image_link', u)),
    f('availability', print.available ? 'in_stock' : 'out_of_stock'),
    f('price', money(onSale ? print.compareAt! : print.price)),
    ...(onSale ? [f('sale_price', money(print.price))] : []),
    f('condition', 'new'),
    f('brand', BRAND),
    gtin ? f('gtin', gtin) : f('identifier_exists', 'no'),
    f('google_product_category', PRINT_BOOKS),
    ...(type ? [f('product_type', type)] : []),
    ...(b.author ? [f('custom_label_0', clean(b.author, 100))] : []),
    '    </item>',
  ].join('\n');
}

export async function productFeedXml(deps: Deps): Promise<string> {
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  const { items } = await loadCatalog(deps.db, deps.storage);
  const entries = items.map((b) => item(b, site)).filter(Boolean);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    '  <channel>',
    `    <title>${BRAND}</title>`,
    `    <link>${esc(site)}/</link>`,
    `    <description>Printed books from ${BRAND}</description>`,
    ...entries,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}
