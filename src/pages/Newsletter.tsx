import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../store/api';
import { NewsletterForm } from '../components/NewsletterForm';
import { Arrow, Reveal, SplitWords } from '../components/motion';

/**
 * /newsletter: the sign-up page, and where the links in our emails land:
 *   ?confirm=1&e=&t=      confirms a new subscription
 *   ?unsubscribe=1&e=&t=  asks before unsubscribing (link scanners must not unsubscribe people)
 */
// Before launch this page runs on its own (email links must work), so its links load full pages.
const Standalone = createContext(false);
function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  return useContext(Standalone) ? <a href={to} className={className}>{children}</a> : <RouterLink to={to} className={className}>{children}</RouterLink>;
}

export function NewsletterStandalone() {
  return <Standalone.Provider value={true}><Newsletter /></Standalone.Provider>;
}

export function Newsletter() {
  const standalone = useContext(Standalone);
  const [sp] = useSearchParams();
  const email = sp.get('e') ?? '';
  const token = sp.get('t') ?? '';
  useEffect(() => { document.title = 'Newsletter — Elden Academic Press'; }, []);

  if (sp.get('confirm') && email && token) return <Confirm email={email} token={token} />;
  if (sp.get('unsubscribe') && email && token) return <Unsubscribe email={email} token={token} />;
  return (
    <div className="wrap page-narrow nl-page">
      <div className="t-label">Newsletter</div>
      <h1 className="t-display nl-page__title"><SplitWords text="New books," /> <span className="serif-i">first.</span></h1>
      <Reveal delay={0.25}>
        <p className="t-lead">New titles the week they’re published, free sample papers before exams, and the occasional offer. A few emails a month, and you can leave any time.</p>
      </Reveal>
      <Reveal delay={0.35} className="form-card"><NewsletterForm source="newsletter-page" /></Reveal>
      {!standalone && <p className="form-note">Have an account? You can also turn the newsletter on or off from <Link to="/account" className="text-link">your account</Link>.</p>}
    </div>
  );
}

function Result({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="wrap page-narrow nl-page">
      <div className="t-label">Newsletter</div>
      <h1 className="t-h2">{title}</h1>
      {children}
    </div>
  );
}

function Confirm({ email, token }: { email: string; token: string }) {
  const standalone = useContext(Standalone);
  const [state, setState] = useState<'busy' | 'done' | string>('busy');
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    api('/newsletter/confirm', { body: { email, token } }).then(() => setState('done'), (e) => setState(errorMessage(e)));
  }, [email, token]);

  if (state === 'busy') return <Result title="Confirming…"><p className="t-lead">One moment.</p></Result>;
  if (state === 'done') {
    return (
      <Result title="You’re subscribed.">
        <p className="t-lead">Thanks for confirming. News about new books and offers will come to <strong>{email}</strong>.</p>
        <div><Link to={standalone ? '/' : '/catalogue'} className="btn btn--ink btn--lg">{standalone ? 'Back to the site' : <>Browse the store <Arrow /></>}</Link></div>
      </Result>
    );
  }
  return (
    <Result title="That link didn’t work.">
      <p className="t-lead">{state}</p>
      <div><Link to="/newsletter" className="btn btn--ink btn--lg">Subscribe again</Link></div>
    </Result>
  );
}

function Unsubscribe({ email, token }: { email: string; token: string }) {
  const [state, setState] = useState<'ask' | 'busy' | 'done' | { error: string }>('ask');
  const leave = () => {
    setState('busy');
    api('/newsletter/unsubscribe', { body: { email, token } }).then(() => setState('done'), (e) => setState({ error: errorMessage(e) }));
  };

  if (state === 'done') {
    return (
      <Result title="You’re unsubscribed.">
        <p className="t-lead"><strong>{email}</strong> won’t get any more newsletters from us. Order emails, like receipts and delivery updates, still arrive as usual.</p>
        <p className="form-note">Changed your mind? <Link to="/newsletter" className="text-link">Subscribe again</Link></p>
      </Result>
    );
  }
  return (
    <Result title="Unsubscribe from the newsletter?">
      <p className="t-lead">We’ll stop sending news about new books and offers to <strong>{email}</strong>.</p>
      {typeof state === 'object' && <div className="form-error" role="alert">{state.error}</div>}
      <div className="form-submit-row">
        <button type="button" className="btn btn--ink btn--lg" disabled={state === 'busy'} onClick={leave}>{state === 'busy' ? 'Unsubscribing…' : 'Unsubscribe'}</button>
        <Link to="/" className="text-link">Keep me subscribed</Link>
      </div>
    </Result>
  );
}
