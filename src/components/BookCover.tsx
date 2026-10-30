import type { CSSProperties } from 'react';
import { PAL } from '../data';
import { productMeta } from '../store/catalog';
import type { Product } from '../store/types';

type Size = 'card' | 'hero' | 'detail';

/** The uploaded cover image, or a typeset cover in the brand palette. */
export function BookCover({ book, size = 'card' }: { book: Product; size?: Size }) {
  if (book.coverUrl) {
    return (
      <div className={'cover cover--image cover--' + size}>
        <img src={book.coverUrl} alt="" loading={size === 'card' ? 'lazy' : 'eager'} />
      </div>
    );
  }
  const c = PAL[book.palette] ?? PAL[0];
  const style = { '--cv-bg': c.bg, '--cv-fg': c.fg, '--cv-ac': c.ac } as CSSProperties;
  return (
    <div className={'cover cover--' + size} style={style}>
      <div className="cover__spine" />
      <div className="cover__bars"><div /><div /><div /></div>
      <div className="cover__series">{book.series}</div>
      <div className="cover__title">{book.title}</div>
      {size === 'detail' && <div className="cover__author">{book.author}</div>}
      <div className="cover__foot"><span>{productMeta(book)}</span><span className="cover__imprint">Elden</span></div>
    </div>
  );
}
