// /competitions/:slug/register — one step from the saved profile: pick the child (or
// yourself), see the group, answer this competition's questions. Then the confirmation.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../store/api';
import { authApi, optionalAuthApi } from '../store/account';
import { whatsappLink } from '../store/profile';
import { arrivalData, type CompetitionPage, type MeHere, type RegistrationView } from '../store/competitions';
import { istDateTime } from '../shared/competition';
import { Countdown } from '../components/Countdown';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { ResourceList } from './CompetitionDetail';

export const regCode = (id: string) => `R-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export function CompetitionRegister() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [c, setC] = useState<CompetitionPage | null>(null);
  const [me, setMe] = useState<MeHere | null>(null);
  const [studentId, setStudentId] = useState(params.get('student') ?? '');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const load = () => {
    optionalAuthApi<CompetitionPage>(`/competitions/${slug}`).then(setC).catch((e) => setErr(e));
    optionalAuthApi<MeHere>(`/competitions/${slug}/me`).then(setMe).catch(() => setMe({ signedIn: false }));
  };
  useEffect(() => { document.title = 'Register — Elden Academic Press'; load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!c || !me) return <div className="wrap page-narrow" aria-busy="true">{err ? <div className="form-error">{errorMessage(err)}</div> : <div className="skeleton skeleton--hero" />}</div>;
  const shell = (body: ReactNode) => <section className="wrap page-narrow cp-step"><div className="crumbs"><Link to={`/competitions/${slug}`}>{c.title}</Link><span>/</span><span className="crumbs__here">Register</span></div>{body}</section>;
  if (!me.signedIn) return shell(<><h1 className="t-h2">Sign in to register</h1><GoogleSignIn onDone={load} /></>);
  if (!me.account?.type || !me.account.completed) return shell(<><h1 className="t-h2">One quick step first</h1><p className="t-lead">Tell us who is using this account.</p><div><Link className="btn btn--accent btn--lg" to={`/onboarding?next=/competitions/${slug}/register`}>Complete my profile</Link></div></>);

  const candidates = (me.students ?? []).filter((s) => !s.registration);
  const chosen = (me.students ?? []).find((s) => s.id === studentId) ?? (candidates.length === 1 ? candidates[0] : undefined);
  const set = (k: string, v: unknown) => setAnswers((a) => ({ ...a, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!chosen) return;
    setBusy(true); setErr(null);
    try {
      const { ref, utm } = arrivalData();
      const r = await authApi<{ registrationId: string }>(`/competitions/${slug}/register`, { body: { studentId: chosen.id, answers, utm, ref } });
      navigate(`/competitions/${slug}/registered/${r.registrationId}`, { replace: true });
    } catch (x) {
      if (x instanceof ApiError && x.code === 'already_registered' && x.details && typeof x.details === 'object' && 'registrationId' in x.details) {
        navigate(`/competitions/${slug}/registered/${(x.details as { registrationId: string }).registrationId}`, { replace: true });
        return;
      }
      setErr(x);
    } finally { setBusy(false); }
  };
  const fieldErr = (k: string) => (err instanceof ApiError && err.details && typeof err.details === 'object' ? (err.details as Record<string, string[]>)[k]?.[0] : undefined);

  return shell(
    <form className="cp-form" onSubmit={submit}>
      <div className="t-label">Register</div>
      <h1 className="t-h2">{c.title}</h1>
      {me.account.type === 'parent' && (me.students ?? []).length > 1 && (
        <fieldset className="cp-card">
          <legend className="cp-h3">Who is taking part?</legend>
          {(me.students ?? []).map((s) => (
            <label key={s.id} className="tick">
              <input type="radio" name="student" checked={chosen?.id === s.id} disabled={Boolean(s.registration) || Boolean(s.notEligible)} onChange={() => setStudentId(s.id)} />
              <span className="tick__box" aria-hidden="true" />
              <span><b>{s.firstName}</b><small>{s.registration ? 'Already registered' : s.notEligible ?? `Class ${s.classGrade} · ${s.group?.name}`}</small></span>
            </label>
          ))}
        </fieldset>
      )}
      {chosen && (chosen.notEligible
        ? <div className="form-notice">{chosen.notEligible}</div>
        : chosen.registration ? <div className="form-notice">{chosen.firstName} is already registered. <Link to={`/competitions/${slug}/registered/${chosen.registration.id}`}>See the registration</Link></div>
          : <div className="cp-card"><b>{chosen.relation === 'self' ? 'You' : chosen.firstName} · Class {chosen.classGrade}</b><span className="cp-muted">{chosen.group?.name}{chosen.group?.formatNote ? ` · ${chosen.group.formatNote}` : ''}</span></div>)}
      {chosen && !chosen.notEligible && !chosen.registration && c.fields.map((q) => (
        <label key={q.key} className={'field' + (fieldErr(q.key) ? ' has-error' : '')}>
          {q.type !== 'checkbox' && <>{q.label}{q.required ? '' : ' (optional)'}</>}
          {q.type === 'select' && <select className="input" value={String(answers[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} required={q.required}><option value="">Choose…</option>{q.options.map((o) => <option key={o}>{o}</option>)}</select>}
          {q.type === 'multiselect' && <div className="cp-consents">{q.options.map((o) => {
            const cur = (answers[q.key] as string[] | undefined) ?? [];
            return <label key={o} className="tick"><input type="checkbox" checked={cur.includes(o)} onChange={(e) => set(q.key, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} /><span className="tick__box" aria-hidden="true" /><span>{o}</span></label>;
          })}</div>}
          {q.type === 'text' && <input className="input" value={String(answers[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} required={q.required} maxLength={300} />}
          {q.type === 'number' && <input className="input" type="number" inputMode="numeric" value={String(answers[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} required={q.required} />}
          {q.type === 'textarea' && <textarea className="input input--area" rows={4} value={String(answers[q.key] ?? '')} onChange={(e) => set(q.key, e.target.value)} required={q.required} maxLength={3000} />}
          {q.type === 'checkbox' && <span className="tick"><input type="checkbox" checked={answers[q.key] === true} onChange={(e) => set(q.key, e.target.checked)} required={q.required} /><span className="tick__box" aria-hidden="true" /><span>{q.label}</span></span>}
          {q.helpText && <small className="cp-muted">{q.helpText}</small>}
          {fieldErr(q.key) && <span className="field__error">{fieldErr(q.key)}</span>}
        </label>
      ))}
      {Boolean(err) && <div className="form-error" role="alert">{errorMessage(err)}</div>}
      {chosen && !chosen.notEligible && !chosen.registration && <div><button type="submit" className="btn btn--accent btn--lg" disabled={busy}>{busy ? 'Registering…' : `Register${chosen.relation === 'parent' ? ` ${chosen.firstName}` : ''}`}</button></div>}
      <p className="cp-muted">Free. Your details come from your profile: nothing to type again.</p>
    </form>,
  );
}

/** /competitions/:slug/registered/:id — the confirmation: ID, deadline, resources, referral link (parents), book suggestion (parents). */
export function RegistrationDone() {
  const { slug = '', id = '' } = useParams();
  const [r, setR] = useState<RegistrationView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    document.title = 'Registered — Elden Academic Press';
    authApi<RegistrationView>(`/my/registrations/${id}`).then(setR).catch((e) => setErr(errorMessage(e)));
  }, [id]);
  if (err) return <section className="wrap page-narrow cp-step"><h1 className="t-h2">We couldn’t open this registration</h1><p className="t-lead">{err}</p><div><Link className="btn btn--ink btn--md" to="/account/competitions">My entries</Link></div></section>;
  if (!r) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  const c = r.competition;
  const who = r.relation === 'self' ? 'You’re' : `${r.student.firstName} is`;
  const submitted = r.submissions.find((s) => s.status === 'submitted');
  return (
    <section className="wrap page-narrow cp-step">
      <div className="crumbs"><Link to={`/competitions/${slug}`}>{c.title}</Link><span>/</span><span className="crumbs__here">Registered</span></div>
      <div className="t-label">Registration confirmed</div>
      <h1 className="t-h2">{who} registered!</h1>
      <div className="cp-card cp-kv">
        <div><span>Registration ID</span><b>{regCode(r.id)}</b></div>
        {r.group && <div><span>Group</span><b>{r.group.name}{r.group.formatNote ? ` · ${r.group.formatNote}` : ''}</b></div>}
        {r.deadline && <div><span>Last date for entries</span><b>{r.deadline.label}</b></div>}
        {submitted && <div><span>Entry</span><b>{submitted.entryCode} · received {istDateTime(submitted.submittedAt)}</b></div>}
      </div>
      {r.deadline && <Countdown to={r.deadline.at} label="Time left to submit" />}
      {c.submissionRequired && (
        <div className="cp-actions">
          {r.canSubmit ? <Link className="btn btn--accent btn--lg" to={`/competitions/${slug}/entry/${r.id}`}>{submitted ? 'View or edit the entry' : 'Upload the entry'}</Link>
            : c.status === 'SUBMISSIONS_SOON' || c.status === 'REGISTRATION_OPEN' ? <p className="cp-muted">Uploads open {istDateTime(c.dates.submissionOpensAt)}. We’ll be here.</p> : null}
          <Link className="text-link" to="/account/competitions">My entries</Link>
        </div>
      )}
      {r.resources.length > 0 && <><h2 className="cp-h3">Resources</h2><ResourceList resources={r.resources} /></>}
      {r.referralUrl && (
        <div className="cp-card">
          <b>Invite friends to join</b>
          <p className="cp-muted">Know a child who’d love this? Share your link.</p>
          <input className="input" readOnly value={r.referralUrl} onFocus={(e) => e.target.select()} aria-label="Your link" />
          <div className="cp-actions">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => { navigator.clipboard?.writeText(r.referralUrl!); setCopied(true); }}>{copied ? 'Copied' : 'Copy link'}</button>
            <a className="btn btn--accent btn--sm cp-wa" target="_blank" rel="noopener noreferrer" href={whatsappLink(`${c.title} by Elden Academic Press: ${c.tagline || 'a free competition for students'}. Register here: ${r.referralUrl}`)}>Share on WhatsApp</a>
          </div>
        </div>
      )}
      {r.upsell && (
        <a className="cp-card cp-upsell" href={r.upsell.url}>
          {r.upsell.coverUrl && <img src={r.upsell.coverUrl} alt="" />}
          <div><b>{r.upsell.headline}</b>{r.upsell.title && <span className="cp-muted">{r.upsell.title}</span>}<span className="text-link">Take a look</span></div>
        </a>
      )}
    </section>
  );
}
