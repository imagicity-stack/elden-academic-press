import { useState } from 'react';
import { inr } from '../../store/api';
import { adminApi, fmtDate, rupees, toPaise, useAdmin } from '../api';
import { canManage, useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, MoneyField, Page, SelectField, TextField, useAction } from '../ui';

interface Coupon {
  id: string; code: string; description: string; type: 'percent' | 'fixed'; value: number; minSubtotal: number; maxDiscount: number | null;
  startsAt: string | null; endsAt: string | null; usageLimit: number | null; usedCount: number; oncePerCustomer: boolean; active: boolean;
}

export default function Discounts() {
  const { me } = useMe();
  const { data, error, reload } = useAdmin<{ items: Coupon[] }>('/coupons');
  const [editing, setEditing] = useState<Coupon | 'new' | null>(null);
  const describe = (c: Coupon) => `${c.type === 'percent' ? `${c.value}% off` : `${inr(c.value)} off`}${c.maxDiscount ? ` (up to ${inr(c.maxDiscount)})` : ''}${c.minSubtotal ? ` on orders over ${inr(c.minSubtotal)}` : ''}`;
  const state = (c: Coupon) => {
    const now = Date.now();
    if (!c.active) return <Badge>Off</Badge>;
    if (c.endsAt && new Date(c.endsAt).getTime() < now) return <Badge>Expired</Badge>;
    if (c.startsAt && new Date(c.startsAt).getTime() > now) return <Badge tone="blue">Scheduled</Badge>;
    if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return <Badge>Used up</Badge>;
    return <Badge tone="green">Active</Badge>;
  };
  return (
    <Page title="Discount codes" subtitle="Codes customers enter at checkout." actions={canManage(me) && <Btn kind="primary" onClick={() => setEditing('new')}>Create code</Btn>}>
      <Card flush>
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? <Empty title="No discount codes yet." /> : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr><th>Code</th><th>Discount</th><th>Valid</th><th className="ad-num">Used</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id} onClick={() => canManage(me) && setEditing(c)}>
                    <td><span className="ad-code">{c.code}</span><div className="ad-muted">{c.description}</div></td>
                    <td>{describe(c)}{c.oncePerCustomer && <div className="ad-muted">Once per customer</div>}</td>
                    <td className="ad-muted">{c.startsAt || c.endsAt ? `${c.startsAt ? fmtDate(c.startsAt) : 'Now'} – ${c.endsAt ? fmtDate(c.endsAt) : 'no end'}` : 'Always'}</td>
                    <td className="ad-num">{c.usedCount}{c.usageLimit !== null && ` / ${c.usageLimit}`}</td>
                    <td>{state(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {editing && <CouponDialog coupon={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </Page>
  );
}

const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (s: string) => (s ? new Date(s + ':00+05:30').toISOString() : null);

function CouponDialog({ coupon, onClose, onSaved }: { coupon: Coupon | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: coupon?.code ?? '', description: coupon?.description ?? '', type: coupon?.type ?? 'percent',
    value: coupon ? (coupon.type === 'percent' ? String(coupon.value) : rupees(coupon.value)) : '10',
    minSubtotal: coupon?.minSubtotal ? rupees(coupon.minSubtotal) : '', maxDiscount: coupon?.maxDiscount ? rupees(coupon.maxDiscount) : '',
    startsAt: toLocal(coupon?.startsAt ?? null), endsAt: toLocal(coupon?.endsAt ?? null),
    usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : '', oncePerCustomer: coupon?.oncePerCustomer ?? false, active: coupon?.active ?? true,
  });
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run('save', () => adminApi(coupon ? `/coupons/${coupon.id}` : '/coupons', {
    method: coupon ? 'PUT' : 'POST',
    body: {
      code: f.code, description: f.description, type: f.type,
      value: f.type === 'percent' ? Number(f.value) : toPaise(f.value),
      minSubtotal: f.minSubtotal ? toPaise(f.minSubtotal) : 0, maxDiscount: f.maxDiscount ? toPaise(f.maxDiscount) : null,
      startsAt: fromLocal(f.startsAt), endsAt: fromLocal(f.endsAt), usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
      oncePerCustomer: f.oncePerCustomer, active: f.active,
    },
  }), 'Saved').then((r) => r && onSaved());
  const remove = () => confirm('Delete this code? If it has been used it will be switched off instead.') &&
    run('del', () => adminApi(`/coupons/${coupon!.id}`, { method: 'DELETE' }), 'Done').then((r) => r && onSaved());

  return (
    <Modal title={coupon ? `Edit ${coupon.code}` : 'Create discount code'} onClose={onClose} footer={<>
      {coupon && <Btn kind="danger" busy={busy === 'del'} onClick={remove}>Delete</Btn>}
      <span className="ad-grow" />
      <Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'save'} onClick={save} disabled={!f.code.trim() || !f.value}>Save</Btn>
    </>}>
      <div className="ad-form">
        <div className="ad-form-grid">
          <TextField label="Code" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} placeholder="DIWALI15" />
          <SelectField label="Type" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="percent">Percentage off</option><option value="fixed">Fixed amount off</option></SelectField>
        </div>
        <TextField label="Description (shown to the customer)" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="15% off for Diwali" />
        <div className="ad-form-grid">
          {f.type === 'percent'
            ? <TextField label="Percent" type="number" min={1} max={100} value={f.value} onChange={(e) => set('value', e.target.value)} />
            : <MoneyField label="Amount" value={f.value} onChange={(e) => set('value', e.target.value)} />}
          {f.type === 'percent' && <MoneyField label="Maximum discount (optional)" value={f.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />}
          <MoneyField label="Minimum order (optional)" value={f.minSubtotal} onChange={(e) => set('minSubtotal', e.target.value)} />
          <TextField label="Total uses allowed (optional)" type="number" min={1} value={f.usageLimit} onChange={(e) => set('usageLimit', e.target.value)} />
          <TextField label="Starts (optional)" type="datetime-local" value={f.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          <TextField label="Ends (optional)" type="datetime-local" value={f.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
        </div>
        <Check label="Once per customer" hint="Checked against the customer’s email address" checked={f.oncePerCustomer} onChange={(v) => set('oncePerCustomer', v)} />
        <Check label="Active" checked={f.active} onChange={(v) => set('active', v)} />
      </div>
    </Modal>
  );
}
