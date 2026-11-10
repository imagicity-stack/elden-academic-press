import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ga } from '../ga';
import { newEventId, rememberUser, track } from '../meta';
import { api } from '../store/api';
import { useSubmit } from '../store/useSubmit';
import { Arrow } from './motion';

type Source = 'footer' | 'newsletter-page' | 'home';

/**
 * Newsletter sign-up: name, email, mobile and a confirmation box (ticked by default).
 * Sending the form is the consent, so there's no confirmation email; a welcome email with an unsubscribe link follows.
 */
export function NewsletterForm({ source, dark = false }: { source: Source; dark?: boolean }) {
  const [result, setResult] = useState<'already' | 'subscribed' | null>(null);
  // Ticked by default; unticking it stops the sign-up.
  const [agree, setAgree] = useState(true);
  // Permission to call or WhatsApp about new books: also ticked by default.
  const [callOk, setCallOk] = useState(true);
  const { busy, error, sent, setSent, submit } = useSubmit(async (form) => {
    const f = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const eventId = newEventId();
    const r = await api<{ status: 'already' | 'subscribed' }>('/newsletter/subscribe', {
      body: { name: f.name || undefined, email: f.email, phone: f.phone, source, consent: agree, callConsent: callOk, website: f.website || undefined },
      headers: { 'X-Meta-Event-Id': eventId },
    });
    rememberUser({ email: f.email, phone: f.phone, name: f.name });
    if (r.status === 'subscribed') {
      track('Subscribe', { content_name: 'Newsletter' }, { eventId });
      ga('newsletter_signup', { method: source });
    }
    setResult(r.status);
  });

  if (sent) {
    return (
      <div className={'nl-done' + (dark ? ' nl-done--dark' : '')} role="status">
        <div className="nl-done__title">{result === 'already' ? 'You’re already on the list.' : 'You’re subscribed.'}</div>
        <p>{result === 'already'
          ? 'We’ll keep sending news about new books and offers to that address.'
          : 'Thanks! News about new books, sample papers and offers is on its way to your inbox.'}</p>
        <button type="button" className="text-link" onClick={() => { setSent(false); setResult(null); setAgree(true); setCallOk(true); }}>Use another address</button>
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
      <label className="tick nl-form__agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
        <span className="tick__box" aria-hidden="true" />
        <span>Subscribe to newsletter</span>
      </label>
      <label className="tick nl-form__agree">
        <input type="checkbox" checked={callOk} onChange={(e) => setCallOk(e.target.checked)} />
        <span className="tick__box" aria-hidden="true" />
        <span>Subscribe to calls</span>
      </label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      {error && <div className="form-error" role="alert">{error}</div>}
      <p className="nl-form__note">A few emails a month. See our <Link to="/privacy">privacy policy</Link>.</p>
    </form>
  );
}
