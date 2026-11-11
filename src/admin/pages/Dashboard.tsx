// Admin → Dashboard: sales and money for a chosen period (compared with the period before),
// cash on delivery kept apart (advances, collected, still to collect with its age, lost), a daily
// chart, what needs doing, recent orders, low stock and best sellers.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../../store/api';
import { fmtDate, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Card, ErrorBox, Loading, Page } from '../ui';

interface Kpi { now: number; prev: number }
interface Analytics {
  period: { days: number; from: string; to: string };
  kpis: { booked: Kpi; received: Kpi; orders: Kpi; aov: Kpi };
  money: { prepaid: number; codAdvances: number; codCollected: number; codLost: number; codOutstanding: number; refunds: number };
  cod: {
    orders: number; share: number | null; value: number;
    outstanding: { amount: number; parcels: number; ageing: { label: string; parcels: number; amount: number }[] };
    collectedOrders: number; lostOrders: number; collectionRate: number | null; avgDaysToCollect: number | null;
    oldest: { id: string; number: number; name: string; codAmount: number; paidAt: string; shippedAt: string | null; fulfillmentStatus: string; waitingDays: number }[];
  };
  mix: { online: { orders: number; value: number }; cod: { orders: number; value: number } };
  series: { day: string; booked: number; received: number; orders: number }[];
}
interface Dash {
  toFulfil: number; attention: number; newEnquiries: number; abandonedWeek: number;
  lowStock: { productId: string; title: string; stock: number }[];
  lowStockThreshold: number;
  topProducts: { title: string; quantity: number; revenue: number }[];
  recentOrders: { id: string; number: number; name: string; total: number; paidAt: string; status: string }[];
  analytics: Analytics;
}

const PERIODS: [number, string, string][] = [[1, 'Today', 'yesterday'], [7, '7 days', 'the 7 days before'], [30, '30 days', 'the 30 days before'], [90, '90 days', 'the 90 days before'], [365, '12 months', 'the 12 months before']];
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);

export default function Dashboard() {
  const { me } = useMe();
  const [days, setDays] = useState(30);
  const { data: d, error, reload } = useAdmin<Dash>(`/dashboard?days=${days}`);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const title = `${greet}${me.name && me.name !== 'Owner' ? ', ' + me.name.split(' ')[0] : ''}`;
  const vs = PERIODS.find(([n]) => n === days)![2];

  return (
    <Page title={title} subtitle="Here’s how the store is doing.">
      <div className="ad-row">
        <div className="au-seg" role="group" aria-label="Period">
          {PERIODS.map(([n, l]) => <button key={n} type="button" className={days === n ? 'is-on' : ''} onClick={() => setDays(n)}>{l}</button>)}
        </div>
        <span className="ad-muted">Compared with {vs}.</span>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !d ? <Loading /> : (
        <div className="ad-stack ad-mt">
          <div className="ad-stats">
            <Stat label="Sales booked" k={d.analytics.kpis.booked} money vs={vs} hint="Orders paid in the period, less refunds and refused cash-on-delivery parcels." />
            <Stat label="Money received" k={d.analytics.kpis.received} money vs={vs} hint="Paid online in the period (less refunds), plus cash collected on delivery." />
            <div className="ad-stat db-stat--cod" title="Across every open cash-on-delivery order, whenever it was placed.">
              <span>Cash still to collect</span><b>{inr(d.analytics.cod.outstanding.amount)}</b>
              <small>{d.analytics.cod.outstanding.parcels} parcel{d.analytics.cod.outstanding.parcels === 1 ? '' : 's'} on cash on delivery · right now</small>
            </div>
            <Stat label="Orders" k={d.analytics.kpis.orders} vs={vs} extra={`average ${inr(d.analytics.kpis.aov.now)}`} />
          </div>

          <div className="ad-actions">
            <ActionCard to="/admin/orders?tab=unfulfilled" n={d.toFulfil} label="orders to pack and ship" tone={d.toFulfil ? 'amber' : 'grey'} />
            <ActionCard to="/admin/orders?tab=attention" n={d.attention} label="orders need attention" tone={d.attention ? 'red' : 'grey'} />
            <ActionCard to="/admin/enquiries" n={d.newEnquiries} label="new enquiries" tone={d.newEnquiries ? 'blue' : 'grey'} />
            <ActionCard to="/admin/orders?tab=abandoned" n={d.abandonedWeek} label="unpaid checkouts this week" tone="grey" />
          </div>

          <div className="ad-grid-2">
            <Money a={d.analytics} />
            <Cod a={d.analytics} />
          </div>

          <Card title="Per day"><DailyChart series={d.analytics.series} /></Card>

          <div className="ad-grid-2">
            <Card title="Recent orders" actions={<Link to="/admin/orders" className="ad-link">All orders →</Link>} flush>
              {d.recentOrders.length ? (
                <table className="ad-table">
                  <tbody>
                    {d.recentOrders.map((o) => (
                      <tr key={o.id}>
                        <td><Link to={`/admin/orders/${o.id}`} className="ad-strong">#{o.number}</Link><div className="ad-muted">{fmtDate(o.paidAt, true)}</div></td>
                        <td>{o.name}</td>
                        <td><Badge tone={o.status === 'Confirmed' ? 'amber' : o.status === 'Refunded' || o.status === 'Cancelled' ? 'grey' : 'green'}>{o.status}</Badge></td>
                        <td className="ad-num">{inr(o.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ad-pad ad-muted">No orders yet. They’ll appear here as soon as someone buys.</p>}
            </Card>
            <div className="ad-stack">
              <Card title="Low stock" actions={<Link to="/admin/inventory" className="ad-link">Inventory →</Link>} flush>
                {d.lowStock.length ? (
                  <ul className="ad-list">
                    {d.lowStock.map((p) => (
                      <li key={p.productId}><Link to={`/admin/products/${p.productId}`}>{p.title}</Link><Badge tone={p.stock === 0 ? 'red' : 'amber'}>{p.stock === 0 ? 'Out of stock' : `${p.stock} left`}</Badge></li>
                    ))}
                  </ul>
                ) : <p className="ad-pad ad-muted">Every printed title has more than {d.lowStockThreshold} copies.</p>}
              </Card>
              <Card title={`Best sellers (${PERIODS.find(([n]) => n === days)![1].toLowerCase()})`} flush>
                {d.topProducts.length ? (
                  <ul className="ad-list">
                    {d.topProducts.map((p) => <li key={p.title}><span>{p.title}</span><span className="ad-muted">{p.quantity} sold · {inr(p.revenue)}</span></li>)}
                  </ul>
                ) : <p className="ad-pad ad-muted">No sales in this period.</p>}
              </Card>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/** A headline number with its change from the previous period (arrow and words, not colour alone). */
function Stat({ label, k, money, vs, hint, extra }: { label: string; k: Kpi; money?: boolean; vs: string; hint?: string; extra?: string }) {
  const change = k.prev ? Math.round(((k.now - k.prev) / k.prev) * 100) : null;
  const fmt = (n: number) => (money ? inr(n) : n.toLocaleString('en-IN'));
  return (
    <div className="ad-stat" title={hint}>
      <span>{label}</span><b>{fmt(k.now)}</b>
      <small>
        {change === null ? (k.now ? 'new this period' : `none in ${vs}`)
          : <span className={change > 0 ? 'db-up' : change < 0 ? 'db-down' : ''}>{change > 0 ? '▲' : change < 0 ? '▼' : '■'} {Math.abs(change)}%</span>}
        {change !== null && <> vs {fmt(k.prev)}</>}{extra && <> · {extra}</>}
      </small>
    </div>
  );
}

/** Where the period's money is: received online, collected in cash, still to collect, lost. */
function Money({ a }: { a: Analytics }) {
  const m = a.money;
  const rows: { label: string; hint: string; amount: number; tone?: 'muted' | 'warn' }[] = [
    { label: 'Paid online', hint: 'Orders paid in full online', amount: m.prepaid },
    { label: 'COD advances (online)', hint: 'The advance paid online on cash-on-delivery orders', amount: m.codAdvances },
    { label: 'COD cash collected', hint: 'Cash the courier collected (orders marked Delivered)', amount: m.codCollected },
    { label: 'COD cash still to collect', hint: 'All open cash-on-delivery orders, right now', amount: m.codOutstanding, tone: 'warn' },
    { label: 'COD cash lost', hint: 'Refused or cancelled before the cash was collected', amount: m.codLost, tone: 'muted' },
  ];
  const max = Math.max(1, ...rows.map((r) => r.amount));
  const received = m.prepaid + m.codAdvances + m.codCollected;
  return (
    <Card title="Where the money is">
      <p className="ad-muted au-hint">In hand this period: <b className="db-strong">{inr(received)}</b>{m.refunds > 0 && <> (after {inr(m.refunds)} refunded)</>}. Cash on delivery is kept apart until the courier collects it.</p>
      <ul className="au-bars">
        {rows.map((r) => (
          <li key={r.label}>
            <div className={'au-bar db-money' + (r.tone ? ` db-money--${r.tone}` : '')} title={r.hint}>
              <span className="au-bar__label">{r.label}</span>
              <span className="au-bar__track"><span className="au-bar__fill" style={{ width: r.amount ? `${Math.max(2, (r.amount / max) * 100)}%` : 0 }} /></span>
              <span className="au-bar__value"><b>{inr(r.amount)}</b></span>
            </div>
          </li>
        ))}
      </ul>
      <div className="db-mix">
        <span className="ad-label">Payment mix</span>
        <div className="db-mix__row">
          <span>Online <b>{a.mix.online.orders}</b> orders · {inr(a.mix.online.value)}</span>
          <span>Cash on delivery <b>{a.mix.cod.orders}</b> orders · {inr(a.mix.cod.value)}{a.cod.share !== null && ` (${a.cod.share}%)`}</span>
        </div>
      </div>
    </Card>
  );
}

/** Cash on delivery: what's still out there and for how long, how much gets collected, and how fast. */
function Cod({ a }: { a: Analytics }) {
  const c = a.cod;
  const max = Math.max(1, ...c.outstanding.ageing.map((x) => x.amount));
  return (
    <Card title="Cash on delivery" actions={<Link to="/admin/orders" className="ad-link">Orders →</Link>}>
      <div className="db-cod-head">
        <div><span className="ad-label">Still to collect</span><b>{inr(c.outstanding.amount)}</b><small>{c.outstanding.parcels} parcel{c.outstanding.parcels === 1 ? '' : 's'}</small></div>
        <div><span className="ad-label">Collection rate</span><b>{c.collectionRate === null ? '—' : `${c.collectionRate}%`}</b><small>{c.collectedOrders} collected · {c.lostOrders} refused or cancelled</small></div>
        <div><span className="ad-label">Days to collect</span><b>{c.avgDaysToCollect === null ? '—' : c.avgDaysToCollect}</b><small>on average, from order to cash</small></div>
      </div>
      <span className="ad-label">How long it has been waiting</span>
      <ul className="au-bars ad-mt">
        {c.outstanding.ageing.map((x) => (
          <li key={x.label}>
            <div className={'au-bar' + (x.label.includes('8+') && x.parcels ? ' db-money--warn' : '')} title={`${x.label}: ${x.parcels} parcel${x.parcels === 1 ? '' : 's'}, ${inr(x.amount)}`}>
              <span className="au-bar__label">{x.label}</span>
              <span className="au-bar__track"><span className="au-bar__fill" style={{ width: x.amount ? `${Math.max(2, (x.amount / max) * 100)}%` : 0 }} /></span>
              <span className="au-bar__value"><b>{inr(x.amount)}</b> <small>{x.parcels}</small></span>
            </div>
          </li>
        ))}
      </ul>
      {c.oldest.length > 0 && (
        <>
          <span className="ad-label ad-mt">Oldest cash due</span>
          <ul className="ad-list db-oldest">
            {c.oldest.map((o) => (
              <li key={o.id}>
                <Link to={`/admin/orders/${o.id}`}><b>#{o.number}</b> {o.name}</Link>
                <span className="ad-muted">{o.shippedAt ? `shipped ${fmtDate(o.shippedAt)}` : 'not shipped'} · {o.waitingDays}d · <b className="db-strong">{inr(o.codAmount)}</b></span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="ad-muted ad-mt">The cash counts as collected when you mark the order <b>Delivered</b>. {c.share !== null && `${c.share}% of this period’s orders were cash on delivery.`}</p>
    </Card>
  );
}

function ActionCard({ to, n, label, tone }: { to: string; n: number; label: string; tone: string }) {
  return <Link to={to} className={`ad-action ad-action--${tone}`}><b>{n}</b><span>{label}</span><i>→</i></Link>;
}

/** One measure at a time (booked, received or orders) per day, with a hover read-out. */
function DailyChart({ series }: { series: Analytics['series'] }) {
  const [metric, setMetric] = useState<'booked' | 'received' | 'orders'>('booked');
  const [hover, setHover] = useState<number | null>(null);
  const val = (s: Analytics['series'][number]) => s[metric];
  const fmt = (n: number) => (metric === 'orders' ? `${n} order${n === 1 ? '' : 's'}` : inr(n));
  const max = Math.max(...series.map(val), 1);
  const W = 900, H = 200, gap = series.length > 60 ? 1 : series.length > 20 ? 3 : 6, bw = (W - gap * (series.length - 1)) / series.length;
  const h = hover !== null ? series[hover] : null;
  const total = series.reduce((a, s) => a + val(s), 0);
  const dayLabel = (d: string, long = false) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { ...(long ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' } as Intl.DateTimeFormatOptions);
  const every = Math.ceil(series.length / 6);
  return (
    <div className="ad-chart">
      <div className="ad-row db-chart-head">
        <div className="au-seg" role="group" aria-label="Measure">
          {([['booked', 'Sales booked'], ['received', 'Money received'], ['orders', 'Orders']] as const).map(([k, l]) => (
            <button key={k} type="button" className={metric === k ? 'is-on' : ''} onClick={() => setMetric(k)}>{l}</button>
          ))}
        </div>
        <div className="ad-chart__readout">
          {h ? <><b>{fmt(val(h))}</b> · {dayLabel(h.day, true)}{metric !== 'orders' && <> · {h.orders} order{h.orders === 1 ? '' : 's'}</>}</>
            : <><b>{fmt(total)}</b> in this period</>}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`${metric} per day`} onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H} y2={H} className="ad-chart__axis" />
        {series.map((s, i) => {
          const bh = Math.max((val(s) / max) * (H - 10), val(s) ? 3 : 0);
          return (
            <g key={s.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx={bw > 6 ? 2 : 0} className={'ad-chart__bar' + (hover === i ? ' is-hover' : '')} />
              {(i % every === 0 || i === series.length - 1) && (i === series.length - 1 || series.length - 1 - i >= every / 2) && (
                // The first and last labels hug the edges so they aren't cut off.
                <text x={i === 0 ? 0 : i === series.length - 1 ? W : i * (bw + gap) + bw / 2} y={H + 16} textAnchor={i === 0 && series.length > 1 ? 'start' : i === series.length - 1 && series.length > 1 ? 'end' : 'middle'} className="ad-chart__label">{dayLabel(s.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="ad-muted db-note">{pct(series.filter((s) => val(s) > 0).length, series.length)}% of days had {metric === 'orders' ? 'orders' : 'sales'}.</p>
    </div>
  );
}
