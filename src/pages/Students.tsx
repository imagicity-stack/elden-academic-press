// /account/students — a parent's children (details, consents, own login, delete),
// or a student's own profile (class and school, approval).
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { profileApi, useProfile, whatsappLink, type ProfileData, type ProfileStudent } from '../store/profile';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { ChildFields, ConsentChecks, ParentFields, childPayload, type ChildDraft, type Consents, type ParentDraft } from '../components/ProfileForms';
import { AddChildForm, WaitingStep } from './Onboarding';
import { istDay } from '../shared/competition';

export function Students() {
  const { state, reload, set } = useProfile();
  useEffect(() => { document.title = 'Your children — Elden Academic Press'; }, []);
  if (state.status === 'loading') return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  if (state.status === 'signedOut') return <section className="wrap page-narrow cp-step"><h1 className="t-h2">Sign in</h1><GoogleSignIn onDone={reload} /></section>;
  if (state.status === 'error') return <div className="wrap page-narrow"><h1 className="t-h2">We couldn’t load your profile.</h1><p className="t-lead">{state.message}</p></div>;
  const data = state.data;
  if (!data.account.type || !data.account.completed) {
    return (
      <section className="wrap page-narrow cp-step">
        <h1 className="t-h2">Complete your profile first</h1>
        <p className="t-lead">Tell us who is using this account. It takes a minute, once.</p>
        <div><Link to="/onboarding" className="btn btn--ink btn--lg">Complete my profile</Link></div>
      </section>
    );
  }
  return (
    <div className="wrap page-narrow cp-page">
      <div className="crumbs"><Link to="/account">Account</Link><span>/</span><span className="crumbs__here">{data.account.type === 'parent' ? 'Children' : 'My profile'}</span></div>
      {data.account.type === 'parent' ? <ParentView data={data} onChange={set} /> : <StudentView data={data} onChange={set} />}
    </div>
  );
}

function ParentView({ data, onChange }: { data: ProfileData; onChange: (d: ProfileData) => void }) {
  const kids = data.students.filter((s) => s.relation === 'parent');
  const [adding, setAdding] = useState(kids.length === 0);
  return (
    <>
      <h1 className="t-h2">Your children</h1>
      <p className="t-lead">Register them for competitions and upload their work from <Link to="/account/competitions" className="text-link">My entries</Link>.</p>
      {kids.map((k) => <ChildCard key={k.id} kid={k} onChange={onChange} />)}
      {adding ? <AddChildForm onDone={(d) => { onChange(d); setAdding(false); }} onCancel={kids.length ? () => setAdding(false) : undefined} />
        : <div><button type="button" className="btn btn--outline btn--md" onClick={() => setAdding(true)}>+ Add a child</button></div>}
      <ParentDetails data={data} onChange={onChange} />
    </>
  );
}

function useRun(onChange: (d: ProfileData) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<ProfileData>, ok?: string) => {
    setBusy(key); setMsg(null);
    try { const d = await fn(); onChange(d); if (ok) setMsg({ ok: true, text: ok }); return d; }
    catch (e) { setMsg({ ok: false, text: errorMessage(e) }); return null; }
    finally { setBusy(null); }
  };
  return { busy, msg, run };
}

function ChildCard({ kid, onChange }: { kid: ProfileStudent; onChange: (d: ProfileData) => void }) {
  const { busy, msg, run } = useRun(onChange);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ChildDraft>({ firstName: kid.firstName, lastName: kid.lastName, classGrade: String(kid.classGrade), schoolName: kid.schoolName, city: kid.city, state: kid.state });
  const [consents, setConsents] = useState<Consents>(kid.consents ?? { data_processing: true, publication: false, marketing: false });
  const [invite, setInvite] = useState<string | null>(kid.invite?.url ?? null);
  const save = (e: FormEvent) => { e.preventDefault(); run('edit', () => profileApi(`/children/${kid.id}`, { method: 'PUT', body: childPayload(draft) }), 'Saved.').then((d) => d && setEditing(false)); };
  const consentChanged = kid.consents && (kid.consents.publication !== consents.publication || kid.consents.marketing !== consents.marketing);
  const share = `Hi ${kid.firstName}! Here’s your login for Elden Academic Press competitions. Open it and sign in with your own Google account: ${invite ?? ''}`;

  return (
    <article className="cp-card">
      <header className="cp-card__head">
        <div>
          <h2 className="cp-h3">{kid.firstName} {kid.lastName}</h2>
          <div className="cp-muted">Class {kid.classGrade} · {kid.schoolName} · {kid.city}</div>
        </div>
        <span className={'cp-badge' + (kid.hasLogin ? ' cp-badge--ok' : '')}>{kid.hasLogin ? 'Has own login' : 'Managed by you'}</span>
      </header>

      {kid.needsClassConfirm && !editing && (
        <div className="form-notice cp-row">
          <span>New school year: is {kid.firstName} still in Class {kid.classGrade}?</span>
          <span className="cp-actions">
            <button type="button" className="btn btn--ink btn--sm" disabled={busy === 'confirm'} onClick={() => run('confirm', () => profileApi(`/children/${kid.id}`, { method: 'PUT', body: { confirmClass: true } }), 'Thanks!')}>Yes</button>
            <button type="button" className="text-link" onClick={() => setEditing(true)}>Change class</button>
          </span>
        </div>
      )}

      {editing ? (
        <form className="cp-form" onSubmit={save}>
          <ChildFields value={draft} onChange={setDraft} />
          <div className="cp-actions">
            <button type="submit" className="btn btn--ink btn--md" disabled={busy === 'edit'}>{busy === 'edit' ? 'Saving…' : 'Save'}</button>
            <button type="button" className="text-link" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : <div><button type="button" className="text-link" onClick={() => setEditing(true)}>Edit details</button></div>}

      <details className="cp-more">
        <summary>Permissions</summary>
        <ConsentChecks value={consents} onChange={setConsents} childName={kid.firstName} only={['publication', 'marketing']} />
        <p className="cp-muted">Taking part was agreed when you added {kid.firstName}. To withdraw it, delete {kid.firstName}’s profile below.</p>
        {consentChanged && (
          <div><button type="button" className="btn btn--ink btn--sm" disabled={busy === 'consent'} onClick={() => run('consent', () => profileApi(`/children/${kid.id}/consents`, { body: { publication: consents.publication, marketing: consents.marketing } }), 'Saved.')}>Save permissions</button></div>
        )}
      </details>

      {!kid.hasLogin && (
        <details className="cp-more">
          <summary>Give {kid.firstName} their own login</summary>
          <p className="cp-muted">Optional. {kid.firstName} opens a link and signs in with their own Google account; it’s linked to this profile, already approved. The link works once, for 7 days.</p>
          {invite ? (
            <div className="cp-invite">
              <input className="input" readOnly value={invite} aria-label="Login link" onFocus={(e) => e.target.select()} />
              <div className="cp-actions">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => navigator.clipboard?.writeText(invite)}>Copy link</button>
                <a className="btn btn--accent btn--sm" href={whatsappLink(share)} target="_blank" rel="noopener noreferrer">Share on WhatsApp</a>
              </div>
              {kid.invite && <p className="cp-muted">Works until {istDay(kid.invite.expiresAt)}. We also emailed it to you.</p>}
            </div>
          ) : (
            <button type="button" className="btn btn--outline btn--sm" disabled={busy === 'invite'}
              onClick={async () => { setInvite(null); const r = await run('invite', () => profileApi<ProfileData & { inviteUrl: string }>(`/children/${kid.id}/invite`, { method: 'POST' })); if (r) setInvite((r as ProfileData & { inviteUrl: string }).inviteUrl); }}>
              {busy === 'invite' ? 'Creating…' : 'Create login link'}
            </button>
          )}
        </details>
      )}

      <details className="cp-more">
        <summary>Delete {kid.firstName}’s profile</summary>
        <p className="cp-muted">This deletes {kid.firstName}’s details and uploaded work, and withdraws any entries. It can’t be undone.</p>
        <button type="button" className="btn btn--outline btn--sm cp-danger" disabled={busy === 'delete'}
          onClick={() => confirm(`Delete ${kid.firstName}’s profile and uploaded work? This can’t be undone.`) && run('delete', () => profileApi(`/children/${kid.id}`, { method: 'DELETE' }))}>
          Delete profile
        </button>
      </details>
      {msg && <div className={msg.ok ? 'cp-ok' : 'form-error'} role="status">{msg.text}</div>}
    </article>
  );
}

function ParentDetails({ data, onChange }: { data: ProfileData; onChange: (d: ProfileData) => void }) {
  const a = data.account;
  const [v, setV] = useState<ParentDraft>({ fullName: a.fullName, whatsapp: a.whatsapp, city: a.city, state: a.state });
  const [err, setErr] = useState<unknown>(null);
  const { busy, msg, run } = useRun(onChange);
  return (
    <details className="cp-card cp-more">
      <summary>Your details</summary>
      <form className="cp-form" onSubmit={(e) => { e.preventDefault(); setErr(null); run('details', () => profileApi('/details', { method: 'PUT', body: v }).catch((x) => { setErr(x); throw x; }), 'Saved.'); }}>
        <ParentFields value={v} onChange={setV} error={err} />
        <div><button type="submit" className="btn btn--ink btn--md" disabled={busy === 'details'}>{busy === 'details' ? 'Saving…' : 'Save'}</button></div>
        {msg && <div className={msg.ok ? 'cp-ok' : 'form-error'} role="status">{msg.text}</div>}
      </form>
    </details>
  );
}

function StudentView({ data, onChange }: { data: ProfileData; onChange: (d: ProfileData) => void }) {
  const me = data.students.find((s) => s.relation === 'self');
  const { busy, msg, run } = useRun(onChange);
  const [draft, setDraft] = useState<ChildDraft | null>(me ? { firstName: me.firstName, lastName: me.lastName, classGrade: String(me.classGrade), schoolName: me.schoolName, city: me.city, state: me.state } : null);
  if (!me || !draft) return <section className="cp-step"><h1 className="t-h2">No profile yet</h1><div><Link to="/onboarding" className="btn btn--ink btn--lg">Set up my profile</Link></div></section>;
  if (me.approvalStatus !== 'approved') return <WaitingStep me={me} onDone={onChange} />;
  return (
    <>
      <h1 className="t-h2">My profile</h1>
      <p className="t-lead">{me.firstName} {me.lastName} · Class {me.classGrade} · {me.schoolName}</p>
      {me.needsClassConfirm && <div className="form-notice">New school year: please check your class below and save.</div>}
      <form className="cp-card cp-form" onSubmit={(e) => { e.preventDefault(); run('edit', () => profileApi(`/children/${me.id}`, { method: 'PUT', body: { classGrade: Number(draft.classGrade), schoolName: draft.schoolName, confirmClass: true } }), 'Saved.'); }}>
        <p className="cp-muted">You can change your class and school. Ask your parent to change anything else.</p>
        <ChildFields value={draft} onChange={setDraft} only={['classGrade', 'schoolName']} />
        <div><button type="submit" className="btn btn--ink btn--md" disabled={busy === 'edit'}>{busy === 'edit' ? 'Saving…' : 'Save'}</button></div>
      </form>
      <details className="cp-card cp-more">
        <summary>Delete my profile</summary>
        <p className="cp-muted">Only a parent can delete your profile. We’ll email them your request.</p>
        <button type="button" className="btn btn--outline btn--sm" disabled={busy === 'delete'} onClick={() => run('delete', () => profileApi('/student', { method: 'DELETE' }), 'We’ve asked your parent.')}>Ask my parent to delete it</button>
      </details>
      {msg && <div className={msg.ok ? 'cp-ok' : 'form-error'} role="status">{msg.text}</div>}
    </>
  );
}
