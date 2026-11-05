// Admin: the list of competitions (and, from the tab, student accounts).
import { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { adminApi, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, Page, SelectField, TextField, useAction, type Tone } from '../ui';
import { COMPETITION_TYPES, istDateTime, STATUS_LABEL, TYPE_LABEL, type CompetitionStatus } from '../../shared/competition';
import { CompetitionAccounts } from './CompetitionAccounts';

interface Row {
  id: string; slug: string; title: string; type: keyof typeof TYPE_LABEL; publishState: string; status: CompetitionStatus;
  registrationOpensAt: string | null; registrationClosesAt: string | null; submissionOpensAt: string | null; submissionClosesAt: string | null;
  resultsAt: string | null; registrations: number; submissions: number;
}

export const STATUS_TONE_C: Record<CompetitionStatus, Tone> = {
  DRAFT: 'amber', ARCHIVED: 'grey', SCHEDULED: 'blue', COMING_SOON: 'blue', REGISTRATION_OPEN: 'green', SUBMISSIONS_OPEN: 'green',
  BOTH_OPEN: 'green', SUBMISSIONS_SOON: 'blue', CLOSED: 'grey', JUDGING: 'navy', VOTING: 'navy', RESULTS_OUT: 'navy',
};
export const StatusBadge = ({ s }: { s: CompetitionStatus }) => <Badge tone={STATUS_TONE_C[s]}>{STATUS_LABEL[s]}</Badge>;

const span = (a: string | null, b: string | null) => (a || b ? `${a ? istDateTime(a) : '—'} → ${b ? istDateTime(b) : '—'}` : 'Not set');

export default function Competitions() {
  const { pathname } = useLocation();
  const accounts = pathname.endsWith('/accounts');
  return (
    <Page title="Competitions" subtitle="Create and run competitions for students. Times are India time (IST).">
      <div className="ad-tabs">
        <NavLink to="/admin/competitions" end className={({ isActive }) => 'ad-tab' + (isActive ? ' is-on' : '')}>Competitions</NavLink>
        <NavLink to="/admin/competitions/accounts" className={({ isActive }) => 'ad-tab' + (isActive ? ' is-on' : '')}>Student accounts</NavLink>
      </div>
      {accounts ? <CompetitionAccounts /> : <List />}
    </Page>
  );
}

function List() {
  const { data, error, reload } = useAdmin<{ items: Row[] }>('/competitions');
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { busy, run } = useAction();
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  const duplicate = (id: string) => run(`dup-${id}`, () => adminApi<{ competition: { id: string } }>(`/competitions/${id}/duplicate`, { method: 'POST' }), 'Copied as a new draft')
    .then((r) => r && navigate(`/admin/competitions/${r.competition.id}`));
  return (
    <>
      <div className="ad-toolbar"><span className="ad-grow" /><Btn kind="primary" onClick={() => setCreating(true)}>New competition</Btn></div>
      <Card flush>
        {data.items.length === 0 ? <Empty title="No competitions yet."><p className="ad-muted">Create one: it stays a draft (not visible) until you publish it.</p></Empty> : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Competition</th><th>Status</th><th>Registration</th><th>Submissions</th><th className="ad-num">Registered</th><th className="ad-num">Submitted</th><th /></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/admin/competitions/${r.id}`)}>
                    <td><b>{r.title}</b><div className="ad-muted">{TYPE_LABEL[r.type]} · /competitions/{r.slug}</div></td>
                    <td><StatusBadge s={r.status} /></td>
                    <td className="ad-muted">{span(r.registrationOpensAt, r.registrationClosesAt)}</td>
                    <td className="ad-muted">{span(r.submissionOpensAt, r.submissionClosesAt)}</td>
                    <td className="ad-num">{r.registrations}</td>
                    <td className="ad-num">{r.submissions}</td>
                    <td className="ad-nowrap" onClick={(e) => e.stopPropagation()}>
                      <Btn size="sm" onClick={() => navigate(`/admin/competitions/${r.id}/entries`)}>Entries</Btn>{' '}
                      <Btn size="sm" kind="ghost" busy={busy === `dup-${r.id}`} onClick={() => duplicate(r.id)}>Duplicate</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {creating && <CreateDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/admin/competitions/${id}`)} />}
    </>
  );
}

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<(typeof COMPETITION_TYPES)[number]>('comic');
  const { busy, run } = useAction();
  const create = () => run('create', () => adminApi<{ competition: { id: string } }>('/competitions', { body: { title, type } }), 'Draft created')
    .then((r) => r && onCreated(r.competition.id));
  return (
    <Modal title="New competition" onClose={onClose} footer={<><span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" busy={busy === 'create'} disabled={title.trim().length < 3} onClick={create}>Create draft</Btn></>}>
      <div className="ad-form">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Elden Comic Challenge 2026" autoFocus />
        <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
          {COMPETITION_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </SelectField>
        <p className="ad-muted">It starts as a draft with one group (Classes 3–12) and the default emails. Nothing is visible until you publish.</p>
      </div>
    </Modal>
  );
}
