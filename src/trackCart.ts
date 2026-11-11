// "Added to cart", the same everywhere a book is added (its page, or the + on a book card):
// Meta Pixel AddToCart (relayed to the Conversions API with the same id) and GA4 add_to_cart.
// Both respect cookie consent and skip staff, the admin and students (meta.ts, ga.ts).
import { ga, gaItem } from './ga';
import { formatName, track } from './meta';
import type { Kind, Product } from './store/types';

export function trackAddToCart(book: Product, kind: Kind, quantity: number) {
  const chosen = book.formats[kind];
  if (!chosen) return;
  const value = (chosen.price * quantity) / 100;
  track('AddToCart', { content_ids: [book.id], content_name: book.title, content_type: 'product', contents: [{ id: book.id, quantity }], value, currency: 'INR', format: formatName(kind) });
  ga('add_to_cart', { currency: 'INR', value, items: [gaItem(book.id, book.title, kind, chosen.price, quantity, book.category?.name)] });
}
