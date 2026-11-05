// /invite/:token — a child opens the login link their parent created and signs in
// with their own Google account.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { accountToken, authApi, optionalAuthApi, signOut } from '../store/account';
import { noteAccountType } from '../store/profile';
import { GoogleSignIn } from '../components/GoogleSignIn';

export function Invite() {
  const { token = '' } = useParams();
  const [info, setInfo] = useState<{ status: string; firstName: string | null } | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    setSignedIn(Boolean(await accountToken()));
    try { setInfo(await optionalAuthApi<{ status: string; firstName: string | null }>(`/invites/${encodeURIComponent(token)}`)); } catch (e) { setErr(errorMessage(e)); }
  }, [token]);
  useEffect(() => { document.title = 'Your login — Elden Academic Press'; load(); }, [load]);

  const claim = async () => {
    setBusy(true); setErr(null);
    try { await authApi(`/invites/${encodeURIComponent(token)}/claim`, { method: 'POST' }); noteAccountType('student'); setDone(true); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const shell = (body: ReactNode) => <section className="wrap page-narrow cp-step">{body}</section>;
  if (!info && !err) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  if (done) return shell(<><h1 className="t-h2">Welcome, {info?.firstName}!</h1><p className="t-lead">Your login is ready. You can register for competitions and upload your entries.</p><div><Link to="/competitions" className="btn btn--accent btn--lg">See competitions</Link></div></>);
  if (!info || info.status !== 'open') return shell(<><h1 className="t-h2">This link doesn’t work</h1><p className="t-lead">{err ?? 'It has run out or was already used. Ask your parent to create a new one from their account.'}</p></>);
  return shell(
    <>
      <div className="t-label">Your own login</div>
      <h1 className="t-h2">Hi {info.firstName}!</h1>
      <p className="t-lead">Your parent set this up for you. Sign in with <b>your own</b> Google account, not your parent’s.</p>
      {!signedIn ? <GoogleSignIn onDone={load} /> : (
        <div className="cp-actions">
          <button type="button" className="btn btn--accent btn--lg" onClick={claim} disabled={busy}>{busy ? 'Linking…' : 'Use this Google account'}</button>
          <button type="button" className="text-link" onClick={async () => { await signOut(); load(); }}>Use a different account</button>
        </div>
      )}
      {err && <div className="form-error" role="alert">{err}</div>}
    </>,
  );
}
