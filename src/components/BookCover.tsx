import type { CSSProperties } from 'react';
import { PAL } from '../data';
import { productMeta } from '../store/catalog';
import type { Product } from '../store/types';

type Size = 'card' | 'hero' | 'detail';

// Each typeset cover gets one of these graphics, chosen from its title, so the
// shelf looks varied while a given book always looks the same.
const ART = ['circle', 'stripes', 'blocks', 'arc'] as const;
const artFor = (slug: string) => ART[[...slug].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % ART.length];

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
      <div className={'cover__art cover__art--' + artFor(book.slug)} />
      <div className="cover__series">{book.series || book.category?.name}</div>
      <div className="cover__title">{book.title}</div>
      {size !== 'card' && book.author && <div className="cover__author">{book.author}</div>}
      <div className="cover__foot"><span>{productMeta(book)}</span><span className="cover__imprint">Elden</span></div>
    </div>
  );
}
