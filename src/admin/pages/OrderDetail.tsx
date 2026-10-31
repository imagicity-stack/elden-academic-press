import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { inr } from '../../store/api';
import { adminApi, fmtDate, openPrintable, toPaise, useAdmin } from '../api';
import { canManage, useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, ErrorBox, FulBadge, Loading, Modal, MoneyField, Page, PayBadge, SelectField, TextArea, TextField, useAction, useToast } from '../ui';

interface Detail {
  order: {
    id: string; number: number; status: string; createdAt: string; paidAt: string | null; name: string; email: string; phone: string;
    shipName: string | null; shipLine1: string | null; shipLine2: string | null; shipCity: string | null; shipPincode: string | null; shipStateName: string; billingStateName: string;
    requiresShipping: boolean; subtotal: number; discount: number; shipping: number; tax: number; total: number; couponCode: string | null; refundedAmount: number;
    paymentStatus: string; fulfillmentStatus: string; razorpayOrderId: string | null; razorpayPaymentId: string | null; paymentMethod: string | null;
    invoiceNumber: string | null; courier: string | null; trackingNumber: string | null; trackingUrl: string | null; cancelledAt: string | null; cancelReason: string | null;
    customerNote: string; internalNote: string; needsAttention: boolean; attentionReason: string | null; customerId: string | null;
  };
  items: { id: string; title: string; formatLabel: string; sku: string | null; quantity: number; unitPrice: number; lineTotal: number; discount: number; taxAmount: number; isDigital: boolean; requiresShipping: boolean; downloadsUsed: number; productId: string | null }[];
  events: { id: number; type: string; message: string; actor: string; createdAt: string }[];
  payments: { id: string; razorpayPaymentId: string; amount: number; status: string; method: string | null; createdAt: string }[];
  refunds: { id: string; amount: number; status: string; reason: string; actor: string; createdAt: string }[];
  customer: { id: string; ordersCount: number; totalSpent: number } | null;
  customerLink: string;
}

const COURIERS = ['India Post', 'DTDC', 'Delhivery', 'Blue Dart', 'Ekart', 'Xpressbees', 'Shiprocket', 'Professional Couriers', 'Hand delivery', 'Other'];

export default function OrderDetail() {
  const { id } = useParams();
  const { me, refreshCounts } = useMe();
  const { data, error, reload } = useAdmin<Detail>(`/orders/${id}`);
  const { busy, run } = useAction();
  const toast = useToast();
  const [dialog, setDialog] = useState<'ship' | 'refund' | 'cancel' | null>(null);
  const [note, setNote] = useState<string | null>(null);

  if (error) return <Page title="Order" back={{ to: '/admin/orders', label: 'Orders' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!data) return <Page title="Order" back={{ to: '/admin/orders', label: 'Orders' }}><Loading /></Page>;
  const o = data.order;
  const paid = ['paid', 'partially_refunded'].includes(o.paymentStatus);
  const active = paid && !o.cancelledAt;
  const act = async (key: string, path: string, body: unknown, ok: string) => {
    const r = await run(key, () => adminApi(`/orders/${o.id}/${path}`, { body }), ok);
    if (r !== undefined) { reload(); refreshCounts(); setDialog(null); }
  };

  return (
    <Page
      back={{ to: '/admin/orders', label: 'Orders' }}
      title={<>Order #{o.number} <PayBadge s={o.paymentStatus} />{active && o.requiresShipping && <FulBadge s={o.fulfillmentStatus} />}{o.cancelledAt && <Badge tone="grey">Cancelled</Badge>}</>}
      subtitle={<>Placed {fmtDate(o.createdAt, true)}{o.paidAt && <> · paid {fmtDate(o.paidAt, true)}</>}{o.paymentMethod && <> by {o.paymentMethod}</>}</>}
      actions={<>
        {o.invoiceNumber && <Btn busy={busy === 'inv'} onClick={() => run('inv', () => openPrintable(`/orders/${o.id}/invoice`))}>Invoice</Btn>}
        {o.requiresShipping && paid && <Btn busy={busy === 'slip'} onClick={() => run('slip', () => openPrintable(`/orders/${o.id}/packing-slip`))}>Packing slip</Btn>}
      </>}
    >
      {o.needsAttention && (
        <div className="ad-alert ad-alert--red">
          <div><b>Needs attention.</b> {o.attentionReason}</div>
          <Btn size="sm" busy={busy === 'resolve'} onClick={() => act('resolve', 'resolve', {}, 'Marked as resolved')}>Mark resolved</Btn>
        </div>
      )}

      {active && o.requiresShipping && (
        <div className="ad-fulfil">
          <div className="ad-fulfil__steps">
            {(['unfulfilled', 'packed', 'shipped', 'delivered'] as const).map((s, i) => (
              <span key={s} className={['unfulfilled', 'packed', 'shipped', 'delivered'].indexOf(o.fulfillmentStatus) >= i ? 'is-done' : ''}>{['Paid', 'Packed', 'Shipped', 'Delivered'][i]}</span>
            ))}
          </div>
          <div className="ad-fulfil__actions">
            {o.fulfillmentStatus === 'unfulfilled' && <Btn kind="secondary" busy={busy === 'pack'} onClick={() => act('pack', 'fulfillment', { status: 'packed' }, 'Marked as packed')}>Mark packed</Btn>}
            {['unfulfilled', 'packed'].includes(o.fulfillmentStatus) && <Btn kind="primary" onClick={() => setDialog('ship')}>Mark shipped…</Btn>}
            {o.fulfillmentStatus === 'shipped' && <><Btn onClick={() => setDialog('ship')}>Edit tracking</Btn><Btn kind="primary" busy={busy === 'deliv'} onClick={() => act('deliv', 'fulfillment', { status: 'delivered', notify: false }, 'Marked as delivered')}>Mark delivered</Btn></>}
            {o.fulfillmentStatus === 'delivered' && <span className="ad-muted">Delivered — nothing left to do.</span>}
          </div>
        </div>
      )}

      <div className="ad-grid-2 ad-grid-2--wide">
        <div className="ad-stack">
          <Card title="Items" flush>
            <table className="ad-table">
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.productId ? <Link to={`/admin/products/${i.productId}`} className="ad-strong">{i.title}</Link> : <b>{i.title}</b>}
                      <div className="ad-muted">{i.formatLabel}{i.sku && ` · ${i.sku}`}{i.isDigital && ` · ${i.downloadsUsed} download${i.downloadsUsed === 1 ? '' : 's'}`}</div>
                    </td>
                    <td className="ad-num ad-muted">{inr(i.unitPrice)} × {i.quantity}</td>
                    <td className="ad-num ad-strong">{inr(i.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="ad-sums">
              <div><dt>Subtotal</dt><dd>{inr(o.subtotal)}</dd></div>
              {o.discount > 0 && <div><dt>Discount {o.couponCode && <Badge>{o.couponCode}</Badge>}</dt><dd>−{inr(o.discount)}</dd></div>}
              {o.requiresShipping && <div><dt>Shipping</dt><dd>{o.shipping ? inr(o.shipping) : 'Free'}</dd></div>}
              <div className="ad-sums__total"><dt>Total</dt><dd>{inr(o.total)}</dd></div>
              {o.tax > 0 && <div className="ad-muted"><dt>GST included</dt><dd>{inr(o.tax)}</dd></div>}
              {o.refundedAmount > 0 && <div><dt>Refunded</dt><dd>−{inr(o.refundedAmount)}</dd></div>}
              {o.refundedAmount > 0 && <div className="ad-sums__total"><dt>Net</dt><dd>{inr(o.total - o.refundedAmount)}</dd></div>}
            </dl>
          </Card>

          <Card title="Payment" actions={
            <div className="ad-row">
              {paid && canManage(me) && <Btn size="sm" kind="danger" onClick={() => setDialog('refund')}>Refund…</Btn>}
              {['pending', 'failed'].includes(o.paymentStatus) && !o.cancelledAt && <Btn size="sm" kind="danger" onClick={() => setDialog('cancel')}>Cancel order</Btn>}
            </div>
          }>
            <dl className="ad-kv">
              <div><dt>Status</dt><dd><PayBadge s={o.paymentStatus} /></dd></div>
              {o.razorpayPaymentId && <div><dt>Razorpay payment</dt><dd><code>{o.razorpayPaymentId}</code></dd></div>}
              {o.razorpayOrderId && <div><dt>Razorpay order</dt><dd><code>{o.razorpayOrderId}</code></dd></div>}
              {o.invoiceNumber && <div><dt>Invoice</dt><dd>{o.invoiceNumber}</dd></div>}
              {o.cancelReason && <div><dt>Cancelled</dt><dd>{o.cancelReason}</dd></div>}
            </dl>
            {data.refunds.length > 0 && (
              <ul className="ad-list ad-list--plain">
                {data.refunds.map((r) => <li key={r.id}><span>Refund {inr(r.amount)}{r.reason && ` — ${r.reason}`}</span><Badge tone={r.status === 'processed' ? 'green' : r.status === 'failed' ? 'red' : 'amber'}>{r.status}</Badge></li>)}
              </ul>
            )}
          </Card>

          <Card title="History">
            <ol className="ad-timeline">
              {[...data.events].reverse().map((e) => (
                <li key={e.id}><b>{e.message}</b><span>{fmtDate(e.createdAt, true)} · {e.actor}</span></li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="ad-stack">
          <Card title="Customer">
            <div className="ad-strong">{o.name}</div>
            <div><a href={`mailto:${o.email}`}>{o.email}</a></div>
            <div><a href={`tel:+91${o.phone}`}>+91 {o.phone}</a></div>
            {data.customer && <div className="ad-muted ad-mt"><Link to={`/admin/customers/${data.customer.id}`}>{data.customer.ordersCount} order{data.customer.ordersCount === 1 ? '' : 's'} · {inr(data.customer.totalSpent)} spent →</Link></div>}
            <div className="ad-row ad-mt">
              <Btn size="sm" onClick={() => { navigator.clipboard.writeText(data.customerLink); toast('Customer’s order link copied'); }}>Copy order link</Btn>
              {paid && <Btn size="sm" busy={busy === 'resend'} onClick={() => act('resend', 'resend', {}, 'Confirmation email sent')}>Resend email</Btn>}
            </div>
          </Card>
          {o.requiresShipping ? (
            <Card title="Shipping address">
              <p className="ad-address">{o.shipName}<br />{o.shipLine1}{o.shipLine2 && <><br />{o.shipLine2}</>}<br />{o.shipCity}, {o.shipStateName} – {o.shipPincode}</p>
              {o.trackingNumber && <p className="ad-mt"><b>{o.courier}</b> · {o.trackingNumber}{o.trackingUrl && <> · <a href={o.trackingUrl} target="_blank" rel="noopener noreferrer">track ↗</a></>}</p>}
            </Card>
          ) : (
            <Card title="Billing address">
              {o.shipLine1
                ? <p className="ad-address">{o.shipName}<br />{o.shipLine1}{o.shipLine2 && <><br />{o.shipLine2}</>}<br />{o.shipCity}, {o.shipStateName} – {o.shipPincode}</p>
                : <p className="ad-muted">Place of supply: {o.billingStateName}.</p>}
              <p className="ad-muted ad-mt">E-books only, delivered by download.</p>
            </Card>
          )}
          {o.customerNote && <Card title="Customer note"><p className="ad-pre">{o.customerNote}</p></Card>}
          <Card title="Internal note">
            <TextArea label="Only staff can see this" rows={3} value={note ?? o.internalNote} onChange={(e) => setNote(e.target.value)} />
            {note !== null && note !== o.internalNote && <Btn size="sm" kind="primary" busy={busy === 'note'} onClick={() => act('note', 'note', { internalNote: note }, 'Note saved').then(() => setNote(null))}>Save note</Btn>}
          </Card>
        </div>
      </div>

      {dialog === 'ship' && <ShipDialog o={o} busy={busy === 'ship'} onClose={() => setDialog(null)} onSave={(b) => act('ship', 'fulfillment', b, 'Marked as shipped')} />}
      {dialog === 'refund' && <RefundDialog o={o} busy={busy === 'refund'} onClose={() => setDialog(null)} onSave={(b) => act('refund', 'refund', b, 'Refund started')} />}
      {dialog === 'cancel' && (
        <CancelDialog busy={busy === 'cancel'} onClose={() => setDialog(null)} onSave={(reason) => act('cancel', 'cancel', { reason }, 'Order cancelled')} />
      )}
    </Page>
  );
}

function ShipDialog({ o, busy, onClose, onSave }: { o: Detail['order']; busy: boolean; onClose: () => void; onSave: (b: unknown) => void }) {
  const [courier, setCourier] = useState(o.courier ?? 'India Post');
  const [num, setNum] = useState(o.trackingNumber ?? '');
  const [url, setUrl] = useState(o.trackingUrl ?? '');
  const [notify, setNotify] = useState(o.fulfillmentStatus !== 'shipped');
  return (
    <Modal title="Mark as shipped" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" busy={busy} disabled={!num.trim()} onClick={() => onSave({ status: 'shipped', courier, trackingNumber: num.trim(), trackingUrl: url.trim(), notify })}>Save</Btn></>}>
      <div className="ad-form">
        <SelectField label="Courier" value={courier} onChange={(e) => setCourier(e.target.value)}>{COURIERS.map((c) => <option key={c}>{c}</option>)}</SelectField>
        <TextField label="Tracking number" value={num} onChange={(e) => setNum(e.target.value)} autoFocus />
        <TextField label="Tracking link (optional)" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Check label="Email the customer" hint="Sends the courier and tracking number." checked={notify} onChange={setNotify} />
      </div>
    </Modal>
  );
}

function RefundDialog({ o, busy, onClose, onSave }: { o: Detail['order']; busy: boolean; onClose: () => void; onSave: (b: unknown) => void }) {
  const max = o.total - o.refundedAmount;
  const [amount, setAmount] = useState(String(max / 100));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(o.requiresShipping && ['unfulfilled', 'packed'].includes(o.fulfillmentStatus));
  const [cancel, setCancel] = useState(true);
  const [notify, setNotify] = useState(true);
  const paise = toPaise(amount);
  const valid = paise > 0 && paise <= max;
  return (
    <Modal title="Refund" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="danger" busy={busy} disabled={!valid} onClick={() => onSave({ amount: paise, reason, restock, cancel: cancel && paise === max, notify })}>Refund {valid ? inr(paise) : ''}</Btn></>}>
      <div className="ad-form">
        <p className="ad-muted">The money goes back to the customer’s original payment method through Razorpay, usually in 5–7 working days. This can’t be undone.</p>
        <MoneyField label={`Amount (up to ${inr(max)})`} value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !valid ? 'Enter an amount up to the refundable total' : undefined} />
        <TextField label="Reason" placeholder="e.g. Damaged in transit" value={reason} onChange={(e) => setReason(e.target.value)} />
        {o.requiresShipping && <Check label="Put printed copies back in stock" checked={restock} onChange={setRestock} />}
        {paise === max && <Check label="Cancel the order" hint="Use when nothing will be shipped." checked={cancel} onChange={setCancel} />}
        <Check label="Email the customer" checked={notify} onChange={setNotify} />
      </div>
    </Modal>
  );
}

function CancelDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState('Customer did not complete payment');
  return (
    <Modal title="Cancel unpaid order" onClose={onClose} footer={<><Btn onClick={onClose}>Keep order</Btn><Btn kind="danger" busy={busy} onClick={() => onSave(reason)}>Cancel order</Btn></>}>
      <div className="ad-form">
        <p className="ad-muted">Any printed copies held for this order go back into stock.</p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
