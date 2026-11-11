import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { catalogueHref, relatedTo } from '../catalogue';
import { config } from '../config';
import { LV, PAL } from '../data';
import { useSite } from '../site';
import { inr } from '../store/api';
import { productMeta, useCatalog, useStoreConfig } from '../store/catalog';
import { MAX_QTY, useCart } from '../store/cart';
import type { Kind, Product } from '../store/types';
import { BookCard } from '../components/BookCard';
import { BookCover } from '../components/BookCover';
import { BookPhotos } from '../components/BookPhotos';
import { ElmasterMark } from '../components/Brand';
import { Arrow, EASE, Reveal, SplitWords, Stagger, StaggerItem, Tilt } from '../components/motion';
import { NotFound } from './NotFound';
import { formatName, track } from '../meta';
import { ga, gaItem } from '../ga';
import { BookSchema } from '../components/BookSchema';
import { trackAddToCart } from '../trackCart';
import { dropPrerender } from '../prerender';

const TABS = ['Overview', 'Contents'] as const;

export function BookDetail() {
  const { slug } = useParams();
  const { bySlug, status } = useCatalog();
  const book = bySlug(slug);
  // No such book: the server's ready-made page (if any) gives way to "not found". If the catalogue
  // failed to load, it stays: it's the book's real content.
  useLayoutEffect(() => { if (!book && status === 'ready') dropPrerender(); }, [book, status]);
  if (!book) return status === 'loading' ? <div className="wrap page-head" aria-busy="true"><div className="skeleton skeleton--hero" /></div> : <NotFound />;
  // Keyed so tab / format selection resets when moving between books.
  return <BookView key={book.id} book={book} />;
}


function BookView({ book }: { book: Product }) {
  const { openModal } = useSite();
  const { products } = useCatalog();
  const cfg = useStoreConfig();
  const related = relatedTo(products, book);
  const cart = useCart();
  const navigate = useNavigate();
  const { print, digital } = book.formats;
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview');
  const [format, setFormat] = useState<'print' | 'digital'>(print?.available || !digital ? 'print' : 'digital');
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  // The app's page is ready: it replaces the server's ready-made copy before the next paint.
  useLayoutEffect(() => dropPrerender(), []);

  useEffect(() => { document.title = `${book.title} — Elden Academic Press`; }, [book.title]);
  useEffect(() => {
    const price = (book.formats.print ?? book.formats.digital)?.price;
    track('ViewContent', { content_ids: [book.id], content_name: book.title, content_type: 'product', ...(price ? { value: price / 100, currency: 'INR' } : {}) });
    const k = book.formats.print ? 'print' : 'digital';
    if (price) ga('view_item', { currency: 'INR', value: price / 100, items: [gaItem(book.id, book.title, k, price, 1, book.category?.name)] });
  }, [book.id]);

  const kind: Kind = format;
  const chosen = book.formats[kind];
  const available = Boolean(chosen?.available);
  const total = chosen ? chosen.price * (kind === 'print' ? qty : 1) : 0;

  // Meta CustomizeProduct: the visitor switches between print and e-book.
  const chooseFormat = (f: 'print' | 'digital') => {
    if (f === format) return;
    setFormat(f);
    const price = book.formats[f]?.price;
    track('CustomizeProduct', { content_ids: [book.id], content_name: book.title, content_type: 'product', format: formatName(f), ...(price ? { value: price / 100, currency: 'INR' } : {}) });
  };

  const addToCart = (go: boolean) => {
    if (!available) return;
    const quantity = kind === 'print' ? qty : 1;
    cart.add({ productId: book.id, kind, quantity });
    trackAddToCart(book, kind, quantity);
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

  const stockNote = !chosen ? '' : kind === 'digital' ? 'Instant download'
    : !available ? 'Out of stock'
    : kind === 'print' && print?.lowStock ? `Only ${print.lowStock} left · dispatched in ${config.policy.dispatch}`
    : `In stock · dispatched in ${config.policy.dispatch}`;
  const c = PAL[book.palette] ?? PAL[0];
  const freeAbove = cfg?.shipping.freeAbove ?? 0;

  return (
    <div className="pd">
      <BookSchema book={book} />
      <div className="wrap pd__top">
        <div className="crumbs crumbs--28">
          <Link to="/">Home</Link><span>/</span><Link to="/catalogue">Store</Link><span>/</span><span className="crumbs__here">{book.title}</span>
        </div>
        <div className="pd__grid">
          <div className="pd__side">
            <div className="pd__media" style={{ '--pd-tint': c.bg } as CSSProperties}>
              <motion.div className="pd__cover" initial={{ opacity: 0, y: 30, rotate: -4 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ duration: 0.9, ease: EASE }}>
                <Tilt max={12}><BookCover book={book} size="detail" /></Tilt>
              </motion.div>
            </div>
            <BookPhotos photos={book.images ?? []} title={book.title} />
          </div>

          <div className="pd__info">
            <Reveal className="pd__tags">
              {book.category && <Link to={catalogueHref({ type: [book.category.slug] })} className="pd__tag">{book.category.name}</Link>}
              <span className="pd__tag pd__tag--plain">{LV[book.level]}</span>
              {book.isNew && <span className="pd__tag pd__tag--new">New</span>}
            </Reveal>
            <h1 className="t-h1 pd__title"><SplitWords text={book.title} /></h1>
            <Reveal delay={0.15} className="pd__by">{book.author && <>by <b>{book.author}</b> · </>}{productMeta(book)}</Reveal>
            {book.blurb && <Reveal delay={0.2}><p className="pd__blurb">{book.blurb}</p></Reveal>}

            <Reveal delay={0.25} className="buy">
              <div className="buy__price" aria-live="polite">
                <span className="buy__amount">{chosen ? inr(chosen.price) : '—'}</span>
                {chosen?.compareAt && chosen.compareAt > chosen.price && <s>{inr(chosen.compareAt)}</s>}
                <span className={'buy__stock' + (available ? '' : ' is-out')}>{stockNote}</span>
              </div>

              {print && digital && (
                <div className="seg" role="radiogroup" aria-label="Format">
                  {([['print', 'Printed book', print], ['digital', 'E-book (PDF)', digital]] as const).map(([k, label, f]) => (
                    <button key={k} type="button" role="radio" aria-checked={format === k} className={'seg__opt' + (format === k ? ' is-on' : '')} onClick={() => chooseFormat(k)}>
                      {format === k && <motion.span layoutId="pd-format" className="seg__bg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                      <span>{label}</span><b>{inr(f.price)}</b>
                    </button>
                  ))}
                </div>
              )}

              {format === 'print' && print?.includesEbook && (
                <div className="buy__free"><span aria-hidden="true">+</span> <b>E-book (PDF) included free</b>, ready to download as soon as you pay.</div>
              )}

              <div className="buy__actions">
                {kind === 'print' && available && (
                  <div className="qty" aria-label="Quantity">
                    <button type="button" aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1}>−</button>
                    <span aria-live="polite">{qty}</span>
                    <button type="button" aria-label="More" onClick={() => setQty((q) => Math.min(MAX_QTY.print, q + 1))} disabled={qty >= MAX_QTY.print || (print?.lowStock != null && qty >= print.lowStock)}>+</button>
                  </div>
                )}
                <button type="button" className="btn btn--accent btn--lg buy__add" disabled={!available} onClick={() => addToCart(false)}>
                  {!available ? 'Out of stock' : added ? '✓ Added. Add another' : <>Add to cart{qty > 1 && kind === 'print' ? ` · ${inr(total)}` : ''}</>}
                </button>
              </div>
              {available && <button type="button" className="buy__now" onClick={() => addToCart(true)}>or buy now and go to checkout <Arrow /></button>}

              <p className="buy__fine">
                Secure checkout by Razorpay (UPI, cards, net banking).
                {kind !== 'print' ? ' E-book link arrives by email instantly.' : freeAbove > 0 ? ` Free delivery above ${inr(freeAbove)}.` : ''}
              </p>
            </Reveal>

            {specs.length > 0 && (
              <dl className="specs">
                {specs.map(([k, v]) => <div key={k} className="spec"><dt>{k}</dt><dd>{v}</dd></div>)}
              </dl>
            )}

            <div className="pd__schools">
              <b>Ordering for a school?</b>
              <div className="pd__links">
                <button type="button" className="text-link" onClick={() => openModal('bulk', book.id)}>Bulk pricing</button>
                <Link to="/contact" className="text-link">Find a distributor</Link>
              </div>
            </div>
            {book.companion && (
              <div className="elm-note">
                <ElmasterMark className="elm-note__mark" />
                <span className="elm-note__text">Includes a digital companion: scan the QR inside for videos and chapter tests.</span>
                {config.elmasterUrl && <a href={config.elmasterUrl} target="_blank" rel="noopener" className="text-link">Preview ↗</a>}
              </div>
            )}
          </div>
        </div>
      </div>

      <section className="pd__tabs-band">
        <div className="wrap pd__tabs-wrap">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={'tab' + (tab === t ? ' is-on' : '')} onClick={() => setTab(t)}>
                {t}
                {tab === t && <motion.span layoutId="pd-tab" className="tab__line" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={tab} className="tab-panel" role="tabpanel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
              {tab === 'Overview' && (
                <div className="stack-18">
                  {book.description && book.description !== book.blurb && <p className="pd__desc prewrap">{book.description}</p>}
                  {book.highlights.length > 0 && <h3 className="t-h3">What’s inside</h3>}
                  <ul className="highlights">
                    {book.highlights.map((h) => <li key={h}>{h}</li>)}
                  </ul>
                  {!book.description && !book.highlights.length && <p className="body">{book.blurb}</p>}
                </div>
              )}
              {tab === 'Contents' && (
                book.contents.length ? (
                  <ol className="toc">
                    {book.contents.map((t, i) => (
                      <li key={t + i}><span className="toc__n">{String(i + 1).padStart(2, '0')}</span><span className="toc__t">{t}</span><span className="toc__dots" aria-hidden="true" /></li>
                    ))}
                  </ol>
                ) : <p className="body">The table of contents will be added soon.</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {related.length > 0 && (
        <section className="wrap section--tight pd__related">
          <Reveal><h2 className="t-h2">You may <span className="serif-i">also need.</span></h2></Reveal>
          <Stagger className="grid-books pd__related-grid">
            {related.map((b) => <StaggerItem key={b.id}><BookCard book={b} variant="related" /></StaggerItem>)}
          </Stagger>
        </section>
      )}
    </div>
  );
}
