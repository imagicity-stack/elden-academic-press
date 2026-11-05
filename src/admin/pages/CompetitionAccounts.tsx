// Admin: students waiting for a parent's approval, the 14-day clean-up, and
// changing an account's type (with a reason, kept in the audit log).
import { useState } from 'react';
import { adminApi, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, SelectField, TextArea, TextField, useAction } from '../ui';

interface Pending {
  id: string; studentFirstName: string; classGrade: number; schoolName: string; city: string; parentEmail: string; parentWhatsapp: string;
  createdAt: string; linkExpiresAt: string; ageDays: number; linkExpired: boolean;
}
interface Found {
  account: { userId: string; email: string; name: string; type: 'parent' | 'student' | null; locked: boolean; completed: boolean } | null;
  students?: { id: string; firstName: string; classGrade: number; approvalStatus: string; relation: string }[];
}

export function CompetitionAccounts() {
  const { data, error, reload } = useAdmin<{ items: Pending[] }>('/competitions/accounts/pending');
  const { busy, run } = useAction();
  return (
    <>
      <Card title="Waiting for a parent’s approval" actions={
        <Btn size="sm" busy={busy === 'purge'} onClick={() => confirm('Delete every request older than 14 days that no parent approved?') && run('purge', () => adminApi<{ purged: number }>('/competitions/accounts/purge', { method: 'POST' }), 'Done').then((r) => { if (r) { alert(`${r.purged} request${r.purged === 1 ? '' : 's'} deleted.`); reload(); } })}>
          Purge expired requests
        </Btn>
      }>
        <p className="ad-muted">Students who signed up themselves and asked a parent to approve. Requests not approved within 14 days are deleted automatically every 15 minutes; the button does it now.</p>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="Nobody is waiting." /> : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Student</th><th>Parent</th><th>Waiting</th><th>Link</th></tr></thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.studentFirstName}</b><div className="ad-muted">Class {r.classGrade} · {r.schoolName}, {r.city}</div></td>
                    <td>{r.parentEmail}<div className="ad-muted">{r.parentWhatsapp}</div></td>
                    <td>{r.ageDays} day{r.ageDays === 1 ? '' : 's'}<div className="ad-muted">since {fmtDate(r.createdAt)}</div></td>
                    <td>{r.linkExpired ? <Badge tone="grey">Expired</Badge> : <Badge tone="amber">Until {fmtDate(r.linkExpiresAt)}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <TypeChange />
    </>
  );
}

function TypeChange() {
  const [email, setEmail] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [type, setType] = useState<'parent' | 'student' | 'none'>('parent');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();
  const find = () => run('find', () => adminApi<Found>(`/competitions/accounts/find?email=${encodeURIComponent(email.trim())}`)).then((r) => r && setFound(r));
  const a = found?.account;
  return (
    <Card title="Change an account’s type">
      <p className="ad-muted">Once an account is linked to a child or parent, only an admin can change whether it’s a parent or a student. The change and your reason are kept in the audit log.</p>
      <div className="ad-inline">
        <TextField label="Email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        <Btn busy={busy === 'find'} disabled={!email.includes('@')} onClick={find}>Find</Btn>
      </div>
      {found && !a && <p className="ad-muted">No account with that email.</p>}
      {a && (
        <div className="ad-form">
          <p><b>{a.name || a.email}</b> · {a.type ?? 'not chosen yet'}{a.locked ? ' · linked' : ''}</p>
          {found?.students?.length ? <p className="ad-muted">{found.students.map((s) => `${s.firstName} (Class ${s.classGrade}, ${s.relation === 'self' ? 'own profile' : 'child'}, ${s.approvalStatus})`).join(' · ')}</p> : null}
          <SelectField label="New type" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="parent">Parent</option><option value="student">Student</option><option value="none">Not chosen (they’ll be asked again)</option>
          </SelectField>
          <TextArea label="Reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Parent signed up as a student by mistake (confirmed by email)" />
          <div><Btn kind="primary" busy={busy === 'type'} disabled={reason.trim().length < 5}
            onClick={() => run('type', () => adminApi('/competitions/accounts/type', { body: { userId: a.userId, type, reason } }), 'Account type changed').then((r) => r && find())}>Change type</Btn></div>
        </div>
      )}
    </Card>
  );
}
