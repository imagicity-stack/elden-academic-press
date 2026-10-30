import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, downloadFile, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Page, Pagination, TextArea, useAction } from '../ui';

interface Customer { id: string; email: string; phone: string; name: string; ordersCount: number; totalSpent: number; firstOrderAt: string | null; lastOrderAt: string | null; notes: string }

export default function Customers() {
  const { id } = useParams();
  return id ? <CustomerDetail id={id} /> : <CustomerList />;
}

function CustomerList() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const { busy, run } = useAction();
  const params = new URLSearchParams({ sort, page: String(page), limit: '50' });
  if (query) params.set('q', query);
  const { data, error, reload } = useAdmin<{ items: Customer[]; total: number; page: number; limit: number }>(`/customers?${params}`);
  return (
    <Page title="Customers" subtitle="Everyone who has paid for an order, grouped by email address."
      actions={<Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile('/customers/export.csv', 'customers.csv'))}>Export CSV</Btn>}>
      <Card flush>
        <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(1); }}>
          <input type="search" className="ad-search" placeholder="Search name, email or phone" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} aria-label="Sort">
            <option value="recent">Most recent</option><option value="spent">Most spent</option><option value="orders">Most orders</option>
          </select>
          <Btn size="sm" type="submit">Search</Btn>
        </form>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="No customers yet." /> : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Customer</th><th>Phone</th><th className="ad-num">Orders</th><th className="ad-num">Spent</th><th>Last order</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/admin/customers/${c.id}`)}>
                    <td><Link to={`/admin/customers/${c.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>{c.name || c.email}</Link><div className="ad-muted">{c.email}</div></td>
                    <td className="ad-muted">{c.phone}</td>
                    <td className="ad-num">{c.ordersCount}</td>
                    <td className="ad-num ad-strong">{inr(c.totalSpent)}</td>
                    <td className="ad-muted">{fmtDate(c.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
      </Card>
    </Page>
  );
}

function CustomerDetail({ id }: { id: string }) {
  const { data, error, reload } = useAdmin<{ customer: Customer; orders: { id: string; number: number; createdAt: string; total: number; status: string }[] }>(`/customers/${id}`);
  const [notes, setNotes] = useState<string | null>(null);
  const { busy, run } = useAction();
  if (error) return <Page title="Customer" back={{ to: '/admin/customers', label: 'Customers' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Customer" back={{ to: '/admin/customers', label: 'Customers' }}><Loading /></Page>;
  const c = data.customer;
  return (
    <Page back={{ to: '/admin/customers', label: 'Customers' }} title={c.name || c.email} subtitle={`Customer since ${fmtDate(c.firstOrderAt)}`}>
      <div className="ad-grid-2 ad-grid-2--wide">
        <Card title={`Orders (${data.orders.length})`} flush>
          <table className="ad-table">
            <tbody>
              {data.orders.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/admin/orders/${o.id}`} className="ad-strong">#{o.number}</Link></td>
                  <td className="ad-muted">{fmtDate(o.createdAt, true)}</td>
                  <td><Badge>{o.status}</Badge></td>
                  <td className="ad-num">{inr(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="ad-stack">
          <Card title="Contact">
            <div><a href={`mailto:${c.email}`}>{c.email}</a></div>
            <div><a href={`tel:+91${c.phone}`}>+91 {c.phone}</a></div>
            <dl className="ad-kv ad-mt">
              <div><dt>Orders</dt><dd>{c.ordersCount}</dd></div>
              <div><dt>Total spent</dt><dd>{inr(c.totalSpent)}</dd></div>
              <div><dt>Average order</dt><dd>{c.ordersCount ? inr(Math.round(c.totalSpent / c.ordersCount)) : '—'}</dd></div>
            </dl>
          </Card>
          <Card title="Notes">
            <TextArea label="Only staff can see this" rows={4} value={notes ?? c.notes} onChange={(e) => setNotes(e.target.value)} />
            {notes !== null && notes !== c.notes && <Btn size="sm" kind="primary" busy={busy === 'n'} onClick={() => run('n', () => adminApi(`/customers/${c.id}`, { method: 'PUT', body: { notes } }), 'Saved').then((r) => { if (r) { setNotes(null); reload(); } })}>Save</Btn>}
          </Card>
        </div>
      </div>
    </Page>
  );
}
