// /competitions: every competition built in src/shared/competitions.ts, open ones first.
// /competitions/<slug>: its page, with registration (one person or a group) after signing
// in with Google and completing the profile once. No approval from anyone.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authApi, useAccount, type Profile } from '../store/account';
import { errorMessage, ApiError } from '../store/api';
import { CLASS_OPTIONS, findCompetition, istDateTime, listedCompetitions, phaseOf, PHASE_LABEL, type Competition, type Field, type Phase } from '../shared/competitions';
import { Countdown } from '../components/Countdown';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { ProfileForm } from '../components/ProfileForm';
import { RichText } from '../components/RichText';
import { Reveal, SplitWords } from '../components/motion';
import { NotFound } from './NotFound';
import { DoomsdayPage } from './doomsday/DoomsdayPage';

const ORDER: Record<Phase, number> = { open: 0, upcoming: 1, closed: 2 };

export function CompetitionsPage() {
  useEffect(() => { document.title = 'Competitions — Elden Academic Press'; }, []);
  const list = listedCompetitions().slice().sort((a, b) => ORDER[phaseOf(a)] - ORDER[phaseOf(b)]);
  return (
    <div className="comp">
      <section className="wrap comp__head">
        <div className="t-label">Elden Academic Press</div>
        <h1 className="t-h1"><SplitWords text="Competitions" /></h1>
        <Reveal delay={0.2}><p className="t-lead">Contests for students and schools. Sign in with Google, register on your own or as a group, and you’re in.</p></Reveal>
      </section>
      <section className="wrap comp__list">
        {list.length === 0 ? (
          <div className="empty">
            <div className="empty__title">No competitions right now.</div>
            <p className="empty__body">New competitions are announced here and in our newsletter. Check back soon.</p>
            <Link to="/newsletter" className="btn btn--ink btn--md">Get the newsletter</Link>
          </div>
        ) : (
          <ul className="comp__cards">
            {list.map((c) => {
              const phase = phaseOf(c);
              return (
                <li key={c.slug}>
                  <Link to={`/competitions/${c.slug}`} className="comp-card">
                    {c.image && <img className="comp-card__img" src={c.image} alt="" loading="lazy" />}
                    <div className="comp-card__body">
                      <span className={'comp-badge comp-badge--' + phase}>{PHASE_LABEL[phase]}</span>
                      <h2 className="comp-card__title">{c.title}</h2>
                      <p className="comp-card__tag">{c.tagline}</p>
                      <span className="comp-card__when">
                        {phase === 'upcoming' ? `Opens ${istDateTime(c.opensAt)}` : phase === 'open' ? `Register by ${istDateTime(c.closesAt)}` : 'Registration closed'}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function CompetitionPage() {
  const { slug = '' } = useParams();
  const c = findCompetition(slug);
  useEffect(() => { if (c) document.title = `${c.title} — Elden Academic Press`; }, [c]);
  if (!c) return <NotFound />;
  if (c.team) return <DoomsdayPage c={c as Competition & { team: NonNullable<Competition['team']> }} />;
  const phase = phaseOf(c);
  return (
    <div className="comp">
      <section className="wrap comp__hero">
        <div className="comp__hero-text">
          <Link to="/competitions" className="comp__back">← All competitions</Link>
          <span className={'comp-badge comp-badge--' + phase}>{PHASE_LABEL[phase]}</span>
          <h1 className="t-h1 comp__title">{c.title}</h1>
          <p className="t-lead">{c.tagline}</p>
          {phase === 'open' && <Countdown to={c.closesAt} label="Registration closes in" />}
          {phase === 'upcoming' && <Countdown to={c.opensAt} label="Opens in" />}
        </div>
        {c.image && <img className="comp__hero-img" src={c.image} alt="" />}
      </section>
      <div className="wrap comp__layout">
        <article className="comp__about">
          <RichText text={c.about} className="comp__text" />
          {c.facts && c.facts.length > 0 && (
            <dl className="comp__facts">
              {c.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
              <div><dt>Registration</dt><dd>{istDateTime(c.opensAt)} to {istDateTime(c.closesAt)}</dd></div>
            </dl>
          )}
          {c.prizes && c.prizes.length > 0 && <><h2 className="comp__h2">Prizes</h2><ul className="comp__bullets">{c.prizes.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {c.rules && c.rules.length > 0 && <><h2 className="comp__h2">Rules</h2><ol className="comp__bullets">{c.rules.map((x) => <li key={x}>{x}</li>)}</ol></>}
        </article>
        <aside className="comp__side" id="register">
          <Register c={c} phase={phase} />
        </aside>
      </div>
    </div>
  );
}

interface Mine { id: string; mode: 'individual' | 'group'; groupName: string; people: string[]; createdAt: string }

/** Sign in → profile → the form → done (and the list of what this account has registered). */
function Register({ c, phase }: { c: Competition; phase: Phase }) {
  const { state, reload } = useAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [adding, setAdding] = useState(false);
  const signedIn = state.status === 'ready';
  useEffect(() => { if (state.status === 'ready') setProfile(state.data.profile); }, [state]);
  useEffect(() => {
    if (!signedIn) return;
    authApi<{ items: Mine[] }>(`/competitions/${c.slug}/mine`).then((r) => setMine(r.items), () => setMine([]));
  }, [signedIn, c.slug]);

  let body;
  if (phase === 'upcoming') body = <p className="comp-note">Registration opens on <b>{istDateTime(c.opensAt)}</b>.</p>;
  else if (state.status === 'loading' || (signedIn && (!profile || !mine))) body = <div className="skeleton comp-skel" aria-busy="true" />;
  else if (state.status === 'error') body = <div className="form-error" role="alert">{state.message}</div>;
  else if (!signedIn) {
    body = phase === 'closed' ? <p className="comp-note">Registration has closed.</p> : (
      <>
        <p className="comp-note">Sign in with Google to register. It takes a few seconds.</p>
        <GoogleSignIn onDone={reload} />
      </>
    );
  } else if (mine!.length > 0 && !adding) {
    const max = c.maxPerAccount ?? 10;
    body = (
      <>
        <div className="comp-done">✓ You’re registered</div>
        <ul className="comp-mine">
          {mine!.map((m) => <li key={m.id}><b>{m.mode === 'group' ? m.groupName : m.people.join(', ')}</b>{m.mode === 'group' && <span>{m.people.join(', ')}</span>}</li>)}
        </ul>
        <p className="comp-note">We’ve emailed you a confirmation. It’s also under Competitions in <Link to="/account?tab=competitions">your account</Link>.</p>
        {phase === 'open' && mine!.length < max && <button type="button" className="btn btn--outline btn--md" onClick={() => setAdding(true)}>Register someone else</button>}
      </>
    );
  } else if (phase === 'closed') body = <p className="comp-note">Registration has closed.</p>;
  else if (!profile!.completed) {
    body = (
      <>
        <p className="comp-note"><b>First, complete your profile.</b> You only do this once.</p>
        <ProfileForm profile={profile!} name={state.status === 'ready' ? state.data.customer.name : ''} onSaved={setProfile} submitLabel="Save and continue" />
      </>
    );
  } else {
    body = <SignupForm c={c} onDone={(m) => { setMine([m, ...(mine ?? [])]); setAdding(false); }} onCancel={mine!.length ? () => setAdding(false) : undefined} />;
  }
  return (
    <div className="comp-reg">
      <h2 className="comp-reg__title">Register</h2>
      {body}
    </div>
  );
}

type Values = Record<string, string>;

function SignupForm({ c, onDone, onCancel }: { c: Competition; onDone: (m: Mine) => void; onCancel?: () => void }) {
  const modes = [c.individual && 'individual', c.group && 'group'].filter(Boolean) as ('individual' | 'group')[];
  const [mode, setMode] = useState(modes[0]);
  const [answers, setAnswers] = useState<Values>({});
  const [groupName, setGroupName] = useState('');
  const [people, setPeople] = useState<Values[]>(() => Array.from({ length: Math.max(1, c.group && modes[0] === 'group' ? c.group.minMembers : 1) }, () => ({})));
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<string[]>([]);
  const g = c.group;
  const switchMode = (m: 'individual' | 'group') => {
    setMode(m);
    setPeople(Array.from({ length: m === 'group' && g ? Math.max(1, g.minMembers) : 1 }, () => ({})));
    setAnswers({}); setErrs([]);
  };
  const questions = (mode === 'group' ? g?.questions : c.individual?.questions) ?? [];
  const personFields = (mode === 'group' ? g?.member : c.individual?.participant) ?? [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrs([]);
    try {
      const r = await authApi<{ signup: Mine }>(`/competitions/${c.slug}/register`, { method: 'POST', body: { mode, groupName, answers, participants: people } });
      onDone(r.signup);
    } catch (e2) {
      const list = e2 instanceof ApiError && (e2.details as { problems?: string[] } | undefined)?.problems;
      setErrs(list && list.length ? list : [errorMessage(e2)]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="comp-form" onSubmit={submit}>
      {modes.length > 1 && (
        <div className="comp-modes" role="radiogroup" aria-label="Register as">
          {modes.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={'comp-mode' + (mode === m ? ' is-on' : '')} onClick={() => switchMode(m)}>
              {m === 'individual' ? 'Individual' : 'Group'}
            </button>
          ))}
        </div>
      )}
      {mode === 'group' && g && (
        <label className="field">{g.nameLabel ?? 'Group name'}
          <input className="input input--white" value={groupName} onChange={(e) => setGroupName(e.target.value)} required maxLength={120} />
        </label>
      )}
      {questions.map((f) => <FieldInput key={f.key} f={f} value={answers[f.key] ?? ''} onChange={(v) => setAnswers({ ...answers, [f.key]: v })} />)}
      {people.map((p, i) => (
        <fieldset key={i} className="comp-person">
          {mode === 'group' && (
            <legend className="comp-person__legend">
              Member {i + 1}
              {g && people.length > g.minMembers && <button type="button" className="text-link" onClick={() => setPeople(people.filter((_, k) => k !== i))}>Remove</button>}
            </legend>
          )}
          {personFields.map((f) => <FieldInput key={f.key} f={f} value={p[f.key] ?? ''} onChange={(v) => setPeople(people.map((x, k) => (k === i ? { ...x, [f.key]: v } : x)))} />)}
        </fieldset>
      ))}
      {mode === 'group' && g && people.length < g.maxMembers && (
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setPeople([...people, {}])}>+ Add a member</button>
      )}
      {errs.length > 0 && <div className="form-error" role="alert">{errs.length === 1 ? errs[0] : <ul>{errs.map((x) => <li key={x}>{x}</li>)}</ul>}</div>}
      <div className="comp-form__foot">
        <button type="submit" className="btn btn--accent btn--lg" disabled={busy}>{busy ? 'Registering…' : 'Register'}</button>
        {onCancel && <button type="button" className="text-link" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function FieldInput({ f, value, onChange }: { f: Field; value: string; onChange: (v: string) => void }) {
  const type = f.type ?? 'text';
  const common = { required: f.required, value, placeholder: f.placeholder, onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <label className="field">
      {f.label}{!f.required && <span className="field__opt"> (optional)</span>}
      {type === 'textarea' ? <textarea className="input input--white" rows={4} maxLength={2000} {...common} />
        : type === 'select' || type === 'class' ? (
          <select className="input input--white" aria-label={f.label} {...common}>
            <option value="">Choose…</option>
            {(type === 'class' ? CLASS_OPTIONS : f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )
        : <input className="input input--white" maxLength={200} {...common}
            type={type === 'email' ? 'email' : type === 'phone' ? 'tel' : type === 'number' ? 'number' : 'text'}
            inputMode={type === 'phone' ? 'tel' : type === 'number' ? 'numeric' : undefined} />}
      {f.help && <small className="field__hint">{f.help}</small>}
    </label>
  );
}
