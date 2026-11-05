// Admin → competition → Entries: the counters, the registrations table (filters, search,
// CSV export) and a detail view per registration with private previews and actions
// (flag, note, hide from public, disqualify / reinstate). Everything is audit-logged.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, downloadFile, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, Pagination, TextArea, type Tone, useAction } from '../ui';

type EntryState = 'no_entry' | 'draft' | 'submitted' | 'withdrawn' | 'disqualified';
interface SubRow { id: string; entryCode: string; status: string; submittedAt: string | null; flags: string[]; hidden: boolean; files: number; hasNote: boolean }
interface Row {
  id: string; code: string; createdAt: string; status: string; state: EntryState; registeredByType: 'parent' | 'student';
  student: { firstName: string; lastName: string; classGrade: number; school: string; city: string; state: string; deleted: boolean };
  group: { letter: string; name: string } | null; publication: boolean; howHeard: string; utmSource: string; submissions: SubRow[];
}
interface List {
  total: number; page: number; limit: number; items: Row[];
  options: { groups: { letter: string; name: string }[]; howHeard: string[]; utmSource: string[]; states: { code: string; name: string }[] };
}
interface Split { label: string; registrations: number; submissions: number; rate: number }
interface Stats {
  registrations: number; submissions: number; rate: number; drafts: number; withdrawn: number; disqualified: number; referred: number; pendingApprovals: number;
  byGroup: Split[]; byRegisteredBy: Split[]; byHowHeard: Split[]; byUtmSource: Split[];
  downloads: { total: number; items: { id: string; title: string; total: number; people: number }[] };
}

const STATE: Record<EntryState, [string, Tone]> = {
  no_entry: ['No entry yet', 'grey'], draft: ['Draft', 'amber'], submitted: ['Submitted', 'green'], withdrawn: ['Withdrawn', 'grey'], disqualified: ['Disqualified', 'red'],
};
const SUB_STATUS: Record<string, [string, Tone]> = {
  draft: ['Draft', 'amber'], submitted: ['Submitted', 'green'], withdrawn: ['Withdrawn', 'grey'], disqualified: ['Disqualified', 'red'],
  under_review: ['Under review', 'blue'], shortlisted: ['Shortlisted', 'blue'], winner: ['Winner', 'navy'],
};
export const FLAGS: [string, string][] = [['suspected_ai', 'Suspected AI'], ['possibly_copied', 'Possibly copied'], ['content_issue', 'Content issue']];
const FILTERS = ['q', 'status', 'group', 'state', 'howHeard', 'utmSource', 'registeredByType', 'school', 'city'] as const;
type FilterKey = (typeof FILTERS)[number];

export function CompetitionEntries({ id }: { id: string }) {
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [draft, setDraft] = useState({ q: '', school: '', city: '' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const [contacts, setContacts] = useState(false);
  const { busy, run } = useAction();
  const params = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const { data, error, reload } = useAdmin<List>(`/competitions/${id}/entries?${params}&page=${page}`);
  const stats = useAdmin<Stats>(`/competitions/${id}/stats`);
  const set = (k: FilterKey, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1); };
  const active = Object.values(filters).some(Boolean);
  const refresh = () => { reload(); stats.reload(); };

  return (
    <div className="ad-stack">
      <Counters stats={stats.data} error={stats.error} />
      <Card flush title="Registrations" actions={
        <div className="ad-row">
          <label className="ad-inline"><input type="checkbox" checked={contacts} onChange={(e) => setContacts(e.target.checked)} /> Include parents’ contact details</label>
          <Btn size="sm" busy={busy === 'csv'} onClick={() => {
            const q = new URLSearchParams(params); if (contacts) q.set('contacts', '1');
            run('csv', () => downloadFile(`/competitions/${id}/entries/export.csv?${q}`, `entries${contacts ? '-with-contacts' : ''}.csv`));
          }}>Export CSV{active ? ' (filtered)' : ''}</Btn>
        </div>
      }>
        <form className="ad-toolbar ad-ent-toolbar" onSubmit={(e) => { e.preventDefault(); setFilters((f) => ({ ...f, q: draft.q.trim(), school: draft.school.trim(), city: draft.city.trim() })); setPage(1); }}>
          <input type="search" className="ad-search" placeholder="Student name, entry code or parent WhatsApp" aria-label="Search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
          <select aria-label="Status" value={filters.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any status</option>
            <option value="submitted">Submitted</option><option value="draft">Draft</option><option value="no_entry">No entry yet</option>
            <option value="flagged">Flagged</option><option value="hidden">Hidden from public</option><option value="withdrawn">Withdrawn</option><option value="disqualified">Disqualified</option>
          </select>
          <select aria-label="Group" value={filters.group ?? ''} onChange={(e) => set('group', e.target.value)}>
            <option value="">All groups</option>
            {data?.options.groups.map((g) => <option key={g.letter} value={g.letter}>{g.letter} · {g.name}</option>)}
          </select>
          <select aria-label="Registered by" value={filters.registeredByType ?? ''} onChange={(e) => set('registeredByType', e.target.value)}>
            <option value="">Parent or student</option><option value="parent">Registered by a parent</option><option value="student">Registered by the student</option>
          </select>
          <select aria-label="State" value={filters.state ?? ''} onChange={(e) => set('state', e.target.value)}>
            <option value="">All states</option>
            {data?.options.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
          <select aria-label="How they heard" value={filters.howHeard ?? ''} onChange={(e) => set('howHeard', e.target.value)}>
            <option value="">How they heard: any</option>
            {data?.options.howHeard.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select aria-label="UTM source" value={filters.utmSource ?? ''} onChange={(e) => set('utmSource', e.target.value)}>
            <option value="">UTM source: any</option>
            {data?.options.utmSource.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <input type="search" placeholder="School" aria-label="School" value={draft.school} onChange={(e) => setDraft({ ...draft, school: e.target.value })} />
          <input type="search" placeholder="City" aria-label="City" value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} />
          <Btn size="sm" type="submit">Search</Btn>
          {active && <button type="button" className="ad-link" onClick={() => { setFilters({}); setDraft({ q: '', school: '', city: '' }); setPage(1); }}>Clear</button>}
        </form>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
          <Empty title={active ? 'Nothing matches these filters.' : 'No registrations yet.'} />
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Student</th><th>Group</th><th>School · City</th><th>Entry</th><th>Public credit</th><th>Registered</th></tr></thead>
              <tbody>
                {data.items.map((r) => {
                  const sub = r.submissions.find((s) => s.status === 'submitted' || s.status === 'disqualified') ?? r.submissions[r.submissions.length - 1];
                  return (
                    <tr key={r.id} onClick={() => setOpen(r.id)}>
                      <td>
                        <button type="button" className="ad-link ad-strong" onClick={(e) => { e.stopPropagation(); setOpen(r.id); }}>{r.student.firstName} {r.student.lastName}</button>
                        <div className="ad-muted">Class {r.student.classGrade} · {r.code}{r.student.deleted && ' · profile deleted'}</div>
                      </td>
                      <td>{r.group?.letter ?? '—'}</td>
                      <td><div>{r.student.school || '—'}</div><div className="ad-muted">{r.student.city}{r.student.state && `, ${r.student.state}`}</div></td>
                      <td>
                        <Badge tone={STATE[r.state][1]}>{STATE[r.state][0]}</Badge>
                        {sub && <div className="ad-muted">{sub.entryCode}{r.submissions.length > 1 && ` +${r.submissions.length - 1}`}</div>}
                        {r.submissions.some((s) => s.flags.length) && <div><Badge tone="red">Flagged</Badge></div>}
                        {r.submissions.some((s) => s.hidden) && <div className="ad-muted">Hidden from public</div>}
                      </td>
                      <td>{r.publication ? <Badge tone="green">Allowed</Badge> : <span className="ad-muted">No</span>}</td>
                      <td><div>{fmtDate(r.createdAt)}</div><div className="ad-muted">by {r.registeredByType}{r.howHeard && ` · ${r.howHeard}`}</div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
      </Card>
      {open && <Detail competitionId={id} regId={open} onClose={() => setOpen(null)} onChange={refresh} />}
    </div>
  );
}

function Counters({ stats, error }: { stats: Stats | null; error: unknown }) {
  if (error) return <ErrorBox error={error} />;
  if (!stats) return <Loading />;
  const splits: [string, Split[]][] = [['By group', stats.byGroup], ['Registered by', stats.byRegisteredBy], ['How they heard', stats.byHowHeard], ['UTM source', stats.byUtmSource]];
  return (
    <>
      <div className="ad-stats ad-ent-stats">
        <div className="ad-stat"><span>Registrations</span><b>{stats.registrations}</b><small>{stats.withdrawn} withdrawn · {stats.disqualified} disqualified</small></div>
        <div className="ad-stat"><span>Entries submitted</span><b>{stats.submissions}</b><small>{stats.drafts} more in draft</small></div>
        <div className="ad-stat"><span>Submission rate</span><b>{stats.rate}%</b><small>of active registrations</small></div>
        <div className="ad-stat"><span>Resource downloads</span><b>{stats.downloads.total}</b><small>{stats.downloads.items.map((d) => `${d.title}: ${d.people} people`).join(' · ') || 'No resources'}</small></div>
        <div className="ad-stat"><span>Waiting for a parent</span><b>{stats.pendingApprovals}</b><small><Link to="/admin/competitions/accounts">Students on the whole site</Link></small></div>
        <div className="ad-stat"><span>Came from a referral</span><b>{stats.referred}</b><small>registrations with a friend’s link</small></div>
      </div>
      <div className="ad-ent-splits">
        {splits.map(([title, rows]) => (
          <Card key={title} title={title} flush>
            {rows.length === 0 ? <p className="ad-nl-note ad-muted">Nothing yet.</p> : (
              <div className="ad-table-wrap">
                <table className="ad-table ad-table--tight">
                  <thead><tr><th></th><th className="ad-num">Reg.</th><th className="ad-num">Entries</th><th className="ad-num">Rate</th></tr></thead>
                  <tbody>{rows.map((r) => <tr key={r.label}><td>{r.label}</td><td className="ad-num">{r.registrations}</td><td className="ad-num">{r.submissions}</td><td className="ad-num">{r.rate}%</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

interface FileInfo { id: string; kind: string; label: string; name: string; mimeType: string; sizeBytes: number; width: number | null; height: number | null; verified: boolean; url: string | null; thumbUrl: string | null }
interface SubDetail {
  id: string; entryCode: string; status: string; title: string; language: string; textContent: string; linkUrl: string; words: number;
  submittedAt: string | null; updatedAt: string; declarationAcceptedAt: string | null; flags: string[]; notes: string; hidden: boolean; files: FileInfo[];
}
interface DetailData {
  id: string; code: string; createdAt: string; status: string; disqualifyReason: string; registeredByType: string;
  group: { letter: string; name: string; formatNote: string } | null;
  student: { firstName: string; lastName: string; classAtRegistration: number; classNow: number; school: string; city: string; state: string; approvalStatus: string; ownLogin: boolean; deleted: boolean };
  contacts: { parents: { name: string; email: string; whatsapp: string }[]; studentEmail: string };
  answers: { key: string; label: string; value: unknown }[];
  source: Record<string, string>;
  consents: { type: string; granted: boolean; at: string | null; version: string }[];
  submissions: SubDetail[];
  history: { at: string; actor: string; action: string; details: unknown }[];
}
const CONSENT_NAME: Record<string, string> = { data_processing: 'Taking part (data use)', publication: 'Showing the entry with first name and city', marketing: 'Book news for parents' };
const ACTION_NAME: Record<string, string> = {
  'entry.flag': 'Flags changed', 'entry.note': 'Note changed', 'entry.hide': 'Hidden from public', 'entry.unhide': 'Shown in public',
  'entry.disqualify': 'Disqualified', 'entry.reinstate': 'Reinstated',
};
const size = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

function Detail({ competitionId, regId, onClose, onChange }: { competitionId: string; regId: string; onClose: () => void; onChange: () => void }) {
  const { data, error, reload } = useAdmin<DetailData>(`/competitions/${competitionId}/entries/${regId}`);
  const { busy, run } = useAction();
  const [reason, setReason] = useState<string | null>(null);
  const after = () => { reload(); onChange(); };
  const d = data;
  return (
    <Modal wide title={d ? `${d.student.firstName} ${d.student.lastName} · ${d.code}` : 'Registration'} onClose={onClose}>
      {error ? <ErrorBox error={error} retry={reload} /> : !d ? <Loading /> : (
        <div className="ad-stack ad-ent-detail">
          {d.status === 'disqualified' && <div className="ad-error ad-ce-problems"><strong>Disqualified.</strong> {d.disqualifyReason}</div>}
          <section>
            <h3 className="ad-h3">Student</h3>
            <dl className="ad-kv">
              <div><dt>Class</dt><dd>{d.student.classAtRegistration} when registered{d.student.classNow !== d.student.classAtRegistration && ` (now ${d.student.classNow})`} · {d.group ? (d.group.name === `Group ${d.group.letter}` ? d.group.name : `Group ${d.group.letter} · ${d.group.name}`) : 'No group'}</dd></div>
              <div><dt>School</dt><dd>{d.student.school || '—'}</dd></div>
              <div><dt>City</dt><dd>{d.student.city}{d.student.state && `, ${d.student.state}`}</dd></div>
              <div><dt>Registered</dt><dd>{fmtDate(d.createdAt, true)} by the {d.registeredByType}{d.student.ownLogin ? ' · has own login' : ''}</dd></div>
              {d.contacts.parents.map((p, i) => (
                <div key={i}><dt>Parent</dt><dd>{p.name} · <a href={`mailto:${p.email}`}>{p.email}</a>{p.whatsapp && <> · <a href={`https://wa.me/91${p.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp {p.whatsapp}</a></>}</dd></div>
              ))}
              {d.contacts.studentEmail && <div><dt>Student login</dt><dd>{d.contacts.studentEmail}</dd></div>}
            </dl>
          </section>

          <section>
            <h3 className="ad-h3">Consents (from the parent)</h3>
            <dl className="ad-kv">
              {d.consents.map((c) => <div key={c.type}><dt>{CONSENT_NAME[c.type] ?? c.type}</dt><dd>{c.granted ? 'Yes' : 'No'}{c.at && <span className="ad-muted"> · {fmtDate(c.at, true)} · {c.version}</span>}</dd></div>)}
            </dl>
          </section>

          {(d.answers.length > 0 || Object.values(d.source).some(Boolean)) && (
            <section>
              <h3 className="ad-h3">Answers and source</h3>
              <dl className="ad-kv">
                {d.answers.map((a) => <div key={a.key}><dt>{a.label}</dt><dd>{Array.isArray(a.value) ? a.value.join(', ') : typeof a.value === 'boolean' ? (a.value ? 'Yes' : 'No') : String(a.value)}</dd></div>)}
                {(['utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'referredByCode'] as const).filter((k) => d.source[k]).map((k) => (
                  <div key={k}><dt>{k === 'referredByCode' ? 'Referred by' : k.replace('utm', 'UTM ').toLowerCase()}</dt><dd>{d.source[k]}</dd></div>
                ))}
              </dl>
            </section>
          )}

          {d.submissions.length === 0 ? <p className="ad-muted">No entry yet.</p> : d.submissions.map((s) => (
            <Entry key={s.id} s={s} competitionId={competitionId} onChange={after} />
          ))}

          <div className="ad-row">
            {d.status === 'registered' && reason === null && <Btn kind="danger" onClick={() => setReason('')}>Disqualify…</Btn>}
            {d.status === 'disqualified' && (
              <Btn busy={busy === 'reinstate'} onClick={() => run('reinstate', () => adminApi(`/competitions/${competitionId}/entries/${d.id}/reinstate`, { method: 'POST' }), 'Reinstated').then((r) => r && after())}>Reinstate</Btn>
            )}
          </div>
          {reason !== null && (
            <div className="ad-cp-row">
              <TextArea label="Why is this registration disqualified?" hint="Kept in the record and the audit log. The family isn’t emailed automatically." rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="ad-row">
                <Btn kind="danger" busy={busy === 'dq'} disabled={reason.trim().length < 5} onClick={() => run('dq', () => adminApi(`/competitions/${competitionId}/entries/${d.id}/disqualify`, { body: { reason } }), 'Disqualified').then((r) => { if (r) { setReason(null); after(); } })}>Disqualify</Btn>
                <Btn kind="ghost" onClick={() => setReason(null)}>Cancel</Btn>
              </div>
            </div>
          )}

          {d.history.length > 0 && (
            <section>
              <h3 className="ad-h3">History</h3>
              <ul className="ad-ent-history">
                {d.history.map((h, i) => <li key={i}><span className="ad-muted">{fmtDate(h.at, true)}</span> {ACTION_NAME[h.action] ?? h.action} <span className="ad-muted">· {h.actor}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
    </Modal>
  );
}

function Entry({ s, competitionId, onChange }: { s: SubDetail; competitionId: string; onChange: () => void }) {
  const { busy, run } = useAction();
  const [notes, setNotes] = useState(s.notes);
  // Ticks change at once and go back if saving fails.
  const [flags, setFlags] = useState(s.flags);
  const [hidden, setHidden] = useState(s.hidden);
  useEffect(() => { setNotes(s.notes); setFlags(s.flags); setHidden(s.hidden); }, [s.notes, s.flags, s.hidden]);
  const save = (key: string, b: object, ok: string, undo?: () => void) =>
    run(key, () => adminApi(`/competitions/${competitionId}/entries/submissions/${s.id}`, { body: b }), ok).then((r) => { if (r) onChange(); else undo?.(); });
  const st = SUB_STATUS[s.status] ?? [s.status, 'grey' as Tone];
  return (
    <section className="ad-cp-row">
      <div className="ad-row">
        <h3 className="ad-h3 ad-grow">Entry {s.entryCode}</h3>
        <Badge tone={st[1]}>{st[0]}</Badge>
      </div>
      <dl className="ad-kv">
        {s.title && <div><dt>Title</dt><dd>{s.title}</dd></div>}
        <div><dt>Submitted</dt><dd>{s.submittedAt ? fmtDate(s.submittedAt, true) : 'Not yet'}{s.declarationAcceptedAt && ' · declaration accepted'}</dd></div>
        <div><dt>Last changed</dt><dd>{fmtDate(s.updatedAt, true)}</dd></div>
        {s.language && <div><dt>Language</dt><dd>{s.language}</dd></div>}
        {s.linkUrl && <div><dt>Link</dt><dd><a href={s.linkUrl} target="_blank" rel="noreferrer noopener">{s.linkUrl}</a></dd></div>}
      </dl>
      {s.files.length > 0 && (
        <ul className="ad-ent-files">
          {s.files.map((f) => (
            <li key={f.id}>
              {f.thumbUrl || (f.url && f.mimeType.startsWith('image/'))
                ? <a href={f.url ?? undefined} target="_blank" rel="noreferrer"><img src={(f.thumbUrl ?? f.url)!} alt={`${f.label} file`} loading="lazy" /></a>
                : <span className="ad-ent-file-icon">{f.mimeType === 'application/pdf' ? 'PDF' : f.mimeType.startsWith('video/') ? 'Video' : 'File'}</span>}
              <div>
                <strong>{f.label}</strong>
                <div className="ad-muted">{f.name || 'file'} · {size(f.sizeBytes)}{f.width ? ` · ${f.width} × ${f.height}` : ''}</div>
                {f.url ? <a href={f.url} target="_blank" rel="noreferrer">Open</a> : <span className="ad-muted">Not checked yet</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {s.textContent && (
        <details>
          <summary>Written entry ({s.words} words)</summary>
          <div className="ad-ent-text">{s.textContent}</div>
        </details>
      )}
      <small className="ad-muted">Preview links work for 10 minutes. Close and reopen to get fresh ones.</small>

      <div className="ad-field">
        <span className="ad-label">Flags</span>
        <div className="ad-row">
          {FLAGS.map(([k, label]) => (
            <Check key={k} label={label} checked={flags.includes(k)} onChange={(v) => {
              const before = flags;
              const next = v ? [...flags, k] : flags.filter((x) => x !== k);
              setFlags(next);
              save('flag', { flags: next }, v ? `Flagged: ${label}` : 'Flag removed', () => setFlags(before));
            }} />
          ))}
        </div>
      </div>
      <Check label="Hide from public" hint="Never shown in any public gallery, even with the parent’s consent." checked={hidden}
        onChange={(v) => { setHidden(v); save('hide', { hidden: v }, v ? 'Hidden from public' : 'No longer hidden', () => setHidden(!v)); }} />
      <TextArea label="Private note (admins only)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {notes !== s.notes && <div className="ad-row"><Btn size="sm" kind="primary" busy={busy === 'note'} onClick={() => save('note', { notes }, 'Note saved')}>Save note</Btn></div>}
    </section>
  );
}
