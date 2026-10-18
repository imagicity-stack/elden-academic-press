import type { CSSProperties } from 'react';
import { PAL, bookMeta, type Book } from '../data';

type Size = 'card' | 'hero' | 'detail';

/** Typeset placeholder cover. Replace with real cover images when available. */
export function BookCover({ book, size = 'card' }: { book: Book; size?: Size }) {
  const c = PAL[book.p];
  const style = { '--cv-bg': c.bg, '--cv-fg': c.fg, '--cv-ac': c.ac } as CSSProperties;
  return (
    <div className={'cover cover--' + size} style={style}>
      <div className="cover__spine" />
      <div className="cover__bars"><div /><div /><div /></div>
      <div className="cover__series">{book.s}</div>
      <div className="cover__title">{book.t}</div>
      {size === 'detail' && <div className="cover__author">{book.a}</div>}
      <div className="cover__foot"><span>{bookMeta(book)}</span><span className="cover__imprint">Elden</span></div>
    </div>
  );
}
