// What Google can show for a book in search results: price, availability, ISBN, author.
// Structured data (schema.org JSON-LD, built in shared/bookSchema.ts, the same as the server's
// copy in the page it sends) plus the page's meta description.
import { useEffect } from 'react';
import type { Product } from '../store/types';
import { bookDescription, bookSchema, jsonLd } from '../shared/bookSchema';

export function BookSchema({ book }: { book: Product }) {
  const description = bookDescription(book);

  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta || !description) return;
    const before = meta.content;
    meta.content = description.slice(0, 160);
    return () => { meta.content = before; };
  }, [description]);

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(bookSchema(book)) }} />;
}
