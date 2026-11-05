import { useEffect, useRef, useState, type FormEvent } from 'react';
import { accountsDevMode, accountsEnabled, devSignIn, googleButtonAvailable, renderGoogleButton, signInWithGoogle } from '../store/account';

/** Google sign-in on any page (e.g. a competition). Stays on this page. */
export function GoogleSignIn({ onDone, note }: { onDone: () => void; note?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [devEmail, setDevEmail] = useState('');
  const [fallback, setFallback] = useState(!googleButtonAvailable);
  const slot = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!googleButtonAvailable || !slot.current) return;
    let current = true;
    renderGoogleButton(slot.current, onDone, setErr, () => current).catch(() => current && setFallback(true));
    return () => { current = false; };
  }, [onDone]);

  const google = async () => {
    setBusy(true); setErr(null);
    try { await signInWithGoogle(location.pathname + location.search); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const dev = (e: FormEvent) => { e.preventDefault(); devSignIn(devEmail); onDone(); };

  return (
    <div className="gsi">
      {googleButtonAvailable && !fallback && <div ref={slot} className="acct-gsi" />}
      {accountsEnabled && fallback && (
        <button type="button" className="btn btn--outline btn--lg acct-google" onClick={google} disabled={busy}>
          {busy ? 'Opening Google…' : 'Continue with Google'}
        </button>
      )}
      {accountsDevMode && (
        <form className="acct-dev" onSubmit={dev}>
          <input className="input" type="email" required value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="Email" aria-label="Email" />
          <button type="submit" className="btn btn--ink btn--md">Developer sign-in</button>
        </form>
      )}
      {!accountsEnabled && !accountsDevMode && <p className="form-notice">Sign-in isn’t available right now.</p>}
      {err && <div className="form-error" role="alert">{err}</div>}
      {note && <p className="gsi__note">{note}</p>}
    </div>
  );
}
