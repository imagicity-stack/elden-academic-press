import { useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, fmtDate, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, Page, useAction } from '../ui';

interface Item { variantId: string; productId: string; title: string; classLabel: string; status: string; sku: string | null; stock: number; trackStock: boolean; active: boolean }
const REASONS = [['received', 'Stock received'], ['returned', 'Returned'], ['correction', 'Count correction'], ['damaged', 'Damaged / lost'], ['other', 'Other']] as const;

export default function Inventory() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [low, setLow] = useState(false);
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (low) params.set('low', '1');
  const { data, error, reload } = useAdmin<{ items: Item[]; lowStockThreshold: number }>(`/inventory?${params}`);
  const [history, setHistory] = useState<Item | null>(null);

  return (
    <Page title="Inventory" subtitle="Printed copies in stock. E-books never run out.">
      <Card flush>
        <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <input type="search" className="ad-search" placeholder="Search title or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="ad-inline"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Low stock only</label>
          <Btn size="sm" type="submit">Search</Btn>
        </form>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="Nothing matches." /> : (
          <div className="ad-table-wrap">
            <table className="ad-table">
              <thead><tr><th>Title</th><th>SKU</th><th className="ad-num">In stock</th><th>Adjust</th><th /></tr></thead>
              <tbody>
                {data.items.map((it) => <Row key={it.variantId} it={it} threshold={data.lowStockThreshold} onChanged={reload} onHistory={() => setHistory(it)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {history && <History item={history} onClose={() => setHistory(null)} />}
    </Page>
  );
}

function Row({ it, threshold, onChanged, onHistory }: { it: Item; threshold: number; onChanged: () => void; onHistory: () => void }) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<string>('received');
  const { busy, run } = useAction();
  const n = parseInt(delta, 10);
  const apply = async () => {
    const r = await run('adj', () => adminApi(`/inventory/${it.variantId}/adjust`, { body: { delta: n, reason } }), `${it.title}: ${n > 0 ? '+' : ''}${n}`);
    if (r) { setDelta(''); onChanged(); }
  };
  return (
    <tr>
      <td><Link to={`/admin/products/${it.productId}`} className="ad-strong">{it.title}</Link><div className="ad-muted">{it.classLabel}{it.status !== 'active' && ` · ${it.status}`}</div></td>
      <td className="ad-muted">{it.sku ?? '—'}</td>
      <td className="ad-num">{it.trackStock ? <Badge tone={it.stock === 0 ? 'red' : it.stock <= threshold ? 'amber' : 'grey'}>{it.stock}</Badge> : <span className="ad-muted">Not tracked</span>}</td>
      <td>
        {it.trackStock && (
          <form className="ad-adjust" onSubmit={(e) => { e.preventDefault(); if (n) apply(); }}>
            <input type="number" placeholder="+50 / −2" value={delta} onChange={(e) => setDelta(e.target.value)} aria-label={`Change stock for ${it.title}`} />
            <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">{REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <Btn size="sm" type="submit" busy={busy === 'adj'} disabled={!n}>Apply</Btn>
          </form>
        )}
      </td>
      <td><button type="button" className="ad-link" onClick={onHistory}>History</button></td>
    </tr>
  );
}

function History({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data } = useAdmin<{ items: { id: number; delta: number; stockAfter: number; reason: string; note: string; actor: string; createdAt: string; orderId: string | null }[] }>(`/inventory/${item.variantId}/movements`);
  return (
    <Modal title={`Stock history — ${item.title}`} onClose={onClose} wide>
      {!data ? <Loading /> : data.items.length === 0 ? <p className="ad-muted">No changes yet.</p> : (
        <table className="ad-table">
          <thead><tr><th>Date</th><th className="ad-num">Change</th><th className="ad-num">After</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>
            {data.items.map((m) => (
              <tr key={m.id}>
                <td className="ad-muted">{fmtDate(m.createdAt, true)}</td>
                <td className={'ad-num ' + (m.delta < 0 ? 'ad-neg' : 'ad-pos')}>{m.delta > 0 ? '+' : ''}{m.delta}</td>
                <td className="ad-num">{m.stockAfter}</td>
                <td>{m.reason}{m.note && <span className="ad-muted"> — {m.note}</span>}{m.orderId && <> · <Link to={`/admin/orders/${m.orderId}`}>order</Link></>}</td>
                <td className="ad-muted">{m.actor}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
