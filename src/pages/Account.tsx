import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { catalogueHref } from '../catalogue';
import { inr } from '../store/api';
import { useCatalog } from '../store/catalog';
import { accountApi, accountsDevMode, accountsEnabled, devSignIn, signInWithGoogle, signOut, useAccount, type AccountData, type LibraryItem } from '../store/account';
import { orderPath } from '../store/orderToken';
import { BookCover } from '../components/BookCover';
import { Arrow, EASE, Reveal, SplitWords, Stagger, StaggerItem } from '../components/motion';

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function Account() {
  const { state, reload } = useAccount();
  useEffect(() => { document.title = 'Your account — Elden Academic Press'; }, []);

  if (state.status === 'loading') return <div className="wrap page-head" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  if (state.status === 'signedOut') return <SignIn onDone={reload} />;
  if (state.status === 'error') {
    return (
      <div className="wrap page-narrow">
        <h1 className="t-h2">We couldn’t load your account.</h1>
        <p className="t-lead">{state.message}</p>
        <div><button type="button" className="btn btn--ink btn--lg" onClick={reload}>Try again</button></div>
      </div>
    );
  }
  return <Dashboard data={state.data} onSignOut={async () => { await signOut(); reload(); }} />;
}

/* ---------------- Signed out ---------------- */

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const { products } = useCatalog();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState('');
  const shelf = products.filter((p) => p.formats.digital).slice(0, 3);

  const google = async () => {
    setBusy(true); setErr(null);
    try { await signInWithGoogle(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const dev = (e: FormEvent) => { e.preventDefault(); devSignIn(devEmail); onDone(); };

  return (
    <section className="wrap acct-in">
      <div className="acct-in__text">
        <div className="t-label">Your account</div>
        <h1 className="t-display acct-in__title"><SplitWords text="Your shelf," /> <span className="serif-i">in one place.</span></h1>
        <Reveal delay={0.3}><p className="t-lead">Read your e-books and journals online, download them again, and see every order. No password to remember.</p></Reveal>
        <Reveal delay={0.4} className="acct-in__actions">
          {accountsEnabled && (
            <button type="button" className="btn btn--outline btn--lg acct-google" onClick={google} disabled={busy}>
              <GoogleG /> {busy ? 'Opening Google…' : 'Continue with Google'}
            </button>
          )}
          {accountsDevMode && (
            <form className="acct-dev" onSubmit={dev}>
              <input className="input" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="Email used at checkout" aria-label="Email" />
              <button type="submit" className="btn btn--ink btn--md">Developer sign-in</button>
            </form>
          )}
          {!accountsEnabled && !accountsDevMode && <p className="form-notice">Accounts are coming soon. Meanwhile, use the link in your order email or <Link to="/track">track an order</Link>.</p>}
          {err && <div className="form-error" role="alert">{err}</div>}
          <p className="acct-in__note">Use the Google account with the email you ordered with: your past orders appear automatically. By continuing you agree to our <Link to="/terms">terms</Link> and <Link to="/privacy">privacy policy</Link>.</p>
        </Reveal>
      </div>
      <div className="acct-in__art" aria-hidden="true">
        {shelf.map((b, i) => (
          <motion.div key={b.id} className="acct-in__book" style={{ zIndex: 3 - i }}
            initial={{ opacity: 0, y: 40, rotate: 0 }} animate={{ opacity: 1, y: i * 26, rotate: [-8, 4, 12][i], x: [-70, 0, 70][i] }} transition={{ duration: 0.9, ease: EASE, delay: 0.3 + i * 0.12 }}>
            <BookCover book={b} size="hero" />
          </motion.div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Signed in ---------------- */

function Dashboard({ data, onSignOut }: { data: AccountData; onSignOut: () => void }) {
  const [tab, setTab] = useState<'library' | 'orders'>(data.library.length ? 'library' : 'orders');
  const first = data.customer.name.split(' ')[0] || data.customer.email.split('@')[0];
  return (
    <div className="acct">
      <section className="wrap acct__head">
        <div className="acct__who">
          {data.customer.avatar
            ? <img src={data.customer.avatar} alt="" className="acct__avatar" referrerPolicy="no-referrer" />
            : <span className="acct__avatar acct__avatar--letter" aria-hidden="true">{first[0]?.toUpperCase()}</span>}
          <div>
            <div className="t-label">Your account</div>
            <h1 className="t-h1 acct__title">Hello, <span className="serif-i">{first}.</span></h1>
            <div className="acct__email">{data.customer.email} · <button type="button" className="text-link" onClick={onSignOut}>Sign out</button></div>
          </div>
        </div>
        <div className="acct__stats">
          <div><b>{data.library.length}</b><span>e-books &amp; journals</span></div>
          <div><b>{data.orders.length}</b><span>orders</span></div>
        </div>
      </section>

      <div className="wrap">
        <div className="tabs" role="tablist">
          {([['library', `Library · ${data.library.length}`], ['orders', `Orders · ${data.orders.length}`]] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={'tab' + (tab === k ? ' is-on' : '')} onClick={() => setTab(k)}>
              {label}
              {tab === k && <motion.span layoutId="acct-tab" className="tab__line" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} className="acct__panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3, ease: EASE }}>
            {tab === 'library' ? <Library items={data.library} /> : <Orders data={data} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Library({ items }: { items: LibraryItem[] }) {
  const { byId } = useCatalog();
  const [err, setErr] = useState<string | null>(null);
  if (!items.length) {
    return (
      <div className="empty">
        <div className="empty__title">No e-books yet.</div>
        <div className="empty__body">E-books and journal issues you buy appear here, ready to read.</div>
        <Link to={catalogueHref({ format: ['ebook'] })} className="btn btn--ink btn--md">Browse e-books <Arrow /></Link>
      </div>
    );
  }
  const read = async (item: LibraryItem) => {
    setErr(null);
    const win = window.open('', '_blank');
    try {
      const { url } = await accountApi<{ url: string }>(`/library/${item.itemId}/read`, { method: 'POST' });
      const href = new URL(url, window.location.origin).href;
      if (win) win.location.href = href; else window.location.href = href;
    } catch (e) {
      win?.close();
      setErr((e as Error).message);
    }
  };
  return (
    <>
      {err && <div className="form-error" role="alert">{err}</div>}
      <Stagger className="acct-lib">
        {items.map((i) => {
          const p = i.productId ? byId(i.productId) : undefined;
          return (
            <StaggerItem key={i.itemId} className="acct-book">
              <div className="acct-book__cover">{p ? <BookCover book={p} /> : <div className="cover"><div className="cover__title">{i.title}</div></div>}</div>
              <div className="acct-book__info">
                <div className="book-card__meta">{i.format} · order #{i.orderNumber}</div>
                {p ? <Link to={'/books/' + p.slug} className="acct-book__title">{i.title}</Link> : <span className="acct-book__title">{i.title}</span>}
                <div className="acct-book__actions">
                  <button type="button" className="btn btn--accent btn--sm" disabled={!i.canRead} onClick={() => read(i)}>Read</button>
                  {i.downloadUrl ? <a className="text-link" href={i.downloadUrl}>Download · {i.downloadsLeft} left</a> : <span className="acct-book__muted">{i.canRead ? 'No downloads left' : 'Access ended'}</span>}
                </div>
                {i.expiresAt && <div className="acct-book__muted">Available until {day(i.expiresAt)}</div>}
              </div>
            </StaggerItem>
          );
        })}
      </Stagger>
    </>
  );
}

function Orders({ data }: { data: AccountData }) {
  const navigate = useNavigate();
  if (!data.orders.length) {
    return (
      <div className="empty">
        <div className="empty__title">No orders yet.</div>
        <div className="empty__body">Orders placed with {data.customer.email} appear here. Ordered with another email? <Link to="/track" className="text-link">Track an order</Link></div>
        <Link to="/catalogue" className="btn btn--ink btn--md">Browse the store <Arrow /></Link>
      </div>
    );
  }
  return (
    <ul className="acct-orders">
      {data.orders.map((o) => (
        <li key={o.number}>
          <button type="button" className="acct-order" onClick={() => navigate(orderPath(o.number, o.token))}>
            <span className="acct-order__n">#{o.number}</span>
            <span className="acct-order__main">
              <b>{o.items.map((i) => i.title).join(', ')}</b>
              <span>{day(o.createdAt)} · {o.items.reduce((n, i) => n + i.quantity, 0)} item{o.items.reduce((n, i) => n + i.quantity, 0) === 1 ? '' : 's'}{o.invoice ? ` · invoice ${o.invoice}` : ''}</span>
            </span>
            <span className={'acct-order__status' + (/Refunded|Cancelled/.test(o.status) ? ' is-muted' : /Delivered|Complete/.test(o.status) ? ' is-done' : '')}>{o.status}</span>
            <span className="acct-order__total">{inr(o.total)}</span>
            <Arrow className="btn__arrow acct-order__arrow" />
          </button>
        </li>
      ))}
    </ul>
  );
}
