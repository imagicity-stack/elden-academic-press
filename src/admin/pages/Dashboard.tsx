import { useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../../store/api';
import { fmtDate, useAdmin } from '../api';
import { useMe } from '../AdminApp';
import { Badge, Card, ErrorBox, Loading, Page } from '../ui';

interface Dash {
  today: { revenue: number; orders: number };
  week: { revenue: number; orders: number };
  month: { revenue: number; orders: number };
  aov: number;
  series: { day: string; revenue: number; orders: number }[];
  toFulfil: number; attention: number; newEnquiries: number; abandonedWeek: number;
  lowStock: { productId: string; title: string; stock: number }[];
  lowStockThreshold: number;
  topProducts: { title: string; quantity: number; revenue: number }[];
  recentOrders: { id: string; number: number; name: string; total: number; paidAt: string; status: string }[];
}

export default function Dashboard() {
  const { me } = useMe();
  const { data: d, error, reload } = useAdmin<Dash>('/dashboard');
  if (error) return <Page title="Dashboard"><ErrorBox error={error} retry={reload} /></Page>;
  if (!d) return <Page title="Dashboard"><Loading /></Page>;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <Page title={`${greet}${me.name && me.name !== 'Owner' ? ', ' + me.name.split(' ')[0] : ''}`} subtitle="Here’s how the store is doing.">
      <div className="ad-stats">
        <Stat label="Today" value={inr(d.today.revenue)} sub={`${d.today.orders} order${d.today.orders === 1 ? '' : 's'}`} />
        <Stat label="Last 7 days" value={inr(d.week.revenue)} sub={`${d.week.orders} orders`} />
        <Stat label="Last 30 days" value={inr(d.month.revenue)} sub={`${d.month.orders} orders`} />
        <Stat label="Average order" value={inr(d.aov)} sub="last 30 days" />
      </div>

      <div className="ad-actions">
        <ActionCard to="/admin/orders?tab=unfulfilled" n={d.toFulfil} label="orders to pack and ship" tone={d.toFulfil ? 'amber' : 'grey'} />
        <ActionCard to="/admin/orders?tab=attention" n={d.attention} label="orders need attention" tone={d.attention ? 'red' : 'grey'} />
        <ActionCard to="/admin/enquiries" n={d.newEnquiries} label="new enquiries" tone={d.newEnquiries ? 'blue' : 'grey'} />
        <ActionCard to="/admin/orders?tab=abandoned" n={d.abandonedWeek} label="unpaid checkouts this week" tone="grey" />
      </div>

      <Card title="Sales — last 30 days"><SalesChart series={d.series} /></Card>

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
          <Card title="Best sellers (30 days)" flush>
            {d.topProducts.length ? (
              <ul className="ad-list">
                {d.topProducts.map((p) => <li key={p.title}><span>{p.title}</span><span className="ad-muted">{p.quantity} sold · {inr(p.revenue)}</span></li>)}
              </ul>
            ) : <p className="ad-pad ad-muted">No sales yet.</p>}
          </Card>
        </div>
      </div>
    </Page>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="ad-stat"><span>{label}</span><b>{value}</b><small>{sub}</small></div>
);

function ActionCard({ to, n, label, tone }: { to: string; n: number; label: string; tone: string }) {
  return <Link to={to} className={`ad-action ad-action--${tone}`}><b>{n}</b><span>{label}</span><i>→</i></Link>;
}

function SalesChart({ series }: { series: Dash['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...series.map((s) => s.revenue), 1);
  const W = 900, H = 200, gap = 4, bw = (W - gap * (series.length - 1)) / series.length;
  const h = hover !== null ? series[hover] : null;
  const total = series.reduce((a, s) => a + s.revenue, 0);
  return (
    <div className="ad-chart">
      <div className="ad-chart__readout">
        {h ? <><b>{inr(h.revenue)}</b> · {h.orders} order{h.orders === 1 ? '' : 's'} · {new Date(h.day).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</>
          : <><b>{inr(total)}</b> in the last 30 days</>}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label="Daily revenue for the last 30 days" onMouseLeave={() => setHover(null)}>
        <line x1="0" x2={W} y1={H} y2={H} className="ad-chart__axis" />
        {series.map((s, i) => {
          const bh = Math.max((s.revenue / max) * (H - 10), s.revenue ? 3 : 0);
          return (
            <g key={s.day} onMouseEnter={() => setHover(i)}>
              <rect x={i * (bw + gap)} y={0} width={bw} height={H} fill="transparent" />
              <rect x={i * (bw + gap)} y={H - bh} width={bw} height={bh} rx="2" className={'ad-chart__bar' + (hover === i ? ' is-hover' : '')} />
              {(i % 5 === 0 || i === series.length - 1) && <text x={i * (bw + gap) + bw / 2} y={H + 16} textAnchor="middle" className="ad-chart__label">{new Date(s.day).getDate()}/{new Date(s.day).getMonth() + 1}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
