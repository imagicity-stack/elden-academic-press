import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { relatedTo } from '../catalogue';
import { config } from '../config';
import { LV } from '../data';
import { useSite } from '../site';
import { inr } from '../store/api';
import { productMeta, useCatalog } from '../store/catalog';
import { MAX_QTY, useCart } from '../store/cart';
import type { Format, Kind, Product } from '../store/types';
import { BookCard } from '../components/BookCard';
import { BookCover } from '../components/BookCover';
import { ElmasterMark } from '../components/Brand';
import { NotFound } from './NotFound';

const TABS = ['Overview', 'Contents', 'For teachers'] as const;

export function BookDetail() {
  const { slug } = useParams();
  const { bySlug, status } = useCatalog();
  const book = bySlug(slug);
  if (!book) return status === 'loading' ? <div className="wrap page-book" aria-busy="true"><div className="skeleton skeleton--hero" /></div> : <NotFound />;
  // Keyed so tab / format selection resets when moving between books.
  return <BookView key={book.id} book={book} />;
}

function priceTag(f: Format) {
  return (
    <>
      <span className="format__price">{inr(f.price)}</span>
      {f.compareAt && f.compareAt > f.price && <s className="format__was">{inr(f.compareAt)}</s>}
    </>
  );
}

function BookView({ book }: { book: Product }) {
  const { openModal } = useSite();
  const { products } = useCatalog();
  const cart = useCart();
  const navigate = useNavigate();
  const { print, digital, bundle } = book.formats;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [format, setFormat] = useState<'print' | 'digital'>(print?.available || !digital ? 'print' : 'digital');
  const [withPrint, setWithPrint] = useState(false);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => { document.title = `${book.title} — Elden Academic Press`; }, [book.title]);

  const kind: Kind = format === 'digital' && withPrint && bundle ? 'bundle' : format;
  const chosen = book.formats[kind];
  const available = Boolean(chosen?.available);
  const total = chosen ? chosen.price * (kind === 'print' ? qty : 1) : 0;

  const addToCart = (go: boolean) => {
    if (!available) return;
    cart.add({ productId: book.id, kind, quantity: kind === 'print' ? qty : 1 });
    if (go) navigate('/checkout');
    else { setAdded(true); cart.openDrawer(); }
  };

  const specs: [string, string][] = ([
    ['ISBN', book.isbn],
    ['Pages', book.pages ? String(book.pages) : ''],
    ['Edition', book.edition],
    [book.boards.length ? 'Board' : 'Exam / series', book.boards.join(', ') || book.classLabel],
    ['Level', LV[book.level]],
    ['Language', book.language],
  ] as [string, string][]).filter(([, v]) => v);

  return (
    <div>
      <div className="wrap page-book">
        <div className="crumbs crumbs--28">
          <Link to="/">Home</Link><span>/</span><Link to="/catalogue">Store</Link><span>/</span><span className="crumbs__here">{book.title}</span>
        </div>
        <div className="book-top">
          <div className="book-top__cover"><BookCover book={book} size="detail" /></div>
          <div className="book-top__info">
            <div className="book-tags">
              {book.category && <span className="eyebrow eyebrow--11 eyebrow--tag">{book.category.name}</span>}
              {book.category && <span className="dot dot--sep" />}
              <span className="book-tags__lvl">{LV[book.level]}</span>
              {book.isNew && <span className="badge-new">NEW</span>}
            </div>
            <h1 className="h1-book">{book.title}</h1>
            <div className="book-by">{book.author && <>by <span>{book.author}</span> · </>}{productMeta(book)}</div>
            <p className="book-blurb">{book.blurb}</p>

            <div className="buy" aria-label="Buy this title">
              <div className="formats" role="radiogroup" aria-label="Format">
                {print && (
                  <button type="button" role="radio" aria-checked={format === 'print'} className={'format' + (format === 'print' ? ' is-on' : '')} onClick={() => setFormat('print')}>
                    <span className="format__label">Printed book</span>
                    <span className="format__prices">{priceTag(print)}</span>
                    <span className={'format__stock' + (print.available ? '' : ' is-out')}>{!print.available ? 'Out of stock' : print.lowStock ? `Only ${print.lowStock} left` : 'In stock · ships in 2–4 days'}</span>
                  </button>
                )}
                {digital && (
                  <button type="button" role="radio" aria-checked={format === 'digital'} className={'format' + (format === 'digital' ? ' is-on' : '')} onClick={() => setFormat('digital')}>
                    <span className="format__label">E-book (PDF)</span>
                    <span className="format__prices">{priceTag(digital)}</span>
                    <span className="format__stock">Instant download</span>
                  </button>
                )}
              </div>

              {format === 'digital' && bundle && print && (
                <label className={'bundle-opt' + (bundle.available ? '' : ' is-disabled')}>
                  <input type="checkbox" checked={withPrint} disabled={!bundle.available} onChange={(e) => setWithPrint(e.target.checked)} />
                  <span className="bundle-opt__box" aria-hidden="true">{withPrint ? '✓' : ''}</span>
                  <span className="bundle-opt__text">
                    <strong>Also send me the printed copy</strong>
                    <span>{bundle.available ? <>E-book + printed book for {inr(bundle.price)} — {inr(Math.max(bundle.price - digital!.price, 0))} more{print.price + digital!.price > bundle.price && <> (save {inr(print.price + digital!.price - bundle.price)})</>}</> : 'The printed copy is out of stock right now.'}</span>
                  </span>
                </label>
              )}

              <div className="buy__row">
                {kind === 'print' && available && (
                  <div className="qty" aria-label="Quantity">
                    <button type="button" aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
                    <span aria-live="polite">{qty}</span>
                    <button type="button" aria-label="More" onClick={() => setQty((q) => Math.min(MAX_QTY.print, q + 1))} disabled={qty >= MAX_QTY.print || (print?.lowStock != null && qty >= print.lowStock)}>+</button>
                  </div>
                )}
                <button type="button" className="btn btn--bronze btn--lg" disabled={!available} onClick={() => addToCart(false)}>
                  {available ? `Add to cart · ${inr(total)}` : 'Out of stock'}
                </button>
                {available && <button type="button" className="btn btn--outline" onClick={() => addToCart(true)}>Buy now</button>}
              </div>
              {added && <div className="buy__added" role="status">Added to your cart.</div>}
              <div className="buy__notes">
                <span>Secure payment by Razorpay · UPI, cards, net banking</span>
                {(kind !== 'digital') && <span>Free delivery on orders above ₹999</span>}
              </div>
            </div>

            <div className="book-ctas book-ctas--secondary">
              <button type="button" className="text-link text-link--lg" onClick={() => openModal('sample', book.id)}>Request a sample copy</button>
              <button type="button" className="text-link text-link--lg" onClick={() => openModal('bulk', book.id)}>School / bulk enquiry</button>
              <Link to="/contact" className="text-link text-link--lg">Find a distributor</Link>
            </div>
            {book.companion && (
              <div className="elm-note">
                <ElmasterMark className="elm-note__mark" />
                <span className="elm-note__text">Includes a digital companion — scan the QR inside for videos and chapter tests.</span>
                {config.elmasterUrl && <a href={config.elmasterUrl} target="_blank" rel="noopener" className="elm-note__link">Preview ↗</a>}
              </div>
            )}
            <div className="specs">
              {specs.map(([k, v]) => (
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
                {book.description && book.description !== book.blurb && <p className="body body--15 body--relaxed prewrap">{book.description}</p>}
                {book.highlights.length > 0 && <h3 className="h3-30">What's inside</h3>}
                <div className="highlights">
                  {book.highlights.map((h) => <div key={h} className="highlight"><span />{h}</div>)}
                </div>
              </div>
            )}
            {tab === 'Contents' && (
              book.contents.length ? (
                <ol className="toc">
                  {book.contents.map((t, i) => (
                    <li key={t + i}><span>{String(i + 1).padStart(2, '0')}</span>{t}</li>
                  ))}
                </ol>
              ) : <p className="body body--15">The table of contents will be added soon.</p>
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
          {relatedTo(products, book).map((b) => <BookCard key={b.id} book={b} variant="related" />)}
        </div>
      </section>
    </div>
  );
}
