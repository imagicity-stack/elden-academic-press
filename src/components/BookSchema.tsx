// What Google can show for a book in search results: price, availability, ISBN, author.
// Structured data (schema.org JSON-LD) plus the page's meta description.
import { useEffect } from 'react';
import type { Product } from '../store/types';

const SITE = 'https://eldenap.in';
const PUBLISHER = { '@type': 'Organization', name: 'Elden Academic Press', url: `${SITE}/` };

/** A valid ISBN-13 from an ISBN-13 or ISBN-10 (same rule as the product feed). */
function isbn13(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  const check13 = (d: string) => (10 - (d.slice(0, 12).split('').reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) % 10)) % 10;
  if (/^97[89]\d{10}$/.test(s)) return check13(s) === Number(s[12]) ? s : null;
  if (/^\d{9}[\dX]$/.test(s)) {
    if (s.split('').reduce((n, c, i) => n + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11) return null;
    const base = '978' + s.slice(0, 9);
    return base + check13(base + '0');
  }
  return null;
}

export function BookSchema({ book }: { book: Product }) {
  const url = `${SITE}/books/${encodeURIComponent(book.slug)}`;
  const description = (book.blurb || book.description || '').replace(/\s+/g, ' ').trim();

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta || !description) return;
    const before = meta.content;
    meta.content = description.slice(0, 160);
    return () => { meta.content = before; };
  }, [description]);

  const gtin = book.isbn ? isbn13(book.isbn) : null;
  // The cover first, then any more photos.
  const images = [book.coverUrl, ...(book.images ?? []).map((i) => i.url)].filter((u): u is string => Boolean(u)).map((u) => new URL(u, SITE).href);
  const image = images.length > 1 ? images : images[0];
  const offers = ([['print', book.formats.print?.includesEbook ? 'Printed book + free e-book' : 'Printed book'], ['digital', 'E-book']] as const).flatMap(([k, name]) => {
    const f = book.formats[k];
    return f ? [{
      '@type': 'Offer', name, url, priceCurrency: 'INR', price: (f.price / 100).toFixed(2),
      availability: f.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition', seller: PUBLISHER,
    }] : [];
  });
  const data = {
    '@context': 'https://schema.org',
    '@type': ['Product', 'Book'],
    '@id': `${url}#book`,
    name: book.title,
    url,
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(book.isbn ? { isbn: book.isbn } : {}),
    ...(gtin ? { gtin13: gtin } : {}),
    sku: book.id,
    ...(book.author ? { author: { '@type': 'Person', name: book.author } } : {}),
    publisher: PUBLISHER,
    brand: { '@type': 'Brand', name: 'Elden Academic Press' },
    ...(book.pages ? { numberOfPages: book.pages } : {}),
    ...(book.language ? { inLanguage: book.language } : {}),
    ...(book.edition ? { bookEdition: book.edition } : {}),
    ...(book.category ? { category: book.category.name } : {}),
    ...(offers.length ? { offers } : {}),
  };
  // "<" escaped so the JSON can never close the script tag.
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
