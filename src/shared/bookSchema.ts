// What Google can show for a book in search results (price, availability, ISBN, author): the
// schema.org JSON-LD for a book page. The server puts it in the page it sends (routes/og.ts) and
// the app renders the same data once it takes over (components/BookSchema.tsx).

export const SITE = 'https://eldenap.in';
const PUBLISHER = { '@type': 'Organization', name: 'Elden Academic Press', url: `${SITE}/` };

interface Format { price: number; available: boolean; includesEbook?: boolean }
/** The fields of a catalogue book this needs (the app's Product and the server's CatalogItem both fit). */
export interface SchemaBook {
  id: string;
  slug: string;
  title: string;
  author: string;
  blurb: string;
  description: string;
  isbn: string;
  pages: number | null;
  language: string;
  edition: string;
  coverUrl: string | null;
  images?: { url: string }[];
  category: { name: string } | null;
  formats: { print?: Format; digital?: Format };
}

/** A valid ISBN-13 from an ISBN-13 or ISBN-10 (same rule as the product feed). */
export function isbn13(raw: string): string | null {
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

export const bookUrl = (slug: string, site = SITE) => `${site.replace(/\/$/, '')}/books/${encodeURIComponent(slug)}`;

/** The book's one-paragraph description: its blurb, else its description (whitespace tidied). */
export const bookDescription = (b: Pick<SchemaBook, 'blurb' | 'description'>) => (b.blurb || b.description || '').replace(/\s+/g, ' ').trim();

/** The cover first, then any more photos, as full addresses. */
export const bookImages = (b: Pick<SchemaBook, 'coverUrl' | 'images'>, site = SITE) =>
  [b.coverUrl, ...(b.images ?? []).map((i) => i.url)].filter((u): u is string => Boolean(u)).map((u) => new URL(u, site).href);

export function bookSchema(book: SchemaBook) {
  const url = bookUrl(book.slug);
  const description = bookDescription(book);
  const gtin = book.isbn ? isbn13(book.isbn) : null;
  const images = bookImages(book);
  const image = images.length > 1 ? images : images[0];
  const offers = ([['print', book.formats.print?.includesEbook ? 'Printed book + free e-book' : 'Printed book'], ['digital', 'E-book']] as const).flatMap(([k, name]) => {
    const f = book.formats[k];
    return f ? [{
      '@type': 'Offer', name, url, priceCurrency: 'INR', price: (f.price / 100).toFixed(2),
      availability: f.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      itemCondition: 'https://schema.org/NewCondition', seller: PUBLISHER,
    }] : [];
  });
  return {
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
}

/** The JSON for a <script type="application/ld+json">, with "<" escaped so it can never close the tag. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
