// /onboarding — "Who is using this account?", once per account. Then the parent path
// (details → children with consents) or the student path (details → parent's details
// → waiting for approval). Shopping never needs this.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage, fieldError } from '../store/api';
import { profileApi, useProfile, whatsappLink, type ProfileData, type ProfileStudent } from '../store/profile';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { QrCode } from '../components/QrCode';
import {
  ChildFields, ConsentChecks, ParentFields, childPayload, defaultConsents, emptyChild, emptyParent, type ChildDraft, type Consents, type ParentDraft,
} from '../components/ProfileForms';
import { istDay } from '../shared/competition';

/** Only go back to pages on this site. */
const safeNext = (s: string | null) => (s && /^\/[a-z0-9/_-]*$/i.test(s) && !s.startsWith('//') ? s : null);

export function Onboarding() {
  const { state, reload, set } = useProfile();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [changing, setChanging] = useState(false);
  useEffect(() => { document.title = 'Your profile — Elden Academic Press'; }, []);

  if (state.status === 'loading') return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  if (state.status === 'signedOut') {
    return (
      <section className="wrap page-narrow cp-step">
        <div className="t-label">Competitions</div>
        <h1 className="t-h2">Sign in to take part.</h1>
        <p className="t-lead">Parents and students sign in once with Google. After that, joining any competition takes a moment.</p>
        <GoogleSignIn onDone={reload} note="Students: use your own Google account. Parents: use yours. We’ll ask who is using it next." />
      </section>
    );
  }
  if (state.status === 'error') return <div className="wrap page-narrow"><h1 className="t-h2">We couldn’t load your profile.</h1><p className="t-lead">{state.message}</p><div><button type="button" className="btn btn--ink btn--lg" onClick={reload}>Try again</button></div></div>;

  const data = state.data;
  const own = data.students.find((s) => s.relation === 'self');
  const step = !data.account.type || changing ? <WhoStep data={data} onDone={(d) => { setChanging(false); set(d); }} />
    : data.account.type === 'parent'
      ? (!data.account.completed ? <ParentDetailsStep data={data} onDone={set} /> : <ChildrenStep data={data} onDone={set} next={next} />)
      : !own ? <StudentStep onDone={set} />
        : own.approvalStatus !== 'approved' ? <WaitingStep me={own} onDone={set} />
          : <AllSet me={own} next={next} />;

  return (
    <div className="wrap page-narrow cp-onboard">
      {step}
      {data.account.type && !data.account.locked && !changing && (
        <p className="cp-muted">Not {data.account.type === 'parent' ? 'a parent' : 'a student'}? <button type="button" className="text-link" onClick={() => setChanging(true)}>Change who is using this account</button></p>
      )}
    </div>
  );
}

function WhoStep({ data, onDone }: { data: ProfileData; onDone: (d: ProfileData) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const choose = async (type: 'parent' | 'student') => {
    setBusy(type); setErr(null);
    try { onDone(await profileApi('/type', { body: { type } })); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <section className="cp-step">
      <div className="t-label">One-time setup</div>
      <h1 className="t-h2">Who is using this account?</h1>
      <p className="t-lead">Signed in as {data.account.email}. You only answer this once.</p>
      <div className="cp-who">
        <button type="button" className="cp-who__btn" onClick={() => choose('parent')} disabled={Boolean(busy)}>
          <span className="cp-who__emoji" aria-hidden="true">👪</span>
          <b>I’m a Parent</b>
          <span>Add your children, register them and upload their work.</span>
        </button>
        <button type="button" className="cp-who__btn" onClick={() => choose('student')} disabled={Boolean(busy)}>
          <span className="cp-who__emoji" aria-hidden="true">🎒</span>
          <b>I’m a Student</b>
          <span>Take part yourself, once a parent approves you.</span>
        </button>
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
    </section>
  );
}

function ParentDetailsStep({ data, onDone }: { data: ProfileData; onDone: (d: ProfileData) => void }) {
  const a = data.account;
  const [v, setV] = useState<ParentDraft>({ ...emptyParent(), fullName: a.fullName || a.name, whatsapp: a.whatsapp, city: a.city, state: a.state });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onDone(await profileApi('/details', { method: 'PUT', body: v })); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <form className="cp-step" onSubmit={submit}>
      <div className="t-label">Step 1 of 2 · Parent</div>
      <h1 className="t-h2">Your details</h1>
      <p className="t-lead">So we can reach you about your child’s entries. Your WhatsApp number is never shown to anyone.</p>
      <ParentFields value={v} onChange={setV} error={err} />
      {err !== null && !fieldError(err, 'fullName') && <div className="form-error" role="alert">{errorMessage(err)}</div>}
      <div><button type="submit" className="btn btn--ink btn--lg" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button></div>
    </form>
  );
}

/** Add a child with the one-time consents; used here and on the children page. */
export function AddChildForm({ onDone, onCancel, title = 'Add your child' }: { onDone: (d: ProfileData) => void; onCancel?: () => void; title?: string }) {
  const [child, setChild] = useState<ChildDraft>(emptyChild());
  const [consents, setConsents] = useState<Consents>(defaultConsents());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onDone(await profileApi('/children', { body: { ...childPayload(child), consents } })); setChild(emptyChild()); setConsents(defaultConsents()); }
    catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <form className="cp-card cp-form" onSubmit={submit}>
      <h2 className="cp-h3">{title}</h2>
      <p className="cp-muted">Only first name and city are ever shown in public, and only if you allow it below.</p>
      <ChildFields value={child} onChange={setChild} error={err} />
      <ConsentChecks value={consents} onChange={setConsents} childName={child.firstName.trim() || undefined} />
      {err !== null && <div className="form-error" role="alert">{errorMessage(err)}</div>}
      <div className="cp-actions">
        <button type="submit" className="btn btn--ink btn--md" disabled={busy || !consents.data_processing}>{busy ? 'Adding…' : 'Add child'}</button>
        {onCancel && <button type="button" className="text-link" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function ChildrenStep({ data, onDone, next }: { data: ProfileData; onDone: (d: ProfileData) => void; next: string | null }) {
  const navigate = useNavigate();
  const kids = data.students.filter((s) => s.relation === 'parent');
  return (
    <section className="cp-step">
      <div className="t-label">Step 2 of 2 · Parent</div>
      <h1 className="t-h2">{kids.length ? 'Your children' : 'Add your child'}</h1>
      <p className="t-lead">Add each child once. They don’t need their own login: you can register them and upload their work yourself.</p>
      {kids.length > 0 && (
        <ul className="cp-kids">
          {kids.map((k) => <li key={k.id}><b>{k.firstName} {k.lastName}</b><span>Class {k.classGrade} · {k.schoolName}</span></li>)}
        </ul>
      )}
      <AddChildForm onDone={onDone} title={kids.length ? 'Add another child' : 'Your child'} />
      {kids.length > 0 && (
        <div className="cp-actions">
          <button type="button" className="btn btn--accent btn--lg" onClick={() => navigate(next ?? '/competitions')}>{next ? 'Continue' : 'See competitions'}</button>
          <Link to="/account/students" className="text-link">Manage children and logins</Link>
        </div>
      )}
    </section>
  );
}

function StudentStep({ onDone, me }: { onDone: (d: ProfileData) => void; me?: ProfileStudent }) {
  const [child, setChild] = useState<ChildDraft>(me ? { firstName: me.firstName, lastName: me.lastName, classGrade: String(me.classGrade), schoolName: me.schoolName, city: me.city, state: me.state } : emptyChild());
  const [parent, setParent] = useState({ name: me?.approval?.parentName ?? '', whatsapp: me?.approval?.parentWhatsapp ?? '', email: me?.approval?.parentEmail ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onDone(await profileApi('/student', { method: 'PUT', body: { ...childPayload(child), parent } })); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <form className="cp-step" onSubmit={submit}>
      <div className="t-label">Student</div>
      <h1 className="t-h2">{me ? 'Edit your details' : 'About you'}</h1>
      <p className="t-lead">Just the basics. A parent will approve you once, and then you can join any competition.</p>
      <ChildFields value={child} onChange={setChild} error={err} />
      <h2 className="cp-h3">Your parent</h2>
      <p className="cp-muted">We’ll send them a link to approve you. They sign in with their own Google account.</p>
      <div className="cp-fields">
        <label className="field">Parent’s name<input className="input" value={parent.name} onChange={(e) => setParent({ ...parent, name: e.target.value })} required maxLength={120} /></label>
        <label className="field">Parent’s WhatsApp number<input className="input" type="tel" inputMode="numeric" placeholder="10-digit mobile" value={parent.whatsapp} onChange={(e) => setParent({ ...parent, whatsapp: e.target.value })} required /></label>
        <label className="field">Parent’s email<input className="input" type="email" value={parent.email} onChange={(e) => setParent({ ...parent, email: e.target.value })} required /></label>
      </div>
      {err !== null && <div className="form-error" role="alert">{errorMessage(err)}</div>}
      <div><button type="submit" className="btn btn--ink btn--lg" disabled={busy}>{busy ? 'Sending…' : me ? 'Save and send again' : 'Ask my parent to approve'}</button></div>
    </form>
  );
}

/** Waiting for a parent: WhatsApp share, QR code for a parent sitting next to them, resend, edit, cancel. */
export function WaitingStep({ me, onDone }: { me: ProfileStudent; onDone: (d: ProfileData) => void }) {
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const a = me.approval;
  if (editing) return <StudentStep me={me} onDone={(d) => { setEditing(false); onDone(d); }} />;
  const link = a?.link ?? null;
  const expired = !a || a.status !== 'pending' || !link;
  const run = async (key: string, fn: () => Promise<ProfileData>, ok: string) => {
    setBusy(key); setMsg(null);
    try { onDone(await fn()); setMsg(ok); } catch (e) { setMsg(errorMessage(e)); } finally { setBusy(null); }
  };
  const text = `Hi! I signed up for Elden Academic Press competitions. Please approve me: open this link and sign in with your own Google account. ${link ?? ''}`;
  return (
    <section className="cp-step">
      <div className="t-label">Almost there</div>
      <h1 className="t-h2">Waiting for your parent’s approval</h1>
      <p className="t-lead">
        {expired ? 'Your approval link has run out. Send a new one to your parent.' : <>We emailed <b>{a?.parentEmail}</b>. Ask {a?.parentName || 'your parent'} to open the link and approve you. It works until {istDay(a?.expiresAt)}.</>}
      </p>
      <p className="cp-muted">Until then you can look at competitions, but you can’t register or upload yet.</p>
      <div className="cp-share">
        {!expired && <a className="btn btn--accent btn--lg cp-wa" href={whatsappLink(text, a?.parentWhatsapp)} target="_blank" rel="noopener noreferrer">Send to my parent on WhatsApp</a>}
        {!expired && <button type="button" className="btn btn--outline btn--lg" onClick={() => setQr((x) => !x)} aria-expanded={qr}>{qr ? 'Hide QR code' : 'Show QR code'}</button>}
        <button type="button" className="btn btn--outline btn--lg" disabled={busy === 'resend'} onClick={() => run('resend', () => profileApi('/student/resend', { method: 'POST' }), expired ? 'A new link was sent.' : 'Sent again.')}>
          {busy === 'resend' ? 'Sending…' : expired ? 'Send a new link' : 'Resend email'}
        </button>
      </div>
      {qr && link && (
        <div className="cp-qr">
          <QrCode text={link} label="QR code with the approval link" />
          <p className="cp-muted">Your parent scans this with <b>their own</b> phone’s camera.</p>
        </div>
      )}
      {msg && <div className="form-notice" role="status">{msg}</div>}
      <div className="cp-actions">
        <button type="button" className="text-link" onClick={() => setEditing(true)}>Edit my details or my parent’s</button>
        <button type="button" className="text-link" disabled={busy === 'cancel'} onClick={() => confirm('Cancel your request? Your details will be deleted.') && run('cancel', () => profileApi('/student', { method: 'DELETE' }), 'Your request was cancelled.')}>Cancel my request</button>
      </div>
    </section>
  );
}

function AllSet({ me, next }: { me: ProfileStudent; next: string | null }) {
  return (
    <section className="cp-step">
      <div className="t-label">All set</div>
      <h1 className="t-h2">You’re approved, {me.firstName}!</h1>
      <p className="t-lead">You can register for any competition for Class {me.classGrade} and upload your entries.</p>
      <div className="cp-actions">
        <Link to={next ?? '/competitions'} className="btn btn--accent btn--lg">{next ? 'Continue' : 'See competitions'}</Link>
        <Link to="/account/competitions" className="text-link">My entries</Link>
      </div>
    </section>
  );
}
