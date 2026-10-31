import { Link } from 'react-router-dom';
import { inr } from '../store/api';
import { formatsLabel, fromPrice } from '../store/catalog';
import { useCart } from '../store/cart';
import type { Product } from '../store/types';
import { BookCover } from './BookCover';

/**
 * Cover + details. The title link is stretched over the whole card, so the
 * card is clickable while the add button stays a separate control.
 * - `new`: home page
 * - `catalogue`: adds formats and a quick add for the printed book
 * - `related`: compact
 */
export function BookCard({ book, variant = 'new' }: { book: Product; variant?: 'new' | 'catalogue' | 'related' }) {
  const { add, openDrawer } = useCart();
  const price = fromPrice(book);
  const quickKind = book.formats.print?.available ? 'print' : book.formats.digital?.available ? 'digital' : null;
  const from = book.formats.print && book.formats.digital;
  return (
    <article className="book-card">
      <div className="book-card__cover">
        {book.isNew && <span className="book-card__badge">New</span>}
        <BookCover book={book} />
      </div>
      <div className="book-card__info">
        <div className="book-card__meta">{[book.category?.name, book.classLabel].filter(Boolean).join(' · ')}</div>
        <Link to={'/books/' + book.slug} className="book-card__title">{book.title}</Link>
        {variant !== 'related' && book.author && <div className="book-card__author">{book.author}</div>}
        <div className="book-card__row">
          <div>
            <span className={'book-card__price' + (price === null ? ' is-muted' : '')}>
              {price === null ? 'Out of stock' : <>{from && <small>from</small>}{inr(price)}</>}
            </span>
            {variant === 'catalogue' && <span className="book-card__fmts">{formatsLabel(book)}</span>}
          </div>
          {variant !== 'related' && quickKind && (
            <button type="button" className="book-card__add" aria-label={`Add ${book.title} to cart`}
              onClick={() => { add({ productId: book.id, kind: quickKind, quantity: 1 }); openDrawer(); }}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
