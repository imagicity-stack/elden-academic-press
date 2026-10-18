import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { config } from '../config';
import { LV, bookMeta, bookPrice, contentsFor, findBook, highlightsFor, inr, relatedTo, specsFor, type Book } from '../data';
import { useSite } from '../site';
import { BookCard } from '../components/BookCard';
import { BookCover } from '../components/BookCover';
import { ElmasterMark } from '../components/Brand';
import { NotFound } from './NotFound';

const TABS = ['Overview', 'Contents', 'For teachers'] as const;

export function BookDetail() {
  const { id } = useParams();
  const book = findBook(id);
  if (!book) return <NotFound />;
  // Keyed so tab / format selection resets when moving between books.
  return <BookView key={book.id} book={book} />;
}

function BookView({ book }: { book: Book }) {
  const { openModal } = useSite();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [fmt, setFmt] = useState(0);

  const formats = [{ label: 'Print', price: bookPrice(book) }];
  if (book.eb) formats.push({ label: 'E-book', price: inr(book.eb) });

  return (
    <div>
      <div className="wrap page-book">
        <div className="crumbs crumbs--28">
          <Link to="/">Home</Link><span>/</span><Link to="/catalogue">Catalogue</Link><span>/</span><span className="crumbs__here">{book.t}</span>
        </div>
        <div className="book-top">
          <div className="book-top__cover"><BookCover book={book} size="detail" /></div>
          <div className="book-top__info">
            <div className="book-tags">
              <span className="eyebrow eyebrow--11 eyebrow--tag">{book.ty}</span>
              <span className="dot dot--sep" />
              <span className="book-tags__lvl">{LV[book.lv]}</span>
              {book.nw && <span className="badge-new">NEW</span>}
            </div>
            <h1 className="h1-book">{book.t}</h1>
            <div className="book-by">by <span>{book.a}</span> · {bookMeta(book)}</div>
            <p className="book-blurb">{book.bl}</p>
            <div className="formats">
              {formats.map((x, i) => (
                <button key={x.label} type="button" aria-pressed={fmt === i} className={'format' + (fmt === i ? ' is-on' : '')} onClick={() => setFmt(i)}>
                  <span className="format__label">{x.label}</span>
                  <span className="format__price">{x.price}</span>
                </button>
              ))}
            </div>
            <div className="book-ctas">
              <button type="button" className="btn btn--navy btn--lg" onClick={() => openModal('sample', book.id)}>Request a sample copy</button>
              <button type="button" className="btn btn--outline" onClick={() => openModal('bulk', book.id)}>School / bulk enquiry</button>
              <Link to="/contact" className="text-link text-link--lg">Find a distributor</Link>
            </div>
            {book.em && (
              <div className="elm-note">
                <ElmasterMark className="elm-note__mark" />
                <span className="elm-note__text">Includes a digital companion — scan the QR inside for videos and chapter tests.</span>
                {config.elmasterUrl && <a href={config.elmasterUrl} target="_blank" rel="noopener" className="elm-note__link">Preview ↗</a>}
              </div>
            )}
            <div className="specs">
              {specsFor(book).map(([k, v]) => (
                <div key={k} className="spec"><span className="spec__k">{k}</span><span className="spec__v">{v}</span></div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="book-tabs-band">
        <div className="wrap book-tabs-wrap">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tab' + (tab === t ? ' is-on' : '')} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          <div className="tab-panel" role="tabpanel">
            {tab === 'Overview' && (
              <div className="stack-18">
                <h3 className="h3-30">What's inside</h3>
                <div className="highlights">
                  {highlightsFor(book).map((h) => <div key={h} className="highlight"><span />{h}</div>)}
                </div>
              </div>
            )}
            {tab === 'Contents' && (
              <ol className="toc">
                {contentsFor(book).map((t, i) => (
                  <li key={t}><span>{String(i + 1).padStart(2, '0')}</span>{t}</li>
                ))}
              </ol>
            )}
            {tab === 'For teachers' && (
              <div className="stack-16 align-start">
                <h3 className="h3-30">Teacher resources</h3>
                <p className="body body--15 body--relaxed">Teacher's manual, chapter-wise answer keys, lesson plans and question banks are available to registered schools adopting this title.</p>
                <button type="button" className="btn btn--navy btn--md" onClick={() => openModal('teacher', book.id)}>Request teacher access</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="wrap section-related">
        <h2 className="h2-related">You may also need</h2>
        <div className="grid-books grid-books--cat grid-books--related">
          {relatedTo(book).map((b) => <BookCard key={b.id} book={b} variant="related" />)}
        </div>
      </section>
    </div>
  );
}
