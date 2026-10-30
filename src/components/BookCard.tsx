import { Link } from 'react-router-dom';
import { inr } from '../store/api';
import { formatsLabel, fromPrice } from '../store/catalog';
import { useCart } from '../store/cart';
import type { Product } from '../store/types';
import { BookCover } from './BookCover';

/**
 * Cover + details. The title link is stretched over the whole card, so the
 * card is clickable while the Add button stays a separate control.
 * - `new`: category, title, author, price (home)
 * - `catalogue`: adds formats and a quick "Add" for the printed book
 * - `related`: category, title, price
 */
export function BookCard({ book, variant = 'new' }: { book: Product; variant?: 'new' | 'catalogue' | 'related' }) {
  const { add, openDrawer } = useCart();
  const price = fromPrice(book);
  const priceLabel = price === null ? 'Out of stock' : (book.formats.print && book.formats.digital ? 'From ' : '') + inr(price);
  const quickKind = book.formats.print?.available ? 'print' : book.formats.digital?.available ? 'digital' : null;
  return (
    <article className="book-card">
      <BookCover book={book} />
      <div className="book-card__info">
        <div className="eyebrow-sm">{book.category?.name ?? ''}</div>
        <Link to={'/books/' + book.slug} className="book-card__title stretched">{book.title}</Link>
        {variant !== 'related' && <div className="book-card__author">{book.author}</div>}
        {variant === 'catalogue' ? (
          <div className="book-card__row">
            <div className="book-card__prices">
              <span className={'book-card__price' + (price === null ? ' is-muted' : '')}>{priceLabel}</span>
              <span className="book-card__fmts">{formatsLabel(book)}</span>
            </div>
            {quickKind && (
              <button type="button" className="btn-sample" aria-label={`Add ${book.title} to cart`}
                onClick={() => { add({ productId: book.id, kind: quickKind, quantity: 1 }); openDrawer(); }}>
                Add
              </button>
            )}
          </div>
        ) : (
          <div className={'book-card__price' + (variant === 'new' ? ' book-card__price--spaced' : '')}>{priceLabel}</div>
        )}
      </div>
    </article>
  );
}
