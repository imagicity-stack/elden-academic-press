// /account/competitions — every registration: status, deadline countdown, resources,
// Submit / Edit and the receipt. A parent sees all their children; a student only themselves.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { accountToken, authApi } from '../store/account';
import { istDateTime, STATUS_LABEL, type CompetitionStatus } from '../shared/competition';
import { Countdown } from '../components/Countdown';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { regCode } from './CompetitionRegister';

interface Item {
  registrationId: string; status: string; createdAt: string;
  student: { id: string; firstName: string; relation: 'parent' | 'self'; publication?: boolean };
  competition: { slug: string; title: string; status: CompetitionStatus; submissionRequired: boolean; submissionClosesAt: string | null; resultsAt: string | null; thumbnailUrl: string | null; canSubmit: boolean };
  group: { name: string };
  submissions: { id: string; entryCode: string; status: string; submittedAt: string | null; hiddenFromPublic: boolean }[];
}

const SUB_LABEL: Record<string, string> = { draft: 'Draft, not submitted', submitted: 'Submitted', withdrawn: 'Withdrawn', disqualified: 'Not accepted', under_review: 'Being judged', shortlisted: 'Shortlisted', winner: 'Winner' };

export function MyEntries() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!(await accountToken())) { setSignedIn(false); return; }
    setSignedIn(true);
    authApi<{ items: Item[] }>('/my/competitions').then((r) => setItems(r.items), (e) => setErr(errorMessage(e)));
  }, []);
  useEffect(() => { document.title = 'My entries — Elden Academic Press'; load(); }, [load]);

  if (!signedIn) return <section className="wrap page-narrow cp-step"><h1 className="t-h2">My entries</h1><GoogleSignIn onDone={load} /></section>;
  return (
    <div className="wrap page-narrow cp-page">
      <div className="crumbs"><Link to="/account">Account</Link><span>/</span><span className="crumbs__here">My entries</span></div>
      <h1 className="t-h2">My entries</h1>
      {err && <div className="form-error">{err}</div>}
      {!items && !err && <div className="skeleton skeleton--hero" />}
      {items?.length === 0 && <div className="cp-card"><b>No registrations yet.</b><p className="cp-muted">Find a competition and register in a few taps.</p><div><Link className="btn btn--accent btn--md" to="/competitions">See competitions</Link></div></div>}
      {items?.map((i) => {
        const sub = i.submissions.find((s) => s.status !== 'withdrawn') ?? i.submissions[0];
        const open = i.competition.canSubmit;
        return (
          <article key={i.registrationId} className="cp-card cp-entry">
            <header className="cp-card__head">
              <div>
                <h2 className="cp-h3"><Link to={`/competitions/${i.competition.slug}`}>{i.competition.title}</Link></h2>
                <div className="cp-muted">{i.student.relation === 'self' ? 'You' : i.student.firstName} · {i.group.name} · {regCode(i.registrationId)}</div>
              </div>
              <span className="cp-badge">{STATUS_LABEL[i.competition.status]}</span>
            </header>
            {i.status !== 'registered' ? <p className="cp-muted">{i.status === 'withdrawn' ? 'Withdrawn.' : 'This registration isn’t taking part.'}</p> : (
              <>
                {i.competition.submissionRequired && (
                  <p>{sub ? <><b>{SUB_LABEL[sub.status] ?? sub.status}</b>{sub.status === 'submitted' && <> · {sub.entryCode} · {istDateTime(sub.submittedAt)}</>}</> : <b>Not submitted yet</b>}</p>
                )}
                {open && i.competition.submissionClosesAt && <Countdown to={i.competition.submissionClosesAt} label="Time left" />}
                <div className="cp-actions">
                  {open && <Link className="btn btn--accent btn--md" to={`/competitions/${i.competition.slug}/entry/${i.registrationId}`}>{sub?.status === 'submitted' ? 'Edit entry' : 'Submit entry'}</Link>}
                  {!open && sub && sub.status !== 'draft' && <Link className="btn btn--outline btn--md" to={`/competitions/${i.competition.slug}/entry/${i.registrationId}`}>View entry and receipt</Link>}
                  <Link className="text-link" to={`/competitions/${i.competition.slug}/registered/${i.registrationId}`}>Resources</Link>
                </div>
                {i.student.relation === 'parent' && sub?.status === 'submitted' && <HideToggle submissionId={sub.id} hidden={sub.hiddenFromPublic} allowed={Boolean(i.student.publication)} onChange={load} />}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** A parent can keep any one entry out of public showcases. */
function HideToggle({ submissionId, hidden, allowed, onChange }: { submissionId: string; hidden: boolean; allowed: boolean; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  if (!allowed) return <p className="cp-muted cp-small">Not shown in public (you haven’t allowed showing entries).</p>;
  return (
    <label className="tick cp-small">
      <input type="checkbox" checked={!hidden} disabled={busy} onChange={async (e) => {
        setBusy(true);
        try { await authApi(`/my/submissions/${submissionId}/visibility`, { body: { hidden: !e.target.checked } }); onChange(); } finally { setBusy(false); }
      }} />
      <span className="tick__box" aria-hidden="true" />
      <span>EAP may show this entry in public (first name and city only)</span>
    </label>
  );
}
