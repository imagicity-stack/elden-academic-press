import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { downloadFile, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, FulBadge, Loading, Page, Pagination, PayBadge, useAction } from '../ui';

interface Row {
  id: string; number: number; createdAt: string; name: string; email: string; phone: string; total: number;
  paymentStatus: string; fulfillmentStatus: string; cancelledAt: string | null; requiresShipping: boolean; needsAttention: boolean; items: number; status: string;
}

const TABS: { key: string; label: string; params: Record<string, string> }[] = [
  { key: 'all', label: 'All orders', params: { view: 'orders' } },
  { key: 'unfulfilled', label: 'To pack', params: { view: 'orders', payment: 'paid', fulfillment: 'unfulfilled' } },
  { key: 'packed', label: 'Packed', params: { view: 'orders', payment: 'paid', fulfillment: 'packed' } },
  { key: 'shipped', label: 'Shipped', params: { view: 'orders', fulfillment: 'shipped' } },
  { key: 'attention', label: 'Needs attention', params: { view: 'all', attention: '1' } },
  { key: 'abandoned', label: 'Unpaid checkouts', params: { view: 'abandoned' } },
];

export default function Orders() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const tab = TABS.find((t) => t.key === sp.get('tab')) ?? TABS[0];
  const page = Number(sp.get('page') ?? 1);
  const [q, setQ] = useState(sp.get('q') ?? '');
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const params = new URLSearchParams({ ...tab.params, page: String(page), limit: '50' });
  if (sp.get('q')) params.set('q', sp.get('q')!);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const { data, error, loading, reload } = useAdmin<{ items: Row[]; total: number; page: number; limit: number }>(`/orders?${params}`);
  const { busy, run } = useAction();

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setSp(next, { replace: true });
  };

  return (
    <Page title="Orders" actions={<Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile(`/orders/export.csv?${params}`, 'orders.csv'))}>Export CSV</Btn>}>
      <div className="ad-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={'ad-tab' + (t.key === tab.key ? ' is-on' : '')} onClick={() => setParam('tab', t.key === 'all' ? '' : t.key)}>{t.label}</button>
        ))}
      </div>
      <Card flush>
        <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim()); }}>
          <input type="search" placeholder="Search order #, name, email, phone, invoice" value={q} onChange={(e) => setQ(e.target.value)} className="ad-search" />
          <label className="ad-inline">From <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} /></label>
          <label className="ad-inline">To <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} /></label>
          <Btn type="submit" size="sm">Search</Btn>
          {(sp.get('q') || from || to) && <button type="button" className="ad-link" onClick={() => { setQ(''); setSp(tab.key === 'all' ? {} : { tab: tab.key }); }}>Clear</button>}
        </form>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
          <Empty title={tab.key === 'unfulfilled' ? 'Nothing to pack — all caught up.' : 'No orders here yet.'} />
        ) : (
          <div className="ad-table-wrap">
            <table className={'ad-table ad-table--click' + (loading ? ' is-loading' : '')}>
              <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Payment</th><th>Fulfilment</th><th className="ad-num">Items</th><th className="ad-num">Total</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td><Link to={`/admin/orders/${o.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>#{o.number}</Link>{o.needsAttention && <Badge tone="red">Check</Badge>}</td>
                    <td className="ad-muted ad-nowrap">{fmtDate(o.createdAt, true)}</td>
                    <td><div>{o.name}</div><div className="ad-muted">{o.email}</div></td>
                    <td>{o.cancelledAt && o.paymentStatus !== 'expired' ? <Badge tone="grey">Cancelled</Badge> : <PayBadge s={o.paymentStatus} />}</td>
                    <td>{['paid', 'partially_refunded'].includes(o.paymentStatus) && !o.cancelledAt ? <FulBadge s={o.fulfillmentStatus} /> : <span className="ad-muted">—</span>}</td>
                    <td className="ad-num">{o.items}</td>
                    <td className="ad-num ad-strong">{inr(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={(p) => setParam('page', String(p))} />}
      </Card>
    </Page>
  );
}
