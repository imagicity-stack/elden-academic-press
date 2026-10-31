import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { inr } from '../store/api';
import { FORMAT_LABEL, useCatalog } from '../store/catalog';
import { MAX_QTY, useCart, useQuote } from '../store/cart';
import type { Quote, QuoteLine } from '../store/types';
import { BookCover } from './BookCover';
import { Arrow, EASE } from './motion';

export function issueText(l: Pick<QuoteLine, 'issue'>) {
  if (!l.issue) return null;
  if (l.issue.code === 'out_of_stock') return 'Out of stock — remove to continue';
  if (l.issue.code === 'insufficient_stock') return `Only ${l.issue.available} left — lower the quantity`;
  return 'No longer available — remove to continue';
}

export function CartDrawer() {
  const cart = useCart();
  const { byId } = useCatalog();
  const navigate = useNavigate();
  const { quote, loading, error } = useQuote(cart.drawerOpen ? cart.lines : [], cart.coupon);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cart.drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cart.closeDrawer();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [cart.drawerOpen, cart]);

  const lineFor = (productId: string, kind: string) => quote?.lines.find((l) => l.productId === productId && l.kind === kind);

  return (
    <AnimatePresence>
      {cart.drawerOpen && (
        <>
          <motion.div key="backdrop" className="drawer-backdrop" onClick={cart.closeDrawer} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div key="drawer" className="drawer" role="dialog" aria-modal="true" aria-label="Your cart" ref={panel} tabIndex={-1}
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 340, damping: 36 }}>
            <div className="drawer__head">
              <div className="drawer__title">Your cart{cart.count ? <small>{cart.count} {cart.count === 1 ? 'item' : 'items'}</small> : null}</div>
              <button type="button" className="drawer__close" aria-label="Close cart" onClick={cart.closeDrawer}>×</button>
            </div>

            {cart.lines.length === 0 ? (
              <div className="drawer__empty">
                <div className="drawer__empty-art" aria-hidden="true">0</div>
                <p>Your cart is empty.</p>
                <Link to="/catalogue" className="btn btn--ink btn--lg" onClick={cart.closeDrawer}>Browse the store <Arrow /></Link>
              </div>
            ) : (
              <>
                <ul className="drawer__lines">
                  <AnimatePresence initial={false}>
                    {cart.lines.map((l, i) => {
                      const p = byId(l.productId);
                      const q = lineFor(l.productId, l.kind);
                      return (
                        <motion.li layout key={l.productId + l.kind} className="cart-line"
                          initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0, transition: { duration: 0.4, ease: EASE, delay: 0.1 + i * 0.05 } }} exit={{ opacity: 0, x: 40, height: 0, paddingTop: 0, paddingBottom: 0 }}>
                          <div className="cart-line__cover">{p ? <BookCover book={p} /> : <div className="cover" />}</div>
                          <div className="cart-line__body">
                            <Link to={p ? '/books/' + p.slug : '/catalogue'} className="cart-line__title" onClick={cart.closeDrawer}>{p?.title ?? q?.title ?? 'Item'}</Link>
                            <div className="cart-line__fmt">{FORMAT_LABEL[l.kind]}</div>
                            {q?.issue && <div className="cart-line__issue">{issueText(q)}</div>}
                            <div className="cart-line__row">
                              {MAX_QTY[l.kind] > 1 ? (
                                <div className="qty qty--sm">
                                  <button type="button" aria-label="Fewer" onClick={() => cart.setQuantity(l.productId, l.kind, l.quantity - 1)} disabled={l.quantity <= 1}>−</button>
                                  <span>{l.quantity}</span>
                                  <button type="button" aria-label="More" onClick={() => cart.setQuantity(l.productId, l.kind, l.quantity + 1)}>+</button>
                                </div>
                              ) : <span className="cart-line__one">Qty 1</span>}
                              <button type="button" className="cart-line__remove" onClick={() => cart.remove(l.productId, l.kind)}>Remove</button>
                              <span className="cart-line__price">{q ? inr(q.lineTotal) : '—'}</span>
                            </div>
                          </div>
                        </motion.li>
                      );
                    })}
                  </AnimatePresence>
                </ul>
                <div className="drawer__foot">
                  <CouponField quote={quote} />
                  {error && <div className="form-error">{error}</div>}
                  {quote && (
                    <dl className="sums">
                      <div><dt>Subtotal</dt><dd>{inr(quote.subtotal)}</dd></div>
                      {quote.discount > 0 && <div className="sums__saving"><dt>Discount ({quote.coupon?.code})</dt><dd>−{inr(quote.discount)}</dd></div>}
                      {quote.requiresShipping && <div><dt>Shipping</dt><dd>{quote.shipping ? inr(quote.shipping) : 'Free'}</dd></div>}
                      <div className="sums__total"><dt>Total</dt><dd>{inr(quote.total)}</dd></div>
                    </dl>
                  )}
                  {quote && quote.freeShippingRemaining > 0 && <div className="drawer__hint">Add {inr(quote.freeShippingRemaining)} more for free delivery.</div>}
                  <button type="button" className="btn btn--accent btn--lg btn--block" disabled={!quote || !quote.lines.every((l) => !l.issue) || loading}
                    onClick={() => { cart.closeDrawer(); navigate('/checkout'); }}>
                    {loading && !quote ? 'Updating…' : <>Checkout <Arrow /></>}
                  </button>
                  <button type="button" className="drawer__continue" onClick={cart.closeDrawer}>Continue shopping</button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function CouponField({ quote }: { quote: Quote | null }) {
  const cart = useCart();
  const [open, setOpen] = useState(Boolean(cart.coupon));
  const [code, setCode] = useState(cart.coupon);
  if (!open) return <button type="button" className="text-link coupon-toggle" onClick={() => setOpen(true)}>Have a coupon code?</button>;
  return (
    <div className="coupon">
      {/* Not a <form>: this sits inside the checkout form. */}
      <div className="coupon__row">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Coupon code" aria-label="Coupon code" maxLength={30}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (code.trim()) cart.setCoupon(code); } }} />
        {cart.coupon ? (
          <button type="button" onClick={() => { cart.setCoupon(''); setCode(''); }}>Remove</button>
        ) : (
          <button type="button" disabled={!code.trim()} onClick={() => cart.setCoupon(code)}>Apply</button>
        )}
      </div>
      {cart.coupon && quote?.couponError && <div className="form-error">{quote.couponError}</div>}
      {cart.coupon && quote?.coupon && <div className="form-ok">{quote.coupon.description || `${quote.coupon.code} applied`}</div>}
    </div>
  );
}
