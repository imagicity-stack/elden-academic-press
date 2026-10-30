import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { adminApi, ApiError } from './api';
import { accessToken, devMode, devSignIn, LINK_TYPE, mfaEnroll, mfaState, mfaVerify, onAuthChange, sendReset, setPassword, signIn, signOut, supabase } from './auth';
import { Btn, Loading, ToastProvider } from './ui';
import './admin.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Orders = lazy(() => import('./pages/Orders'));
const OrderDetail = lazy(() => import('./pages/OrderDetail'));
const Products = lazy(() => import('./pages/Products'));
const ProductEditor = lazy(() => import('./pages/ProductEditor'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Customers = lazy(() => import('./pages/Customers'));
const Discounts = lazy(() => import('./pages/Discounts'));
const Enquiries = lazy(() => import('./pages/Enquiries'));
const StudyHubAdmin = lazy(() => import('./pages/StudyHub'));
const Settings = lazy(() => import('./pages/Settings'));

export interface Me { userId: string; email: string; name: string; role: 'owner' | 'manager' | 'staff'; aal: string; mfaRequired: boolean; mfaSatisfied: boolean }
interface Counts { toFulfil: number; attention: number; newEnquiries: number }

const AdminCtx = createContext<{ me: Me; counts: Counts | null; refreshCounts(): void }>(null!);
export const useMe = () => useContext(AdminCtx);
export const canManage = (me: Me) => me.role !== 'staff';

type Gate = { state: 'checking' } | { state: 'signin' } | { state: 'mfa' } | { state: 'password' } | { state: 'denied'; message: string } | { state: 'error'; message: string } | { state: 'ready'; me: Me };

export default function AdminApp() {
  const [gate, setGate] = useState<Gate>({ state: 'checking' });

  const check = useCallback(async () => {
    if (!(await accessToken())) { setGate({ state: 'signin' }); return; }
    try {
      const me = await adminApi<Me>('/me');
      if (LINK_TYPE && supabase) setGate({ state: 'password' });
      else setGate(me.mfaSatisfied ? { state: 'ready', me } : { state: 'mfa' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) setGate({ state: 'denied', message: e.message });
      else if (e instanceof ApiError && e.status === 401) setGate({ state: 'signin' });
      else setGate({ state: 'error', message: errorMessage(e) });
    }
  }, []);

  useEffect(() => {
    document.title = 'Admin — Elden Academic Press';
    const meta = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.appendChild(meta);
    const unsub = onAuthChange((session, event) => {
      if (event === 'PASSWORD_RECOVERY') setGate({ state: 'password' });
      else if (event === 'SIGNED_OUT' || !session) setGate({ state: 'signin' });
    });
    const onUnauth = () => setGate({ state: 'signin' });
    window.addEventListener('admin:unauthenticated', onUnauth);
    check();
    return () => { unsub(); window.removeEventListener('admin:unauthenticated', onUnauth); meta.remove(); };
  }, [check]);

  return (
    <ToastProvider>
      {gate.state === 'checking' && <div className="ad-gate"><Loading /></div>}
      {gate.state === 'signin' && <SignIn onDone={check} />}
      {gate.state === 'mfa' && <TwoStep onDone={check} />}
      {gate.state === 'password' && <SetPassword onDone={() => { history.replaceState(null, '', '/admin'); window.location.reload(); }} />}
      {gate.state === 'denied' && (
        <GateCard title="No access">
          <p>{gate.message}</p>
          <p>Ask the store owner to add you under Staff.</p>
          <Btn onClick={() => signOut().then(() => setGate({ state: 'signin' }))}>Sign out</Btn>
        </GateCard>
      )}
      {gate.state === 'error' && (
        <GateCard title="The store’s server isn’t ready">
          <p>{gate.message}</p>
          <p>Open the <a href="/api/health" target="_blank" rel="noreferrer">setup check</a> to see what still needs setting up.</p>
          <Btn onClick={() => { setGate({ state: 'checking' }); check(); }}>Try again</Btn>
        </GateCard>
      )}
      {gate.state === 'ready' && <Shell me={gate.me} />}
    </ToastProvider>
  );
}

/* ---------------- Sign-in screens ---------------- */

function GateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="ad-gate">
      <div className="ad-gate__card">
        <img src="/assets/elden-mark.png" alt="" className="ad-gate__mark" />
        <div className="ad-gate__brand">Elden Academic Press · Admin</div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(null);

  if (devMode) {
    return (
      <GateCard title="Developer sign-in">
        <p>Supabase isn’t configured, so this local copy uses a developer login with owner access. This option never exists on the live site.</p>
        <Btn kind="primary" onClick={() => { devSignIn(); onDone(); }}>Enter admin</Btn>
      </GateCard>
    );
  }
  if (!supabase) return <GateCard title="Sign-in not configured"><p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY for this deployment.</p></GateCard>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'reset') { await sendReset(email); setMsg({ text: 'If that email has access, a reset link is on its way.', ok: true }); }
      else { await signIn(email, password); onDone(); }
    } catch (err) { setMsg({ text: errorMessage(err) }); }
    finally { setBusy(false); }
  };
  return (
    <GateCard title={mode === 'reset' ? 'Reset password' : 'Sign in'}>
      <form className="ad-form" onSubmit={submit}>
        <label className="ad-field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus /></label>
        {mode === 'signin' && <label className="ad-field"><span>Password</span><input type="password" value={password} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required /></label>}
        {msg && <div className={msg.ok ? 'ad-ok' : 'ad-error'}>{msg.text}</div>}
        <Btn kind="primary" type="submit" busy={busy}>{mode === 'reset' ? 'Send reset link' : 'Sign in'}</Btn>
        <button type="button" className="ad-link" onClick={() => { setMode(mode === 'reset' ? 'signin' : 'reset'); setMsg(null); }}>
          {mode === 'reset' ? 'Back to sign in' : 'Forgot your password?'}
        </button>
      </form>
    </GateCard>
  );
}

function TwoStep({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<{ factorId: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    mfaState()
      .then(async (s) => setSetup(s.enrolled ? { factorId: s.factorId! } : await mfaEnroll()))
      .catch((e) => setErr(errorMessage(e)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setBusy(true); setErr(null);
    try { await mfaVerify(setup.factorId, code); onDone(); }
    catch (e2) { setErr(errorMessage(e2)); setBusy(false); }
  };
  return (
    <GateCard title={setup?.qr ? 'Set up two-step verification' : 'Enter your code'}>
      {setup?.qr ? (
        <>
          <p>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…), then enter the 6-digit code it shows. You’ll need the app each time you sign in.</p>
          <img src={setup.qr} alt="QR code for your authenticator app" className="ad-qr" />
          <p className="ad-muted">Can’t scan? Enter this key in the app: <code>{setup.secret}</code></p>
        </>
      ) : <p>Open your authenticator app and enter the 6-digit code for Elden admin.</p>}
      <form className="ad-form" onSubmit={submit}>
        <label className="ad-field"><span>6-digit code</span><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus /></label>
        {err && <div className="ad-error">{err}</div>}
        <Btn kind="primary" type="submit" busy={busy} disabled={!setup}>Verify</Btn>
        <button type="button" className="ad-link" onClick={() => signOut()}>Sign out</button>
      </form>
    </GateCard>
  );
}

function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    if (pw !== pw2) return setErr('The passwords don’t match.');
    setBusy(true);
    try { await setPassword(pw); onDone(); } catch (e2) { setErr(errorMessage(e2)); setBusy(false); }
  };
  return (
    <GateCard title={LINK_TYPE === 'invite' ? 'Welcome — choose a password' : 'Choose a new password'}>
      <form className="ad-form" onSubmit={submit}>
        <label className="ad-field"><span>New password</span><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required autoFocus /></label>
        <label className="ad-field"><span>Repeat password</span><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required /></label>
        {err && <div className="ad-error">{err}</div>}
        <Btn kind="primary" type="submit" busy={busy}>Save password</Btn>
      </form>
    </GateCard>
  );
}

/* ---------------- Layout ---------------- */

const NAV: { to: string; label: string; icon: string; count?: keyof Counts; owner?: boolean; end?: boolean }[] = [
  { to: '/admin', label: 'Dashboard', icon: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v5h7V3zM3 21h7v-5H3z', end: true },
  { to: '/admin/orders', label: 'Orders', icon: 'M6 2h12l2 5v14H4V7zM4 7h16M9 11h6', count: 'toFulfil' },
  { to: '/admin/products', label: 'Products', icon: 'M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3zM18 20V7M8 8h6' },
  { to: '/admin/inventory', label: 'Inventory', icon: 'M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10' },
  { to: '/admin/customers', label: 'Customers', icon: 'M16 19a4 4 0 0 0-8 0M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM20 19a3 3 0 0 0-3-3M4 19a3 3 0 0 1 3-3' },
  { to: '/admin/discounts', label: 'Discounts', icon: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01' },
  { to: '/admin/enquiries', label: 'Enquiries', icon: 'M4 5h16v11H8l-4 4zM8 9h8M8 12h5', count: 'newEnquiries' },
  { to: '/admin/study-hub', label: 'Study Hub', icon: 'M12 4v12M7 11l5 5 5-5M5 20h14' },
  { to: '/admin/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z' },
];

function Shell({ me }: { me: Me }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [menu, setMenu] = useState(false);
  const { pathname } = useLocation();
  const refreshCounts = useCallback(() => {
    adminApi<Counts>('/dashboard').then((d) => setCounts({ toFulfil: d.toFulfil, attention: d.attention, newEnquiries: d.newEnquiries })).catch(() => {});
  }, []);
  useEffect(() => { refreshCounts(); const t = setInterval(refreshCounts, 120_000); return () => clearInterval(t); }, [refreshCounts]);
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [pathname]);

  return (
    <AdminCtx.Provider value={{ me, counts, refreshCounts }}>
      <div className="ad-shell">
        <aside className={'ad-side' + (menu ? ' is-open' : '')}>
          <div className="ad-side__brand">
            <img src="/assets/elden-mark-light.png" alt="" />
            <div><b>ELDEN</b><span>Store admin</span></div>
            <button type="button" className="ad-side__menu" onClick={() => setMenu(!menu)} aria-expanded={menu}>{menu ? 'Close' : 'Menu'}</button>
          </div>
          <nav className="ad-nav">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'ad-nav__link' + (isActive ? ' is-active' : '')}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d={n.icon} /></svg>
                <span>{n.label}</span>
                {n.count && counts?.[n.count] ? <em>{counts[n.count]}</em> : null}
              </NavLink>
            ))}
          </nav>
          <div className="ad-side__foot">
            <a href="/" target="_blank" rel="noopener">View store ↗</a>
            <div className="ad-me"><b>{me.name || me.email}</b><span>{me.email} · {me.role}</span></div>
            <button type="button" onClick={() => signOut().then(() => window.location.reload())}>Sign out</button>
          </div>
        </aside>
        <main className="ad-main">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/admin" element={<Dashboard />} />
              <Route path="/admin/orders" element={<Orders />} />
              <Route path="/admin/orders/:id" element={<OrderDetail />} />
              <Route path="/admin/products" element={<Products />} />
              <Route path="/admin/products/new" element={<ProductEditor />} />
              <Route path="/admin/products/:id" element={<ProductEditor />} />
              <Route path="/admin/inventory" element={<Inventory />} />
              <Route path="/admin/customers" element={<Customers />} />
              <Route path="/admin/customers/:id" element={<Customers />} />
              <Route path="/admin/discounts" element={<Discounts />} />
              <Route path="/admin/enquiries" element={<Enquiries />} />
              <Route path="/admin/study-hub" element={<StudyHubAdmin />} />
              <Route path="/admin/settings" element={<Settings />} />
              <Route path="/admin/settings/:tab" element={<Settings />} />
              <Route path="*" element={<div className="ad-page"><h1 className="ad-page__title">Page not found</h1></div>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </AdminCtx.Provider>
  );
}
