// /approve/:token — a parent approves a student who signed up: sign in with the
// parent's own Google account, add details if new, give the one-time consents.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { optionalAuthApi, authApi } from '../store/account';
import { noteAccountType } from '../store/profile';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { ConsentChecks, ParentFields, defaultConsents, type Consents, type ParentDraft } from '../components/ProfileForms';

interface Page {
  status: 'pending' | 'approved' | 'declined' | 'expired';
  student: { firstName: string; classGrade: number; schoolName: string } | null;
  viewer: null | {
    email: string; type: 'parent' | 'student' | null; blocked: string | null; needsDetails: boolean; details: ParentDraft;
    mergeCandidates: { id: string; firstName: string; lastName: string; classGrade: number; schoolName: string }[];
  };
}

export function Approve() {
  const { token = '' } = useParams();
  const [page, setPage] = useState<Page | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [details, setDetails] = useState<ParentDraft | null>(null);
  const [consents, setConsents] = useState<Consents>(defaultConsents());
  const [merge, setMerge] = useState<string>('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<'approved' | 'declined' | null>(null);

  const load = useCallback(() => {
    optionalAuthApi<Page>(`/approvals/${encodeURIComponent(token)}`)
      .then((p) => { setPage(p); setDetails(p.viewer?.details ?? null); setMerge(p.viewer?.mergeCandidates[0]?.id ?? ''); })
      .catch((e) => setLoadErr(errorMessage(e)));
  }, [token]);
  useEffect(() => { document.title = 'Approve a student — Elden Academic Press'; load(); }, [load]);

  const decide = async (decision: 'approve' | 'decline') => {
    if (decision === 'decline' && !confirm(`Decline? ${page?.student?.firstName}’s details will be deleted.`)) return;
    setBusy(decision); setErr(null);
    try {
      const v = page!.viewer!;
      await authApi(`/approvals/${encodeURIComponent(token)}`, {
        body: { decision, ...(decision === 'approve' ? { consents, ...(v.needsDetails ? { details } : {}), ...(merge ? { mergeInto: merge } : {}) } : {}) },
      });
      if (decision === 'approve') noteAccountType('parent');
      setDone(decision === 'approve' ? 'approved' : 'declined');
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  if (loadErr) return <Shell><h1 className="t-h2">This link doesn’t work</h1><p className="t-lead">{loadErr}</p></Shell>;
  if (!page) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  if (done) {
    return (
      <Shell>
        <h1 className="t-h2">{done === 'approved' ? `${page.student?.firstName} is approved` : 'Declined'}</h1>
        <p className="t-lead">{done === 'approved' ? `Thank you. ${page.student?.firstName} can now register for competitions and upload entries. You’ll get an email whenever ${page.student?.firstName} registers or submits.` : 'The request was declined and the details were deleted.'}</p>
        {done === 'approved' && <div className="cp-actions"><Link to="/account/students" className="btn btn--ink btn--lg">See your children</Link><Link to="/competitions" className="text-link">Competitions</Link></div>}
      </Shell>
    );
  }
  if (page.status !== 'pending' || !page.student) {
    return <Shell><h1 className="t-h2">{page.status === 'approved' ? 'Already approved' : 'This link has run out'}</h1><p className="t-lead">{page.status === 'approved' ? 'Nothing more to do.' : 'Ask the student to send a new link from their account. Links work once, for 7 days.'}</p></Shell>;
  }
  const s = page.student;
  const v = page.viewer;
  return (
    <Shell>
      <div className="t-label">Parent approval</div>
      <h1 className="t-h2">Approve {s.firstName}?</h1>
      <div className="cp-card cp-who-card">
        <b>{s.firstName}</b><span>Class {s.classGrade} · {s.schoolName}</span>
        <p className="cp-muted">{s.firstName} signed up for Elden Academic Press competitions and named you as their parent. You approve once; after that {s.firstName} can join any competition, and you’ll be told each time.</p>
      </div>
      {!v ? (
        <>
          <p className="t-lead">Sign in with <b>your own</b> Google account (not {s.firstName}’s) to continue.</p>
          <GoogleSignIn onDone={load} />
        </>
      ) : v.blocked ? (
        <div className="form-error" role="alert">{v.blocked} You’re signed in as {v.email}. Sign out and sign in with the parent’s account.</div>
      ) : (
        <form className="cp-form" onSubmit={(e) => { e.preventDefault(); decide('approve'); }}>
          <p className="cp-muted">Signed in as {v.email}.</p>
          {v.needsDetails && details && (
            <>
              <h2 className="cp-h3">Your details</h2>
              <ParentFields value={details} onChange={setDetails} error={err} prefix={[]} />
            </>
          )}
          {v.mergeCandidates.length > 0 && (
            <div className="cp-card">
              <h2 className="cp-h3">Is this the same child?</h2>
              <p className="cp-muted">You already added someone with the same name and class. Link {s.firstName}’s login to that profile instead of making a second one.</p>
              {v.mergeCandidates.map((m) => (
                <label key={m.id} className="tick"><input type="radio" name="merge" checked={merge === m.id} onChange={() => setMerge(m.id)} /><span className="tick__box" aria-hidden="true" /><span>Yes, it’s {m.firstName} {m.lastName} (Class {m.classGrade}, {m.schoolName})</span></label>
              ))}
              <label className="tick"><input type="radio" name="merge" checked={merge === ''} onChange={() => setMerge('')} /><span className="tick__box" aria-hidden="true" /><span>No, this is a different child</span></label>
            </div>
          )}
          <h2 className="cp-h3">Your permission</h2>
          <ConsentChecks value={consents} onChange={setConsents} childName={s.firstName} />
          {err !== null && <div className="form-error" role="alert">{errorMessage(err)}</div>}
          <div className="cp-actions">
            <button type="submit" className="btn btn--accent btn--lg" disabled={Boolean(busy) || !consents.data_processing}>{busy === 'approve' ? 'Approving…' : `Approve ${s.firstName}`}</button>
            <button type="button" className="text-link" disabled={Boolean(busy)} onClick={() => decide('decline')}>Decline</button>
          </div>
        </form>
      )}
    </Shell>
  );
}

const Shell = ({ children }: { children: ReactNode }) => <section className="wrap page-narrow cp-step">{children}</section>;
