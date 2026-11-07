import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { downloadFile, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, FulBadge, Loading, Page, Pagination, PayBadge, useAction } from '../ui';
import { CHANNELS } from '../../shared/attribution';

interface Row {
  id: string; number: number; createdAt: string; name: string; email: string; phone: string; total: number;
  paymentStatus: string; fulfillmentStatus: string; cancelledAt: string | null; requiresShipping: boolean; needsAttention: boolean; items: number; status: string; paymentMode?: string; codAmount?: number; codCollectedAt?: string | null;
  channel: string; sourceLabel: string; sourceDetail: string;
}
interface Sources {
  from: string; to: string; totals: { orders: number; revenue: number };
  channels: { channel: string; label: string; hint: string; orders: number; revenue: number }[];
  campaigns: { channel: string; label: string; campaign: string; orders: number; revenue: number }[];
}

const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** Paid orders and revenue per source in the chosen dates (the last 30 days if none); a row filters the list. */
function SourcesCard({ from, to, onPick }: { from: string; to: string; onPick: (channel: string) => void }) {
  const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to);
  const { data, error, reload } = useAdmin<Sources>(`/orders/sources?${p}`);
  const title = data ? `Where orders came from · ${from || to ? `${day(data.from ?? from)} to ${day(data.to ?? to)}` : 'last 30 days'}` : 'Where orders came from';
  return (
    <Card flush title={title}>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.totals.orders === 0 ? (
        <p className="ad-src-note ad-muted">No paid orders in these dates yet.</p>
      ) : (
        <>
          <ul className="ad-src-list">
            {data.channels.map((c) => {
              const share = data.totals.revenue ? c.revenue / data.totals.revenue : c.orders / data.totals.orders;
              return (
                <li key={c.channel} title={c.hint}>
                  <button type="button" onClick={() => onPick(c.channel)}>{c.label}</button>
                  <span className="ad-src-bar" aria-label={`${Math.round(share * 100)}% of revenue`}><i style={{ width: `${Math.max(2, share * 100)}%` }} /></span>
                  <span className="ad-num ad-muted">{c.orders} order{c.orders === 1 ? '' : 's'}</span>
                  <span className="ad-num ad-strong">{inr(c.revenue)}</span>
                </li>
              );
            })}
          </ul>
          {data.campaigns.length > 0 && (
            <ul className="ad-src-list ad-src-campaigns">
              <li className="ad-muted"><span>Top campaigns</span></li>
              {data.campaigns.map((c) => (
                <li key={c.channel + c.campaign}><span>{c.campaign}</span><span className="ad-muted">{c.label}</span><span className="ad-num ad-muted">{c.orders} order{c.orders === 1 ? '' : 's'}</span><span className="ad-num ad-strong">{inr(c.revenue)}</span></li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="ad-src-note ad-muted">Revenue is after refunds. Meta ads are counted as “Meta ads” when their links are tagged; in Ads Manager, under the ad’s <i>URL parameters</i>, add <code>utm_source={'{{site_source_name}}'}&amp;utm_medium=paid&amp;utm_campaign={'{{campaign.name}}'}&amp;utm_content={'{{ad.name}}'}</code>. Untagged ones show as “Facebook / Instagram”.</p>
    </Card>
  );
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
  const source = sp.get('source') ?? '';
  if (source) params.set('source', source);
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
      {tab.key === 'all' && <SourcesCard from={from} to={to} onPick={(c) => setParam('source', c)} />}
      <Card flush>
        <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim()); }}>
          <input type="search" placeholder="Search order #, name, email, phone, invoice" value={q} onChange={(e) => setQ(e.target.value)} className="ad-search" />
          <label className="ad-inline">From <input type="date" value={from} onChange={(e) => setParam('from', e.target.value)} /></label>
          <label className="ad-inline">To <input type="date" value={to} onChange={(e) => setParam('to', e.target.value)} /></label>
          <select aria-label="Source" value={source} onChange={(e) => setParam('source', e.target.value)}>
            <option value="">All sources</option>
            {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <Btn type="submit" size="sm">Search</Btn>
          {(sp.get('q') || from || to || source) && <button type="button" className="ad-link" onClick={() => { setQ(''); setSp(tab.key === 'all' ? {} : { tab: tab.key }); }}>Clear</button>}
        </form>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
          <Empty title={tab.key === 'unfulfilled' ? 'Nothing to pack — all caught up.' : 'No orders here yet.'} />
        ) : (
          <div className="ad-table-wrap">
            <table className={'ad-table ad-table--click' + (loading ? ' is-loading' : '')}>
              <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Source</th><th>Payment</th><th>Fulfilment</th><th className="ad-num">Items</th><th className="ad-num">Total</th></tr></thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/admin/orders/${o.id}`)}>
                    <td><Link to={`/admin/orders/${o.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>#{o.number}</Link>{o.needsAttention && <Badge tone="red">Check</Badge>}</td>
                    <td className="ad-muted ad-nowrap">{fmtDate(o.createdAt, true)}</td>
                    <td><div>{o.name}</div><div className="ad-muted">{o.email}</div></td>
                    <td><div className={o.channel === 'unknown' ? 'ad-muted' : ''}>{o.sourceLabel}</div>{o.sourceDetail && <div className="ad-muted">{o.sourceDetail}</div>}</td>
                    <td>{o.cancelledAt && o.paymentStatus !== 'expired' ? <Badge tone="grey">Cancelled</Badge> : <PayBadge s={o.paymentStatus} />}
                      {o.paymentMode === 'cod' && !o.cancelledAt && <Badge tone={o.codCollectedAt ? 'green' : 'amber'}>{o.codCollectedAt ? 'COD collected' : `COD ${inr(o.codAmount ?? 0)}`}</Badge>}</td>
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
