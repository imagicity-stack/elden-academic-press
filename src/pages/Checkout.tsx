import { useEffect, useMemo, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api, fieldError, inr } from '../store/api';
import { FORMAT_LABEL, useCatalog, useStoreConfig } from '../store/catalog';
import { useCart, useQuote } from '../store/cart';
import { orderPath } from '../store/orderToken';
import { BookCover } from '../components/BookCover';
import { CouponField, issueText } from '../components/CartDrawer';

interface CheckoutResponse {
  orderId: string;
  number: number;
  token: string;
  total: number;
  paid: boolean;
  razorpay: { keyId: string; orderId: string; amount: number; currency: string; simulated: boolean } | null;
  prefill: { name: string; email: string; contact: string };
}
interface PaymentResult { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }

declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => { open(): void; on(ev: string, cb: (r: { error?: { description?: string } }) => void): void } }
}

const DETAILS_KEY = 'elden-checkout-details';
const blank = { name: '', email: '', phone: '', line1: '', line2: '', city: '', state: '20', pincode: '', note: '' };

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.body.appendChild(s);
  });
}

export function Checkout() {
  const cart = useCart();
  const { byId } = useCatalog();
  const cfg = useStoreConfig();
  const navigate = useNavigate();
  const [d, setD] = useState(() => {
    try { return { ...blank, ...JSON.parse(localStorage.getItem(DETAILS_KEY) ?? '{}'), note: '' }; } catch { return blank; }
  });
  const { quote, loading, refresh } = useQuote(cart.lines, cart.coupon, d.state);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sim, setSim] = useState<CheckoutResponse | null>(null);
  const pending = useRef<{ key: string; res: CheckoutResponse } | null>(null);

  useEffect(() => { document.title = 'Checkout — Elden Academic Press'; }, []);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setD((x: typeof blank) => ({ ...x, [k]: e.target.value }));
  const needsAddress = Boolean(quote?.requiresShipping);

  const payload = useMemo(() => ({
    items: cart.lines,
    couponCode: cart.coupon || null,
    contact: { name: d.name, email: d.email, phone: d.phone },
    shipping: needsAddress ? { name: d.name, line1: d.line1, line2: d.line2, city: d.city, state: d.state, pincode: d.pincode } : null,
    billingState: d.state,
    note: d.note || undefined,
  }), [cart.lines, cart.coupon, d, needsAddress]);

  async function finish(result: PaymentResult) {
    setBusy(true);
    try {
      const r = await api<{ number: number; token: string }>('/checkout/verify', { body: result });
      pending.current = null;
      cart.clear();
      navigate(orderPath(r.number, r.token, 'new=1'), { replace: true });
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  async function openPayment(res: CheckoutResponse) {
    if (!res.razorpay) return;
    if (res.razorpay.simulated) { setSim(res); setBusy(false); return; }
    await loadRazorpay();
    const rzp = new window.Razorpay!({
      key: res.razorpay.keyId,
      order_id: res.razorpay.orderId,
      amount: res.razorpay.amount,
      currency: res.razorpay.currency,
      name: cfg?.storeName ?? 'Elden Academic Press',
      description: `Order #${res.number}`,
      image: `${location.origin}/assets/elden-mark.png`,
      prefill: res.prefill,
      notes: { order_number: String(res.number) },
      theme: { color: '#0E1F33' },
      handler: (r: PaymentResult) => finish(r),
      modal: {
        ondismiss: () => {
          setBusy(false);
          setNotice('Payment not completed. Your order is saved for 30 minutes — press Pay to try again.');
          api('/checkout/abandoned', { body: { razorpayOrderId: res.razorpay!.orderId } }).catch(() => {});
        },
      },
    });
    rzp.on('payment.failed', (r) => setNotice(r.error?.description ? `Payment failed: ${r.error.description}` : 'Payment failed. Please try another method.'));
    rzp.open();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    setBusy(true);
    try { localStorage.setItem(DETAILS_KEY, JSON.stringify({ ...d, note: '' })); } catch { /* ignore */ }
    const key = JSON.stringify(payload);
    try {
      let res = pending.current?.key === key ? pending.current.res : null;
      if (!res) {
        res = await api<CheckoutResponse>('/checkout', { body: payload });
        pending.current = { key, res };
      }
      if (res.paid) {
        cart.clear();
        navigate(orderPath(res.number, res.token, 'new=1'), { replace: true });
        return;
      }
      await openPayment(res);
    } catch (e2) {
      setErr(e2);
      setBusy(false);
      if (e2 instanceof ApiError && e2.status === 409) refresh();
    }
  }

  if (!cart.lines.length) {
    return (
      <div className="wrap page-narrow">
        <h1 className="t-h1">Checkout</h1>
        <p className="t-lead">Your cart is empty.</p>
        <div><Link to="/catalogue" className="btn btn--ink">Browse the store</Link></div>
      </div>
    );
  }

  const fe = (...p: string[]) => fieldError(err, ...p);
  const generalError = err instanceof ApiError && err.code === 'invalid' && err.details && typeof err.details === 'object'
    ? [...new Set(Object.values(err.details as Record<string, string[]>).flat())].join(' · ')
    : err instanceof Error ? err.message : null;
  const hasIssues = quote ? quote.lines.some((l) => l.issue) : false;

  return (
    <div className="wrap page-checkout">
      <div className="crumbs"><Link to="/catalogue">Store</Link><span>/</span><span className="crumbs__here">Checkout</span></div>
      <h1 className="h1-page">Checkout</h1>
      <form className="checkout" onSubmit={submit} noValidate>
        <div className="checkout__form">
          <fieldset className="co-section">
            <legend>Contact</legend>
            <div className="form-grid">
              <Input label="Full name" value={d.name} onChange={set('name')} autoComplete="name" required />
              <Input label="Mobile number" value={d.phone} onChange={set('phone')} type="tel" autoComplete="tel-national" inputMode="numeric" placeholder="10-digit mobile" required />
            </div>
            <Input label="Email" value={d.email} onChange={set('email')} type="email" autoComplete="email" required hint="Your order confirmation and e-book links are sent here." />
          </fieldset>

          {needsAddress ? (
            <fieldset className="co-section">
              <legend>Delivery address</legend>
              <Input label="House / flat, street" value={d.line1} onChange={set('line1')} autoComplete="address-line1" required />
              <Input label="Area, landmark (optional)" value={d.line2} onChange={set('line2')} autoComplete="address-line2" />
              <div className="form-grid form-grid--3">
                <Input label="City / town" value={d.city} onChange={set('city')} autoComplete="address-level2" required />
                <StateSelect value={d.state} onChange={set('state')} states={cfg?.states} />
                <Input label="PIN code" value={d.pincode} onChange={set('pincode')} autoComplete="postal-code" inputMode="numeric" maxLength={6} required />
              </div>
            </fieldset>
          ) : (
            <fieldset className="co-section">
              <legend>Your state</legend>
              <p className="co-hint">E-books are delivered by email and on your order page — no address needed. We use your state for the GST invoice.</p>
              <StateSelect value={d.state} onChange={set('state')} states={cfg?.states} error={fe('billingState')} />
            </fieldset>
          )}

          <fieldset className="co-section">
            <legend>Note (optional)</legend>
            <textarea className="input input--area" rows={2} maxLength={500} value={d.note} onChange={set('note')} placeholder="Anything we should know about delivery?" aria-label="Order note" />
          </fieldset>
        </div>

        <aside className="checkout__summary" aria-label="Order summary">
          <div className="co-summary">
            <div className="co-summary__title">Order summary</div>
            <ul className="co-lines">
              {cart.lines.map((l) => {
                const p = byId(l.productId);
                const q = quote?.lines.find((x) => x.productId === l.productId && x.kind === l.kind);
                return (
                  <li key={l.productId + l.kind}>
                    <div className="co-lines__cover">{p && <BookCover book={p} />}<span className="co-lines__qty">{l.quantity}</span></div>
                    <div className="co-lines__text"><strong>{p?.title ?? q?.title}</strong><span>{FORMAT_LABEL[l.kind]}</span>{q?.issue && <em>{issueText(q)}</em>}</div>
                    <div className="co-lines__price">{q ? inr(q.lineTotal) : ''}</div>
                  </li>
                );
              })}
            </ul>
            <CouponField quote={quote} />
            {quote && (
              <dl className="sums">
                <div><dt>Subtotal</dt><dd>{inr(quote.subtotal)}</dd></div>
                {quote.discount > 0 && <div className="sums__saving"><dt>Discount ({quote.coupon?.code})</dt><dd>−{inr(quote.discount)}</dd></div>}
                {quote.requiresShipping && <div><dt>Shipping</dt><dd>{quote.shipping ? inr(quote.shipping) : 'Free'}</dd></div>}
                <div className="sums__total"><dt>Total</dt><dd>{inr(quote.total)}</dd></div>
                {quote.tax > 0 && <div className="sums__note"><dt>Includes GST</dt><dd>{inr(quote.tax)}</dd></div>}
              </dl>
            )}
            {quote && quote.freeShippingRemaining > 0 && <div className="drawer__hint">Add {inr(quote.freeShippingRemaining)} more for free delivery.</div>}
            {generalError && <div className="form-error" role="alert">{generalError}</div>}
            {notice && <div className="form-notice" role="status">{notice}</div>}
            {cfg && !cfg.payments && <div className="form-notice">Online payment isn’t switched on yet. Please <Link to="/contact">contact us</Link> to order.</div>}
            <button type="submit" className="btn btn--accent btn--lg btn--block" disabled={busy || loading || !quote || hasIssues || !cfg?.payments}>
              {busy ? 'Please wait…' : quote ? `Pay ${inr(quote.total)}` : 'Pay'}
            </button>
            <div className="co-secure">
              <span aria-hidden="true">🔒</span> Payments are processed securely by Razorpay. We never see or store your card or UPI details.
            </div>
            <p className="co-terms">
              By paying you agree to our <a href="/terms" target="_blank" rel="noopener">terms</a>, <a href="/refunds" target="_blank" rel="noopener">refund policy</a> and <a href="/privacy" target="_blank" rel="noopener">privacy policy</a>.
            </p>
          </div>
        </aside>
      </form>
      {sim && <SimulatedPayment res={sim} onClose={() => { setSim(null); setNotice('Payment not completed. Press Pay to try again.'); }} onPaid={(r) => { setSim(null); finish(r); }} />}
    </div>
  );
}

function Input({ label, error, hint, ...rest }: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={'field' + (error ? ' has-error' : '')}>
      {label}
      <input className="input input--white" {...rest} />
      {hint && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

function StateSelect({ value, onChange, states, error }: { value: string; onChange: (e: { target: { value: string } }) => void; states?: { code: string; name: string }[]; error?: string }) {
  return (
    <label className={'field' + (error ? ' has-error' : '')}>
      State
      <select className="input input--white" value={value} onChange={onChange} autoComplete="address-level1">
        {(states ?? [{ code: '20', name: 'Jharkhand' }]).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
      </select>
      {error && <span className="field__error">{error}</span>}
    </label>
  );
}

/** Local development only: stands in for Razorpay's payment window. */
function SimulatedPayment({ res, onPaid, onClose }: { res: CheckoutResponse; onPaid: (r: PaymentResult) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (fail: boolean) => {
    setBusy(true);
    try {
      const r = await api<PaymentResult>('/dev/simulate-payment', { body: { razorpayOrderId: res.razorpay!.orderId, fail } });
      if (fail) {
        await api('/checkout/verify', { body: r }).catch((e: Error) => setMsg(e.message));
        setBusy(false);
      } else onPaid(r);
    } catch (e) {
      setMsg((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal sim-pay" role="dialog" aria-modal="true" aria-label="Test payment">
        <div className="modal__head">
          <div className="modal__head-text">
            <div className="modal__title">Test payment</div>
            <div className="modal__desc">Development mode — no real money. Razorpay’s window appears here once your keys are set.</div>
          </div>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className="sim-pay__body">
          <div className="sim-pay__amount">{inr(res.razorpay!.amount)}</div>
          <div className="sim-pay__order">Order #{res.number}</div>
          {msg && <div className="form-error">{msg}</div>}
          <button type="button" className="btn btn--ink btn--lg btn--block" disabled={busy} onClick={() => go(false)}>Pay with test UPI</button>
          <button type="button" className="btn btn--outline btn--block" disabled={busy} onClick={() => go(true)}>Simulate a failed payment</button>
        </div>
      </div>
    </div>
  );
}
