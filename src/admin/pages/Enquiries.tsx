import { useState } from 'react';
import { adminApi, downloadFile, fmtDate, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Page, Pagination, useAction, type Tone } from '../ui';

interface Enquiry {
  id: string; kind: string; status: 'new' | 'in_progress' | 'closed'; name: string; email: string; phone: string; institution: string; city: string;
  role: string; title: string; message: string; data: Record<string, string> | null; createdAt: string; handledBy: string | null;
}
const KINDS: Record<string, string> = { sample: 'Sample copy', bulk: 'Bulk / school', teacher: 'Teacher access', dist: 'Distributor', contact: 'Contact', proposal: 'Author proposal' };
const STATUS: Record<Enquiry['status'], [string, Tone]> = { new: ['New', 'blue'], in_progress: ['In progress', 'amber'], closed: ['Done', 'grey'] };

export default function Enquiries() {
  const { refreshCounts } = useMe();
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { busy, run } = useAction();
  const params = new URLSearchParams({ page: String(page), limit: '30' });
  if (kind) params.set('kind', kind);
  if (status) params.set('status', status);
  const { data, error, reload, setData } = useAdmin<{ items: Enquiry[]; total: number; page: number; limit: number }>(`/enquiries?${params}`);

  const setStatusOf = async (e: Enquiry, s: Enquiry['status']) => {
    const r = await run('st' + e.id, () => adminApi<Enquiry>(`/enquiries/${e.id}`, { method: 'PATCH', body: { status: s } }));
    if (r && data) { setData({ ...data, items: data.items.map((x) => (x.id === e.id ? { ...x, status: r.status, handledBy: r.handledBy } : x)) }); refreshCounts(); }
  };

  return (
    <Page title="Enquiries" subtitle="Sample requests, school orders, teacher access, distributor applications, contact messages and author proposals."
      actions={<Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile(`/enquiries/export.csv?${params}`, 'enquiries.csv'))}>Export CSV</Btn>}>
      <div className="ad-tabs">
        {[['open', 'Open'], ['new', 'New'], ['closed', 'Done'], ['', 'All']].map(([v, l]) => (
          <button key={v} type="button" className={'ad-tab' + (status === v ? ' is-on' : '')} onClick={() => { setStatus(v); setPage(1); }}>{l}</button>
        ))}
        <select className="ad-tabs__select" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1); }} aria-label="Type">
          <option value="">All types</option>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <Card flush>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="Inbox zero." /> : (
          <ul className="ad-inbox">
            {data.items.map((e) => (
              <li key={e.id} className={open === e.id ? 'is-open' : ''}>
                <button type="button" className="ad-inbox__row" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                  <Badge tone={STATUS[e.status][1]}>{STATUS[e.status][0]}</Badge>
                  <span className="ad-inbox__kind">{KINDS[e.kind]}</span>
                  <b>{e.name}</b>
                  <span className="ad-muted ad-inbox__sub">{[e.institution, e.city, e.title].filter(Boolean).join(' · ')}</span>
                  <span className="ad-muted">{fmtDate(e.createdAt, true)}</span>
                </button>
                {open === e.id && (
                  <div className="ad-inbox__body">
                    <dl className="ad-kv">
                      {e.email && <div><dt>Email</dt><dd><a href={`mailto:${e.email}?subject=${encodeURIComponent('Re: ' + (KINDS[e.kind] ?? 'your enquiry'))}`}>{e.email}</a></dd></div>}
                      {e.phone && <div><dt>Phone</dt><dd><a href={`tel:${e.phone}`}>{e.phone}</a></dd></div>}
                      {e.role && <div><dt>Role</dt><dd>{e.role}</dd></div>}
                      {e.institution && <div><dt>Institution</dt><dd>{e.institution}</dd></div>}
                      {e.city && <div><dt>City</dt><dd>{e.city}</dd></div>}
                      {e.title && <div><dt>Title</dt><dd>{e.title}</dd></div>}
                      {Object.entries(e.data ?? {}).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                    </dl>
                    {e.message && <p className="ad-pre">{e.message}</p>}
                    <div className="ad-row">
                      {e.email && <a className="ad-btn ad-btn--primary ad-btn--sm" href={`mailto:${e.email}?subject=${encodeURIComponent('Re: ' + (KINDS[e.kind] ?? 'your enquiry'))}`}>Reply by email</a>}
                      {e.status !== 'in_progress' && <Btn size="sm" busy={busy === 'st' + e.id} onClick={() => setStatusOf(e, 'in_progress')}>Mark in progress</Btn>}
                      {e.status !== 'closed' && <Btn size="sm" busy={busy === 'st' + e.id} onClick={() => setStatusOf(e, 'closed')}>Mark done</Btn>}
                      {e.status === 'closed' && <Btn size="sm" onClick={() => setStatusOf(e, 'new')}>Reopen</Btn>}
                      {e.handledBy && <span className="ad-muted">Last handled by {e.handledBy}</span>}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
      </Card>
    </Page>
  );
}
