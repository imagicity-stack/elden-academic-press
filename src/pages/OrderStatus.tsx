import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, api, inr } from '../store/api';
import { useStoreConfig } from '../store/catalog';

interface OrderView {
  number: number;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  paidAt: string | null;
  name: string;
  email: string;
  items: { id: string; title: string; format: string; kind: string; quantity: number; lineTotal: number; isDigital: boolean; downloadsLeft: number | null; canDownload: boolean }[];
  downloadsExpireAt: string | null;
  subtotal: number; discount: number; couponCode: string | null; shipping: number; tax: number; total: number; refundedAmount: number;
  requiresShipping: boolean;
  address: { name: string; line1: string; line2: string | null; city: string; state: string; pincode: string } | null;
  tracking: { courier: string | null; number: string | null; url: string | null; shippedAt: string; deliveredAt: string | null } | null;
  invoice: string | null;
  timeline: { type: string; message: string; at: string }[];
}

const date = (s: string | null) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

const STEPS = [
  { key: 'paid', label: 'Confirmed' },
  { key: 'packed', label: 'Packed' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
];

export function OrderStatus() {
  const { number } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get('t') ?? '';
  const isNew = sp.get('new') === '1';
  const cfg = useStoreConfig();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    document.title = `Order #${number} — Elden Academic Press`;
    api<OrderView>(`/orders/${number}?t=${encodeURIComponent(token)}`).then(setOrder, setError);
  }, [number, token]);

  if (error) {
    return (
      <div className="wrap page-narrow">
        <h1 className="h1-page">Order not found</h1>
        <p className="body body--15">This link may be incomplete. Use the link from your confirmation email, or find your order below.</p>
        <div><Link to="/track" className="btn btn--ink">Track an order</Link></div>
      </div>
    );
  }
  if (!order) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;

  const fulfilIndex = ['unfulfilled', 'packed', 'shipped', 'delivered'].indexOf(order.fulfillmentStatus);
  const paid = ['paid', 'partially_refunded'].includes(order.paymentStatus);
  const q = `?t=${encodeURIComponent(token)}`;
  const digital = order.items.filter((i) => i.isDigital);

  return (
    <div className="wrap page-order">
      {isNew && paid && (
        <div className="order-thanks" role="status">
          <div className="order-thanks__tick" aria-hidden="true">✓</div>
          <div>
            <div className="order-thanks__title">Thank you, {order.name.split(' ')[0]}!</div>
            <div className="order-thanks__text">Your payment was successful. A confirmation is on its way to {order.email}. Bookmark this page — it’s your private link to this order.</div>
          </div>
        </div>
      )}
      <div className="order-head">
        <div>
          <div className="eyebrow eyebrow--11">Order #{order.number}</div>
          <h1 className="h1-page">{order.status}</h1>
          <div className="order-head__meta">Placed {date(order.createdAt)}</div>
        </div>
        {order.invoice && <a className="btn btn--outline btn--md" href={`/api/orders/${order.number}/invoice${q}`} target="_blank" rel="noopener">Invoice {order.invoice}</a>}
      </div>

      {order.requiresShipping && paid && (
        <ol className="progress" aria-label="Delivery progress">
          {STEPS.map((s, i) => (
            <li key={s.key} className={i <= Math.max(fulfilIndex, 0) ? 'is-done' : ''}><span />{s.label}</li>
          ))}
        </ol>
      )}

      <div className="order-grid">
        <div className="stack-18">
          {digital.length > 0 && paid && (
            <section className="order-card">
              <h2 className="order-card__title">Your e-books</h2>
              <ul className="dl-list">
                {digital.map((i) => (
                  <li key={i.id}>
                    <div><strong>{i.title}</strong><span>{i.format} · {i.downloadsLeft} download{i.downloadsLeft === 1 ? '' : 's'} left</span></div>
                    {i.canDownload
                      ? <a className="btn btn--ink btn--md" href={`/api/orders/${order.number}/download/${i.id}${q}`}>Download PDF</a>
                      : <span className="dl-list__off">Not available — <a href={`mailto:${cfg?.supportEmail ?? 'hello@eldenap.in'}`}>contact us</a></span>}
                  </li>
                ))}
              </ul>
              {order.downloadsExpireAt && <p className="order-card__note">Downloads are available until {new Date(order.downloadsExpireAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}. Save the file to your device.</p>}
            </section>
          )}

          {order.tracking && (
            <section className="order-card">
              <h2 className="order-card__title">Delivery</h2>
              <p className="body body--15">
                Shipped {date(order.tracking.shippedAt)}{order.tracking.courier && <> with <strong>{order.tracking.courier}</strong></>}.
                {order.tracking.number && <> Tracking number <strong>{order.tracking.number}</strong>.</>}
                {order.tracking.deliveredAt && <> Delivered {date(order.tracking.deliveredAt)}.</>}
              </p>
              {order.tracking.url && <a className="btn btn--outline btn--md" href={order.tracking.url} target="_blank" rel="noopener noreferrer">Track parcel ↗</a>}
            </section>
          )}

          <section className="order-card">
            <h2 className="order-card__title">Items</h2>
            <ul className="order-items">
              {order.items.map((i) => (
                <li key={i.id}><div><strong>{i.title}</strong><span>{i.format} × {i.quantity}</span></div><div>{inr(i.lineTotal)}</div></li>
              ))}
            </ul>
            <dl className="sums">
              <div><dt>Subtotal</dt><dd>{inr(order.subtotal)}</dd></div>
              {order.discount > 0 && <div className="sums__saving"><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ''}</dt><dd>−{inr(order.discount)}</dd></div>}
              {order.requiresShipping && <div><dt>Shipping</dt><dd>{order.shipping ? inr(order.shipping) : 'Free'}</dd></div>}
              <div className="sums__total"><dt>Total</dt><dd>{inr(order.total)}</dd></div>
              {order.tax > 0 && <div className="sums__note"><dt>Includes GST</dt><dd>{inr(order.tax)}</dd></div>}
              {order.refundedAmount > 0 && <div className="sums__saving"><dt>Refunded</dt><dd>−{inr(order.refundedAmount)}</dd></div>}
            </dl>
          </section>
        </div>

        <div className="stack-18">
          {order.address && (
            <section className="order-card">
              <h2 className="order-card__title">Delivering to</h2>
              <p className="body body--15">{order.address.name}<br />{order.address.line1}{order.address.line2 && <><br />{order.address.line2}</>}<br />{order.address.city} – {order.address.pincode}</p>
            </section>
          )}
          <section className="order-card">
            <h2 className="order-card__title">History</h2>
            <ol className="timeline">
              {order.timeline.slice().reverse().map((e, i) => <li key={i}><span>{e.message}</span><time>{date(e.at)}</time></li>)}
            </ol>
          </section>
          <section className="order-card order-card--muted">
            <p className="body body--15">Questions about this order? Write to <a href={`mailto:${cfg?.supportEmail ?? 'hello@eldenap.in'}?subject=Order%20%23${order.number}`}>{cfg?.supportEmail ?? 'hello@eldenap.in'}</a> with your order number.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

interface LookupView { number: number; status: string; createdAt: string; items: { title: string; format: string; quantity: number }[]; tracking: OrderView['tracking']; emailHint: string }

export function Track() {
  const [number, setNumber] = useState('');
  const [contact, setContact] = useState('');
  const [result, setResult] = useState<LookupView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { document.title = 'Track your order — Elden Academic Press'; }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setResult(null); setSent(false);
    try { setResult(await api<LookupView>('/orders/lookup', { body: { number: number.replace(/\D/g, ''), contact } })); }
    catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true);
    try { await api('/orders/resend', { body: { number: result!.number, contact } }); setSent(true); }
    catch (e2) { setErr((e2 as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="wrap page-narrow">
      <div className="eyebrow eyebrow--11">Orders</div>
      <h1 className="h1-page">Track your order</h1>
      <p className="body body--15">Enter your order number and the email or mobile number you used at checkout.</p>
      <form className="track-form" onSubmit={submit}>
        <label className="field">Order number<input className="input input--white" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 100234" inputMode="numeric" required /></label>
        <label className="field">Email or mobile<input className="input input--white" value={contact} onChange={(e) => setContact(e.target.value)} required autoComplete="email" /></label>
        <button type="submit" className="btn btn--ink" disabled={busy}>{busy ? 'Looking…' : 'Find order'}</button>
      </form>
      {err && <div className="form-error" role="alert">{err}</div>}
      {result && (
        <section className="order-card">
          <div className="eyebrow eyebrow--11">Order #{result.number} · {new Date(result.createdAt).toLocaleDateString('en-IN')}</div>
          <h2 className="order-card__title">{result.status}</h2>
          <ul className="order-items">{result.items.map((i, k) => <li key={k}><div><strong>{i.title}</strong><span>{i.format} × {i.quantity}</span></div></li>)}</ul>
          {result.tracking && (
            <p className="body body--15">{result.tracking.courier} {result.tracking.number && <>· tracking <strong>{result.tracking.number}</strong></>} {result.tracking.url && <a href={result.tracking.url} target="_blank" rel="noopener noreferrer">Track parcel ↗</a>}</p>
          )}
          {sent
            ? <div className="form-ok">We’ve emailed the full order link to {result.emailHint}.</div>
            : <button type="button" className="btn btn--outline btn--md" disabled={busy} onClick={resend}>Email me the full order link (with e-book downloads)</button>}
        </section>
      )}
    </div>
  );
}
