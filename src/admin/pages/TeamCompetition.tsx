// Admin → Competitions → a team competition (DoomsDay Diaries): overview numbers,
// applications (review with secure ID viewing), submissions, notices and emails to groups
// of teams, shortlist and results, and settings (dates, pictures, official documents).
import { useEffect, useState } from 'react';
import { CompetitionAnalytics } from './CompetitionAnalytics';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import { adminApi, downloadFile, fmtDate, uploadFile, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Page, SelectField, TextArea, TextField, Toggle, type Tone, useAction, useToast } from '../ui';
import { findCompetition, istDateTime } from '../../shared/competitions';
import { RESULT_TEXT, STATUS_TEXT, type TeamConfig } from '../../shared/teams';

const TONE: Record<string, Tone> = { pending: 'amber', changes_requested: 'blue', approved: 'green', rejected: 'red', withdrawn: 'grey' };
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={TONE[s] ?? 'grey'}>{STATUS_TEXT[s] ?? s}</Badge>;
const TABS = [['overview', 'Overview'], ['analytics', 'Analytics'], ['applications', 'Applications'], ['submissions', 'Submissions'], ['notices', 'Notices & email'], ['results', 'Shortlist & results'], ['settings', 'Settings']] as const;
type TabKey = (typeof TABS)[number][0];

export function TeamCompetition({ slug }: { slug: string }) {
  const { tab = 'overview' } = useParams();
  const c = findCompetition(slug)!;
  const cfg = c.team!;
  return (
    <Page title={c.title} back={{ to: '/admin/competitions', label: 'Competitions' }}
      subtitle={<>Team competition · <a href={`/competitions/${slug}`} target="_blank" rel="noreferrer">View on the website ↗</a></>}>
      <nav className="ad-tabs ad-tt-tabs">
        {TABS.map(([k, label]) => <NavLink key={k} to={`/admin/competitions/${slug}/${k}`} className={() => 'ad-tab' + (tab === k ? ' is-on' : '')}>{label}</NavLink>)}
      </nav>
      {tab === 'overview' && <Overview slug={slug} />}
      {tab === 'analytics' && <CompetitionAnalytics slug={slug} />}
      {tab === 'applications' && <Applications slug={slug} cfg={cfg} />}
      {tab === 'submissions' && <Applications slug={slug} cfg={cfg} submissions />}
      {tab === 'notices' && <Notices slug={slug} cfg={cfg} />}
      {tab === 'results' && <Results slug={slug} cfg={cfg} />}
      {tab === 'settings' && <Settings slug={slug} />}
      {!TABS.some(([k]) => k === (tab as TabKey)) && <Empty title="Not found." />}
    </Page>
  );
}

/* ---------------- Overview ---------------- */

interface Stats {
  total: number; byStatus: Record<string, number>; byCategory: { key: string; label: string; teams: number; approved: number }[];
  byInstitution: { label: string; teams: number }[]; byState: { label: string; teams: number }[]; members: number; minors: number;
  uploads: Record<string, number>; daily: { d: string; n: number }[];
}
function Overview({ slug }: { slug: string }) {
  const { data, error, reload } = useAdmin<Stats>(`/competitions/${slug}/teams/stats`);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.byStatus;
  const max = Math.max(1, ...data.daily.map((d) => d.n));
  return (
    <div className="ad-stack">
      <div className="ad-stats">
        <Link className="ad-stat" to={`/admin/competitions/${slug}/applications?status=pending`}><span>Pending verification</span><b>{s.pending ?? 0}</b><small>{s.changes_requested ?? 0} waiting for changes</small></Link>
        <div className="ad-stat"><span>Approved teams</span><b>{s.approved ?? 0}</b><small>{s.rejected ?? 0} rejected · {s.withdrawn ?? 0} withdrawn</small></div>
        <div className="ad-stat"><span>Applications</span><b>{data.total}</b><small>{data.members} members in live teams</small></div>
        <div className="ad-stat"><span>Under 18</span><b>{data.minors}</b><small>members with a guardian’s consent</small></div>
        <div className="ad-stat"><span>Comics uploaded</span><b>{data.uploads.comic ?? 0}</b><small>of {s.approved ?? 0} approved teams</small></div>
        <div className="ad-stat"><span>Sketches uploaded</span><b>{data.uploads.sketches ?? 0}</b><small>proof of work</small></div>
      </div>
      <div className="ad-tt-grid">
        <Card title="By age group" flush>
          <table className="ad-table"><thead><tr><th>Group</th><th className="ad-num">Teams</th><th className="ad-num">Approved</th></tr></thead>
            <tbody>{data.byCategory.map((x) => <tr key={x.key}><td><Link to={`/admin/competitions/${slug}/applications?category=${x.key}`}>{x.label}</Link></td><td className="ad-num">{x.teams}</td><td className="ad-num">{x.approved}</td></tr>)}</tbody></table>
        </Card>
        <Card title="By institution" flush>
          <table className="ad-table"><tbody>{data.byInstitution.map((x) => <tr key={x.label}><td>{x.label}</td><td className="ad-num">{x.teams}</td></tr>)}</tbody></table>
        </Card>
        <Card title="Top states" flush>
          {data.byState.length ? <table className="ad-table"><tbody>{data.byState.map((x) => <tr key={x.label}><td>{x.label}</td><td className="ad-num">{x.teams}</td></tr>)}</tbody></table> : <p className="ad-nl-note ad-muted">No applications yet.</p>}
        </Card>
        <Card title="Applications per day (last 3 weeks)">
          {data.daily.length ? <ul className="ad-tt-days">{data.daily.map((d) => <li key={d.d}><span>{d.d.slice(5)}</span><i style={{ width: `${(d.n / max) * 100}%` }} /><b>{d.n}</b></li>)}</ul> : <p className="ad-muted">None yet.</p>}
        </Card>
      </div>
    </div>
  );
}

/* ---------------- Applications and submissions ---------------- */

interface Row {
  id: string; code: string; teamName: string; institution: string; institutionType: string; city: string; state: string; category: string;
  status: string; statusText: string; result: string; members: string[]; createdAt: string; email: string; files: Record<string, { pages: number | null; at: string }>;
  missing?: Missing[];
}
interface Missing { member: string; what: 'id' | 'instagram' }
/** "2 IDs, 1 Instagram" */
const missingText = (m: Missing[]) => {
  const ids = m.filter((x) => x.what === 'id').length;
  const ig = m.filter((x) => x.what === 'instagram').length;
  return [ids ? `${ids} ID${ids === 1 ? '' : 's'}` : '', ig ? `${ig} Instagram` : ''].filter(Boolean).join(', ');
};
interface ListData { items: Row[]; groups: TeamConfig['groups']; institutionTypes: TeamConfig['institutionTypes']; files: { kind: string; label: string }[]; states: { code: string; name: string }[] }

function Applications({ slug, cfg, submissions = false }: { slug: string; cfg: TeamConfig; submissions?: boolean }) {
  const navigate = useNavigate();
  const initial = Object.fromEntries(new URLSearchParams(location.search));
  const [f, setF] = useState<Record<string, string>>(submissions ? { status: 'approved', ...initial } : initial);
  const [q, setQ] = useState(f.q ?? '');
  const { busy, run } = useAction();
  const params = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const { data, error, reload } = useAdmin<ListData>(`/competitions/${slug}/teams?${params}`);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const exportCsv = (contacts: boolean) => {
    const p = new URLSearchParams(params); if (contacts) p.set('contacts', '1');
    run('csv', () => downloadFile(`/competitions/${slug}/teams/export.csv?${p}`, `${slug}-participants${contacts ? '-with-contacts' : ''}.csv`));
  };
  return (
    <Card flush title={submissions ? 'Artwork submissions (approved teams)' : 'Applications'} actions={
      <div className="ad-row">
        <Btn size="sm" busy={busy === 'csv'} onClick={() => exportCsv(false)}>Export participants</Btn>
        <Btn size="sm" kind="ghost" onClick={() => exportCsv(true)}>…with contacts</Btn>
      </div>
    }>
      {!submissions && (
        <div className="ad-chips ad-tt-chips">
          {[['', 'All'], ['pending', 'Pending verification'], ['changes_requested', 'Changes requested'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['withdrawn', 'Withdrawn']].map(([v, l]) => (
            <button key={v} type="button" className={(f.status ?? '') === v ? 'is-on' : ''} onClick={() => set('status', v)}>{l}</button>
          ))}
        </div>
      )}
      <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); set('q', q.trim()); }}>
        <input type="search" className="ad-search" placeholder="Team, ID (DD-12), member, email or institution" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Age group" value={f.category ?? ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All age groups</option>{cfg.groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select aria-label="Institution" value={f.institutionType ?? ''} onChange={(e) => set('institutionType', e.target.value)}>
          <option value="">All institutions</option>{cfg.institutionTypes.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </select>
        <select aria-label="State" value={f.state ?? ''} onChange={(e) => set('state', e.target.value)}>
          <option value="">All states</option>{data?.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <input type="search" placeholder="City" aria-label="City" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        {submissions && (
          <select aria-label="Files" value={f.files ?? ''} onChange={(e) => set('files', e.target.value)}>
            <option value="">Any upload state</option><option value="complete">Both files uploaded</option><option value="missing">Something missing</option>
          </select>
        )}
        <Btn size="sm" type="submit">Search</Btn>
      </form>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="Nothing here yet." /> : (
        <div className="ad-table-wrap">
          <table className="ad-table ad-table--click">
            <thead><tr><th>Team</th><th>Group</th><th>Institution · place</th><th>Members</th>{submissions ? data.files.map((x) => <th key={x.kind}>{x.label}</th>) : <th>Status</th>}<th>Registered</th></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id} onClick={() => navigate(`/admin/competitions/${slug}/teams/${r.id}`)}>
                  <td><Link to={`/admin/competitions/${slug}/teams/${r.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>{r.teamName}</Link><div className="ad-muted">{r.code}{r.result && ` · ${RESULT_TEXT[r.result]}`}</div></td>
                  <td>{r.category}</td>
                  <td><div>{r.institution || r.institutionType}</div><div className="ad-muted">{r.city}, {r.state}</div></td>
                  <td className="ad-muted">{r.members.join(', ')}{r.missing && r.missing.length > 0 && <div><Badge tone="amber">Missing: {missingText(r.missing)}</Badge></div>}</td>
                  {submissions ? data.files.map((x) => <td key={x.kind}>{r.files[x.kind] ? <Badge tone="green">✓ {r.files[x.kind].pages ?? '?'} pages</Badge> : <Badge tone="grey">Not yet</Badge>}</td>) : <td><StatusBadge s={r.status} /></td>}
                  <td className="ad-muted">{fmtDate(r.createdAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <p className="ad-nl-note ad-muted">{data.items.length} team{data.items.length === 1 ? '' : 's'}.</p>}
    </Card>
  );
}

/* ---------------- One application ---------------- */

interface Detail {
  id: string; code: string; teamName: string; institutionType: string; institutionName: string; city: string; state: string; category: string;
  status: string; statusText: string; reviewNote: string; adminNotes: string; result: string; flags: string[]; createdAt: string; updatedAt: string;
  reviewedAt: string | null; reviewedBy: string; acceptedTermsAt: string;
  registeredBy: { email: string; name: string; phone: string; type: string | null; city: string };
  members: { id: string; captain: boolean; fullName: string; dob: string; age: number | null; email: string; phone: string; institutionName: string; roles: string[]; instagram: string;
    idDocType: string; idDoc: boolean; idDocDeletedAt: string | null; guardianName: string; guardianRelation: string; guardianPhone: string; guardianEmail: string; guardianConsentAt: string | null }[];
  files: { id: string; kind: string; name: string; size: number; pages: number | null; uploadedAt: string; uploadedBy: string; replacedAt: string | null; available: boolean }[];
  notices: { title: string; createdAt: string }[];
  history: { at: string; actor: string; action: string; details: unknown }[];
  missing?: Missing[];
}
const ACTION: Record<string, string> = {
  'team.approve': 'Approved', 'team.request_changes': 'Changes requested', 'team.reject': 'Rejected', 'team.result': 'Result set', 'team.notes': 'Notes changed', 'team.view_id': 'ID document viewed',
};

export function TeamApplication({ slug, id }: { slug: string; id: string }) {
  const c = findCompetition(slug)!;
  const { data, error, reload } = useAdmin<Detail>(`/competitions/${slug}/teams/${id}`);
  const { busy, run } = useAction();
  const toast = useToast();
  const [review, setReview] = useState<'changes' | 'reject' | null>(null);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  if (error) return <Page title="Application" back={{ to: `/admin/competitions/${slug}/applications`, label: 'Applications' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!data) return <Loading />;
  const d = data;
  const act = (action: 'approve' | 'changes' | 'reject', msg = '') => run('review', () => adminApi(`/competitions/${slug}/teams/${id}/review`, { body: { action, message: msg } }), action === 'approve' ? 'Approved, and the team is emailed' : action === 'changes' ? 'Changes requested, and the team is emailed' : 'Rejected, and the team is emailed')
    .then((r) => { if (r) { setReview(null); setMessage(''); reload(); } });
  const openId = (memberId: string) => run('id', async () => { const r = await adminApi<{ url: string }>(`/competitions/${slug}/teams/${id}/id/${memberId}`); window.open(r.url, '_blank', 'noopener'); });
  const openFile = (fileId: string) => run('file', async () => { const r = await adminApi<{ url: string }>(`/competitions/${slug}/teams/${id}/files/${fileId}`); window.open(r.url, '_blank', 'noopener'); });
  const role = (r: string) => r;
  return (
    <Page title={d.teamName} back={{ to: `/admin/competitions/${slug}/applications`, label: 'Applications' }}
      subtitle={<>{d.code} · {d.category} · <StatusBadge s={d.status} />{d.result && <> · <Badge tone="navy">{RESULT_TEXT[d.result]}</Badge></>}</>}
      actions={d.status !== 'withdrawn' && (
        <div className="ad-row">
          {d.status !== 'approved' && <Btn kind="primary" busy={busy === 'review'} onClick={() => act('approve')}>Approve</Btn>}
          <Btn onClick={() => { setReview('changes'); setMessage(''); }}>Request changes</Btn>
          {d.status !== 'rejected' && <Btn kind="danger" onClick={() => { setReview('reject'); setMessage(''); }}>Reject</Btn>}
        </div>
      )}>
      <div className="ad-stack">
        {review && (
          <Card title={review === 'changes' ? 'What needs to change?' : 'Why is it rejected?'}>
            <TextArea label={review === 'changes' ? 'Message to the team (they see it on their team page and by email)' : 'Reason (optional; sent to the team)'} rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="ad-row">
              <Btn kind={review === 'reject' ? 'danger' : 'primary'} busy={busy === 'review'} disabled={review === 'changes' && message.trim().length < 5} onClick={() => act(review, message)}>{review === 'changes' ? 'Send the request' : 'Reject the application'}</Btn>
              <Btn kind="ghost" onClick={() => setReview(null)}>Cancel</Btn>
            </div>
          </Card>
        )}
        {d.reviewNote && <div className="ad-dirty">Last message to the team: “{d.reviewNote}”{d.reviewedBy && ` (${d.reviewedBy}, ${fmtDate(d.reviewedAt, true)})`}</div>}

        <div className="ad-tt-grid ad-tt-grid--2">
          <Card title="Team">
            <dl className="ad-kv">
              <div><dt>Institution</dt><dd>{d.institutionType}{d.institutionName ? `: ${d.institutionName}` : ''}</dd></div>
              <div><dt>Place</dt><dd>{d.city}, {d.state}</dd></div>
              <div><dt>Registered</dt><dd>{fmtDate(d.createdAt, true)} · terms accepted {fmtDate(d.acceptedTermsAt, true)}</dd></div>
              <div><dt>Registered by</dt><dd>{d.registeredBy.name} ({d.registeredBy.type ?? 'no profile type'}) · <a href={`mailto:${d.registeredBy.email}`}>{d.registeredBy.email}</a>{d.registeredBy.phone && <> · <a href={`https://wa.me/91${d.registeredBy.phone}`} target="_blank" rel="noreferrer">WhatsApp {d.registeredBy.phone}</a></>}</dd></div>
              {d.flags.length > 0 && <div><dt>Flags</dt><dd>{d.flags.join(', ')}</dd></div>}
            </dl>
          </Card>
          <Card title="Shortlist and notes">
            <SelectField label="Result" value={d.result} disabled={d.status !== 'approved'} onChange={(e) => run('result', () => adminApi(`/competitions/${slug}/teams/${id}/result`, { body: { result: e.target.value } }), 'Saved').then((r) => r && reload())}>
              <option value="">None</option>{Object.entries(RESULT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectField>
            <TextArea label="Private notes (admins only)" rows={3} value={notes ?? d.adminNotes} onChange={(e) => setNotes(e.target.value)} />
            {notes !== null && notes !== d.adminNotes && <Btn size="sm" kind="primary" busy={busy === 'notes'} onClick={() => run('notes', () => adminApi(`/competitions/${slug}/teams/${id}/notes`, { method: 'PUT', body: { notes } }), 'Notes saved').then((r) => { if (r) { setNotes(null); reload(); } })}>Save notes</Btn>}
            <Btn size="sm" onClick={() => setNotice({ title: '', body: '' })}>Send this team a notice…</Btn>
          </Card>
        </div>
        {notice && (
          <Card title={`Notice to ${d.teamName}`}>
            <TextField label="Title" value={notice.title} onChange={(e) => setNotice({ ...notice, title: e.target.value })} maxLength={150} />
            <TextArea label="Message" rows={5} value={notice.body} onChange={(e) => setNotice({ ...notice, body: e.target.value })} />
            <div className="ad-row">
              <Btn kind="primary" busy={busy === 'notice'} disabled={notice.title.trim().length < 3 || notice.body.trim().length < 3}
                onClick={() => run('notice', () => adminApi<{ emailed: number }>(`/competitions/${slug}/notices`, { body: { ...notice, audience: { applicationIds: [id] }, email: true } }))
                  .then((r) => { if (r) { toast(`Sent (${r.emailed} email${r.emailed === 1 ? '' : 's'})`); setNotice(null); reload(); } })}>Post and email</Btn>
              <Btn kind="ghost" onClick={() => setNotice(null)}>Cancel</Btn>
            </div>
          </Card>
        )}

        {d.missing && d.missing.length > 0 && (
          <div className="ad-alert ad-alert--amber">
            <div><b>Not given yet:</b> {d.missing.map((x) => `${x.what === 'id' ? 'ID document' : 'Instagram username'} for ${x.member}`).join('; ')}.
              {' '}The team can add them by changing the application (possible until it’s approved): ask them before approving.</div>
          </div>
        )}
        <Card title={`Members (${d.members.length})`} flush>
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Member</th><th>Born · age</th><th>Roles</th><th>Contact</th><th>Parent / guardian</th><th>ID document</th></tr></thead>
              <tbody>
                {d.members.map((m) => (
                  <tr key={m.id}>
                    <td><span className="ad-strong">{m.fullName}</span>{m.captain && <div className="ad-muted">Captain</div>}{m.institutionName && <div className="ad-muted">{m.institutionName}</div>}{m.instagram ? <div className="ad-muted">@{m.instagram}</div> : d.missing?.some((x) => x.what === 'instagram' && x.member === m.fullName) && <div><Badge tone="amber">No Instagram yet</Badge></div>}</td>
                    <td>{m.dob}<div className="ad-muted">{m.age} on {c.team!.ageOn}</div></td>
                    <td>{m.roles.map(role).join(', ')}</td>
                    <td>{m.email && <div><a href={`mailto:${m.email}`}>{m.email}</a></div>}{m.phone && <div>{m.phone}</div>}</td>
                    <td>{m.guardianName ? <>{m.guardianName} ({m.guardianRelation})<div>{m.guardianPhone}{m.guardianEmail && ` · ${m.guardianEmail}`}</div><div className="ad-muted">{m.guardianConsentAt ? `Consent ${fmtDate(m.guardianConsentAt, true)}` : 'No consent recorded'}</div></> : <span className="ad-muted">Adult</span>}</td>
                    <td>{m.idDocType}<div>{m.idDoc ? <Btn size="sm" busy={busy === 'id'} onClick={() => openId(m.id)}>View (5 min link)</Btn> : m.idDocDeletedAt ? <span className="ad-muted">Deleted {fmtDate(m.idDocDeletedAt)}</span> : <Badge tone="amber">Not uploaded yet</Badge>}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ad-nl-note ad-muted">Every ID view is recorded in the history below and in Settings → Activity.</p>
        </Card>

        <Card title="Submissions" flush>
          {d.files.length === 0 ? <p className="ad-nl-note ad-muted">{d.status === 'approved' ? 'Nothing uploaded yet.' : 'Uploads open once the team is approved.'}</p> : (
            <div className="ad-table-wrap">
              <table className="ad-table">
                <thead><tr><th>File</th><th>Pages</th><th>Size</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>
                  {d.files.slice().reverse().map((f) => (
                    <tr key={f.id}>
                      <td>{c.team!.files.find((x) => x.kind === f.kind)?.label ?? f.kind}<div className="ad-muted">{f.name}</div></td>
                      <td>{f.pages ?? <Badge tone="amber">Couldn’t count: check</Badge>}</td>
                      <td>{(f.size / 1048576).toFixed(1)} MB</td>
                      <td>{fmtDate(f.uploadedAt, true)}<div className="ad-muted">{f.uploadedBy}</div></td>
                      <td>{f.available ? <Btn size="sm" busy={busy === 'file'} onClick={() => openFile(f.id)}>Open</Btn> : <span className="ad-muted">Replaced {fmtDate(f.replacedAt, true)}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="ad-tt-grid ad-tt-grid--2">
          <Card title="Notices this team sees">
            {d.notices.length ? <ul className="ad-tt-list">{d.notices.map((n, i) => <li key={i}>{n.title} <span className="ad-muted">· {fmtDate(n.createdAt, true)}</span></li>)}</ul> : <p className="ad-muted">None.</p>}
          </Card>
          <Card title="History">
            {d.history.length ? <ul className="ad-tt-list">{d.history.map((h, i) => <li key={i}><span className="ad-muted">{fmtDate(h.at, true)}</span> {ACTION[h.action] ?? h.action} <span className="ad-muted">· {h.actor}</span></li>)}</ul> : <p className="ad-muted">No actions yet.</p>}
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ---------------- Notices and email ---------------- */

interface Notice { id: string; title: string; body: string; audience: { public?: boolean; statuses?: string[]; categories?: string[]; results?: string[]; applicationIds?: string[] }; emailed: number; createdBy: string; createdAt: string }

function Notices({ slug, cfg }: { slug: string; cfg: TeamConfig }) {
  const { data, error, reload } = useAdmin<{ items: Notice[] }>(`/competitions/${slug}/notices`);
  const { busy, run } = useAction();
  const toast = useToast();
  const [form, setForm] = useState({ title: '', body: '', where: 'teams' as 'public' | 'teams', statuses: ['pending', 'changes_requested', 'approved'] as string[], categories: [] as string[], shortlisted: false, email: true });
  const [reach, setReach] = useState<number | null>(null);
  const audience = form.where === 'public' ? { public: true } : { statuses: form.statuses, categories: form.categories, ...(form.shortlisted ? { results: ['shortlisted', 'first', 'second', 'third', 'peoples_choice'] } : {}) };
  const key = JSON.stringify(audience);
  useEffect(() => {
    const t = setTimeout(() => adminApi<{ teams: number }>(`/competitions/${slug}/notices/preview`, { body: { audience: form.where === 'public' ? {} : JSON.parse(key) } }).then((r) => setReach(r.teams), () => setReach(null)), 300);
    return () => clearTimeout(t);
  }, [key, slug, form.where]);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const describe = (a: Notice['audience']) => a.public ? 'Public, on the competition page'
    : a.applicationIds?.length ? `${a.applicationIds.length} team${a.applicationIds.length === 1 ? '' : 's'}`
    : [a.statuses?.map((s) => STATUS_TEXT[s]).join(', '), a.categories?.length ? a.categories.map((k) => cfg.groups.find((g) => g.key === k)?.label).join(', ') : 'all age groups', a.results?.length ? 'shortlisted' : ''].filter(Boolean).join(' · ');
  return (
    <div className="ad-tt-grid ad-tt-grid--2">
      <Card title="New notice">
        <div className="ad-form">
          <div className="ad-nl-seg">
            <button type="button" className={form.where === 'teams' ? 'is-on' : ''} onClick={() => setForm({ ...form, where: 'teams' })}>To teams</button>
            <button type="button" className={form.where === 'public' ? 'is-on' : ''} onClick={() => setForm({ ...form, where: 'public' })}>Public announcement</button>
          </div>
          {form.where === 'teams' ? (
            <>
              <div className="ad-field"><span className="ad-label">Status</span><div className="ad-row">
                {['pending', 'changes_requested', 'approved', 'rejected'].map((s) => <Check key={s} label={STATUS_TEXT[s]} checked={form.statuses.includes(s)} onChange={() => setForm({ ...form, statuses: toggle(form.statuses, s) })} />)}
              </div></div>
              <div className="ad-field"><span className="ad-label">Age groups (none ticked: all)</span><div className="ad-row">
                {cfg.groups.map((g) => <Check key={g.key} label={g.label} checked={form.categories.includes(g.key)} onChange={() => setForm({ ...form, categories: toggle(form.categories, g.key) })} />)}
              </div></div>
              <Check label="Shortlisted and winning teams only" checked={form.shortlisted} onChange={(v) => setForm({ ...form, shortlisted: v })} />
              <small className="ad-muted">Shown on these teams’ pages. {reach !== null && <b>{reach} team{reach === 1 ? '' : 's'} now.</b>} To write to one team, open its application.</small>
            </>
          ) : <small className="ad-muted">Shown in Announcements on the competition page. Ticking “Also email” sends it to all live teams ({reach ?? '…'}).</small>}
          <TextField label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={150} />
          <TextArea label="Message" rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <Check label="Also email it" hint="To the person who registered each team and its captain. Competition emails are separate from the newsletter." checked={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          <Btn kind="primary" busy={busy === 'send'} disabled={form.title.trim().length < 3 || form.body.trim().length < 3}
            onClick={() => run('send', () => adminApi<{ teams: number; emailed: number }>(`/competitions/${slug}/notices`, { body: { title: form.title, body: form.body, audience, email: form.email } }))
              .then((r) => { if (r) { toast(`Posted to ${r.teams} team${r.teams === 1 ? '' : 's'}${form.email ? `, ${r.emailed} emails` : ''}`); setForm({ ...form, title: '', body: '' }); reload(); } })}>
            Post{form.email ? ' and email' : ''}
          </Btn>
        </div>
      </Card>
      <Card title="Sent notices" flush>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <p className="ad-nl-note ad-muted">None yet.</p> : (
          <ul className="ad-tt-notices">
            {data.items.map((n) => (
              <li key={n.id}>
                <div className="ad-strong">{n.title}</div>
                <div className="ad-muted">{describe(n.audience)} · {fmtDate(n.createdAt, true)} · {n.emailed ? `${n.emailed} emailed` : 'not emailed'} · {n.createdBy}</div>
                <p>{n.body}</p>
                <button type="button" className="ad-link ad-neg" onClick={() => { if (window.confirm('Remove this notice from the website? Emails already sent stay sent.')) run('del', () => adminApi(`/competitions/${slug}/notices/${n.id}`, { method: 'DELETE' }), 'Removed').then((r) => r && reload()); }}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Shortlist and results ---------------- */

function Results({ slug, cfg }: { slug: string; cfg: TeamConfig }) {
  const { data, error, reload } = useAdmin<ListData>(`/competitions/${slug}/teams?status=approved`);
  const settings = useAdmin<{ settings: { resultsPublished: boolean } }>(`/competitions/${slug}/settings`);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !settings.data) return <Loading />;
  const published = settings.data.settings.resultsPublished;
  return (
    <div className="ad-stack">
      <Card title="Publish results">
        <div className="ad-row">
          <Toggle checked={published} label="Results published" onChange={(v) => run('pub', () => adminApi(`/competitions/${slug}/settings`, { method: 'PUT', body: { resultsPublished: v } }), v ? 'Results are on the website' : 'Results hidden').then((r) => r && settings.reload())} />
          <strong>{published ? 'Winners show on the competition page (team name, first names and city) and teams see their result.' : 'Hidden: only you see results. Shortlisted teams see “Shortlisted” on their page.'}</strong>
        </div>
      </Card>
      {cfg.groups.map((g) => {
        const teams = data.items.filter((t) => t.category === g.label);
        return (
          <Card key={g.key} title={`${g.label} (${g.min}–${g.max}) · ${teams.length} approved`} flush>
            {teams.length === 0 ? <p className="ad-nl-note ad-muted">No approved teams yet.</p> : (
              <table className="ad-table">
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id}>
                      <td><Link to={`/admin/competitions/${slug}/teams/${t.id}`} className="ad-strong">{t.teamName}</Link><div className="ad-muted">{t.code} · {t.city}</div></td>
                      <td>{Object.keys(t.files).length === cfg.files.length ? <Badge tone="green">Files in</Badge> : <Badge tone="grey">Files missing</Badge>}</td>
                      <td className="ad-tt-result">
                        <select aria-label={`Result for ${t.teamName}`} value={t.result} onChange={(e) => run('r', () => adminApi(`/competitions/${slug}/teams/${t.id}/result`, { body: { result: e.target.value } }), 'Saved').then((r) => r && reload())}>
                          <option value="">—</option>{Object.entries(RESULT_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/* ---------------- Settings ---------------- */

interface SettingsData {
  settings: { bannerKey: string | null; artKey: string | null; sponsorKeys: string[]; rulesDocKey: string | null; topicDocKey: string | null; closesAt: string | null; submissionDeadline: string | null; resultsOn: string | null; registrationPaused: boolean; resultsPublished: boolean; kitKey: string | null; kitName: string; kitSize: number };
  dates: { closesAt: string; submissionDeadline: string; resultsOn: string };
  defaults: { closesAt: string; submissionDeadline: string; resultsOn: string };
  urls: { bannerKey: string | null; artKey: string | null; rulesDocKey: string | null; topicDocKey: string | null; sponsorKeys: (string | null)[]; kitKey: string | null };
  kit: { attachMaxBytes: number; registeredTeams: number };
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`;
/** ISO → "YYYY-MM-DDTHH:mm" in India time, for a datetime input. */
const toIstInput = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
const fromIstInput = (v: string) => (v ? `${v}:59+05:30` : null);

function Settings({ slug }: { slug: string }) {
  const { data, error, reload } = useAdmin<SettingsData>(`/competitions/${slug}/settings`);
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const s = data.settings;
  const save = (patch: Partial<SettingsData['settings']>, ok = 'Saved') => run('save', () => adminApi(`/competitions/${slug}/settings`, { method: 'PUT', body: patch }), ok).then((r) => r && reload());
  const upload = (k: 'bannerKey' | 'artKey' | 'rulesDocKey' | 'topicDocKey', accept: string, label: string, hint: string) => (
    <div className="ad-field">
      <span className="ad-label">{label}</span>
      {data.urls[k] && (/\.(jpe?g|png|webp)$/i.test(data.urls[k]!) ? <img src={data.urls[k]!} alt="" className="ad-tt-thumb" /> : <a href={data.urls[k]!} target="_blank" rel="noreferrer">Open the current file ↗</a>)}
      <span className="ad-inline">
        <label className="ad-btn ad-btn--secondary ad-btn--sm">{busy === k ? 'Uploading…' : data.urls[k] ? 'Replace' : 'Upload'}
          <input type="file" hidden accept={accept} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run(k, () => uploadFile('competition-media', f)).then((r) => r && save({ [k]: r.path }, 'Uploaded')); }} />
        </label>
        {data.urls[k] && <button type="button" className="ad-link ad-neg" onClick={() => save({ [k]: null }, 'Removed')}>Remove</button>}
      </span>
      <small className="ad-muted">{hint}</small>
    </div>
  );
  return (
    <div className="ad-tt-grid ad-tt-grid--2">
      <Card title="Registration and dates">
        <div className="ad-form">
          <div className="ad-row"><Toggle checked={s.registrationPaused} label="Pause registration" onChange={(v) => save({ registrationPaused: v }, v ? 'Registration paused' : 'Registration open')} /><strong>{s.registrationPaused ? 'Paused: no new teams or changes' : 'Registration follows the dates below'}</strong></div>
          <DateField label="Registration closes (IST)" value={data.dates.closesAt} def={data.defaults.closesAt} onSave={(v) => save({ closesAt: v })} />
          <DateField label="Submission deadline (IST)" value={data.dates.submissionDeadline} def={data.defaults.submissionDeadline} onSave={(v) => save({ submissionDeadline: v })} />
          <TextField label="Results date" type="date" defaultValue={data.dates.resultsOn} onBlur={(e) => e.target.value !== data.dates.resultsOn && save({ resultsOn: e.target.value || null })} hint={`Default ${data.defaults.resultsOn}.`} />
          <small className="ad-muted">Changing a date here changes what the website shows and enforces. Announce it too (the rules say changes are posted on eldenap.in and Instagram).</small>
        </div>
      </Card>
      <Card title="Pictures and official documents">
        <div className="ad-form">
          {upload('bannerKey', 'image/jpeg,image/png,image/webp', 'Hero banner', 'Replaces the illustration at the top of the page. 1500 × 1000 px works well.')}
          {upload('artKey', 'image/jpeg,image/png,image/webp', 'Promotional artwork', 'Shown lower on the page, full width.')}
          {upload('rulesDocKey', 'application/pdf', 'Official rules and terms (PDF)', 'Shown only to approved teams, on their team page and the rules page (the PDF names the story’s title).')}
          {upload('topicDocKey', 'application/pdf', 'Topic document (PDF)', 'Optional. Shown only to approved teams, with the story brief.')}
          <div className="ad-field">
            <span className="ad-label">Sponsor logos ({s.sponsorKeys.length}/8)</span>
            <div className="ad-row">{data.urls.sponsorKeys.map((u, i) => u && <span key={u} className="ad-tt-logo"><img src={u} alt="" /><button type="button" className="ad-link ad-neg" onClick={() => save({ sponsorKeys: s.sponsorKeys.filter((_, k) => k !== i) }, 'Removed')}>×</button></span>)}</div>
            {s.sponsorKeys.length < 8 && (
              <label className="ad-btn ad-btn--secondary ad-btn--sm">{busy === 'sponsor' ? 'Uploading…' : 'Add a logo'}
                <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) run('sponsor', () => uploadFile('competition-media', f)).then((r) => r && save({ sponsorKeys: [...s.sponsorKeys, r.path] }, 'Added')); }} />
              </label>
            )}
          </div>
        </div>
      </Card>
      <Card title="Comic kit (PDF)">
        <div className="ad-form">
          <p className="ad-muted">Every team that registers gets the kit: in the “Application received” email, and on their team page (pending, approved or asked for changes). It’s stored privately; teams download it through short-lived links.</p>
          {s.kitKey ? (
            <div className="ad-field">
              <span className="ad-label">Current kit</span>
              <span className="ad-inline"><strong>{s.kitName || 'Comic kit'}</strong><span className="ad-muted">{mb(s.kitSize)}</span>{data.urls.kitKey && <a href={data.urls.kitKey} target="_blank" rel="noreferrer">Open ↗</a>}</span>
              <small className="ad-muted">{s.kitSize <= data.kit.attachMaxBytes
                ? 'Attached to the registration email.'
                : `Larger than ${mb(data.kit.attachMaxBytes)}, so the registration email links to the team page instead of attaching it.`}</small>
            </div>
          ) : <p><strong>No kit uploaded yet.</strong></p>}
          <span className="ad-inline">
            <label className="ad-btn ad-btn--primary ad-btn--sm">{busy === 'kit' ? 'Uploading…' : s.kitKey ? 'Replace the kit' : 'Upload the comic kit'}
              <input type="file" hidden accept="application/pdf" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                if (f.type && f.type !== 'application/pdf') { window.alert('Please choose a PDF.'); return; }
                run('kit', () => uploadFile('competition-files', f)).then((r) => r && save({ kitKey: r.path, kitName: r.name, kitSize: r.size }, 'Comic kit uploaded'));
              }} />
            </label>
            {s.kitKey && <button type="button" className="ad-link ad-neg" onClick={() => { if (window.confirm('Stop giving out the comic kit? Teams will no longer see it, and new registration emails won’t include it.')) save({ kitKey: null, kitName: '', kitSize: 0 }, 'Comic kit removed'); }}>Remove</button>}
          </span>
          <small className="ad-muted">PDF, up to 50 MB. {data.kit.registeredTeams > 0 && `The ${data.kit.registeredTeams} team${data.kit.registeredTeams === 1 ? '' : 's'} already registered see it on their team page straight away; to email them about it, send a notice (Notices & email tab).`}</small>
        </div>
      </Card>
      <Card title="Identity documents">
        <p className="ad-muted">ID documents are only needed to check registrations. Once teams are approved or rejected, delete them so they aren’t kept longer than needed. Teams that withdraw lose theirs automatically.</p>
        <Btn kind="danger" busy={busy === 'ids'} onClick={() => { if (window.confirm('Delete the ID documents of every approved, rejected or withdrawn team? Pending teams keep theirs. This can’t be undone.')) run('ids', () => adminApi<{ deleted: number }>(`/competitions/${slug}/teams/delete-ids`, { method: 'POST' })).then((r) => r && window.alert(`${r.deleted} documents deleted.`)); }}>Delete ID documents of decided teams</Btn>
      </Card>
    </div>
  );
}

function DateField({ label, value, def, onSave }: { label: string; value: string; def: string; onSave: (v: string | null) => void }) {
  const [v, setV] = useState(toIstInput(value));
  useEffect(() => setV(toIstInput(value)), [value]);
  return (
    <div className="ad-field">
      <span className="ad-label">{label}</span>
      <span className="ad-inline">
        <input type="datetime-local" value={v} onChange={(e) => setV(e.target.value)} />
        {v !== toIstInput(value) && <Btn size="sm" kind="primary" onClick={() => onSave(fromIstInput(v))}>Save</Btn>}
        {value !== def && <button type="button" className="ad-link" onClick={() => onSave(null)}>Back to {istDateTime(def)}</button>}
      </span>
      <small className="ad-muted">Now: {istDateTime(value)} (the whole minute counts).</small>
    </div>
  );
}
