import { Link } from 'react-router-dom';
import { bookPrice, type Book } from '../data';
import { useSite } from '../site';
import { BookCover } from './BookCover';

/**
 * Cover + details. The title link is stretched over the whole card, so the
 * card is clickable while the Sample button stays a separate control.
 * - `new`: type, title, author, price (home)
 * - `catalogue`: adds formats and a Sample button
 * - `related`: type, title, price
 */
export function BookCard({ book, variant = 'new' }: { book: Book; variant?: 'new' | 'catalogue' | 'related' }) {
  const { openModal } = useSite();
  return (
    <article className="book-card">
      <BookCover book={book} />
      <div className="book-card__info">
        <div className="eyebrow-sm">{book.ty}</div>
        <Link to={'/books/' + book.id} className="book-card__title stretched">{book.t}</Link>
        {variant !== 'related' && <div className="book-card__author">{book.a}</div>}
        {variant === 'catalogue' ? (
          <div className="book-card__row">
            <div className="book-card__prices">
              <span className="book-card__price">{bookPrice(book)}</span>
              <span className="book-card__fmts">{book.eb ? 'Print · E-book' : 'Print'}</span>
            </div>
            <button type="button" className="btn-sample" onClick={() => openModal('sample', book.id)}>Sample</button>
          </div>
        ) : (
          <div className={'book-card__price' + (variant === 'new' ? ' book-card__price--spaced' : '')}>{bookPrice(book)}</div>
        )}
      </div>
    </article>
  );
}
