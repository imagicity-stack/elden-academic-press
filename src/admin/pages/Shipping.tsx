// Admin → Shipping: everything Delhivery. Book parcels (one or many), print labels, ask for a
// pickup, follow every parcel, act on failed deliveries, and the Delhivery settings.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, fmtDate, openPrintable, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, Page, SelectField, TextField, useAction } from '../ui';
import { SHIPMENT_LABEL, type ShipmentStatus } from '../../shared/shipping';
import { COD_CONFIRMATION_LABEL, type CodConfirmation } from '../../shared/calls';

export interface ShippingSettings {
  enabled: boolean; pickupLocation: string; originPin: string; mode: 'Surface' | 'Express'; autoShip: boolean; checkoutCheck: boolean;
  lengthCm: number; breadthCm: number; heightCm: number; packagingGrams: number; defaultBookGrams: number; hsnCode: string;
}
interface ToShip {
  id: string; number: number; name: string; city: string | null; pincode: string | null; total: number; paymentMode: string; codAmount: number;
  codConfirmation: CodConfirmation; paidAt: string | null; fulfillmentStatus: string; needsAttention: boolean; attentionReason: string | null;
}
export interface ShipRow {
  id: string; waybill: string; status: ShipmentStatus; carrierStatus: string; statusLocation: string; statusNote: string; statusAt: string | null;
  paymentMode: string; codAmount: number; weightGrams: number; mode: string; chargeEstimate: number | null; expectedDeliveryAt: string | null; attempts: number;
  ndrAction: string | null; ndrResult: string | null; pickupRequestId: number | null; syncError: string | null; lastSyncedAt: string | null; createdAt: string; env: string;
  orderId: string; orderNumber: number; name: string; city: string | null; pincode: string | null; phone: string;
}
interface Pickup { id: number; pickupId: string; pickupDate: string; pickupTime: string; packageCount: number; centerName: string; createdBy: string; createdAt: string }
interface Overview {
  settings: ShippingSettings; blockers: string[]; connected: boolean; env: 'staging' | 'production' | null; simulator: boolean; webhook: string | null;
  counts: Partial<Record<ShipmentStatus, number>>; toShip: ToShip[]; shipments: ShipRow[]; pickups: Pickup[];
  awaitingPickup: { total: number; unrequested: number };
  /** Parts of the page the server couldn't load in time (they show empty). */
  problems?: string[];
}

export const SHIP_TONE: Record<ShipmentStatus, 'grey' | 'amber' | 'green' | 'red' | 'blue'> = {
  manifested: 'amber', in_transit: 'blue', pending: 'blue', out_for_delivery: 'blue', ndr: 'red', delivered: 'green', rto: 'red', returned: 'grey', cancelled: 'grey', lost: 'red',
};
export const ShipBadge = ({ s }: { s: ShipmentStatus }) => <Badge tone={SHIP_TONE[s]}>{SHIPMENT_LABEL[s]}</Badge>;

const TABS: { key: string; label: string; statuses?: ShipmentStatus[] }[] = [
  { key: 'book', label: 'To book' },
  { key: 'pickup', label: 'Ready for pickup', statuses: ['manifested'] },
  { key: 'transit', label: 'In transit', statuses: ['in_transit', 'pending', 'out_for_delivery'] },
  { key: 'ndr', label: 'Failed delivery', statuses: ['ndr'] },
  { key: 'returns', label: 'Returns', statuses: ['rto', 'returned', 'lost'] },
  { key: 'delivered', label: 'Delivered', statuses: ['delivered'] },
  { key: 'all', label: 'All parcels' },
  { key: 'settings', label: 'Settings' },
];

const istToday = (plusDays = 0) => new Date(Date.now() + 5.5 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);
const kg = (g: number) => (g >= 1000 ? `${(g / 1000).toFixed(2).replace(/\.?0+$/, '')} kg` : `${g} g`);

export default function Shipping() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.find((t) => t.key === sp.get('tab')) ?? TABS[0];
  const { data, error, reload } = useAdmin<Overview>('/shipping');
  const { busy, run } = useAction();
  const sync = () => run('sync', async () => { const r = await adminApi<{ checked: number; updated: number; errors: number }>('/shipping/sync', { method: 'POST' }); reload(); return r; }, 'Tracking refreshed');
  const count = (t: (typeof TABS)[number]) => t.key === 'book' ? data?.toShip.length : t.statuses ? t.statuses.reduce((n, s) => n + (data?.counts[s] ?? 0), 0) : undefined;

  return (
    <Page title="Shipping" subtitle={data?.env ? <>Delhivery {data.simulator ? 'simulator (local development)' : data.env === 'staging' ? 'test system (staging)' : 'live'}</> : 'Delhivery'}
      actions={<Btn busy={busy === 'sync'} onClick={sync} disabled={!data?.connected}>Refresh tracking</Btn>}>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : <>
        {(data.problems?.length ?? 0) > 0 && (
          <div className="ad-note ad-note--warn"><b>Some of this page didn’t load in time:</b> {data.problems!.join(', ')}. Refresh in a minute; if it keeps happening, the server logs say why.</div>
        )}
        {data.blockers.length > 0 && tab.key !== 'settings' && (
          <div className="ad-note ad-note--warn">
            <b>Delhivery isn’t ready to book parcels yet.</b>
            <ul>{data.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            <button type="button" className="ad-link" onClick={() => setSp({ tab: 'settings' })}>Open settings</button>
          </div>
        )}
        <div className="ad-tabs">
          {TABS.map((t) => {
            const n = count(t);
            return (
              <button key={t.key} type="button" className={'ad-tab' + (t.key === tab.key ? ' is-on' : '')} onClick={() => setSp(t.key === 'book' ? {} : { tab: t.key })}>
                {t.label}{n ? <span className="ad-tab__n">{n}</span> : null}
              </button>
            );
          })}
        </div>
        {tab.key === 'settings' ? <SettingsTab data={data} onSaved={reload} />
          : tab.key === 'book' ? <ToBook rows={data.toShip} ready={data.blockers.length === 0} onDone={reload} />
          : <>
            {tab.key === 'pickup' && <PickupCard data={data} onDone={reload} />}
            <Parcels rows={tab.statuses ? data.shipments.filter((s) => tab.statuses!.includes(s.status)) : data.shipments} onChange={reload} tab={tab.key} />
          </>}
      </>}
    </Page>
  );
}

/* ---------------- To book ---------------- */

function ToBook({ rows, ready, onDone }: { rows: ToShip[]; ready: boolean; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ booked: { id: string; waybill: string }[]; failed: { number: number; error: string }[] } | null>(null);
  const { busy, run } = useAction();
  const unconfirmed = (r: ToShip) => r.paymentMode === 'cod' && r.codConfirmation && r.codConfirmation !== 'confirmed';
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.length > 0 && picked.size === rows.length;
  const book = () => run('book', async () => {
    const ids = [...picked];
    const r = await adminApi<{ results: { orderId: string; waybill?: string; shipmentId?: string; error?: string }[] }>('/shipping/bulk-ship', { body: { orderIds: ids } });
    setResult({
      booked: r.results.filter((x) => x.waybill).map((x) => ({ id: x.shipmentId!, waybill: x.waybill! })),
      failed: r.results.filter((x) => x.error).map((x) => ({ number: rows.find((o) => o.id === x.orderId)?.number ?? 0, error: x.error! })),
    });
    setPicked(new Set());
    onDone();
  });
  return (
    <Card flush title="Paid orders waiting for a Delhivery booking" actions={
      <Btn kind="primary" busy={busy === 'book'} disabled={!ready || picked.size === 0} onClick={book}>Book {picked.size || ''} with Delhivery</Btn>
    }>
      {result && (
        <div className="ad-note">
          {result.booked.length > 0 && <p><b>{result.booked.length} booked.</b> <button type="button" className="ad-link" onClick={() => run('labels', () => openPrintable(`/shipping/labels.pdf?ids=${result.booked.map((b) => b.id).join(',')}&size=4R`))}>Print their labels (4 × 6)</button>{' · '}<button type="button" className="ad-link" onClick={() => run('labels', () => openPrintable(`/shipping/labels.pdf?ids=${result.booked.map((b) => b.id).join(',')}&size=A4`))}>A4</button></p>}
          {result.failed.map((f) => <p key={f.number} className="ad-err-text">#{f.number}: {f.error}</p>)}
        </div>
      )}
      {rows.length === 0 ? <Empty title="Nothing to book: every paid order is with Delhivery." /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setPicked(all ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
              <th>Order</th><th>Paid</th><th>Deliver to</th><th>Payment</th><th className="ad-num">Total</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><input type="checkbox" aria-label={`Select order ${r.number}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td><Link to={`/admin/orders/${r.id}`} className="ad-strong">#{r.number}</Link>{r.needsAttention && <Badge tone="red">Check</Badge>}
                    {r.needsAttention && r.attentionReason && <div className="ad-muted ad-small">{r.attentionReason}</div>}</td>
                  <td className="ad-muted ad-nowrap">{r.paidAt ? fmtDate(r.paidAt, true) : '—'}</td>
                  <td><div>{r.name}</div><div className="ad-muted">{[r.city, r.pincode].filter(Boolean).join(' · ')}</div></td>
                  <td>{r.paymentMode === 'cod' ? <Badge tone="amber">COD {inr(r.codAmount)}</Badge> : <Badge tone="green">Prepaid</Badge>}
                    {unconfirmed(r) && <Badge tone={r.codConfirmation === 'pending' ? 'amber' : 'red'}>{COD_CONFIRMATION_LABEL[r.codConfirmation as Exclude<CodConfirmation, ''>]}</Badge>}</td>
                  <td className="ad-num ad-strong">{inr(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="ad-src-note ad-muted">Each order is booked with its printed books only (e-books never ship), weighed from the books plus packing, in the usual box. Open an order to change the weight, box or speed first. Cash-on-delivery orders not yet confirmed are confirmed by booking them.</p>
    </Card>
  );
}

/* ---------------- Parcels ---------------- */

function Parcels({ rows, onChange, tab }: { rows: ShipRow[]; onChange: () => void; tab: string }) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [size, setSize] = useState<'4R' | 'A4'>('4R');
  const [ndr, setNdr] = useState<ShipRow | null>(null);
  const { busy, run } = useAction();
  const printable = rows.filter((r) => r.status !== 'cancelled');
  const all = printable.length > 0 && printable.every((r) => picked.has(r.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const labels = (ids: string[]) => run('labels', () => openPrintable(`/shipping/labels.pdf?ids=${ids.join(',')}&size=${size}`));
  return (
    <Card flush actions={
      <div className="ad-row">
        <select aria-label="Label size" value={size} onChange={(e) => setSize(e.target.value as '4R' | 'A4')}><option value="4R">Labels 4 × 6 in</option><option value="A4">Labels A4</option></select>
        <Btn busy={busy === 'labels'} disabled={picked.size === 0} onClick={() => labels([...picked])}>Print {picked.size || ''} label{picked.size === 1 ? '' : 's'}</Btn>
      </div>
    }>
      {rows.length === 0 ? <Empty title={tab === 'ndr' ? 'No failed deliveries. 🎉' : 'No parcels here.'} /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr>
              <th><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setPicked(all ? new Set() : new Set(printable.map((r) => r.id)))} /></th>
              <th>Parcel</th><th>Order</th><th>Status</th><th>Expected</th><th>Parcel</th><th />
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.status !== 'cancelled' && <input type="checkbox" aria-label={`Select ${r.waybill}`} checked={picked.has(r.id)} onChange={() => toggle(r.id)} />}</td>
                  <td><a className="ad-strong ad-mono" href={`https://www.delhivery.com/track-v2/package/${r.waybill}`} target="_blank" rel="noopener noreferrer">{r.waybill}</a>
                    <div className="ad-muted ad-small">Booked {fmtDate(r.createdAt, true)}{r.env === 'staging' ? ' · staging' : ''}</div></td>
                  <td><Link to={`/admin/orders/${r.orderId}`}>#{r.orderNumber}</Link><div className="ad-muted">{r.name} · {[r.city, r.pincode].filter(Boolean).join(' ')}</div></td>
                  <td><ShipBadge s={r.status} />
                    <div className="ad-muted ad-small">{[r.carrierStatus, r.statusLocation.replace(/_/g, ' ')].filter(Boolean).join(' · ')}{r.statusAt ? ` · ${fmtDate(r.statusAt, true)}` : ''}</div>
                    {r.statusNote && r.status !== 'manifested' && <div className="ad-small">{r.statusNote}</div>}
                    {r.status === 'ndr' && r.ndrAction && <div className="ad-small">Asked: {r.ndrAction}{r.ndrResult ? ` · ${r.ndrResult}` : ' · waiting for Delhivery'}</div>}
                    {r.syncError && <div className="ad-err-text ad-small">Tracking: {r.syncError}</div>}</td>
                  <td className="ad-nowrap">{r.expectedDeliveryAt ? fmtDate(r.expectedDeliveryAt) : '—'}{r.attempts > 0 && <div className="ad-muted ad-small">{r.attempts} attempt{r.attempts === 1 ? '' : 's'}</div>}</td>
                  <td className="ad-nowrap">{r.paymentMode === 'COD' ? <Badge tone="amber">COD {inr(r.codAmount)}</Badge> : <Badge tone="green">Prepaid</Badge>}
                    <div className="ad-muted ad-small">{kg(r.weightGrams)} · {r.mode}{r.chargeEstimate ? ` · ~${inr(r.chargeEstimate)}` : ''}</div></td>
                  <td className="ad-nowrap">
                    <div className="ad-row">
                      {r.status !== 'cancelled' && <Btn size="sm" onClick={() => labels([r.id])}>Label</Btn>}
                      {(r.status === 'ndr' || r.status === 'pending') && <Btn size="sm" kind="primary" onClick={() => setNdr(r)}>Act</Btn>}
                      {!['delivered', 'returned', 'cancelled', 'lost'].includes(r.status) && <Btn size="sm" kind="ghost" busy={busy === `r${r.id}`} onClick={() => run(`r${r.id}`, async () => { await adminApi(`/shipping/shipments/${r.id}/refresh`, { method: 'POST' }); onChange(); }, 'Updated from Delhivery')}>Refresh</Btn>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ndr && <NdrModal s={ndr} onClose={() => setNdr(null)} onDone={() => { setNdr(null); onChange(); }} />}
    </Card>
  );
}

/** What to tell Delhivery after a failed delivery: try again, deliver on a date, or corrected details. */
export function NdrModal({ s, onClose, onDone }: { s: Pick<ShipRow, 'id' | 'waybill' | 'statusNote' | 'name' | 'phone'>; onClose: () => void; onDone: () => void }) {
  const [action, setAction] = useState<'RE-ATTEMPT' | 'DEFER_DLV' | 'EDIT_DETAILS'>('RE-ATTEMPT');
  const [date, setDate] = useState(istToday(1));
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const { busy, run } = useAction();
  const send = () => run('ndr', async () => {
    await adminApi(`/shipping/shipments/${s.id}/ndr`, { body: {
      action, ...(action === 'DEFER_DLV' ? { deferredDate: date } : {}),
      ...(action === 'EDIT_DETAILS' ? Object.fromEntries(Object.entries({ name, address, phone }).filter(([, v]) => v.trim())) : {}),
    } });
    onDone();
  }, 'Sent to Delhivery');
  return (
    <Modal title={`Failed delivery · ${s.waybill}`} onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>Close</Btn><Btn kind="primary" busy={busy === 'ndr'} onClick={send}>Send to Delhivery</Btn></>}>
      {s.statusNote && <p className="ad-note">Courier’s note: <b>{s.statusNote}</b></p>}
      <p className="ad-muted">Call the customer first ({s.name}, <a href={`tel:${s.phone}`}>{s.phone}</a>), then tell Delhivery what to do.</p>
      <div className="ad-stack">
        <Check label="Deliver again (next working day)" checked={action === 'RE-ATTEMPT'} onChange={() => setAction('RE-ATTEMPT')} />
        <Check label="Deliver on a date the customer chose (up to 6 days after the first attempt)" checked={action === 'DEFER_DLV'} onChange={() => setAction('DEFER_DLV')} />
        {action === 'DEFER_DLV' && <TextField label="Delivery date" type="date" value={date} min={istToday(1)} max={istToday(6)} onChange={(e) => setDate(e.target.value)} />}
        <Check label="Correct the name, address or phone" checked={action === 'EDIT_DETAILS'} onChange={() => setAction('EDIT_DETAILS')} />
        {action === 'EDIT_DETAILS' && <>
          <TextField label="Name (only if it changes)" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Address (only if it changes)" value={address} onChange={(e) => setAddress(e.target.value)} />
          <TextField label="Mobile number (only if it changes)" value={phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} />
        </>}
      </div>
    </Modal>
  );
}

/* ---------------- Pickup ---------------- */

function PickupCard({ data, onDone }: { data: Overview; onDone: () => void }) {
  const afterTwo = new Date(Date.now() + 5.5 * 3600_000).getUTCHours() >= 14;
  const [date, setDate] = useState(istToday(afterTwo ? 1 : 0));
  const [time, setTime] = useState('15:00');
  const { busy, run } = useAction();
  const waiting = data.awaitingPickup.unrequested;
  const ask = () => run('pickup', async () => { await adminApi('/shipping/pickup', { body: { date, time } }); onDone(); }, 'Pickup booked with Delhivery');
  return (
    <Card title="Courier pickup" actions={<Btn kind="primary" busy={busy === 'pickup'} disabled={waiting === 0 || data.blockers.length > 0} onClick={ask}>Ask Delhivery to collect {waiting || ''} parcel{waiting === 1 ? '' : 's'}</Btn>}>
      <div className="ad-row">
        <TextField label="Date" type="date" value={date} min={istToday()} onChange={(e) => setDate(e.target.value)} />
        <TextField label="From (time)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <p className="ad-muted ad-small">{data.awaitingPickup.total} parcel{data.awaitingPickup.total === 1 ? '' : 's'} booked and waiting at “{data.settings.pickupLocation || 'your pickup location'}”; {waiting} not yet in a pickup request. Delhivery takes one open pickup per location at a time: book the next one after this one is collected.</p>
      {data.pickups.length > 0 && (
        <ul className="ad-list">
          {data.pickups.map((p) => <li key={p.id}><b>{fmtDate(p.pickupDate)} {p.pickupTime.slice(0, 5)}</b> · {p.packageCount} parcel{p.packageCount === 1 ? '' : 's'} · pickup {p.pickupId}{p.centerName ? ` · ${p.centerName.replace(/_/g, ' ')}` : ''} <span className="ad-muted">by {p.createdBy}</span></li>)}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- Settings ---------------- */

function SettingsTab({ data, onSaved }: { data: Overview; onSaved: () => void }) {
  const [f, setF] = useState<ShippingSettings>(data.settings);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const { busy, run } = useAction();
  const set = <K extends keyof ShippingSettings>(k: K, v: ShippingSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (k: 'lengthCm' | 'breadthCm' | 'heightCm' | 'packagingGrams' | 'defaultBookGrams') => ({
    value: String(f[k]), inputMode: 'numeric' as const, onChange: (e: { target: { value: string } }) => set(k, Number(e.target.value.replace(/\D/g, '')) || 0),
  });
  const changed = useMemo(() => JSON.stringify(f) !== JSON.stringify(data.settings), [f, data.settings]);
  const save = () => run('save', async () => { await adminApi('/shipping/settings', { method: 'PUT', body: f }); onSaved(); }, 'Shipping settings saved');
  const check = () => run('test', async () => setTest(await adminApi<{ ok: boolean; message: string }>('/shipping/test', { method: 'POST' })));
  return (
    <div className="ad-grid-2 ad-grid-2--wide">
      <Card title="Delhivery" actions={<Btn kind="primary" busy={busy === 'save'} disabled={!changed} onClick={save}>Save</Btn>}>
        <div className="ad-stack">
          <Check label="Ship printed books with Delhivery" hint="E-books never ship. Off: orders are packed and marked shipped by hand, as before." checked={f.enabled} onChange={(v) => set('enabled', v)} />
          <TextField label="Pickup location name" hint="Exactly as registered with Delhivery (Delhivery One → Settings → Pickup locations). Capitals and spaces matter." value={f.pickupLocation} onChange={(e) => set('pickupLocation', e.target.value)} />
          <TextField label="Pickup PIN code" hint="Where books are collected from: used for delivery dates and charge estimates." value={f.originPin} inputMode="numeric" maxLength={6} onChange={(e) => set('originPin', e.target.value.replace(/\D/g, ''))} />
          <SelectField label="Speed" value={f.mode} onChange={(e) => set('mode', e.target.value as 'Surface' | 'Express')}>
            <option value="Surface">Surface (cheaper, the usual choice for books)</option>
            <option value="Express">Express (by air, faster, costs more)</option>
          </SelectField>
          <Check label="Book automatically" hint="As soon as an order is paid (cash on delivery: once confirmed), it’s booked with the usual parcel. Failures show under Orders → Needs attention." checked={f.autoShip} onChange={(v) => set('autoShip', v)} />
          <Check label="Check PIN codes for shoppers" hint="Shows the delivery date on book pages and at checkout, stops orders to PIN codes Delhivery can’t reach, and offers cash on delivery only where Delhivery collects cash. If Delhivery can’t be reached, orders go ahead." checked={f.checkoutCheck} onChange={(v) => set('checkoutCheck', v)} />
        </div>
      </Card>
      <div className="ad-stack">
        <Card title="The usual parcel">
          <div className="ad-row">
            <TextField label="Length (cm)" {...num('lengthCm')} />
            <TextField label="Width (cm)" {...num('breadthCm')} />
            <TextField label="Height (cm)" {...num('heightCm')} />
          </div>
          <div className="ad-row">
            <TextField label="Packing weight (g)" hint="Box, wrap and tape" {...num('packagingGrams')} />
            <TextField label="A book with no weight set (g)" {...num('defaultBookGrams')} />
          </div>
          <TextField label="HSN code" hint="4901: printed books" value={f.hsnCode} inputMode="numeric" onChange={(e) => set('hsnCode', e.target.value.replace(/\D/g, '').slice(0, 8))} />
          <p className="ad-muted ad-small">Delhivery charges the higher of the real weight and the box’s size (L × W × H ÷ 5000 kg). Set each book’s weight under Products for accurate charges.</p>
        </Card>
        <Card title="Connection" actions={<Btn busy={busy === 'test'} disabled={!data.connected} onClick={check}>Test connection</Btn>}>
          <p>{data.connected ? <>API: <b>{data.simulator ? 'simulator (no token, local development)' : data.env === 'staging' ? 'staging (test)' : 'live (production)'}</b></> : <>Not connected: add <code>DELHIVERY_API_TOKEN</code> in Vercel and redeploy.</>}</p>
          {test && <p className={test.ok ? 'ad-ok' : 'ad-err-text'}>{test.message}</p>}
          <p className="ad-muted ad-small">Live tracking: tracking refreshes every 30 minutes on its own. For instant updates, ask Delhivery (lastmile-integration@delhivery.com) to push scans to <code>{data.webhook ?? 'your webhook address (set DELHIVERY_WEBHOOK_SECRET first)'}</code>: the full address, with the secret, is in docs/DELHIVERY.md.</p>
        </Card>
      </div>
    </div>
  );
}
