// Admin → Calls: the AI voice agents (cart recovery and order feedback). Switch them on and off,
// see every call (who, when, how it went, the transcript), the queue, saved checkouts, the
// do-not-call list, the settings and the numbers.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { adminApi, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Page, Pagination, SelectField, TextArea, TextField, Toggle, useAction, type Tone } from '../ui';
import { inr } from '../../store/api';
import { CALL_KINDS, CALL_STATUS_LABEL, COD_CONFIRMATION_LABEL, DAYS, INBOUND, OUTCOME_LABEL, type CallKind, type CallSettings, type CallStatus, type CodConfirmation } from '../../shared/calls';

const TABS = [['', 'Overview'], ['log', 'Calls'], ['queue', 'Queue'], ['leads', 'Checkouts'], ['do-not-call', 'Do not call'], ['settings', 'Settings']] as const;
const STATUS_TONE: Record<CallStatus, Tone> = { queued: 'blue', dialling: 'amber', done: 'green', no_answer: 'grey', failed: 'red', skipped: 'grey', cancelled: 'grey' };
const OUTCOME_TONE: Record<string, Tone> = { enquiry: 'blue', will_order: 'green', feedback_given: 'green', callback: 'blue', transferred: 'blue', not_interested: 'grey', declined: 'grey', wrong_person: 'grey', do_not_call: 'red', order_confirmed: 'green', cancel_requested: 'red', not_confirmed: 'amber' };

interface SettingsData {
  settings: CallSettings;
  books: { id: string; title: string }[];
  status: { connected: boolean; provider: string | null; webhook: boolean; inHours: boolean; nextWindow: string; blockers: string[]; overdue: { count: number; oldest: string | null } };
}
interface Row {
  id: string; kind: CallKind; status: CallStatus; phone: string; name: string; outcome: string; dueAt: string; attempts: number;
  startedAt: string | null; endedAt: string | null; durationSeconds: number | null; note: string; issueOpen: boolean; createdBy: string | null; createdAt: string; rating: string | null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const secs = (n: number | null) => (n == null ? '—' : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`);
const kindLabel = (k: CallKind) => CALL_KINDS.find((x) => x.key === k)?.label ?? k;
const Outcome = ({ o }: { o: string }) => (o ? <Badge tone={OUTCOME_TONE[o] ?? 'grey'}>{OUTCOME_LABEL[o] ?? o}</Badge> : <span className="ad-muted">—</span>);
const Status = ({ s }: { s: CallStatus }) => <Badge tone={STATUS_TONE[s]}>{CALL_STATUS_LABEL[s]}</Badge>;

export default function CallsAdmin() {
  const { tab = '' } = useParams();
  if (/^[0-9a-f-]{36}$/.test(tab)) return <CallDetail id={tab} />;
  return (
    <Page title="Calls" subtitle="AI voice agents on Sarvam: cart recovery and order feedback.">
      <nav className="ad-tabs ad-mt">
        {TABS.map(([k, l]) => <Link key={k} to={`/admin/calls${k ? `/${k}` : ''}`} className={'ad-tab' + (tab === k ? ' is-on' : '')}>{l}</Link>)}
      </nav>
      <div className="ad-mt">
        {tab === '' && <Overview />}
        {tab === 'log' && <CallList />}
        {tab === 'queue' && <CallList queue />}
        {tab === 'leads' && <Leads />}
        {tab === 'do-not-call' && <DoNotCall />}
        {tab === 'settings' && <SettingsTab />}
        {!TABS.some(([k]) => k === tab) && <Empty title="Not found." />}
      </div>
    </Page>
  );
}

/* ---------------- Overview: switches and numbers ---------------- */

function Overview() {
  const cfg = useAdmin<SettingsData>('/calls/settings');
  const [days, setDays] = useState(30);
  const stats = useAdmin<Stats>(`/calls/stats?days=${days}`);
  const { run } = useAction();
  if (cfg.error) return <ErrorBox error={cfg.error} retry={cfg.reload} />;
  if (!cfg.data) return <Loading />;
  const s = cfg.data.settings;
  const save = (patch: Partial<CallSettings>, ok: string) => run('save', () => adminApi('/calls/settings', { method: 'PUT', body: patch }), ok).then((r) => r && cfg.reload());
  const st = cfg.data.status;
  return (
    <div className="ad-stack">
      {st.blockers.length > 0 && (
        <div className="ad-alert ad-alert--red">
          <div><b>Calls can’t go out right now:</b>
            <ul style={{ margin: '6px 0', paddingLeft: 18 }}>{st.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            <span className="ad-muted">Queued calls wait and are dialled once this is fixed.</span></div>
        </div>
      )}
      {st.overdue.count > 0 && st.blockers.every((b) => b.startsWith('It’s outside')) && st.inHours && (
        <div className="ad-alert ad-alert--amber">
          <div><b>{st.overdue.count} queued call{st.overdue.count === 1 ? ' is' : 's are'} overdue</b> (the oldest was due {when(st.overdue.oldest)}). The job that dials them every 10 minutes isn’t running: in Vercel → the project → Settings → Cron Jobs, check that <code>/api/cron/calls</code> runs, and that CRON_SECRET is set (then redeploy). “Call now” still works meanwhile.</div>
        </div>
      )}
      {!st.connected && (
        <div className="ad-warn">
          <b>Outgoing calls aren't connected yet.</b> Customers who ring our numbers already reach the agents{st.webhook ? ' and show up here' : ''}. Checkouts are being saved and our calls queued, but the website can't place them until the Sarvam calling connection is added (Settings tab has the details).
        </div>
      )}
      <Card title="On and off">
        <div className="ad-stack-sm">
          <div className="ad-row"><Toggle checked={s.enabled} label="All calls" onChange={(v) => save({ enabled: v }, v ? 'Calls switched on' : 'All calls paused')} />
            <strong>{s.enabled ? 'Calls are on' : 'All calls are paused'}</strong>
            <span className="ad-muted">{s.enabled ? (st.inHours ? 'Inside calling hours now.' : `Next calling window: ${when(st.nextWindow)}.`) : 'Nothing is dialled while paused.'}</span>
          </div>
          {CALL_KINDS.map((k) => (
            <div key={k.key} className="ad-row">
              <Toggle checked={s[k.key].enabled} label={k.label} onChange={(v) => save({ [k.key]: { ...s[k.key], enabled: v } } as Partial<CallSettings>, `${k.label} ${v ? 'on' : 'off'}`)} />
              <strong>{k.label}</strong><span className="ad-muted">{k.help}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="ad-row">
        <SelectField label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </SelectField>
      </div>
      {stats.error ? <ErrorBox error={stats.error} retry={stats.reload} /> : !stats.data ? <Loading /> : <StatsView d={stats.data} />}
    </div>
  );
}

interface KindStats { incoming: number; total: number; queued: number; dialling: number; attempted: number; answered: number; answerRate: number; outcomes: Record<string, number> }
interface Stats {
  cart: KindStats; cod: KindStats; feedback: KindStats; codOrders: Record<string, number>; recovered: { orders: number; revenue: number }; couponsGiven: number;
  rating: { average: number | null; count: number }; openIssues: number; leads: { total: number; paid: number };
  daily: { day: string; placed: number; answered: number }[];
  subscribersCallable: number;
}
const pct = (x: number) => `${Math.round(x * 100)}%`;
const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) => (
  <div className="ad-stat"><span>{label}</span><b>{value}</b>{sub && <small className="ad-muted">{sub}</small>}</div>
);

function StatsView({ d }: { d: Stats }) {
  return (
    <div className="ad-stack">
      <div className="ad-stats">
        <Stat label="Checkouts saved (with consent)" value={d.leads.total} sub={`${d.leads.paid} went on to pay`} />
        <Stat label="Cart calls answered" value={`${d.cart.answered} / ${d.cart.attempted}`} sub={`${pct(d.cart.answerRate)} answer rate`} />
        <Stat label="Recovered by a call" value={inr(d.recovered.revenue)} sub={`${d.recovered.orders} order${d.recovered.orders === 1 ? '' : 's'} paid after the call`} />
        <Stat label="Coupons given on calls" value={d.couponsGiven} />
        <Stat label="COD orders confirmed" value={`${d.codOrders.confirmed ?? 0} / ${Object.values(d.codOrders).reduce((n, x) => n + x, 0)}`}
          sub={`${d.codOrders.cancel_requested ?? 0} said no · ${(d.codOrders.unreachable ?? 0) + (d.codOrders.unclear ?? 0)} not confirmed · ${d.codOrders.pending ?? 0} waiting`} />
        <Stat label="Feedback calls answered" value={`${d.feedback.answered} / ${d.feedback.attempted}`} sub={`${pct(d.feedback.answerRate)} answer rate`} />
        <Stat label="Average rating" value={d.rating.average == null ? '—' : `${d.rating.average.toFixed(1)} / 5`} sub={`${d.rating.count} rating${d.rating.count === 1 ? '' : 's'}`} />
        <Stat label="Problems to look at" value={<Link to="/admin/calls/log?issues=1">{d.openIssues}</Link>} sub="reported on feedback calls" />
        <Stat label="Subscribers who allow calls" value={d.subscribersCallable} sub="ticked the box on the newsletter form" />
        <Stat label="Incoming calls" value={d.cart.incoming + d.cod.incoming + d.feedback.incoming} sub="customers who rang our numbers" />
        <Stat label="Waiting to be called" value={<Link to="/admin/calls/queue">{d.cart.queued + d.cod.queued + d.feedback.queued}</Link>} />
      </div>
      <div className="ad-grid-2">
        <Card title="Calls per day">{d.daily.length ? <DailyChart rows={d.daily} /> : <p className="ad-muted">No calls yet.</p>}</Card>
        <Card title="How calls ended">
          {([['cart', 'cart'], ['cod', 'cod_confirm'], ['feedback', 'feedback']] as const).map(([k, kind]) => (
            <div key={k} className="ad-stack-sm ad-mt">
              <strong>{kindLabel(kind)}</strong>
              {Object.keys(d[k].outcomes).length ? (
                <ul className="ad-list">{Object.entries(d[k].outcomes).sort((a, b) => b[1] - a[1]).map(([o, n]) => (
                  <li key={o}><Link to={`/admin/calls/log?kind=${kind}&outcome=${o}`}><Outcome o={o} /></Link> <b>{n}</b></li>
                ))}</ul>
              ) : <span className="ad-muted">No answered calls yet.</span>}
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function DailyChart({ rows }: { rows: Stats['daily'] }) {
  const max = Math.max(1, ...rows.map((r) => r.placed));
  const W = 600, H = 120, bw = Math.max(4, Math.floor(W / rows.length) - 3);
  return (
    <div className="ad-chart">
      <svg viewBox={`0 0 ${W} ${H + 20}`} role="img" aria-label="Calls placed and answered per day">
        {rows.map((r, i) => {
          const x = i * (W / rows.length);
          const hp = (r.placed / max) * (H - 6), ha = (r.answered / max) * (H - 6);
          return (
            <g key={r.day}>
              <title>{`${r.day}: ${r.placed} placed, ${r.answered} answered`}</title>
              <rect x={x} y={H - hp} width={bw} height={hp} rx="2" className="ad-chart__bar" opacity={0.35} />
              <rect x={x} y={H - ha} width={bw} height={ha} rx="2" className="ad-chart__bar" />
            </g>
          );
        })}
        <line x1="0" x2={W} y1={H} y2={H} className="ad-chart__axis" />
      </svg>
      <p className="ad-muted">Light: placed · dark: answered</p>
    </div>
  );
}

/* ---------------- Calls and queue ---------------- */

function CallList({ queue = false }: { queue?: boolean }) {
  const [sp, setSp] = useSearchParams();
  const page = Number(sp.get('page')) || 1;
  const q = new URLSearchParams(sp);
  if (queue) q.set('status', 'queued');
  const { data, error, reload } = useAdmin<{ items: Row[]; total: number }>(`/calls?${q}`);
  const { busy, run } = useAction();
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('page'); setSp(n); };
  const act = (id: string, action: 'call-now' | 'skip') => run(id, () => adminApi(`/calls/${id}/${action}`, { method: 'POST' }), action === 'skip' ? 'Skipped' : 'Dialling now').then((r) => r && reload());
  return (
    <Card flush>
      <div className="ad-toolbar ad-pad">
        <input type="search" placeholder="Name or phone" defaultValue={sp.get('q') ?? ''} onKeyDown={(e) => { if (e.key === 'Enter') set('q', (e.target as HTMLInputElement).value); }} aria-label="Search" />
        <select value={sp.get('kind') ?? ''} onChange={(e) => set('kind', e.target.value)} aria-label="Agent">
          <option value="">Both agents</option>{CALL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        {!queue && (
          <select value={sp.get('outcome') ?? ''} onChange={(e) => set('outcome', e.target.value)} aria-label="Outcome">
            <option value="">Any outcome</option>{Object.entries(OUTCOME_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        {!queue && <label className="ad-inline"><input type="checkbox" checked={sp.get('issues') === '1'} onChange={(e) => set('issues', e.target.checked ? '1' : '')} /> Problems only</label>}
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : !data.items.length ? <Empty title={queue ? 'Nobody is waiting to be called.' : 'No calls yet.'} /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>{queue ? 'Due' : 'When'}</th><th>Customer</th><th>Agent</th><th>Status</th><th>Outcome</th><th>Length</th><th>Tries</th><th /></tr></thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td>{when(queue ? r.dueAt : r.endedAt ?? r.startedAt ?? r.createdAt)}</td>
                  <td><Link to={`/admin/calls/${r.id}`} className="ad-strong">{r.name || 'Unknown'}</Link><br /><span className="ad-muted">{r.phone}</span></td>
                  <td>{kindLabel(r.kind)}{r.createdBy === INBOUND && <><br /><Badge tone="blue">Incoming</Badge></>}</td>
                  <td><Status s={r.status} />{r.issueOpen && <> <Badge tone="red">Problem</Badge></>}{r.note && <><br /><small className="ad-muted">{r.note}</small></>}</td>
                  <td><Outcome o={r.outcome} />{r.rating && <> <small>{r.rating}★</small></>}</td>
                  <td className="ad-num">{secs(r.durationSeconds)}</td>
                  <td className="ad-num">{r.attempts}</td>
                  <td>
                    {r.status === 'queued' && <Btn size="sm" busy={busy === r.id} onClick={() => act(r.id, 'skip')}>Skip</Btn>}
                    {['queued', 'no_answer', 'failed', 'skipped'].includes(r.status) && <Btn size="sm" busy={busy === r.id} onClick={() => act(r.id, 'call-now')}>Call now</Btn>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} total={data.total} limit={50} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} />
        </div>
      )}
    </Card>
  );
}

interface Detail {
  call: Row & { variables: Record<string, string>; result: Record<string, unknown>; transcript: string; recordingUrl: string; providerCallId: string | null };
  lead: { email: string; items: { title: string; kind: string; quantity: number }[]; total: number; orderId: string | null; createdAt: string } | null;
  order: { id: string; number: number; total: number; codAmount: number; paymentMode: string; codConfirmation: CodConfirmation; cancelledAt: string | null } | null;
  history: Row[];
  doNotCall: boolean;
}
const RESULT_LABEL: Record<string, string> = {
  call_outcome: 'Outcome', wants_link: 'Wants the link', discount_offered: 'Coupon given', callback_time: 'Call back', objection: 'Why they hadn’t ordered',
  rating: 'Rating', feedback_summary: 'Feedback', issue_reported: 'Problem reported', issue_detail: 'The problem', interested_in: 'Interested in', wants_details: 'Wants details of new books',
  order_confirmation: 'Order confirmation', cancel_reason: 'Why they said no', change_request: 'Change asked for', advance_refund_told: 'Told the advance isn’t refunded',
};
const CONFIRMATION_LABEL: Record<string, string> = { confirmed: 'Confirmed', cancel_requested: 'Wants to cancel', unclear: 'No clear answer' };

function CallDetail({ id }: { id: string }) {
  const { data, error, reload } = useAdmin<Detail>(`/calls/${id}`);
  const { busy, run } = useAction();
  const navigate = useNavigate();
  if (error) return <Page title="Call" back={{ to: '/admin/calls/log', label: 'Calls' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!data) return <Loading />;
  const c = data.call;
  const act = (action: string, ok: string) => run(action, () => adminApi(`/calls/${id}/${action}`, { method: 'POST' }), ok).then((r) => r && reload());
  return (
    <Page title={c.name || c.phone} subtitle={<>{kindLabel(c.kind)}{c.createdBy === INBOUND && ' · Incoming call'} · {c.phone}{data.doNotCall && <> · <Badge tone="red">Do not call</Badge></>}</>} back={{ to: '/admin/calls/log', label: 'Calls' }}
      actions={<>
        <Link className="ad-btn ad-btn--ghost" to={`/admin/whatsapp?phone=${encodeURIComponent(c.phone)}`}>WhatsApp chat</Link>
        {c.issueOpen && <Btn kind="primary" busy={busy === 'resolve'} onClick={() => act('resolve', 'Marked as handled')}>Problem handled</Btn>}
        {['queued', 'no_answer', 'failed', 'skipped'].includes(c.status) && <Btn busy={busy === 'call-now'} onClick={() => act('call-now', 'Dialling now')}>Call now</Btn>}
        {c.status === 'queued' && <Btn busy={busy === 'skip'} onClick={() => act('skip', 'Skipped')}>Skip</Btn>}
      </>}>
      <div className="ad-grid-2 ad-grid-2--wide">
        <div className="ad-stack">
          <Card title="The call">
            <dl className="ad-dl">
              <dt>Status</dt><dd><Status s={c.status} /> {c.note && <span className="ad-muted">{c.note}</span>}</dd>
              <dt>Outcome</dt><dd><Outcome o={c.outcome} /></dd>
              <dt>{c.status === 'queued' ? 'Due' : 'Started'}</dt><dd>{when(c.status === 'queued' ? c.dueAt : c.startedAt)}</dd>
              <dt>Length</dt><dd>{secs(c.durationSeconds)}</dd>
              <dt>Tries</dt><dd>{c.attempts}</dd>
              {c.recordingUrl && <><dt>Recording</dt><dd><a href={c.recordingUrl} target="_blank" rel="noreferrer">Listen ↗</a></dd></>}
            </dl>
          </Card>
          <Card title="What the agent recorded">
            {Object.keys(c.result).length ? (
              <dl className="ad-dl">{Object.entries(c.result).filter(([, v]) => v !== '' && v != null).map(([k, v]) => (
                <div key={k}><dt>{RESULT_LABEL[k] ?? k}</dt><dd>{k === 'call_outcome' ? <Outcome o={String(v)} /> : k === 'order_confirmation' ? <b>{CONFIRMATION_LABEL[String(v)] ?? String(v)}</b> : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)}</dd></div>
              ))}</dl>
            ) : <p className="ad-muted">Nothing yet: it's filled in when the call ends.</p>}
          </Card>
          <Card title="Transcript">{c.transcript ? <pre className="ad-transcript">{c.transcript}</pre> : <p className="ad-muted">No transcript yet.</p>}</Card>
        </div>
        <div className="ad-stack">
          <Card title="What the agent was told">
            <dl className="ad-dl">{Object.entries(c.variables).map(([k, v]) => <div key={k}><dt>{k.replace(/_/g, ' ')}</dt><dd>{v || <span className="ad-muted">—</span>}</dd></div>)}</dl>
          </Card>
          {data.order && (
            <Card title="Their order">
              <p><Link to={`/admin/orders/${data.order.id}`}><b>Order #{data.order.number}</b> →</Link> · {inr(data.order.total)}{data.order.paymentMode === 'cod' && <> · {inr(data.order.codAmount)} cash on delivery</>}</p>
              {data.order.cancelledAt ? <Badge tone="grey">Cancelled</Badge>
                : data.order.codConfirmation && <Badge tone={data.order.codConfirmation === 'confirmed' ? 'green' : data.order.codConfirmation === 'pending' ? 'amber' : 'red'}>{COD_CONFIRMATION_LABEL[data.order.codConfirmation]}</Badge>}
            </Card>
          )}
          {data.lead && (
            <Card title="Their checkout">
              <ul className="ad-list">{data.lead.items.map((i, n) => <li key={n}>{i.title} · {i.kind === 'digital' ? 'E-book' : 'Print'} × {i.quantity}</li>)}</ul>
              <p>{inr(data.lead.total)} · {data.lead.email || 'no email'} · {data.lead.orderId ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Not paid</Badge>}</p>
            </Card>
          )}
          {data.history.length > 0 && (
            <Card title="Other calls to this number">
              <ul className="ad-list">{data.history.map((h) => <li key={h.id}><Link to={`/admin/calls/${h.id}`}>{when(h.createdAt)}</Link> · {kindLabel(h.kind)} · <Status s={h.status} /> <Outcome o={h.outcome} /></li>)}</ul>
            </Card>
          )}
          <Btn kind="ghost" onClick={() => navigate('/admin/calls/log')}>← All calls</Btn>
        </div>
      </div>
    </Page>
  );
}

/* ---------------- Checkouts, do-not-call ---------------- */

function Leads() {
  const { data, error, reload } = useAdmin<{ items: { id: string; name: string; phone: string; email: string; total: number; items: { title: string }[]; paid: boolean; updatedAt: string }[] }>('/calls/leads');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <Card flush title="Checkouts saved in the last 30 days" actions={<span className="ad-muted">Only people who ticked “you may call or WhatsApp me” are saved.</span>}>
      {!data.items.length ? <Empty title="No saved checkouts yet." /> : (
        <div className="ad-table-wrap"><table className="ad-table">
          <thead><tr><th>Last change</th><th>Customer</th><th>Books</th><th>Total</th><th>Paid?</th></tr></thead>
          <tbody>{data.items.map((l) => (
            <tr key={l.id}><td>{when(l.updatedAt)}</td><td><b>{l.name || '—'}</b><br /><span className="ad-muted">{l.phone} · {l.email || 'no email'}</span></td>
              <td>{l.items.map((i) => i.title).join(', ')}</td><td className="ad-num">{inr(l.total)}</td><td>{l.paid ? <Badge tone="green">Paid</Badge> : <Badge tone="amber">Not yet</Badge>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </Card>
  );
}

function DoNotCall() {
  const { data, error, reload } = useAdmin<{ items: { phone: string; reason: string; source: string; createdAt: string }[] }>('/calls/do-not-call');
  const { busy, run } = useAction();
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="ad-stack">
      <Card title="Add a number">
        <div className="ad-row">
          <TextField label="Mobile number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />
          <TextField label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Btn kind="primary" busy={busy === 'add'} onClick={() => run('add', () => adminApi('/calls/do-not-call', { body: { phone, reason } }), 'Added').then((r) => { if (r) { setPhone(''); setReason(''); reload(); } })}>Add</Btn>
        </div>
      </Card>
      <Card flush title={`Never called (${data.items.length})`}>
        {!data.items.length ? <Empty title="Nobody is on the list." /> : (
          <div className="ad-table-wrap"><table className="ad-table">
            <thead><tr><th>Number</th><th>Why</th><th>Added</th><th /></tr></thead>
            <tbody>{data.items.map((d) => (
              <tr key={d.phone}><td className="ad-strong">{d.phone}</td><td>{d.source === 'customer' ? 'Asked on a call' : d.reason || 'Added by the team'}</td><td>{when(d.createdAt)}</td>
                <td><Btn size="sm" busy={busy === d.phone} onClick={() => { if (window.confirm(`Allow calls to ${d.phone} again?`)) run(d.phone, () => adminApi(`/calls/do-not-call/${encodeURIComponent(d.phone)}`, { method: 'DELETE' }), 'Removed').then((r) => r && reload()); }}>Remove</Btn></td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Settings ---------------- */

function SettingsTab() {
  const { data, error, reload } = useAdmin<SettingsData>('/calls/settings');
  const { busy, run } = useAction();
  const [s, setS] = useState<CallSettings | null>(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !s) return <Loading />;
  const st = data.status;
  const save = () => run('save', () => adminApi('/calls/settings', { method: 'PUT', body: s }), 'Settings saved').then((r) => r && reload());
  const toggleDay = (d: (typeof DAYS)[number]) => setS({ ...s, hours: { ...s.hours, days: s.hours.days.includes(d) ? s.hours.days.filter((x) => x !== d) : DAYS.filter((x) => x === d || s.hours.days.includes(x)) } });
  const toggleBook = (id: string) => setS({ ...s, feedback: { ...s.feedback, newBookIds: s.feedback.newBookIds.includes(id) ? s.feedback.newBookIds.filter((x) => x !== id) : [...s.feedback.newBookIds, id].slice(0, 5) } });
  return (
    <div className="ad-grid-2">
      <div className="ad-stack">
        <Card title="Calling hours (India time)">
          <div className="ad-row">
            <TextField label="From" type="time" value={s.hours.start} onChange={(e) => setS({ ...s, hours: { ...s.hours, start: e.target.value } })} />
            <TextField label="Until" type="time" value={s.hours.end} onChange={(e) => setS({ ...s, hours: { ...s.hours, end: e.target.value } })} />
          </div>
          <div className="ad-row ad-mt">{DAYS.map((d) => <Check key={d} label={d} checked={s.hours.days.includes(d)} onChange={() => toggleDay(d)} />)}</div>
        </Card>
        <Card title="Cart recovery">
          <TextField label="Call after (minutes)" type="number" min={15} max={4320} value={s.cart.delayMinutes} onChange={(e) => setS({ ...s, cart: { ...s.cart, delayMinutes: Number(e.target.value) } })}
            hint="How long after someone leaves checkout. Calls only go out inside the calling hours." />
          <TextField label="Coupon the agent may offer" value={s.cart.discountCode} onChange={(e) => setS({ ...s, cart: { ...s.cart, discountCode: e.target.value.toUpperCase() } })}
            hint="Create it in Discounts first. Offered only after the customer hesitates twice. Leave empty for no coupon." />
          <TextField label="What the coupon gives (as the agent says it)" value={s.cart.discountOffer} onChange={(e) => setS({ ...s, cart: { ...s.cart, discountOffer: e.target.value } })} placeholder="10 percent off the whole order" />
        </Card>
        <Card title="COD order confirmation">
          <TextField label="Call after (minutes)" type="number" min={0} max={1440} value={s.cod_confirm.delayMinutes} onChange={(e) => setS({ ...s, cod_confirm: { ...s.cod_confirm, delayMinutes: Number(e.target.value) } })}
            hint="How long after a cash-on-delivery order is placed. Calls only go out inside the calling hours." />
          <p className="ad-muted">The cart agent asks whether they want the order. Yes confirms it. No flags the order and emails you to cancel it by hand (the advance isn’t refunded). No answer after every try, or no clear answer, flags it and emails you too. You can confirm an order yourself at any time from the order page, which stops the call.</p>
        </Card>
        <Card title="Order feedback">
          <TextField label="Call after (days)" type="number" min={1} max={30} value={s.feedback.daysAfter} onChange={(e) => setS({ ...s, feedback: { ...s.feedback, daysAfter: Number(e.target.value) } })}
            hint="Days after payment. Printed books wait until they've shipped." />
          <div className="ad-mt">
            <Check label="Also call earlier buyers" checked={s.feedback.allBuyers} onChange={(v) => setS({ ...s, feedback: { ...s.feedback, allBuyers: v } })}
              hint="Buyers who never saw the call box (orders before it existed). Anyone who unticked it is never called. One feedback call a month per number." />
          </div>
          {s.feedback.allBuyers && (
            <TextField label="Orders paid in the last (days)" type="number" min={7} max={90} value={s.feedback.lookbackDays}
              onChange={(e) => setS({ ...s, feedback: { ...s.feedback, lookbackDays: Number(e.target.value) } })} />
          )}
          <div className="ad-field ad-mt"><span className="ad-label">New titles the agent may mention (up to 5)</span>
            <div className="ad-stack-sm">{data.books.map((b) => <Check key={b.id} label={b.title} checked={s.feedback.newBookIds.includes(b.id)} onChange={() => toggleBook(b.id)} />)}</div>
          </div>
        </Card>
        <Card title="When nobody answers">
          <div className="ad-row">
            <TextField label="Tries again" type="number" min={0} max={5} value={s.maxRetries} onChange={(e) => setS({ ...s, maxRetries: Number(e.target.value) })} />
            <TextField label="After (minutes)" type="number" min={30} max={1440} value={s.retryAfterMinutes} onChange={(e) => setS({ ...s, retryAfterMinutes: Number(e.target.value) })} />
          </div>
        </Card>
        <div><Btn kind="primary" busy={busy === 'save'} onClick={save}>Save settings</Btn></div>
      </div>
      <Card title="Connection">
        <dl className="ad-dl">
          <dt>Incoming calls</dt><dd><Badge tone="green">Answered by the agents on Sarvam</Badge></dd>
          <dt>Outgoing calls</dt><dd>{st.connected ? <Badge tone="green">Connected ({st.provider})</Badge> : <Badge tone="amber">Not connected yet</Badge>}</dd>
          <dt>Call results</dt><dd>{st.webhook ? <Badge tone="green">Webhook ready</Badge> : <Badge tone="amber">CALLS_WEBHOOK_SECRET not set</Badge>}</dd>
        </dl>
        <TextArea label="Call-end webhook address (for Sarvam)" readOnly rows={2}
          value={st.webhook ? `${location.origin}/api/calls/webhook/<CALLS_WEBHOOK_SECRET>` : 'Set CALLS_WEBHOOK_SECRET in Vercel first.'}
          hint="Replace <CALLS_WEBHOOK_SECRET> with the value you set in Vercel. Sarvam posts each call's result here." />
        <ConnectionTest />
        <p className="ad-muted">The agents on Sarvam: “Elden Academic Press – Cart Recovery” and “Elden Academic Press – Order Feedback”, calling from +91 79658 60108 and +91 79658 60105 and transferring to +91 73700 02080.</p>
      </Card>
    </div>
  );
}

interface ConnTest {
  connected: boolean;
  key: { length: number; start: string; end: string } | null;
  ids: { org: string; workspace: string; cart: string; feedback: string };
  campaigns: { kind: string; campaignId: string; ok: boolean; status?: string; agentVersion?: number | null; endsAt?: string; error?: string }[];
}

/** Asks Sarvam, with the live site's own key, whether it's accepted and each campaign is there and running. Calls nobody. */
function ConnectionTest() {
  const { busy, run } = useAction();
  const [r, setR] = useState<ConnTest | null>(null);
  return (
    <div className="ad-mt">
      <Btn busy={busy === 'conn'} onClick={() => run('conn', () => adminApi<ConnTest>('/calls/connection-test')).then((x) => x && setR(x))}>Test Sarvam connection</Btn>
      <span className="ad-muted"> Checks the key and both campaigns with Sarvam. Nobody is called.</span>
      {r && (
        <dl className="ad-dl ad-mt">
          <dt>API key in use</dt>
          <dd>{r.key ? <><code>{r.key.start}…{r.key.end}</code> ({r.key.length} characters). Compare with the key in apps.sarvam.ai → Settings → API Key.</> : <Badge tone="red">SARVAM_API_KEY not set</Badge>}</dd>
          <dt>Org / workspace</dt><dd><code>{r.ids.org || '(not set)'}</code> / <code>{r.ids.workspace || '(not set)'}</code></dd>
          {!r.connected && <><dt>Result</dt><dd><Badge tone="red">Not connected</Badge> one of the five SARVAM_ settings is missing in Vercel.</dd></>}
          {r.campaigns.map((c) => (
            <div key={c.kind}>
              <dt>{c.kind === 'cart' ? 'Cart campaign' : 'Feedback campaign'}</dt>
              <dd><code>{c.campaignId}</code>{' '}
                {c.ok ? <Badge tone="green">OK: {c.status}{c.agentVersion != null ? `, agent version ${c.agentVersion}` : ''}</Badge>
                  : c.error ? <><Badge tone="red">Refused</Badge> <span className="ad-neg">{c.error}</span>
                    {/Sarvam 40[13]/.test(c.error) && <div className="ad-muted">Sarvam doesn’t accept this key for this org and workspace. If the key above isn’t the one in apps.sarvam.ai, the new key hasn’t reached the live site: save it for Production and redeploy. If it is the same key, it belongs to another workspace.</div>}
                    {/Sarvam 404/.test(c.error) && <div className="ad-muted">The key works, but Sarvam can’t find this campaign in this org and workspace: check the ids.</div>}</>
                    : <Badge tone="amber">{c.status}: resume it in Sarvam</Badge>}
                {c.endsAt && <span className="ad-muted"> · ends {new Date(c.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
