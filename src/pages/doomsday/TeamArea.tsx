// The team part of a team competition's page (#team): sign in, complete the profile (only
// what's missing), register a team in four steps, then follow it: status, the organiser's
// notes and notices, and, once approved, the uploads with a countdown to the deadline.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { trackStep } from '../../competitionTrack';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { accountApi, authApi, useAccount, type Profile } from '../../store/account';
import { ApiError, errorMessage } from '../../store/api';
import { useStoreConfig } from '../../store/catalog';
import { istDateTime, type Competition } from '../../shared/competitions';
import { ageOn, checkTeam, dayLabel, emptyMember, type MemberInput, type TeamConfig, type TeamFileSpec, type TeamInput } from '../../shared/teams';
import { todayIST } from '../../shared/profile';
import { preparePhoto, putWithRetry, sizeText } from '../../lib/upload';
import { Countdown } from '../../components/Countdown';
import { GoogleSignIn } from '../../components/GoogleSignIn';
import { ProfileForm, ProfileOnboarding, shouldOnboard } from '../../components/ProfileForm';
import { RichText } from '../../components/RichText';
import { trackRegistration } from '../../meta';

type TeamComp = Competition & { team: TeamConfig };
interface FileRow { id: string; name: string; size: number; pages: number | null; uploadedAt: string }
export interface TeamApp {
  id: string; code: string; teamName: string; institutionType: string; institutionName: string; city: string; state: string; stateName: string;
  category: string; categoryLabel: string; status: string; statusText: string; reviewNote: string; result: string; createdAt: string; updatedAt: string; reviewedAt: string | null;
  own: boolean; canEdit: boolean; canWithdraw: boolean; canUpload: boolean;
  members: (Partial<MemberInput> & { fullName: string; roles: string[]; institutionName: string; age: number | null; captain: boolean; idDocOnFile?: boolean })[];
  files: (TeamFileSpec & { current: FileRow | null; history: (Omit<FileRow, 'id'> & { replacedAt: string | null })[] })[];
  notices: { id: string; title: string; body: string; createdAt: string }[];
}
/** The story brief: sent by the server only once one of the person's teams is approved. */
export interface StoryBrief { title: string; lead: string; story: string; mustInclude: string; hashtag: string }
export interface TeamData {
  applications: TeamApp[]; registration: { open: boolean; reason: string };
  dates: { opensAt: string; closesAt: string; submissionDeadline: string; resultsOn: string };
  profile: Profile | null; brief: StoryBrief | null; rulesDocUrl: string | null; topicDocUrl: string | null;
  /** The comic kit: for anyone with a team that registered successfully, once the organiser has uploaded it. */
  kit: { name: string; size: number } | null;
}

export function StoryBriefPanel({ brief, topicDocUrl }: { brief: StoryBrief; topicDocUrl?: string | null }) {
  return (
    <div className="dd-brief">
      <div className="dd-panel dd-panel--dark">
        <div className="dd-caption">Your story brief</div>
        <h4 className="dd-brief__title">{brief.title}</h4>
        <p className="dd-brief__lead">{brief.lead}</p>
        <p>{brief.story}</p>
      </div>
      <div className="dd-panel">
        <h4 className="dd-h4">Your comic must include</h4>
        <RichText text={brief.mustInclude} className="dd-rich" />
        <p className="dd-small">Sharing your entry after you submit? Tag @eldenacademicpress and use <b>{brief.hashtag}</b>.{topicDocUrl && <> <a href={topicDocUrl} target="_blank" rel="noreferrer">Topic document (PDF)</a></>}</p>
      </div>
    </div>
  );
}

/** account: the page's own useAccount(), so the page and this area agree on who is signed in. */
export function TeamArea({ c, account }: { c: TeamComp; account: ReturnType<typeof useAccount> }) {
  const { state, reload } = account;
  const [data, setData] = useState<TeamData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<{ kind: 'new' } | { kind: 'edit'; app: TeamApp } | null>(null);
  const [justSent, setJustSent] = useState<TeamApp | null>(null);
  const [onboard, setOnboard] = useState(false);
  const signedIn = state.status === 'ready';
  const load = useCallback(() => authApi<TeamData>(`/competitions/${c.slug}/team`).then((d) => { setData(d); setErr(null); }, (e) => setErr(errorMessage(e))), [c.slug]);
  useEffect(() => { if (signedIn) load(); }, [signedIn, load]);
  useEffect(() => { if (signedIn) trackStep(c.slug, 'signin'); }, [signedIn, c.slug]);
  useEffect(() => { if (state.status === 'ready' && shouldOnboard(state.data.newAccount, state.data.profile)) setOnboard(true); }, [state]);
  useEffect(() => { if (data && location.hash === '#team') document.getElementById('team')?.scrollIntoView({ behavior: 'smooth' }); }, [data]);

  let body: ReactNode;
  if (state.status === 'loading' || (signedIn && !data && !err)) body = <div className="skeleton dd-skel" aria-busy="true" />;
  else if (state.status === 'error' || err) body = <div className="form-error" role="alert">{state.status === 'error' ? state.message : err}</div>;
  else if (!signedIn) {
    body = (
      <div className="dd-signin">
        <p className="dd-lead">Sign in with Google to see the full rules and register your team. A team captain, a teacher or a parent can register the whole team.</p>
        <GoogleSignIn onDone={reload} />
      </div>
    );
  } else if (mode) {
    body = (
      <RegisterWizard c={c} data={data!} accountEmail={state.data.customer.email} edit={mode.kind === 'edit' ? mode.app : null}
        onCancel={() => setMode(null)} onDone={(app) => { setMode(null); setJustSent(app); load(); }} />
    );
  } else {
    const d = data!;
    const profile = d.profile;
    const live = d.applications.filter((a) => !['rejected', 'withdrawn'].includes(a.status));
    body = (
      <>
        {justSent && <SentPanel app={justSent} newsletter={state.data.newsletter} kit={Boolean(d.kit)} onClose={() => setJustSent(null)} />}
        {d.kit && <KitPanel c={c} kit={d.kit} />}
        {d.applications.map((a) => <TeamDashboard key={a.id} c={c} app={a} data={d} onChange={load} onEdit={() => setMode({ kind: 'edit', app: a })} />)}
        {profile && !profile.completed ? (
          <div className="dd-panel">
            <h3 className="dd-h3">First, complete your profile</h3>
            <p className="dd-lead">Just the details we don’t have yet. You only do this once.</p>
            <ProfileForm profile={profile} name={state.data.customer.name} onlyMissing submitLabel="Save and continue" onSaved={(p) => setData({ ...d, profile: p })} />
          </div>
        ) : d.registration.open ? (
          <div className="dd-panel dd-panel--cta">
            <h3 className="dd-h3">{live.length ? 'Register another team' : 'Register your team'}</h3>
            <p className="dd-lead">2 to 4 members, each with a role (a Writer and an Artist at least) and an ID document. You’ll need a parent’s or guardian’s details for anyone under 18.</p>
            <button type="button" className="btn dd-btn dd-btn--big" onClick={() => setMode({ kind: 'new' })}>Register a team</button>
          </div>
        ) : !d.applications.length && <div className="dd-panel"><p className="dd-lead">{d.registration.reason}</p></div>}
      </>
    );
  }
  return (
    <section className="dd-team" id="team" aria-labelledby="team-title">
      <h2 id="team-title" className="dd-h2"><span>Your team</span></h2>
      {body}
      <AnimatePresence>
        {onboard && state.status === 'ready' && (
          <ProfileOnboarding profile={state.data.profile} name={state.data.customer.name} onClose={() => setOnboard(false)}
            onSaved={(p) => { if (data) setData({ ...data, profile: p }); }} />
        )}
      </AnimatePresence>
    </section>
  );
}

/** The comic kit: a download for every registered team (the link the server gives works for 5 minutes). */
function KitPanel({ c, kit }: { c: TeamComp; kit: NonNullable<TeamData['kit']> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const download = async () => {
    setBusy(true); setErr(null);
    try { window.location.assign((await authApi<{ url: string }>(`/competitions/${c.slug}/team/kit`)).url); }
    catch (e) { setErr(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const size = kit.size ? ` · ${(kit.size / 1024 / 1024).toFixed(1)} MB` : '';
  return (
    <div className="dd-panel dd-panel--cta dd-kit">
      <h3 className="dd-h3">Your comic kit</h3>
      <p className="dd-lead">Everything your team needs to start creating. Download it any time from here.</p>
      <button type="button" className="btn dd-btn" disabled={busy} onClick={download}>{busy ? 'Opening…' : 'Download the comic kit'}</button>
      <span className="dd-small">PDF{size}</span>
      {err && <div className="form-error" role="alert">{err}</div>}
    </div>
  );
}

function SentPanel({ app, newsletter, kit, onClose }: { app: TeamApp; newsletter: string | null; kit: boolean; onClose: () => void }) {
  const [news, setNews] = useState<'ask' | 'busy' | 'done'>(newsletter === 'subscribed' ? 'done' : 'ask');
  return (
    <motion.div className="dd-panel dd-sent" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="dd-pow" aria-hidden="true">SENT!</div>
      <h3 className="dd-h3">Application {app.code} received</h3>
      <p className="dd-lead">Your status is <b>Pending verification</b>. We usually check registrations within 48 hours and email you as soon as we have.{kit && <> Your <b>comic kit</b> is just below, and in your email.</>}</p>
      {newsletter !== 'subscribed' && news !== 'done' && (
        <div className="dd-news">
          <span>Want to hear about future competitions and new books? (Optional, and separate from competition emails.)</span>
          <button type="button" className="btn btn--outline btn--sm" disabled={news === 'busy'} onClick={() => { setNews('busy'); accountApi('/newsletter', { method: 'PUT', body: { subscribed: true } }).then(() => setNews('done'), () => setNews('ask')); }}>Yes, email me</button>
        </div>
      )}
      {news === 'done' && newsletter !== 'subscribed' && <p className="dd-lead">You’re on the list. Thank you!</p>}
      <button type="button" className="text-link" onClick={onClose}>Close</button>
    </motion.div>
  );
}

/* ---------------- One team ---------------- */

function TeamDashboard({ c, app, data, onChange, onEdit }: { c: TeamComp; app: TeamApp; data: TeamData; onChange: () => void; onEdit: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const withdraw = async () => {
    if (!window.confirm(`Withdraw ${app.teamName} from the competition? This can’t be undone.`)) return;
    setBusy(true);
    try { await authApi(`/competitions/${c.slug}/team/${app.id}/withdraw`, { method: 'POST' }); onChange(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const role = (k: string) => c.team.roles.find((r) => r.key === k)?.label ?? k;
  return (
    <article className={`dd-card dd-card--${app.status}`}>
      <header className="dd-card__head">
        <div>
          <div className="dd-card__kicker">{app.code} · {app.categoryLabel}</div>
          <h3 className="dd-card__title">{app.teamName}</h3>
          <div className="dd-card__meta">{app.institutionName || 'Other institutions'} · {app.city}, {app.stateName}</div>
        </div>
        <span className={`dd-stamp dd-stamp--${app.status}`}>{app.statusText}</span>
      </header>

      {app.result && <div className="dd-result">★ {app.result}</div>}
      {app.status === 'pending' && <p className="dd-lead">We’re checking your registration (usually within 48 hours). The competition section opens as soon as it’s approved. {app.canEdit && 'You can still change it.'}</p>}
      {app.status === 'changes_requested' && (
        <div className="dd-bubble"><b>The Organiser says:</b> {app.reviewNote}</div>
      )}
      {app.status === 'rejected' && <div className="dd-bubble dd-bubble--sad"><b>Not approved.</b> {app.reviewNote || 'Reply to our email if you think this is a mistake.'}</div>}
      {app.status === 'withdrawn' && <p className="dd-lead">This team was withdrawn.</p>}

      <ul className="dd-members">
        {app.members.map((m, i) => (
          <li key={i}>
            <b>{m.fullName}</b>{m.captain && <span className="dd-tag">Captain</span>}
            <span>{m.roles.map(role).join(', ')}{m.age !== null ? ` · ${m.age} yrs` : ''}{app.institutionType === 'other' && m.institutionName ? ` · ${m.institutionName}` : ''}</span>
          </li>
        ))}
      </ul>

      {app.notices.length > 0 && (
        <div className="dd-notices">
          <h4 className="dd-h4">Notices for your team</h4>
          {app.notices.map((n) => <div key={n.id} className="dd-notice"><b>{n.title}</b><span>{istDateTime(n.createdAt)}</span><p>{n.body}</p></div>)}
        </div>
      )}

      {app.status === 'approved' && (
        <div className="dd-unlocked">
          <div className="dd-unlocked__head">
            <h4 className="dd-h4">Competition section</h4>
            <Countdown to={data.dates.submissionDeadline} label="Uploads close in" />
          </div>
          {data.brief && <StoryBriefPanel brief={data.brief} topicDocUrl={data.topicDocUrl} />}
          <p className="dd-lead">Upload by <b>{istDateTime(data.dates.submissionDeadline)}</b>. You can replace a file until then; the last upload before the deadline is judged. Upload early!</p>
          {app.files.map((f) => <FileSlot key={f.kind} c={c} app={app} spec={f} onDone={onChange} />)}
          <div className="dd-links">
            <Link to={`/competitions/${c.slug}/confirmation/${app.id}`} className="btn btn--outline btn--sm">Registration confirmation</Link>
            <Link to={`/competitions/${c.slug}/rules`} className="text-link">Rules and terms</Link>
            {data.rulesDocUrl && <a href={data.rulesDocUrl} target="_blank" rel="noreferrer" className="text-link">Official PDF</a>}
          </div>
        </div>
      )}

      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="dd-card__foot">
        {app.canEdit && <button type="button" className="btn dd-btn" onClick={onEdit}>{app.status === 'changes_requested' ? 'Update the application' : 'Change the application'}</button>}
        {app.canWithdraw && <button type="button" className="text-link dd-quiet" disabled={busy} onClick={withdraw}>Withdraw the team</button>}
        {!app.own && <span className="dd-quiet">Registered by someone else; only they can change it.</span>}
      </div>
    </article>
  );
}

function FileSlot({ c, app, spec, onDone }: { c: TeamComp; app: TeamApp; spec: TeamApp['files'][number]; onDone: () => void }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    setErr(null);
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { setErr('Choose a PDF file.'); return; }
    if (file.size > spec.maxMb * 1024 * 1024) { setErr(`This file is ${sizeText(file.size)}; the limit is ${spec.maxMb} MB.`); return; }
    try {
      setProgress(0); setStage('Uploading');
      const u = await authApi<{ key: string; url: string }>(`/competitions/${c.slug}/team/${app.id}/uploads`, { method: 'POST', body: { kind: spec.kind, contentType: 'application/pdf', size: file.size } });
      await putWithRetry(u.url, file, 'application/pdf', setProgress);
      setStage('Checking the pages');
      await authApi(`/competitions/${c.slug}/team/${app.id}/files`, { method: 'POST', body: { kind: spec.kind, key: u.key, name: file.name } });
      onDone();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setProgress(null); setStage('');
    }
  };
  const cur = spec.current;
  const open = async () => {
    try { window.open((await authApi<{ url: string }>(`/competitions/${c.slug}/team/${app.id}/files/${cur!.id}`)).url, '_blank', 'noopener'); } catch (e) { setErr(errorMessage(e)); }
  };
  return (
    <div className={'dd-file' + (cur ? ' is-done' : '')}>
      <div className="dd-file__head">
        <b>{spec.label}</b>
        {cur ? <span className="dd-file__ok">✓ {cur.pages ? `${cur.pages} pages · ` : ''}{sizeText(cur.size)} · {istDateTime(cur.uploadedAt)}</span> : <span className="dd-file__todo">Not uploaded yet</span>}
      </div>
      <p className="dd-file__help">{spec.help}</p>
      {progress !== null ? (
        <div className="dd-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={stage}>
          <span style={{ width: `${Math.max(4, progress * 100)}%` }} /><em>{stage}{stage === 'Uploading' ? ` ${Math.round(progress * 100)}%` : '…'}</em>
        </div>
      ) : app.canUpload ? (
        <div className="dd-file__actions">
          <button type="button" className="btn dd-btn" onClick={() => input.current?.click()}>{cur ? 'Replace the PDF' : 'Upload the PDF'}</button>
          {cur && <button type="button" className="text-link" onClick={open}>Open</button>}
          <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(f); }} />
        </div>
      ) : cur && <button type="button" className="text-link" onClick={open}>Open</button>}
      {err && <div className="form-error" role="alert">{err}</div>}
      {spec.history.length > 1 && (
        <details className="dd-history">
          <summary>Upload history ({spec.history.length})</summary>
          <ul>{spec.history.map((h, i) => <li key={i}>{istDateTime(h.uploadedAt)} · {h.name} · {h.pages ? `${h.pages} pages · ` : ''}{sizeText(h.size)}{h.replacedAt ? ' · replaced' : ' · current'}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

/* ---------------- Registration, in four steps ---------------- */

/**
 * The form is saved on this device as it's filled in, so a leader can leave to collect a
 * teammate's details and come back to it. One draft per competition and account (and per
 * application, when changing one); kept 30 days, removed once sent.
 */
interface Draft { team: TeamInput; step: Step; savedAt: number }
const DRAFT_DAYS = 30;
const draftKey = (slug: string, email: string, editId?: string) => `elden-team-draft:${slug}:${email.toLowerCase()}${editId ? `:${editId}` : ''}`;
function readDraft(key: string): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(key) ?? 'null') as Draft | null;
    if (!d || !d.team || !Array.isArray(d.team.members) || Date.now() - d.savedAt > DRAFT_DAYS * 86_400_000) return null;
    return d;
  } catch { return null; }
}
const forgetDraft = (key: string) => { try { localStorage.removeItem(key); } catch { /* ignore */ } };
const savedTime = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** A field's error, shown under it. */
const FieldErr = ({ msg }: { msg?: string }) => (msg ? <span className="field__error dd-field-err">{msg}</span> : null);
/** How a form part asks for its field's error (when it should show) and says it was left. */
type ErrOf = (field: string) => string | undefined;
type Touch = (field: string) => void;

type Step = 0 | 1 | 2 | 3;
const STEPS = ['Team', 'Members', 'Parents & guardians', 'Review & send'];

/** Which step an error belongs to, so each step only shows its own. */
function stepOf(e: string): Step {
  if (/^(Give your team|The team name|Name the|Add the team|Choose the team|Choose whether)/.test(e)) return 0;
  if (/parent|guardian/i.test(e) && /^(Team captain|Member \d)/.test(e)) return 2;
  if (/^(Accept the rules|Confirm that)/.test(e)) return 3;
  return 1;
}

function RegisterWizard({ c, data, accountEmail, edit, onCancel, onDone }: {
  c: TeamComp; data: TeamData; accountEmail: string; edit: TeamApp | null; onCancel: () => void; onDone: (a: TeamApp) => void;
}) {
  const cfg = c.team;
  const p = data.profile;
  const states = useStoreConfig()?.states ?? [];
  const key = draftKey(c.slug, accountEmail, edit?.id);
  const [draft] = useState(() => readDraft(key));
  const fresh = (): TeamInput => {
    if (edit) {
      return {
        teamName: edit.teamName, institutionType: edit.institutionType, institutionName: edit.institutionName, city: edit.city, state: edit.state,
        members: edit.members.map((m) => ({ ...emptyMember(), ...m, guardianConsent: Boolean(m.guardianConsent) } as MemberInput)), acceptRules: false, confirmTrue: false,
      };
    }
    const first = emptyMember();
    if (p?.type === 'student') {
      Object.assign(first, { fullName: p.fullName, dob: p.dob ?? '', email: accountEmail, phone: p.phone, instagram: p.instagram, guardianName: p.guardianName, guardianPhone: p.guardianPhone });
    }
    const inst = p && ['student', 'teacher'].includes(p.type ?? '') ? { institutionType: p.institutionType, institutionName: p.institutionType === 'other' ? '' : p.institutionName } : { institutionType: '', institutionName: '' };
    return { teamName: '', ...inst, city: p?.city ?? '', state: p?.state ?? '', members: [first, emptyMember()], acceptRules: false, confirmTrue: false };
  };
  // A saved draft wins over a fresh form (the ticks on the last step are always asked again).
  const [team, setTeam] = useState<TeamInput>(() => (draft ? { ...draft.team, members: draft.team.members.map((m) => ({ ...emptyMember(), ...m })), acceptRules: false, confirmTrue: false } : fresh()));
  // Back where they were: the Team or Members step (later steps are checked again from there).
  const [step, setStep] = useState<Step>(() => (draft && draft.step >= 1 ? 1 : 0));
  const [restored, setRestored] = useState<number | null>(draft?.savedAt ?? null);
  const dirty = useRef(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Save as they type (a moment after the last change).
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      try {
        const at = Date.now();
        localStorage.setItem(key, JSON.stringify({ team: { ...team, acceptRules: false, confirmTrue: false }, step: step === 3 ? 1 : step, savedAt: at } satisfies Draft));
        setSavedAt(at);
      } catch { /* storage full or blocked: nothing saved */ }
    }, 400);
    return () => clearTimeout(t);
  }, [team, step, key]);
  const startOver = () => {
    if (!window.confirm('Clear everything typed in this form and start again?')) return;
    forgetDraft(key); dirty.current = false; setTeam(fresh()); setStep(0); setRestored(null); setSavedAt(null); setTouched(new Set()); setShowErrors(false);
  };
  useEffect(() => { if (!edit) trackStep(c.slug, 'start'); }, [edit, c.slug]);
  const [showErrors, setShowErrors] = useState(false);
  // Fields the leader has been in and left: their errors show straight away.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const touch: Touch = (f) => setTouched((t) => (t.has(f) ? t : new Set(t).add(f)));
  const [busy, setBusy] = useState(false);
  const [serverErrs, setServerErrs] = useState<string[]>([]);
  const top = useRef<HTMLDivElement>(null);

  const check = useMemo(() => checkTeam(cfg, team), [cfg, team]);
  const minors = team.members.map((m, i) => ({ m, i, age: ageOn(m.dob, cfg.ageOn) })).filter((x) => x.age !== null && x.age < 18);
  const steps: Step[] = minors.length ? [0, 1, 2, 3] : [0, 1, 3];
  const stepErrors = check.errors.filter((e) => stepOf(e) === step);
  const fieldMsgs = new Set(Object.values(check.fields));
  const errOf: ErrOf = (f) => (showErrors || touched.has(f) ? check.fields[f] : undefined);
  // Errors about the whole team (no single field) are listed at the bottom.
  // On the last step, everything still wrong is listed (earlier steps' fields aren't on screen), except its own two ticks.
  const tickMsgs = new Set([check.fields.acceptRules, check.fields.confirmTrue]);
  const teamErrors = !showErrors ? [] : step === 3 ? check.errors.filter((e) => !tickMsgs.has(e)) : stepErrors.filter((e) => !fieldMsgs.has(e));
  const fieldErrorCount = showErrors ? stepErrors.filter((e) => fieldMsgs.has(e)).length : 0;
  // After "Next" with errors, bring the first one into view.
  useEffect(() => {
    if (!showErrors) return;
    const el = top.current?.querySelector('[aria-invalid="true"], .dd-field-err');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.focus({ preventScroll: true });
  }, [showErrors, step]);
  const inst = cfg.institutionTypes.find((x) => x.key === team.institutionType);
  const setT = (o: Partial<TeamInput>) => { dirty.current = true; setTeam({ ...team, ...o }); setServerErrs([]); };
  const setM = (i: number, o: Partial<MemberInput>) => setT({ members: team.members.map((m, k) => (k === i ? { ...m, ...o } : m)) });
  const go = (to: Step, withErrors = false) => {
    dirty.current = true;
    setStep(to); setShowErrors(withErrors); if (!withErrors) top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Analytics: how far new registrations get (not edits).
    if (!edit && to === 1) trackStep(c.slug, 'members');
    if (!edit && to === 3) trackStep(c.slug, 'review');
  };
  const next = () => {
    if (stepErrors.length) { setShowErrors(true); return; }
    go(steps[steps.indexOf(step) + 1]);
  };
  const submit = async () => {
    if (check.errors.length) { const first = stepOf(check.errors[0]); if (first !== 3) go(first, true); else setShowErrors(true); return; }
    setBusy(true); setServerErrs([]);
    try {
      const r = edit
        ? await authApi<{ application: TeamApp }>(`/competitions/${c.slug}/team/${edit.id}`, { method: 'PUT', body: team })
        : await authApi<{ application: TeamApp }>(`/competitions/${c.slug}/team`, { method: 'POST', body: team });
      forgetDraft(key);
      onDone(r.application);
      // Meta CompleteRegistration for a new registration only (not an edit), after the success screen.
      if (!edit) trackRegistration(r.application.id, c.slug);
    } catch (e) {
      const list = e instanceof ApiError && (e.details as { problems?: string[] } | undefined)?.problems;
      setServerErrs(list && list.length ? list : [errorMessage(e)]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dd-wizard" ref={top}>
      <div className="dd-wizard__head">
        <h3 className="dd-h3">{edit ? `Update ${edit.teamName}` : 'Register your team'}</h3>
        <ol className="dd-steps">
          {steps.map((s, i) => <li key={s} className={s === step ? 'is-on' : steps.indexOf(step) > i ? 'is-done' : ''}><span>{i + 1}</span>{STEPS[s]}</li>)}
        </ol>
        {restored && (
          <div className="dd-draft" role="status">We kept what you typed on this device ({savedTime(restored)}), so you can carry on where you left off.{' '}
            <button type="button" className="text-link" onClick={startOver}>Start over</button></div>
        )}
        {check.group && <div className="dd-group">Age group: <b>{check.group.label}</b> ({check.group.min}–{check.group.max}), from the oldest member on {dayLabel(cfg.ageOn)}</div>}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={step} className="dd-wizard__body" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }}>
          {step === 0 && (
            <div className="dd-fields">
              <label className="field">Team name
                <input className="input input--white" value={team.teamName} onChange={(e) => setT({ teamName: e.target.value })} onBlur={() => touch('teamName')} aria-invalid={Boolean(errOf('teamName'))} maxLength={60} placeholder="Clean, original, not a brand or a film" />
                <FieldErr msg={errOf('teamName')} />
              </label>
              <fieldset className="dd-choice">
                <legend>The team is from a</legend>
                <div className="dd-choice__opts">
                  {cfg.institutionTypes.map((x) => (
                    <button key={x.key} type="button" role="radio" aria-checked={team.institutionType === x.key} className={'dd-opt' + (team.institutionType === x.key ? ' is-on' : '')} onClick={() => setT({ institutionType: x.key })}>{x.label}</button>
                  ))}
                </div>
                <FieldErr msg={errOf('institutionType')} />
              </fieldset>
              {inst && (
                <label className="field">{inst.same ? `Name of the ${inst.label.toLowerCase()}` : 'Name of the group or organisation (optional)'}
                  <input className="input input--white" value={team.institutionName} onChange={(e) => setT({ institutionName: e.target.value })} onBlur={() => touch('institutionName')} aria-invalid={Boolean(errOf('institutionName'))} maxLength={120} placeholder={inst.placeholder} />
                  <FieldErr msg={errOf('institutionName')} />
                  <small className="field__hint">{inst.same ? 'Every member must be a student of this school or college.' : 'Members may be from different institutions; each names their own on the next step.'}</small>
                </label>
              )}
              <div className="dd-row2">
                <label className="field">City or town<input className="input input--white" value={team.city} onChange={(e) => setT({ city: e.target.value })} onBlur={() => touch('city')} aria-invalid={Boolean(errOf('city'))} maxLength={60} /><FieldErr msg={errOf('city')} /></label>
                <label className="field">State
                  <select className="input input--white" aria-label="State" value={team.state} onChange={(e) => setT({ state: e.target.value })} onBlur={() => touch('state')} aria-invalid={Boolean(errOf('state'))}>
                    <option value="">Choose…</option>
                    {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
                  </select>
                  <FieldErr msg={errOf('state')} />
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="dd-fields">
              <p className="dd-lead">{cfg.minMembers} to {cfg.maxMembers} members, all aged {cfg.minAge} to {cfg.maxAge} on {dayLabel(cfg.ageOn)}. Members under 18 and adults can’t be on the same team. Member 1 is the team captain.</p>
              {team.members.map((m, i) => (
                <MemberCard key={i} c={c} m={m} i={i} otherInst={inst ? !inst.same : false} canRemove={team.members.length > cfg.minMembers}
                  errOf={(f) => errOf(`members.${i}.${f}`)} touch={(f) => touch(`members.${i}.${f}`)}
                  onChange={(o) => setM(i, o)} onRemove={() => setT({ members: team.members.filter((_, k) => k !== i) })} />
              ))}
              {team.members.length < cfg.maxMembers && <button type="button" className="btn btn--outline btn--md" onClick={() => setT({ members: [...team.members, emptyMember()] })}>+ Add a member</button>}
            </div>
          )}

          {step === 2 && (
            <div className="dd-fields">
              <p className="dd-lead">Every member under 18 needs a parent’s or guardian’s details and consent. If you’re not the parent, ask them first.</p>
              {minors.map(({ m, i, age }) => (
                <fieldset key={i} className="dd-member">
                  <legend>{m.fullName || `Member ${i + 1}`} <span>{age} yrs</span></legend>
                  <div className="dd-row2">
                    <label className="field">Parent’s or guardian’s name<input className="input input--white" value={m.guardianName} onChange={(e) => setM(i, { guardianName: e.target.value })} onBlur={() => touch(`members.${i}.guardianName`)} aria-invalid={Boolean(errOf(`members.${i}.guardianName`))} maxLength={80} /><FieldErr msg={errOf(`members.${i}.guardianName`)} /></label>
                    <label className="field">Relation
                      <select className="input input--white" aria-label="Relation" value={m.guardianRelation} onChange={(e) => setM(i, { guardianRelation: e.target.value })} onBlur={() => touch(`members.${i}.guardianRelation`)} aria-invalid={Boolean(errOf(`members.${i}.guardianRelation`))}>
                        <option value="">Choose…</option>
                        {['Mother', 'Father', 'Guardian'].map((r) => <option key={r}>{r}</option>)}
                      </select>
                      <FieldErr msg={errOf(`members.${i}.guardianRelation`)} />
                    </label>
                    <label className="field">Their mobile number<input className="input input--white" type="tel" inputMode="tel" placeholder="10-digit mobile number" value={m.guardianPhone} onChange={(e) => setM(i, { guardianPhone: e.target.value })} onBlur={() => touch(`members.${i}.guardianPhone`)} aria-invalid={Boolean(errOf(`members.${i}.guardianPhone`))} maxLength={16} /><FieldErr msg={errOf(`members.${i}.guardianPhone`)} /></label>
                    <label className="field">Their email <span className="field__opt">(optional)</span><input className="input input--white" type="email" value={m.guardianEmail} onChange={(e) => setM(i, { guardianEmail: e.target.value })} onBlur={() => touch(`members.${i}.guardianEmail`)} aria-invalid={Boolean(errOf(`members.${i}.guardianEmail`))} maxLength={120} /><FieldErr msg={errOf(`members.${i}.guardianEmail`)} /></label>
                  </div>
                  <label className="tick dd-consent">
                    <input type="checkbox" checked={m.guardianConsent} onChange={(e) => setM(i, { guardianConsent: e.target.checked })} /><span className="tick__box" aria-hidden="true" />
                    <span>{m.guardianName || 'The parent or guardian'} agrees that {m.fullName || 'this member'} takes part in {c.title}, under its rules and terms, and that these details are shared with Elden Academic Press to run it.</span>
                  </label>
                  <FieldErr msg={errOf(`members.${i}.guardianConsent`)} />
                </fieldset>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="dd-fields">
              <dl className="dd-review">
                <div><dt>Team</dt><dd>{team.teamName}</dd></div>
                <div><dt>From</dt><dd>{inst?.label}{team.institutionName ? `: ${team.institutionName}` : ''} · {team.city}, {states.find((s) => s.code === team.state)?.name ?? team.state}</dd></div>
                <div><dt>Age group</dt><dd>{check.group ? `${check.group.label} (${check.group.min}–${check.group.max})` : '—'}</dd></div>
                {team.members.map((m, i) => (
                  <div key={i}><dt>{i === 0 ? 'Captain' : `Member ${i + 1}`}</dt><dd>{m.fullName} · {ageOn(m.dob, cfg.ageOn) ?? '?'} yrs · {m.roles.map((r) => cfg.roles.find((x) => x.key === r)?.label).join(', ')}{m.idDocKey ? ' · ID ✓' : ''}</dd></div>
                ))}
              </dl>
              <label className="tick"><input type="checkbox" checked={team.acceptRules} onChange={(e) => setT({ acceptRules: e.target.checked })} /><span className="tick__box" aria-hidden="true" />
                <span>I’ve read the <Link to={`/competitions/${c.slug}/rules`} target="_blank">rules and terms</Link>, and every team member (and, for anyone under 18, their parent or guardian) agrees to them.</span></label>
              <FieldErr msg={errOf('acceptRules')} />
              <label className="tick"><input type="checkbox" checked={team.confirmTrue} onChange={(e) => setT({ confirmTrue: e.target.checked })} /><span className="tick__box" aria-hidden="true" />
                <span>The details are true. I understand false details or duplicate entries lead to disqualification.</span></label>
              <FieldErr msg={errOf('confirmTrue')} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {(fieldErrorCount > 0 || teamErrors.length > 0 || serverErrs.length > 0) && (
        <div className="form-error dd-errors" role="alert">
          {fieldErrorCount > 0 && step !== 3 && <p className="dd-errors__lead">Check the {fieldErrorCount === 1 ? 'field' : `${fieldErrorCount} fields`} marked in red above.</p>}
          <ul>{[...new Set(teamErrors.concat(serverErrs))].map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      <div className="dd-wizard__foot">
        {step !== steps[0] && <button type="button" className="btn btn--outline btn--md" onClick={() => go(steps[steps.indexOf(step) - 1])}>Back</button>}
        {step !== 3
          ? <button type="button" className="btn dd-btn" onClick={next}>Next</button>
          : <button type="button" className="btn dd-btn dd-btn--big" disabled={busy} onClick={submit}>{busy ? 'Sending…' : edit ? 'Send the changes' : 'Send the application'}</button>}
        <button type="button" className="text-link dd-quiet" onClick={onCancel}>Cancel</button>
      </div>
      <p className="dd-small">{savedAt ? `Saved on this device at ${savedTime(savedAt)}: you can leave and come back to finish. ` : 'What you type is saved on this device, so you can leave and come back to finish. '}Registration closes {istDateTime(data.dates.closesAt)}. You can change the application until it’s approved.</p>
    </div>
  );
}

function MemberCard({ c, m, i, otherInst, canRemove, errOf, touch, onChange, onRemove }: {
  c: TeamComp; m: MemberInput; i: number; otherInst: boolean; canRemove: boolean; errOf: ErrOf; touch: Touch; onChange: (o: Partial<MemberInput>) => void; onRemove: () => void;
}) {
  const bind = (f: string) => ({ onBlur: () => touch(f), 'aria-invalid': Boolean(errOf(f)) });
  const cfg = c.team;
  const age = ageOn(m.dob, cfg.ageOn);
  const minor = age !== null && age < 18;
  return (
    <fieldset className="dd-member">
      <legend>{i === 0 ? 'Team captain' : `Member ${i + 1}`}{age !== null && <span>{age} yrs on {dayLabel(cfg.ageOn)}</span>}
        {canRemove && <button type="button" className="text-link" onClick={onRemove}>Remove</button>}</legend>
      <div className="dd-row2">
        <label className="field">Full name<input className="input input--white" value={m.fullName} onChange={(e) => onChange({ fullName: e.target.value })} {...bind('fullName')} maxLength={80} autoComplete="off" /><FieldErr msg={errOf('fullName')} /></label>
        <label className="field">Date of birth<input className="input input--white" type="date" value={m.dob} onChange={(e) => onChange({ dob: e.target.value })} {...bind('dob')} min="1995-01-01" max={todayIST()} /><FieldErr msg={errOf('dob')} /></label>
        <label className="field">Email {minor && <span className="field__opt">(optional)</span>}<input className="input input--white" type="email" value={m.email} onChange={(e) => onChange({ email: e.target.value })} {...bind('email')} maxLength={120} /><FieldErr msg={errOf('email')} /></label>
        <label className="field">Mobile number {minor ? <span className="field__opt">(optional)</span> : <span className="field__opt">(email or mobile)</span>}<input className="input input--white" type="tel" inputMode="tel" placeholder="10-digit mobile number" value={m.phone} onChange={(e) => onChange({ phone: e.target.value })} {...bind('phone')} maxLength={16} /><FieldErr msg={errOf('phone')} /></label>
        {otherInst && <label className="field">Their school, college or institution<input className="input input--white" value={m.institutionName} onChange={(e) => onChange({ institutionName: e.target.value })} {...bind('institutionName')} maxLength={120} /><FieldErr msg={errOf('institutionName')} /></label>}
        {age !== null && cfg.instagramFromAge !== null && age >= cfg.instagramFromAge && (
          <label className="field">Instagram username<input className="input input--white" placeholder="@username" value={m.instagram} onChange={(e) => onChange({ instagram: e.target.value })} {...bind('instagram')} maxLength={31} />
            <FieldErr msg={errOf('instagram')} />
            <small className="field__hint">Members aged {cfg.instagramFromAge}+ must follow @{c.instagram}.</small></label>
        )}
      </div>
      <div className="dd-roles" role="group" aria-label="Roles">
        <span className="dd-roles__label">Roles</span>
        {cfg.roles.map((r) => (
          <label key={r.key} className={'dd-role' + (m.roles.includes(r.key) ? ' is-on' : '')}>
            <input type="checkbox" checked={m.roles.includes(r.key)} onChange={(e) => onChange({ roles: e.target.checked ? [...m.roles, r.key] : m.roles.filter((x) => x !== r.key) })} />
            {r.label}{r.help && <small> ({r.help})</small>}
          </label>
        ))}
        <FieldErr msg={errOf('roles')} />
      </div>
      <IdUpload c={c} m={m} onChange={onChange} err={errOf('idDocType')} />
    </fieldset>
  );
}

function IdUpload({ c, m, onChange, err: typeErr }: { c: TeamComp; m: MemberInput; onChange: (o: Partial<MemberInput>) => void; err?: string }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File) => {
    setErr(null);
    try {
      setProgress(0);
      // Photos are redrawn on the phone first: smaller, and without hidden data such as the location.
      const prepared = await preparePhoto(file);
      if (!['image/jpeg', 'image/png', 'application/pdf'].includes(prepared.type)) throw new Error('Choose a photo (JPG or PNG) or a PDF.');
      if (prepared.main.size > 10 * 1024 * 1024) throw new Error('The file is too big. The limit is 10 MB.');
      const u = await authApi<{ key: string; url: string }>(`/competitions/${c.slug}/team/id-upload`, { method: 'POST', body: { contentType: prepared.type, size: prepared.main.size } });
      await putWithRetry(u.url, prepared.main, prepared.type, setProgress);
      setName(file.name);
      onChange({ idDocKey: u.key });
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };
  return (
    <div className="dd-id">
      <label className="field">ID document
        <select className="input input--white" aria-label="ID document" value={m.idDocType} onChange={(e) => onChange({ idDocType: e.target.value })} aria-invalid={Boolean(typeErr)}>
          <option value="">Choose…</option>
          {c.team.idDocs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
        </select>
        <FieldErr msg={typeErr} />
        <small className="field__hint">Aadhaar is never required. If you use it, upload the masked version (only the last 4 digits showing).</small>
      </label>
      <div className="dd-id__file">
        {progress !== null ? <div className="dd-progress"><span style={{ width: `${Math.max(4, progress * 100)}%` }} /><em>Uploading {Math.round(progress * 100)}%</em></div> : (
          <>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => input.current?.click()}>{m.idDocKey ? 'Replace the ID' : 'Upload the ID'}</button>
            {m.idDocKey && <span className="dd-file__ok">✓ {name || 'ID on file'}</span>}
          </>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) pick(f); }} />
      </div>
      {err && <div className="form-error" role="alert">{err}</div>}
    </div>
  );
}
