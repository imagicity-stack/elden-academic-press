// Admin: one competition, in tabs. One Save covers every tab; Publish checks everything.
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { adminApi, ApiError, uploadFile, useAdmin } from '../api';
import { Btn, Card, Check, ErrorBox, Loading, Page, SelectField, TextArea, TextField, useAction } from '../ui';
import { CLASSES, COMPETITION_TYPES, istDateTime, TYPE_LABEL, type CompetitionStatus } from '../../shared/competition';
import { DEFAULT_DECLARATION } from '../../shared/consents';
import { StatusBadge } from './Competitions';
import { CompetitionEmails } from './CompetitionEmails';
import { CompetitionEntries } from './CompetitionEntries';

type Iso = string | null;
interface Comp {
  id: string; slug: string; entryCodePrefix: string; title: string; tagline: string; type: (typeof COMPETITION_TYPES)[number];
  prompt: string; description: string; rulesContent: string; rulesPdfKey: string | null; disclaimer: string;
  thumbnail9x16Key: string | null; image1x1Key: string | null; banner16x9Key: string | null; ogImageKey: string | null;
  languages: string[]; organiserName: string; faqs: { question: string; answer: string }[];
  judges: { name: string; role: string; photoKey: string | null }[];
  regionScope: 'pan_india' | 'states'; states: string[]; participationMode: 'individual' | 'team'; teamMin: number | null; teamMax: number | null;
  maxEntriesPerStudent: number; isPaid: boolean; feeAmountInr: number | null; seatCap: number | null;
  announceAt: Iso; registrationOpensAt: Iso; registrationClosesAt: Iso; submissionOpensAt: Iso; submissionClosesAt: Iso; submissionGraceMinutes: number;
  judgingStartsAt: Iso; shortlistAt: Iso; votingOpensAt: Iso; votingClosesAt: Iso; resultsAt: Iso;
  submissionRequired: boolean; allowedSubmissionTypes: ('file' | 'text' | 'link')[]; allowedMimeTypes: string[]; maxFileSizeMb: number; maxMainFiles: number;
  extraFiles: { key: string; label: string; helpText: string; required: boolean }[]; minWords: number | null; maxWords: number | null;
  allowEditUntilDeadline: boolean; allowWithdraw: boolean; declarationText: string; consentTextVersion: string; termsVersion: string;
  upsellRules: { classMin: number; classMax: number; productId: string | null; url: string | null; headline: string }[];
  seoTitle: string; seoDescription: string; publishState: 'draft' | 'published' | 'archived'; resultsPublished: boolean; status: CompetitionStatus;
}
interface Group { id?: string; name: string; letter: string; classMin: number; classMax: number; formatNote: string; minWords: number | null; maxWords: number | null; maxMainFiles: number | null }
interface Field { key: string; label: string; type: 'text' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'number'; options: string[]; required: boolean; helpText: string }
interface Resource { id?: string; title: string; description: string; fileKey: string; fileName: string; visibility: 'public' | 'registered_only'; url?: string | null }
interface Prize { groupLetter: string; rankFrom: number | null; rankTo: number | null; awardName: string; description: string; prizeType: 'physical' | 'voucher' | 'digital' | 'certificate' }
interface Detail {
  competition: Comp; media: Record<string, { key: string; url: string } | null>; judges: (Comp['judges'][number] & { photoUrl: string | null })[];
  groups: Group[]; fields: Field[]; resources: Resource[]; prizes: Prize[]; counts: { registrations: number; submissions: number };
  templates: unknown[];
}
interface State { c: Comp; groups: Group[]; fields: Field[]; resources: Resource[]; prizes: Prize[]; urls: Record<string, string | null> }

const TABS = [
  ['basics', 'Basics'], ['eligibility', 'Eligibility & groups'], ['schedule', 'Schedule'], ['registration', 'Registration'], ['submission', 'Submission'],
  ['resources', 'Resources'], ['prizes', 'Prizes & judges'], ['publishing', 'Publishing & SEO'], ['upsell', 'Upsell'], ['emails', 'Emails'], ['entries', 'Entries'],
] as const;

const MIME_OPTIONS: [string, string][] = [['image/jpeg', 'JPG photo'], ['image/png', 'PNG image'], ['image/webp', 'WebP image'], ['application/pdf', 'PDF'], ['video/mp4', 'MP4 video']];

// datetime-local inputs in India time. "Closes" times include the whole minute (11:59 PM = 23:59:59.999).
const toLocal = (iso: Iso) => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString().slice(0, 16) : '');
const fromLocal = (v: string, end = false) => (v ? new Date(`${v}:${end ? '59.999' : '00'}+05:30`).toISOString() : null);
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function fromDetail(d: Detail): State {
  const urls: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(d.media)) urls[k] = v?.url ?? null;
  d.judges.forEach((j, i) => { urls[`judge-${i}`] = j.photoUrl; });
  return {
    c: { ...d.competition, judges: d.judges.map(({ name, role, photoKey }) => ({ name, role, photoKey })) },
    groups: d.groups.map(({ id, name, letter, classMin, classMax, formatNote, minWords, maxWords, maxMainFiles }) => ({ id, name, letter, classMin, classMax, formatNote, minWords, maxWords, maxMainFiles })),
    fields: d.fields.map(({ key, label, type, options, required, helpText }) => ({ key, label, type, options, required, helpText })),
    resources: d.resources, prizes: d.prizes.map(({ groupLetter, rankFrom, rankTo, awardName, description, prizeType }) => ({ groupLetter, rankFrom, rankTo, awardName, description, prizeType })),
    urls,
  };
}

function payload(s: State) {
  const { id: _i, publishState: _p, resultsPublished: _r, status: _s, ...c } = s.c;
  return {
    competition: { ...c, upsellRules: c.upsellRules.map((u) => ({ ...u, url: u.url || null, productId: u.productId || null })) },
    groups: s.groups, fields: s.fields,
    resources: s.resources.map(({ url: _u, ...r }) => r), prizes: s.prizes,
  };
}

export default function CompetitionEditor() {
  const { id = '', tab = 'basics' } = useParams();
  const navigate = useNavigate();
  const { data, error, reload, setData } = useAdmin<Detail>(`/competitions/${id}`);
  const [s, setS] = useState<State | null>(null);
  const [saved, setSaved] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const { busy, run } = useAction();
  useEffect(() => { if (data) { const st = fromDetail(data); setS(st); setSaved(JSON.stringify(payload(st))); } }, [data]);
  const dirty = Boolean(s && JSON.stringify(payload(s)) !== saved);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <Page title="Competition"><ErrorBox error={error} retry={reload} /></Page>;
  if (!data || !s) return <Page title="Competition"><Loading /></Page>;
  const c = s.c;
  const setC = (patch: Partial<Comp>) => setS({ ...s, c: { ...c, ...patch } });

  const send = (key: string, path: string, method: string, ok: string, withBody = true) => run(key, async () => {
    setProblems([]);
    try {
      const d = await adminApi<Detail>(path, { method, ...(withBody ? { body: payload(s) } : { body: {} }) });
      setData(d);
      return d;
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object' && 'problems' in e.details) setProblems((e.details as { problems: string[] }).problems);
      throw e;
    }
  }, ok);

  const preview = (as: 'parent' | 'student') => run(`preview-${as}`, async () => {
    const r = await adminApi<{ url: string }>(`/competitions/${id}/preview`, { body: { as } });
    window.open(r.url, '_blank', 'noopener');
  });

  const actions = (
    <>
      <Btn onClick={() => preview('parent')} busy={busy === 'preview-parent'}>Preview as parent</Btn>
      <Btn onClick={() => preview('student')} busy={busy === 'preview-student'}>Preview as student</Btn>
      <Btn kind="primary" busy={busy === 'save'} disabled={!dirty} onClick={() => send('save', `/competitions/${id}`, 'PUT', 'Saved')}>Save{c.publishState === 'draft' ? ' draft' : ''}</Btn>
      {c.publishState !== 'published' && <Btn kind="accent" busy={busy === 'publish'} onClick={() => confirm('Publish? It becomes visible from its announcement date.') && send('publish', `/competitions/${id}/publish`, 'POST', 'Published')}>Publish</Btn>}
    </>
  );

  return (
    <Page title={c.title} back={{ to: '/admin/competitions', label: 'Competitions' }}
      subtitle={<span className="ad-inline"><StatusBadge s={c.status} /> {data.counts.registrations} registered · {data.counts.submissions} submitted · /competitions/{c.slug}</span>}
      actions={actions}>
      {problems.length > 0 && <div className="ad-alert ad-alert--red"><div><b>Please fix:</b><ul className="ad-errlist">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div></div>}
      {dirty && tab !== 'emails' && tab !== 'entries' && <div className="ad-dirty">Unsaved changes</div>}
      <div className="ad-tabs ad-tabs--scroll">
        {TABS.map(([k, label]) => <NavLink key={k} to={`/admin/competitions/${id}/${k}`} className={() => 'ad-tab' + (tab === k ? ' is-on' : '')}>{label}</NavLink>)}
      </div>

      {tab === 'basics' && <Basics s={s} setS={setS} setC={setC} />}
      {tab === 'eligibility' && <Eligibility s={s} setS={setS} setC={setC} />}
      {tab === 'schedule' && <Schedule c={c} setC={setC} />}
      {tab === 'registration' && <Registration s={s} setS={setS} setC={setC} />}
      {tab === 'submission' && <Submission c={c} setC={setC} />}
      {tab === 'resources' && <Resources s={s} setS={setS} />}
      {tab === 'prizes' && <Prizes s={s} setS={setS} setC={setC} />}
      {tab === 'publishing' && (
        <Publishing s={s} setS={setS} setC={setC} counts={data.counts}
          onState={(state) => send(`state-${state}`, `/competitions/${id}/state`, 'POST', state === 'archived' ? 'Archived' : 'Back to draft', false).then(() => {})}
          onResults={(published) => run('results', () => adminApi<Detail>(`/competitions/${id}/results`, { body: { published } }).then(setData), published ? 'Results published' : 'Results hidden')}
          onDelete={() => confirm('Delete this draft for good?') && run('delete', () => adminApi(`/competitions/${id}`, { method: 'DELETE' }), 'Deleted').then((r) => r && navigate('/admin/competitions'))}
          busy={busy} />
      )}
      {tab === 'upsell' && <Upsell c={c} setC={setC} />}
      {tab === 'emails' && <CompetitionEmails id={id} dirty={dirty} />}
      {tab === 'entries' && <CompetitionEntries id={id} />}
    </Page>
  );
}

type Props = { s: State; setS: (s: State) => void; setC: (p: Partial<Comp>) => void };

/** Upload a picture or PDF to competition-media (public) or competition-files (private). */
function Upload({ label, hint, accept, bucket = 'competition-media', url, fileName, onDone, onClear }: {
  label: string; hint?: string; accept: string; bucket?: 'competition-media' | 'competition-files'; url?: string | null; fileName?: string;
  onDone: (r: { key: string; url: string | null; name: string }) => void; onClear?: () => void;
}) {
  const { busy, run } = useAction();
  const isImage = url && /\.(jpe?g|png|webp)$/i.test(url);
  return (
    <div className="ad-field">
      <span className="ad-label">{label}</span>
      {isImage && <img src={url!} alt="" className="ad-cp-thumb" />}
      {!isImage && (url || fileName) && <span className="ad-muted">{fileName || url?.split('/').pop()}</span>}
      <span className="ad-inline">
        <label className="ad-btn ad-btn--secondary ad-btn--sm">
          {busy === 'up' ? 'Uploading…' : url || fileName ? 'Replace' : 'Upload'}
          <input type="file" hidden accept={accept} onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (f) run('up', () => uploadFile(bucket, f), 'Uploaded — save to keep it').then((r) => r && onDone({ key: r.path, url: r.publicUrl, name: f.name }));
          }} />
        </label>
        {(url || fileName) && onClear && <button type="button" className="ad-link ad-neg" onClick={onClear}>Remove</button>}
      </span>
      {hint && <small className="ad-muted">{hint}</small>}
    </div>
  );
}

function Basics({ s, setS, setC }: Props) {
  const c = s.c;
  const media = (key: 'thumbnail9x16Key' | 'image1x1Key' | 'banner16x9Key', label: string, hint: string) => (
    <Upload label={label} hint={hint} accept="image/jpeg,image/png,image/webp" url={s.urls[key]}
      onDone={(r) => setS({ ...s, c: { ...c, [key]: r.key }, urls: { ...s.urls, [key]: r.url } })}
      onClear={() => setS({ ...s, c: { ...c, [key]: null }, urls: { ...s.urls, [key]: null } })} />
  );
  return (
    <div className="ad-grid-2">
      <Card title="About the competition">
        <div className="ad-form">
          <TextField label="Title" value={c.title} onChange={(e) => setC({ title: e.target.value })} />
          <TextField label="Tagline" value={c.tagline} onChange={(e) => setC({ tagline: e.target.value })} hint="One line under the title." />
          <SelectField label="Type" value={c.type} onChange={(e) => setC({ type: e.target.value as Comp['type'] })}>
            {COMPETITION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </SelectField>
          <TextArea label="Theme / prompt" rows={3} value={c.prompt} onChange={(e) => setC({ prompt: e.target.value })} hint="What students make. Shown big on the page." />
          <TextArea label="Description" rows={8} value={c.description} onChange={(e) => setC({ description: e.target.value })} hint="**bold**, [link](https://…), lines starting with “- ” or “1. ” make lists, “## ” a heading." />
          <TextField label="Languages" value={c.languages.join(', ')} onChange={(e) => setC({ languages: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} hint="Comma-separated, e.g. English, Hindi" />
          <TextField label="Organiser" value={c.organiserName} onChange={(e) => setC({ organiserName: e.target.value })} />
        </div>
      </Card>
      <Card title="Pictures">
        <div className="ad-form">
          {media('banner16x9Key', 'Banner (16:9)', 'Top of the page and emails. 1600 × 900 px.')}
          {media('image1x1Key', 'Square (1:1)', 'For sharing and cards. 1080 × 1080 px.')}
          {media('thumbnail9x16Key', 'Tall (9:16)', 'For WhatsApp status and stories. 1080 × 1920 px.')}
          <p className="ad-muted">Pictures here are public: never upload children’s work or photos of children.</p>
        </div>
      </Card>
    </div>
  );
}

const STATES_LIST: [string, string][] = [
  ['35', 'Andaman and Nicobar Islands'], ['37', 'Andhra Pradesh'], ['12', 'Arunachal Pradesh'], ['18', 'Assam'], ['10', 'Bihar'], ['04', 'Chandigarh'], ['22', 'Chhattisgarh'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['07', 'Delhi'], ['30', 'Goa'], ['24', 'Gujarat'], ['06', 'Haryana'], ['02', 'Himachal Pradesh'], ['01', 'Jammu and Kashmir'],
  ['20', 'Jharkhand'], ['29', 'Karnataka'], ['32', 'Kerala'], ['38', 'Ladakh'], ['31', 'Lakshadweep'], ['23', 'Madhya Pradesh'], ['27', 'Maharashtra'], ['14', 'Manipur'],
  ['17', 'Meghalaya'], ['15', 'Mizoram'], ['13', 'Nagaland'], ['21', 'Odisha'], ['34', 'Puducherry'], ['03', 'Punjab'], ['08', 'Rajasthan'], ['11', 'Sikkim'],
  ['33', 'Tamil Nadu'], ['36', 'Telangana'], ['16', 'Tripura'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'], ['19', 'West Bengal'],
];

function Eligibility({ s, setS, setC }: Props) {
  const c = s.c;
  const setGroup = (i: number, patch: Partial<Group>) => setS({ ...s, groups: s.groups.map((g, k) => (k === i ? { ...g, ...patch } : g)) });
  const nextLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find((l) => !s.groups.some((g) => g.letter === l)) ?? 'Z';
  const classSel = (value: number, onChange: (n: number) => void, label: string) => (
    <SelectField label={label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>{CLASSES.map((n) => <option key={n} value={n}>Class {n}</option>)}</SelectField>
  );
  return (
    <>
      <Card title="Groups" actions={<Btn size="sm" onClick={() => setS({ ...s, groups: [...s.groups, { name: `Group ${nextLetter}`, letter: nextLetter, classMin: 3, classMax: 12, formatNote: '', minWords: null, maxWords: null, maxMainFiles: null }] })}>+ Add group</Btn>}>
        <p className="ad-muted">Students are placed in a group by class, automatically. Classes can’t overlap. The letter appears in entry codes ({c.entryCodePrefix}-A-0042).</p>
        {s.groups.map((g, i) => (
          <div key={g.id ?? `new-${i}`} className="ad-cp-row">
            <div className="ad-form-grid">
              <TextField label="Name" value={g.name} onChange={(e) => setGroup(i, { name: e.target.value })} />
              <TextField label="Letter" value={g.letter} maxLength={1} onChange={(e) => setGroup(i, { letter: e.target.value.toUpperCase() })} />
              {classSel(g.classMin, (n) => setGroup(i, { classMin: n }), 'From')}
              {classSel(g.classMax, (n) => setGroup(i, { classMax: n }), 'To')}
            </div>
            <TextField label="Format" value={g.formatNote} onChange={(e) => setGroup(i, { formatNote: e.target.value })} placeholder="e.g. 4 to 8 panels, 1 A4 page" />
            <div className="ad-form-grid">
              <TextField label="Min words (optional)" type="number" value={g.minWords ?? ''} onChange={(e) => setGroup(i, { minWords: num(e.target.value) })} />
              <TextField label="Max words (optional)" type="number" value={g.maxWords ?? ''} onChange={(e) => setGroup(i, { maxWords: num(e.target.value) })} />
              <TextField label="Max main files (optional)" type="number" value={g.maxMainFiles ?? ''} onChange={(e) => setGroup(i, { maxMainFiles: num(e.target.value) })} />
            </div>
            <button type="button" className="ad-link ad-neg" onClick={() => setS({ ...s, groups: s.groups.filter((_, k) => k !== i) })}>Remove group</button>
          </div>
        ))}
      </Card>
      <Card title="Where">
        <div className="ad-form">
          <SelectField label="Open to" value={c.regionScope} onChange={(e) => setC({ regionScope: e.target.value as Comp['regionScope'] })}>
            <option value="pan_india">All of India</option><option value="states">Only some states</option>
          </SelectField>
          {c.regionScope === 'states' && (
            <div className="ad-cp-states">
              {STATES_LIST.map(([code, name]) => (
                <Check key={code} label={name} checked={c.states.includes(code)} onChange={(on) => setC({ states: on ? [...c.states, code] : c.states.filter((x) => x !== code) })} />
              ))}
            </div>
          )}
          <SelectField label="Entries" value={c.participationMode} onChange={(e) => setC({ participationMode: e.target.value as Comp['participationMode'] })}>
            <option value="individual">Individual</option><option value="team">Team (coming later)</option>
          </SelectField>
        </div>
      </Card>
    </>
  );
}

function DateField({ label, value, onChange, end = false, hint }: { label: string; value: Iso; onChange: (v: Iso) => void; end?: boolean; hint?: string }) {
  return <TextField label={`${label} (IST)`} type="datetime-local" value={toLocal(value)} onChange={(e) => onChange(fromLocal(e.target.value, end))} hint={hint ?? (value ? istDateTime(value) : 'Not set')} />;
}

function Schedule({ c, setC }: { c: Comp; setC: (p: Partial<Comp>) => void }) {
  return (
    <div className="ad-grid-2">
      <Card title="Windows">
        <div className="ad-form">
          <DateField label="Announce" value={c.announceAt} onChange={(v) => setC({ announceAt: v })} hint="Before this, the page is hidden. Leave empty to show it as soon as it’s published." />
          <DateField label="Registration opens" value={c.registrationOpensAt} onChange={(v) => setC({ registrationOpensAt: v })} />
          <DateField label="Registration closes" value={c.registrationClosesAt} onChange={(v) => setC({ registrationClosesAt: v })} end />
          {c.submissionRequired && <>
            <DateField label="Submissions open" value={c.submissionOpensAt} onChange={(v) => setC({ submissionOpensAt: v })} />
            <DateField label="Submissions close" value={c.submissionClosesAt} onChange={(v) => setC({ submissionClosesAt: v })} end hint="Closing at 11:59 PM includes the whole minute (23:59:59)." />
            <TextField label="Grace minutes after the deadline" type="number" value={c.submissionGraceMinutes} onChange={(e) => setC({ submissionGraceMinutes: Number(e.target.value) || 0 })} hint="Quietly accepts entries a few minutes late (slow networks). Not shown to students." />
          </>}
          <p className="ad-muted">Registration and submission windows are separate and may overlap. The server decides using its own clock.</p>
        </div>
      </Card>
      <Card title="After the deadline">
        <div className="ad-form">
          <DateField label="Judging starts" value={c.judgingStartsAt} onChange={(v) => setC({ judgingStartsAt: v })} />
          <DateField label="Shortlist announced" value={c.shortlistAt} onChange={(v) => setC({ shortlistAt: v })} />
          <DateField label="Voting opens (optional)" value={c.votingOpensAt} onChange={(v) => setC({ votingOpensAt: v })} />
          <DateField label="Voting closes (optional)" value={c.votingClosesAt} onChange={(v) => setC({ votingClosesAt: v })} end />
          <DateField label="Results" value={c.resultsAt} onChange={(v) => setC({ resultsAt: v })} />
        </div>
      </Card>
    </div>
  );
}

function Registration({ s, setS, setC }: Props) {
  const c = s.c;
  const setField = (i: number, patch: Partial<Field>) => setS({ ...s, fields: s.fields.map((f, k) => (k === i ? { ...f, ...patch } : f)) });
  return (
    <>
      <Card title="Places">
        <div className="ad-form-grid">
          <TextField label="Seat limit (optional)" type="number" value={c.seatCap ?? ''} onChange={(e) => setC({ seatCap: num(e.target.value) })} hint="Registration closes when full." />
          <TextField label="Entries per student" type="number" value={c.maxEntriesPerStudent} onChange={(e) => setC({ maxEntriesPerStudent: Number(e.target.value) || 1 })} />
          <TextField label="Consent text version" value={c.consentTextVersion} onChange={(e) => setC({ consentTextVersion: e.target.value })} />
          <TextField label="Terms version" value={c.termsVersion} onChange={(e) => setC({ termsVersion: e.target.value })} />
        </div>
        <Check label="Paid competition (coming later)" checked={c.isPaid} onChange={(v) => setC({ isPaid: v })} />
      </Card>
      <Card title="Questions at registration" actions={<Btn size="sm" onClick={() => setS({ ...s, fields: [...s.fields, { key: `question_${s.fields.length + 1}`, label: 'New question', type: 'text', options: [], required: false, helpText: '' }] })}>+ Add question</Btn>}>
        <p className="ad-muted">Only these are asked: the student’s details come from their profile.</p>
        {s.fields.map((f, i) => (
          <div key={i} className="ad-cp-row">
            <div className="ad-form-grid">
              <TextField label="Question" value={f.label} onChange={(e) => setField(i, { label: e.target.value })} />
              <TextField label="Key (for exports)" value={f.key} onChange={(e) => setField(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
              <SelectField label="Answer type" value={f.type} onChange={(e) => setField(i, { type: e.target.value as Field['type'] })}>
                <option value="text">Short text</option><option value="textarea">Long text</option><option value="select">Choose one</option>
                <option value="multiselect">Choose several</option><option value="checkbox">Tick box</option><option value="number">Number</option>
              </SelectField>
              <TextField label="Help text" value={f.helpText} onChange={(e) => setField(i, { helpText: e.target.value })} />
            </div>
            {(f.type === 'select' || f.type === 'multiselect') && <TextArea label="Options (one per line)" rows={3} value={f.options.join('\n')} onChange={(e) => setField(i, { options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />}
            <span className="ad-inline">
              <Check label="Required" checked={f.required} onChange={(v) => setField(i, { required: v })} />
              <button type="button" className="ad-link ad-neg" onClick={() => setS({ ...s, fields: s.fields.filter((_, k) => k !== i) })}>Remove</button>
            </span>
          </div>
        ))}
      </Card>
    </>
  );
}

function Submission({ c, setC }: { c: Comp; setC: (p: Partial<Comp>) => void }) {
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v));
  return (
    <div className="ad-grid-2">
      <Card title="What students submit">
        <div className="ad-form">
          <Check label="Entries are uploaded on the website" hint="Switch off for registration-only events." checked={c.submissionRequired} onChange={(v) => setC({ submissionRequired: v })} />
          {c.submissionRequired && <>
            <span className="ad-label">How</span>
            <Check label="Files (drawings, photos, PDFs)" checked={c.allowedSubmissionTypes.includes('file')} onChange={(v) => setC({ allowedSubmissionTypes: toggle(c.allowedSubmissionTypes, 'file', v) })} />
            <Check label="Typed text (stories, essays, poems)" checked={c.allowedSubmissionTypes.includes('text')} onChange={(v) => setC({ allowedSubmissionTypes: toggle(c.allowedSubmissionTypes, 'text', v) })} />
            <Check label="A link (e.g. a video on YouTube)" checked={c.allowedSubmissionTypes.includes('link')} onChange={(v) => setC({ allowedSubmissionTypes: toggle(c.allowedSubmissionTypes, 'link', v) })} />
            {c.allowedSubmissionTypes.includes('file') && <>
              <span className="ad-label">File types</span>
              {MIME_OPTIONS.map(([m, l]) => <Check key={m} label={l} checked={c.allowedMimeTypes.includes(m)} onChange={(v) => setC({ allowedMimeTypes: toggle(c.allowedMimeTypes, m, v) })} />)}
              <div className="ad-form-grid">
                <TextField label="Max size per file (MB)" type="number" value={c.maxFileSizeMb} onChange={(e) => setC({ maxFileSizeMb: Number(e.target.value) || 1 })} hint="Up to 50 MB. Photos are shrunk on the phone first." />
                <TextField label="Main files" type="number" value={c.maxMainFiles} onChange={(e) => setC({ maxMainFiles: Number(e.target.value) || 1 })} />
              </div>
            </>}
            {c.allowedSubmissionTypes.includes('text') && (
              <div className="ad-form-grid">
                <TextField label="Min words" type="number" value={c.minWords ?? ''} onChange={(e) => setC({ minWords: num(e.target.value) })} />
                <TextField label="Max words" type="number" value={c.maxWords ?? ''} onChange={(e) => setC({ maxWords: num(e.target.value) })} />
              </div>
            )}
          </>}
        </div>
      </Card>
      <Card title="Extra files and rules">
        <div className="ad-form">
          <span className="ad-label">Extra files (e.g. a photo of the rough sketch)</span>
          {c.extraFiles.map((x, i) => (
            <div key={i} className="ad-cp-row">
              <div className="ad-form-grid">
                <TextField label="Label" value={x.label} onChange={(e) => setC({ extraFiles: c.extraFiles.map((y, k) => (k === i ? { ...y, label: e.target.value, key: y.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) } : y)) })} />
                <TextField label="Help text" value={x.helpText} onChange={(e) => setC({ extraFiles: c.extraFiles.map((y, k) => (k === i ? { ...y, helpText: e.target.value } : y)) })} />
              </div>
              <span className="ad-inline">
                <Check label="Required" checked={x.required} onChange={(v) => setC({ extraFiles: c.extraFiles.map((y, k) => (k === i ? { ...y, required: v } : y)) })} />
                <button type="button" className="ad-link ad-neg" onClick={() => setC({ extraFiles: c.extraFiles.filter((_, k) => k !== i) })}>Remove</button>
              </span>
            </div>
          ))}
          {c.extraFiles.length < 5 && <div><Btn size="sm" onClick={() => setC({ extraFiles: [...c.extraFiles, { key: `extra_${c.extraFiles.length + 1}`, label: 'Rough sketch photo', helpText: '', required: false }] })}>+ Add extra file</Btn></div>}
          <Check label="Students can edit until the deadline" checked={c.allowEditUntilDeadline} onChange={(v) => setC({ allowEditUntilDeadline: v })} />
          <Check label="Students can withdraw an entry" checked={c.allowWithdraw} onChange={(v) => setC({ allowWithdraw: v })} />
          <TextArea label="Declaration (ticked before submitting)" rows={3} value={c.declarationText} placeholder={DEFAULT_DECLARATION} onChange={(e) => setC({ declarationText: e.target.value })} hint="Empty = the default shown here." />
          <TextArea label="Rules" rows={8} value={c.rulesContent} onChange={(e) => setC({ rulesContent: e.target.value })} hint="One rule per line works best. The first few appear in emails as “quick rules”." />
        </div>
      </Card>
    </div>
  );
}

function Resources({ s, setS }: { s: State; setS: (s: State) => void }) {
  const setR = (i: number, patch: Partial<Resource>) => setS({ ...s, resources: s.resources.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const [vis, setVis] = useState<Resource['visibility']>('registered_only');
  return (
    <Card title="Resources" actions={
      <span className="ad-inline">
        <select className="ad-tabs__select" value={vis} onChange={(e) => setVis(e.target.value as Resource['visibility'])} aria-label="Who can download">
          <option value="registered_only">Registered only</option><option value="public">Anyone</option>
        </select>
        <Upload label="" accept="application/pdf,image/jpeg,image/png,image/webp,.zip" bucket={vis === 'public' ? 'competition-media' : 'competition-files'}
          onDone={(r) => setS({ ...s, resources: [...s.resources, { title: r.name.replace(/\.[^.]+$/, ''), description: '', fileKey: r.key, fileName: r.name, visibility: vis, url: r.url }] })} />
      </span>
    }>
      <p className="ad-muted">Starter kits, templates, sample entries. “Registered only” files are private: they open only for families who registered (and each download is counted).</p>
      {s.resources.length === 0 && <p className="ad-muted">No resources yet.</p>}
      {s.resources.map((r, i) => (
        <div key={r.id ?? r.fileKey} className="ad-cp-row">
          <div className="ad-form-grid">
            <TextField label="Title" value={r.title} onChange={(e) => setR(i, { title: e.target.value })} />
            <TextField label="Description" value={r.description} onChange={(e) => setR(i, { description: e.target.value })} />
          </div>
          <span className="ad-inline"><span className="ad-muted">{r.fileName} · {r.visibility === 'public' ? 'Anyone' : 'Registered only'}</span>
            <button type="button" className="ad-link ad-neg" onClick={() => setS({ ...s, resources: s.resources.filter((_, k) => k !== i) })}>Remove</button></span>
        </div>
      ))}
    </Card>
  );
}

function Prizes({ s, setS, setC }: Props) {
  const c = s.c;
  const setP = (i: number, patch: Partial<Prize>) => setS({ ...s, prizes: s.prizes.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const setJ = (i: number, patch: Partial<Comp['judges'][number]>) => setC({ judges: c.judges.map((j, k) => (k === i ? { ...j, ...patch } : j)) });
  return (
    <>
      <Card title="Prizes" actions={<Btn size="sm" onClick={() => setS({ ...s, prizes: [...s.prizes, { groupLetter: '', rankFrom: s.prizes.length + 1, rankTo: null, awardName: '', description: '', prizeType: 'certificate' }] })}>+ Add prize</Btn>}>
        <p className="ad-muted">Shown on the page. Leave the ranks empty for special awards.</p>
        {s.prizes.map((p, i) => (
          <div key={i} className="ad-cp-row">
            <div className="ad-form-grid">
              <TextField label="Award" value={p.awardName} onChange={(e) => setP(i, { awardName: e.target.value })} placeholder="e.g. First prize" />
              <SelectField label="Group" value={p.groupLetter} onChange={(e) => setP(i, { groupLetter: e.target.value })}>
                <option value="">All groups</option>{s.groups.map((g) => <option key={g.letter} value={g.letter}>{g.name}</option>)}
              </SelectField>
              <TextField label="Rank from" type="number" value={p.rankFrom ?? ''} onChange={(e) => setP(i, { rankFrom: num(e.target.value) })} />
              <TextField label="Rank to (optional)" type="number" value={p.rankTo ?? ''} onChange={(e) => setP(i, { rankTo: num(e.target.value) })} />
              <SelectField label="Kind" value={p.prizeType} onChange={(e) => setP(i, { prizeType: e.target.value as Prize['prizeType'] })}>
                <option value="physical">Physical prize</option><option value="voucher">Voucher</option><option value="digital">Digital</option><option value="certificate">Certificate</option>
              </SelectField>
              <TextField label="Description" value={p.description} onChange={(e) => setP(i, { description: e.target.value })} />
            </div>
            <button type="button" className="ad-link ad-neg" onClick={() => setS({ ...s, prizes: s.prizes.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
      </Card>
      <Card title="Judges" actions={<Btn size="sm" onClick={() => setC({ judges: [...c.judges, { name: '', role: '', photoKey: null }] })}>+ Add judge</Btn>}>
        {c.judges.map((j, i) => (
          <div key={i} className="ad-cp-row">
            <div className="ad-form-grid">
              <TextField label="Name" value={j.name} onChange={(e) => setJ(i, { name: e.target.value })} />
              <TextField label="Role" value={j.role} onChange={(e) => setJ(i, { role: e.target.value })} placeholder="e.g. Illustrator, author of …" />
            </div>
            <Upload label="Photo" accept="image/jpeg,image/png,image/webp" url={s.urls[`judge-${i}`]}
              onDone={(r) => setS({ ...s, c: { ...c, judges: c.judges.map((x, k) => (k === i ? { ...x, photoKey: r.key } : x)) }, urls: { ...s.urls, [`judge-${i}`]: r.url } })} />
            <button type="button" className="ad-link ad-neg" onClick={() => setC({ judges: c.judges.filter((_, k) => k !== i) })}>Remove judge</button>
          </div>
        ))}
      </Card>
      <Card title="FAQs" actions={<Btn size="sm" onClick={() => setC({ faqs: [...c.faqs, { question: '', answer: '' }] })}>+ Add question</Btn>}>
        {c.faqs.map((f, i) => (
          <div key={i} className="ad-cp-row">
            <TextField label="Question" value={f.question} onChange={(e) => setC({ faqs: c.faqs.map((x, k) => (k === i ? { ...x, question: e.target.value } : x)) })} />
            <TextArea label="Answer" rows={2} value={f.answer} onChange={(e) => setC({ faqs: c.faqs.map((x, k) => (k === i ? { ...x, answer: e.target.value } : x)) })} />
            <button type="button" className="ad-link ad-neg" onClick={() => setC({ faqs: c.faqs.filter((_, k) => k !== i) })}>Remove</button>
          </div>
        ))}
      </Card>
    </>
  );
}

function Publishing({ s, setS, setC, counts, onState, onResults, onDelete, busy }: Props & {
  counts: { registrations: number }; onState: (s: 'draft' | 'archived') => void; onResults: (p: boolean) => void; onDelete: () => void; busy: string | null;
}) {
  const c = s.c;
  return (
    <div className="ad-grid-2">
      <Card title="Web address and codes">
        <div className="ad-form">
          <TextField label="Web address" value={c.slug} onChange={(e) => setC({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} hint={`eldenap.in/competitions/${c.slug}`} />
          <TextField label="Entry code prefix" value={c.entryCodePrefix} maxLength={4} onChange={(e) => setC({ entryCodePrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} hint={`Entry codes look like ${c.entryCodePrefix || 'ABC'}-A-0042. Don’t change it once entries exist.`} />
          <TextArea label="Disclaimer (optional)" rows={3} value={c.disclaimer} onChange={(e) => setC({ disclaimer: e.target.value })} hint="Shown on the page and at the end of emails." />
          <Upload label="Rules PDF (optional, public)" accept="application/pdf" url={s.urls.rulesPdfKey}
            onDone={(r) => setS({ ...s, c: { ...c, rulesPdfKey: r.key }, urls: { ...s.urls, rulesPdfKey: r.url } })}
            onClear={() => setS({ ...s, c: { ...c, rulesPdfKey: null }, urls: { ...s.urls, rulesPdfKey: null } })} />
        </div>
      </Card>
      <Card title="Search and sharing">
        <div className="ad-form">
          <TextField label="Page title" placeholder={c.title} value={c.seoTitle} onChange={(e) => setC({ seoTitle: e.target.value })} />
          <TextArea label="Description" rows={2} placeholder={c.tagline} value={c.seoDescription} onChange={(e) => setC({ seoDescription: e.target.value })} hint="Shown by Google and in WhatsApp link previews." />
          <Upload label="Sharing image (optional)" hint="1200 × 630 px. Empty = the banner." accept="image/jpeg,image/png,image/webp" url={s.urls.ogImageKey}
            onDone={(r) => setS({ ...s, c: { ...c, ogImageKey: r.key }, urls: { ...s.urls, ogImageKey: r.url } })}
            onClear={() => setS({ ...s, c: { ...c, ogImageKey: null }, urls: { ...s.urls, ogImageKey: null } })} />
        </div>
      </Card>
      <Card title="State">
        <div className="ad-form">
          <p className="ad-muted">Now: <b>{c.publishState}</b>. Published competitions appear from the announcement date.</p>
          <span className="ad-inline">
            {c.publishState === 'published' && <Btn busy={busy === 'state-draft'} onClick={() => confirm('Take it off the website (back to draft)?') && onState('draft')}>Back to draft</Btn>}
            {c.publishState !== 'archived' && <Btn busy={busy === 'state-archived'} onClick={() => confirm('Archive? It disappears from the website; entries are kept.') && onState('archived')}>Archive</Btn>}
            {c.publishState === 'archived' && <Btn busy={busy === 'state-draft'} onClick={() => onState('draft')}>Restore as draft</Btn>}
            {c.publishState === 'draft' && counts.registrations === 0 && <Btn kind="danger" busy={busy === 'delete'} onClick={onDelete}>Delete draft</Btn>}
          </span>
          <Check label="Results are published" hint="Shows “Results out” on the page." checked={c.resultsPublished} onChange={onResults} />
        </div>
      </Card>
    </div>
  );
}

function Upsell({ c, setC }: { c: Comp; setC: (p: Partial<Comp>) => void }) {
  const { data } = useAdmin<{ items: { id: string; title: string; classLabel: string; status: string }[] }>('/products?limit=200');
  const products = useMemo(() => (data?.items ?? []).filter((p) => p.status === 'active'), [data]);
  const setU = (i: number, patch: Partial<Comp['upsellRules'][number]>) => setC({ upsellRules: c.upsellRules.map((u, k) => (k === i ? { ...u, ...patch } : u)) });
  const cls = (v: number, onChange: (n: number) => void, label: string) => (
    <SelectField label={label} value={String(v)} onChange={(e) => onChange(Number(e.target.value))}>{CLASSES.map((n) => <option key={n} value={n}>Class {n}</option>)}</SelectField>
  );
  return (
    <Card title="Book suggestions for parents" actions={<Btn size="sm" onClick={() => setC({ upsellRules: [...c.upsellRules, { classMin: 3, classMax: 12, productId: null, url: null, headline: '' }] })}>+ Add suggestion</Btn>}>
      <p className="ad-muted">Shown to parents only (never to students): on the registration confirmation, and in the parent’s email if they allowed book news.</p>
      {c.upsellRules.map((u, i) => (
        <div key={i} className="ad-cp-row">
          <div className="ad-form-grid">
            {cls(u.classMin, (n) => setU(i, { classMin: n }), 'For classes from')}
            {cls(u.classMax, (n) => setU(i, { classMax: n }), 'to')}
            <SelectField label="Book" value={u.productId ?? ''} onChange={(e) => setU(i, { productId: e.target.value || null })}>
              <option value="">— A link instead —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.title}{p.classLabel ? ` · ${p.classLabel}` : ''}</option>)}
            </SelectField>
            {!u.productId && <TextField label="Link" value={u.url ?? ''} onChange={(e) => setU(i, { url: e.target.value })} placeholder="https://eldenap.in/…" />}
          </div>
          <TextField label="Headline" value={u.headline} onChange={(e) => setU(i, { headline: e.target.value })} placeholder="e.g. Sharpen their storytelling with Creative Writing 6" />
          <button type="button" className="ad-link ad-neg" onClick={() => setC({ upsellRules: c.upsellRules.filter((_, k) => k !== i) })}>Remove</button>
        </div>
      ))}
    </Card>
  );
}

