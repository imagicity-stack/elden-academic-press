// /competitions/:slug — the competition: hero, theme, groups, IST timeline, prizes,
// judges, rules, FAQs, countdown. The main button depends on the status and on who
// is looking (signed out, parent, approved or waiting student).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../store/api';
import { authApi, hasAccountSession, optionalAuthApi } from '../store/account';
import { noteAccountType, whatsappLink, type ProfileStudent } from '../store/profile';
import { arrival, classesLabel, type CompetitionPage, type MeHere, type MyStudentHere } from '../store/competitions';
import { istDateTime, istDay, STATUS_LABEL } from '../shared/competition';
import { GoogleSignIn } from '../components/GoogleSignIn';
import { QrCode } from '../components/QrCode';
import { RichText } from '../components/RichText';
import { Countdown, nextMoment } from '../components/Countdown';
import { NotFound } from './NotFound';

const OPEN_REG = ['REGISTRATION_OPEN', 'BOTH_OPEN'];
const OPEN_SUB = ['SUBMISSIONS_OPEN', 'BOTH_OPEN'];

export function CompetitionDetail() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const preview = params.get('preview');
  const previewAs = params.get('as') === 'student' ? 'student' : 'parent';
  const [c, setC] = useState<CompetitionPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [me, setMe] = useState<MeHere | null>(null);

  const loadMe = useCallback(() => {
    if (preview) return;
    if (!hasAccountSession()) { setMe({ signedIn: false }); return; }
    optionalAuthApi<MeHere>(`/competitions/${slug}/me`).then((m) => { if (m.account) noteAccountType(m.account.type); setMe(m); }).catch(() => setMe({ signedIn: false }));
  }, [slug, preview]);

  useEffect(() => {
    arrival();
    optionalAuthApi<CompetitionPage>(`/competitions/${slug}${preview ? `?preview=${encodeURIComponent(preview)}` : ''}`)
      .then((d) => { setC(d); document.title = `${d.seo.title} — Elden Academic Press`; })
      .catch(() => setMissing(true));
    loadMe();
  }, [slug, preview, loadMe]);

  if (missing) return <NotFound />;
  if (!c) return <div className="wrap page-narrow" aria-busy="true"><div className="skeleton skeleton--hero" /></div>;
  const next = nextMoment(c.status, c.dates);
  const groupName = (id: string | null) => (id ? c.groups.find((g) => g.id === id)?.name ?? '' : 'All groups');

  return (
    <div className="cp-detail">
      {c.preview && <div className="cp-preview-bar">Preview of a {c.publishState === 'draft' ? 'draft' : c.publishState} competition, as a {previewAs}. Buttons don’t do anything here.</div>}
      <section className="cp-hero">
        {c.bannerUrl && <img className="cp-hero__img" src={c.bannerUrl} alt="" />}
        <div className="wrap cp-hero__text">
          <div className="crumbs"><Link to="/competitions">Competitions</Link><span>/</span><span className="crumbs__here">{c.title}</span></div>
          <span className={'cp-badge' + (OPEN_REG.includes(c.status) || OPEN_SUB.includes(c.status) ? ' cp-badge--live' : '')}>{STATUS_LABEL[c.status]}</span>
          <h1 className="t-h1 cp-hero__title">{c.title}</h1>
          {c.tagline && <p className="t-lead">{c.tagline}</p>}
          <div className="cp-hero__meta">{classesLabel(c.groups)} · {c.languages.join(', ')} · by {c.organiserName}</div>
          {next.to && <Countdown to={next.to} label={next.label} />}
        </div>
      </section>

      <div className="wrap cp-detail__grid">
        <div className="cp-detail__main">
          {c.prompt && <section className="cp-prompt"><div className="t-label">The theme</div><p>{c.prompt}</p></section>}
          {c.description && <section><RichText text={c.description} /></section>}

          <section>
            <h2 className="cp-h2">Groups</h2>
            <ul className="cp-groups">
              {c.groups.map((g) => (
                <li key={g.id}><b>{g.name}</b><span>Class {g.classMin === g.classMax ? g.classMin : `${g.classMin}–${g.classMax}`}</span>{g.formatNote && <span className="cp-muted">{g.formatNote}</span>}</li>
              ))}
            </ul>
            {c.regionScope === 'states' && <p className="cp-muted">Open to students in selected states only.</p>}
          </section>

          <section>
            <h2 className="cp-h2">Timeline</h2>
            <ol className="cp-timeline">
              {([
                ['Registration opens', c.dates.registrationOpensAt], ['Registration closes', c.dates.registrationClosesAt],
                ...(c.submissionRequired ? [['Submissions open', c.dates.submissionOpensAt], ['Last date for entries', c.dates.submissionClosesAt]] as const : []),
                ['Judging', c.dates.judgingStartsAt], ['Shortlist', c.dates.shortlistAt], ['Voting', c.dates.votingOpensAt], ['Results', c.dates.resultsAt],
              ] as [string, string | null][]).filter(([, d]) => d).map(([l, d]) => (
                <li key={l}><span>{l}</span><b>{/(Results|Judging|Shortlist)/.test(l) ? istDay(d) : istDateTime(d)}</b></li>
              ))}
            </ol>
          </section>

          {c.prizes.length > 0 && (
            <section>
              <h2 className="cp-h2">Prizes</h2>
              <ul className="cp-prizes">
                {c.prizes.map((p, i) => <li key={i}><b>{p.awardName}</b><span className="cp-muted">{groupName(p.groupId)}{p.description ? ` · ${p.description}` : ''}</span></li>)}
              </ul>
            </section>
          )}

          {c.judges.length > 0 && (
            <section>
              <h2 className="cp-h2">Judges</h2>
              <ul className="cp-judges">
                {c.judges.map((j) => <li key={j.name}>{j.photoUrl ? <img src={j.photoUrl} alt="" loading="lazy" /> : <span className="cp-judge__dot" aria-hidden="true">{j.name[0]}</span>}<div><b>{j.name}</b><span className="cp-muted">{j.role}</span></div></li>)}
              </ul>
            </section>
          )}

          {(c.rulesContent || c.rulesPdfUrl) && (
            <section>
              <h2 className="cp-h2">Rules</h2>
              {c.rulesContent && <RichText text={c.rulesContent.split('\n').every((l) => !l.trim() || /^\s*([-•]|\d+\.)\s/.test(l)) ? c.rulesContent : c.rulesContent.split('\n').filter(Boolean).map((l) => `- ${l}`).join('\n')} />}
              {c.rulesPdfUrl && <a className="text-link" href={c.rulesPdfUrl} target="_blank" rel="noopener noreferrer">Download the full rules (PDF)</a>}
            </section>
          )}

          {c.resources.length > 0 && (
            <section>
              <h2 className="cp-h2">Resources</h2>
              <ResourceList resources={c.resources.map((r) => ({ ...r, unlocked: r.visibility === 'public' }))} />
              {c.resources.some((r) => r.visibility !== 'public') && <p className="cp-muted">🔒 These open once you’ve registered.</p>}
            </section>
          )}

          {c.faqs.length > 0 && (
            <section>
              <h2 className="cp-h2">Questions</h2>
              {c.faqs.map((f) => <details key={f.question} className="cp-more"><summary>{f.question}</summary><RichText text={f.answer} /></details>)}
            </section>
          )}
          {c.disclaimer && <p className="cp-disclaimer">{c.disclaimer}</p>}
        </div>

        <aside className="cp-detail__side">
          <ActionPanel c={c} me={me} preview={Boolean(c.preview)} previewAs={previewAs} onSignedIn={loadMe} />
        </aside>
      </div>
    </div>
  );
}

/** Download buttons: public files for anyone, registered-only ones after registering. */
export function ResourceList({ resources }: { resources: { id: string; title: string; description: string; fileName: string; unlocked: boolean }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = async (id: string) => {
    setBusy(id); setErr(null);
    try { const r = await optionalAuthApi<{ url: string }>(`/competitions/resources/${id}/link`, { method: 'POST' }); window.location.assign(r.url); }
    catch (e) { setErr(errorMessage(e)); } finally { setBusy(null); }
  };
  return (
    <>
      <ul className="cp-resources">
        {resources.map((r) => (
          <li key={r.id}>
            <div><b>{r.title}</b>{r.description && <span className="cp-muted">{r.description}</span>}</div>
            {r.unlocked
              ? <button type="button" className="btn btn--outline btn--sm" disabled={busy === r.id} onClick={() => open(r.id)}>{busy === r.id ? 'Opening…' : 'Download'}</button>
              : <span className="cp-badge cp-badge--off">🔒 Registered</span>}
          </li>
        ))}
      </ul>
      {err && <div className="form-error" role="alert">{err}</div>}
    </>
  );
}

function ActionPanel({ c, me, preview, previewAs, onSignedIn }: { c: CompetitionPage; me: MeHere | null; preview: boolean; previewAs: 'parent' | 'student'; onSignedIn: () => void }) {
  const regOpen = OPEN_REG.includes(c.status);
  const subOpen = OPEN_SUB.includes(c.status);
  const head = (
    <div className="cp-side__head">
      {c.status === 'COMING_SOON' && <p>Registration opens <b>{istDateTime(c.dates.registrationOpensAt)}</b>.</p>}
      {regOpen && <p>Register by <b>{istDateTime(c.dates.registrationClosesAt)}</b>.</p>}
      {c.submissionRequired && (subOpen || regOpen) && c.dates.submissionClosesAt && <p>Entries close <b>{istDateTime(c.dates.submissionClosesAt)}</b>.</p>}
      {c.status === 'SUBMISSIONS_SOON' && <p>Uploads open <b>{istDateTime(c.dates.submissionOpensAt)}</b>.</p>}
      {['CLOSED', 'JUDGING', 'VOTING'].includes(c.status) && <p>Entries are closed. Results {c.dates.resultsAt ? <>on <b>{istDay(c.dates.resultsAt)}</b></> : 'soon'}.</p>}
      {c.status === 'RESULTS_OUT' && <p><b>Results are out.</b> Winners have been told by email.</p>}
      {c.seatsLeft != null && regOpen && <p className="cp-muted">{c.seatsLeft} place{c.seatsLeft === 1 ? '' : 's'} left.</p>}
      <p className="cp-muted">Free to enter. Times are India time (IST).</p>
    </div>
  );

  if (preview) {
    return (
      <div className="cp-side">
        {head}
        <div className="cp-card cp-preview-card">
          {previewAs === 'parent'
            ? <><b>A parent sees:</b><span>Each child with Register (or Submit / Edit after registering), the referral link and book suggestion on the confirmation.</span><button type="button" className="btn btn--accent btn--lg" disabled>Register Riya</button></>
            : <><b>An approved student sees:</b><span>Register for themselves; never the referral link or book suggestions. A student waiting for approval sees “Ask your parent to approve you first”.</span><button type="button" className="btn btn--accent btn--lg" disabled>Register</button></>}
        </div>
      </div>
    );
  }
  if (!me) return <div className="cp-side">{head}</div>;
  if (!me.signedIn) {
    return (
      <div className="cp-side">
        {head}
        {(regOpen || subOpen) && <><p className="cp-strong">Sign in to register</p><GoogleSignIn onDone={onSignedIn} note="Parents and students both sign in with Google. It’s free." /></>}
      </div>
    );
  }
  if (!me.account?.type || !me.account.completed) {
    return (
      <div className="cp-side">
        {head}
        <p>One quick step first: tell us who is using this account.</p>
        <Link className="btn btn--accent btn--lg" to={`/onboarding?next=/competitions/${c.slug}`}>Complete my profile</Link>
      </div>
    );
  }
  const students = me.students ?? [];
  const own = students.find((s) => s.relation === 'self');
  if (me.account.type === 'student' && own && own.approvalStatus !== 'approved') return <div className="cp-side">{head}<AskParent /></div>;
  return (
    <div className="cp-side">
      {head}
      {me.account.type === 'parent' && students.length === 0 && (
        <><p>Add your child to register them.</p><Link className="btn btn--accent btn--lg" to={`/onboarding?next=/competitions/${c.slug}`}>Add my child</Link></>
      )}
      <ul className="cp-who-list">{students.map((s) => <StudentRow key={s.id} c={c} s={s} regOpen={regOpen} subOpen={subOpen} />)}</ul>
      {me.account.type === 'parent' && students.length > 0 && <Link to="/account/students" className="text-link">Add another child</Link>}
    </div>
  );
}

function StudentRow({ c, s, regOpen, subOpen }: { c: CompetitionPage; s: MyStudentHere; regOpen: boolean; subOpen: boolean }) {
  const name = s.relation === 'self' ? 'You' : s.firstName;
  const reg = s.registration;
  return (
    <li className="cp-who-row">
      <div><b>{name}</b><span className="cp-muted">Class {s.classGrade}{s.group ? ` · ${s.group.name}` : ''}</span></div>
      {reg ? (
        reg.status !== 'registered' ? <span className="cp-badge cp-badge--off">{reg.status === 'withdrawn' ? 'Withdrawn' : 'Not taking part'}</span> : (
          <div className="cp-actions">
            {c.submissionRequired && subOpen && <Link className="btn btn--accent btn--md" to={`/competitions/${c.slug}/entry/${reg.id}`}>{s.submission?.status === 'submitted' ? 'Edit entry' : 'Submit entry'}</Link>}
            {s.submission?.status === 'submitted' && !subOpen && <span className="cp-badge cp-badge--ok">Entry {s.submission.entryCode}</span>}
            <Link className="text-link" to={`/competitions/${c.slug}/registered/${reg.id}`}>Registered ✓</Link>
          </div>
        )
      ) : s.notEligible ? <span className="cp-muted cp-small">{s.notEligible}</span>
        : regOpen ? <Link className="btn btn--accent btn--md" to={`/competitions/${c.slug}/register?student=${s.id}`}>Register{s.relation === 'parent' ? ` ${s.firstName}` : ''}</Link>
          : <span className="cp-muted cp-small">Registration {c.status === 'COMING_SOON' ? 'isn’t open yet' : 'is closed'}.</span>}
    </li>
  );
}

/** A student waiting for approval: share the link with a parent (WhatsApp or QR). */
function AskParent() {
  const [me, setMe] = useState<ProfileStudent | null>(null);
  const [qr, setQr] = useState(false);
  useEffect(() => { authApi<{ students: ProfileStudent[] }>('/profile').then((p) => setMe(p.students.find((s) => s.relation === 'self') ?? null)).catch(() => {}); }, []);
  const link = me?.approval?.link;
  return (
    <div className="cp-card">
      <b>Ask your parent to approve you first</b>
      <p className="cp-muted">Once a parent approves, you can register for this and every other competition.</p>
      {link ? (
        <div className="cp-share">
          <a className="btn btn--accent btn--md cp-wa" target="_blank" rel="noopener noreferrer"
            href={whatsappLink(`Hi! Please approve me for Elden Academic Press competitions. Open this and sign in with your own Google account: ${link}`, me?.approval?.parentWhatsapp)}>Send on WhatsApp</a>
          <button type="button" className="btn btn--outline btn--md" onClick={() => setQr((x) => !x)}>{qr ? 'Hide QR code' : 'Show QR code'}</button>
        </div>
      ) : <Link className="btn btn--outline btn--md" to="/onboarding">Send a new approval link</Link>}
      {qr && link && <div className="cp-qr"><QrCode text={link} label="QR code with the approval link" size={200} /></div>}
    </div>
  );
}
