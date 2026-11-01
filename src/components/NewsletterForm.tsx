import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../store/api';
import { useSubmit } from '../store/useSubmit';
import { Arrow } from './motion';

type Source = 'footer' | 'newsletter-page' | 'home';

/**
 * Newsletter sign-up: name, email and mobile. New addresses get a
 * confirmation email first (double opt-in), so nobody is subscribed by
 * someone else typing their address.
 */
export function NewsletterForm({ source, dark = false }: { source: Source; dark?: boolean }) {
  const [result, setResult] = useState<'pending' | 'subscribed' | null>(null);
  const { busy, error, sent, setSent, submit } = useSubmit(async (form) => {
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const r = await api<{ status: 'pending' | 'subscribed' }>('/newsletter/subscribe', {
      body: { name: f.name || undefined, email: f.email, phone: f.phone, source, website: f.website || undefined },
    });
    setResult(r.status);
  });

  if (sent) {
    return (
      <div className={'nl-done' + (dark ? ' nl-done--dark' : '')} role="status">
        <div className="nl-done__title">{result === 'subscribed' ? 'You’re already on the list.' : 'Check your inbox.'}</div>
        <p>{result === 'subscribed'
          ? 'We’ll keep sending news about new books and offers to that address.'
          : 'We’ve sent you an email with a link. Click it to confirm, and you’re in.'}</p>
        <button type="button" className="text-link" onClick={() => { setSent(false); setResult(null); }}>Use another address</button>
      </div>
    );
  }

  return (
    <form className={'nl-form' + (dark ? ' nl-form--dark' : '')} onSubmit={submit}>
      <div className="nl-form__fields">
        <label className="nl-field"><span>Name</span><input className="input" name="name" autoComplete="name" maxLength={120} /></label>
        <label className="nl-field"><span>Email</span><input className="input" name="email" type="email" autoComplete="email" required maxLength={200} /></label>
        <label className="nl-field"><span>Mobile</span><input className="input" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="10-digit number" required maxLength={16} /></label>
        <button type="submit" className={'btn btn--lg ' + (dark ? 'btn--yellow' : 'btn--ink')} disabled={busy}>{busy ? 'Subscribing…' : <>Subscribe <Arrow /></>}</button>
      </div>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      {error && <div className="form-error" role="alert">{error}</div>}
      <p className="nl-form__note">New books, sample papers and offers, a few times a month. Unsubscribe from any email. See our <Link to="/privacy">privacy policy</Link>.</p>
    </form>
  );
}
