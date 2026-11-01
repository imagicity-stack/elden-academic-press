import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { adminApi, ApiError, downloadFile, fmtDate, useAdmin } from '../api';
import { canManage, useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Modal, Page, Pagination, SelectField, TextArea, TextField, useAction, type Tone } from '../ui';

interface Summary { subscribed: number; pending: number; unsubscribed: number; accounts: number; sentToday: number; dailyLimit: number }
type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled';
interface Campaign {
  id: string; subject: string; preheader: string; heading: string; body: string; ctaLabel: string; ctaUrl: string; productIds: string[];
  status: CampaignStatus; scheduledAt: string | null; startedAt: string | null; sentAt: string | null;
  recipients: number; sentCount: number; failedCount: number; createdBy: string; createdAt: string; updatedAt: string;
}
type SubStatus = 'pending' | 'subscribed' | 'unsubscribed';
interface Subscriber { id: string; email: string; name: string; phone: string; status: SubStatus; source: string; consentAt: string | null; unsubscribedAt: string | null; createdAt: string }
interface Account { userId: string; email: string; name: string; phone: string; createdAt: string; lastSeenAt: string; newsletter: SubStatus | null }

const CAMPAIGN_BADGE: Record<CampaignStatus, [string, Tone]> = {
  draft: ['Draft', 'grey'], scheduled: ['Scheduled', 'blue'], sending: ['Sending', 'amber'], sent: ['Sent', 'green'], cancelled: ['Stopped', 'red'],
};
const SUB_BADGE: Record<SubStatus, [string, Tone]> = { subscribed: ['Subscribed', 'green'], pending: ['Not confirmed', 'amber'], unsubscribed: ['Unsubscribed', 'grey'] };
const SOURCE: Record<string, string> = {
  footer: 'Website footer', 'newsletter-page': 'Newsletter page', home: 'Home page', account: 'Account page', checkout: 'Checkout', admin: 'Added by staff', import: 'Imported',
};
const n = (x: number) => x.toLocaleString('en-IN');

export default function Newsletter() {
  const { tab = 'campaigns', id } = useParams();
  if (id) return <CampaignEditor id={id} />;
  return <NewsletterHome tab={tab} />;
}

function NewsletterHome({ tab }: { tab: string }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const summary = useAdmin<Summary>('/newsletter/summary');
  const s = summary.data;
  const tabs = [['campaigns', 'Campaigns'], ['subscribers', 'Subscribers'], ['accounts', 'Signed-up accounts']];
  return (
    <Page title="Newsletter" subtitle="Email subscribers about new books and offers. Only people who opted in receive campaigns."
      actions={canManage(me) && tab === 'campaigns' && <Btn kind="primary" onClick={() => navigate('/admin/newsletter/campaigns/new')}>New campaign</Btn>}>
      {summary.error ? <ErrorBox error={summary.error} retry={summary.reload} /> : (
        <div className="ad-stats">
          <Stat label="Subscribers" value={s ? n(s.subscribed) : '…'} sub="Receive campaigns" />
          <Stat label="Waiting to confirm" value={s ? n(s.pending) : '…'} sub="Haven’t clicked the email link yet" />
          <Stat label="Signed-up accounts" value={s ? n(s.accounts) : '…'} sub="Signed in with Google" />
          <Stat label="Sent in the last 24 hours" value={s ? n(s.sentToday) : '…'} sub={s ? `Limit ${n(s.dailyLimit)} a day (Settings)` : ''} />
        </div>
      )}
      <div className="ad-tabs">{tabs.map(([k, l]) => (
        <NavLink key={k} to={`/admin/newsletter${k === 'campaigns' ? '' : '/' + k}`} end className={({ isActive }) => 'ad-tab' + (isActive || (k === 'campaigns' && tab === 'campaigns') ? ' is-on' : '')}>{l}</NavLink>
      ))}</div>
      {tab === 'campaigns' && <Campaigns onChange={summary.reload} />}
      {tab === 'subscribers' && <Subscribers onChange={summary.reload} />}
      {tab === 'accounts' && <Accounts />}
    </Page>
  );
}

const Stat = ({ label, value, sub }: { label: string; value: string; sub: string }) => (
  <div className="ad-stat"><span>{label}</span><b>{value}</b><small>{sub}</small></div>
);

/* ---------------- Campaigns ---------------- */

function Campaigns({ onChange }: { onChange: () => void }) {
  const navigate = useNavigate();
  const { data, error, reload } = useAdmin<{ items: Campaign[] }>('/newsletter/campaigns');
  const sending = data?.items.some((c) => c.status === 'sending');
  // While a campaign is going out, keep the numbers fresh.
  useEffect(() => {
    if (!sending) return;
    const t = setInterval(() => { reload(); onChange(); }, 15_000);
    return () => clearInterval(t);
  }, [sending, reload, onChange]);

  return (
    <Card flush>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Empty title="No campaigns yet.">
          <p className="ad-muted">Write one with <b>New campaign</b>, or open a book in Products and choose <b>Announce by email</b>.</p>
        </Empty>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table ad-table--click">
            <thead><tr><th>Campaign</th><th>Status</th><th className="ad-num">Sent</th><th>Date</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/admin/newsletter/campaigns/${c.id}`)}>
                  <td><span className="ad-strong">{c.subject}</span>{c.heading && c.heading !== c.subject && <div className="ad-muted">{c.heading}</div>}</td>
                  <td><Badge tone={CAMPAIGN_BADGE[c.status][1]}>{CAMPAIGN_BADGE[c.status][0]}</Badge></td>
                  <td className="ad-num">{c.recipients ? `${n(c.sentCount)} / ${n(c.recipients)}` : '—'}{c.failedCount > 0 && <div className="ad-muted">{n(c.failedCount)} failed</div>}</td>
                  <td className="ad-muted">{c.status === 'scheduled' ? `Sends ${fmtDate(c.scheduledAt, true)}` : c.sentAt ? fmtDate(c.sentAt, true) : c.startedAt ? `Started ${fmtDate(c.startedAt, true)}` : `Edited ${fmtDate(c.updatedAt, true)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type Draft = Pick<Campaign, 'subject' | 'preheader' | 'heading' | 'body' | 'ctaLabel' | 'ctaUrl' | 'productIds'>;
const EMPTY: Draft = { subject: '', preheader: '', heading: '', body: '', ctaLabel: '', ctaUrl: '', productIds: [] };
const draftOf = (c: Campaign): Draft => ({ subject: c.subject, preheader: c.preheader, heading: c.heading, body: c.body, ctaLabel: c.ctaLabel, ctaUrl: c.ctaUrl, productIds: c.productIds });
const toLocal = (s: string | null) => (s ? new Date(new Date(s).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '');
const fromLocal = (s: string) => new Date(s + ':00+05:30').toISOString();

function CampaignEditor({ id }: { id: string }) {
  const isNew = id === 'new';
  const { me } = useMe();
  const navigate = useNavigate();
  const { data, error, reload, setData } = useAdmin<Campaign>(isNew ? null : `/newsletter/campaigns/${id}`);
  const summary = useAdmin<Summary>('/newsletter/summary');
  const [f, setF] = useState<Draft | null>(isNew ? EMPTY : null);
  const [saved, setSaved] = useState<string>(JSON.stringify(EMPTY));
  const [fieldErr, setFieldErr] = useState<Record<string, string[]>>({});
  const [dialog, setDialog] = useState<'test' | 'schedule' | 'send' | null>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    if (!data) return;
    setF(draftOf(data));
    setSaved(JSON.stringify(draftOf(data)));
  }, [data]);

  // While sending, this page also sends the next batch every 20 seconds (the cron does it every
  // 5 minutes), within the daily limit, and refreshes the progress.
  const manager = canManage(me);
  useEffect(() => {
    if (data?.status !== 'sending') return;
    let stop = false;
    const tick = async () => {
      if (manager) await adminApi('/newsletter/process', { method: 'POST' }).catch(() => {});
      if (!stop) reload();
    };
    const t = setInterval(tick, 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [data?.status, reload, manager]);

  if (error) return <Page title="Campaign" back={{ to: '/admin/newsletter', label: 'Newsletter' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!f || (!isNew && !data)) return <Page title="Campaign" back={{ to: '/admin/newsletter', label: 'Newsletter' }}><Loading /></Page>;

  const editable = canManage(me) && (isNew || data!.status === 'draft' || data!.status === 'scheduled');
  const dirty = JSON.stringify(f) !== saved;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x!, [k]: v }));
  const fe = (k: string) => fieldErr[k]?.[0];

  /** Save, and return the campaign (creating it first if new). */
  const save = async (): Promise<Campaign | undefined> => {
    setFieldErr({});
    try {
      const row = await adminApi<Campaign>(isNew ? '/newsletter/campaigns' : `/newsletter/campaigns/${id}`, { method: isNew ? 'POST' : 'PUT', body: f });
      setSaved(JSON.stringify(draftOf(row)));
      if (isNew) navigate(`/admin/newsletter/campaigns/${row.id}`, { replace: true });
      else setData(row);
      return row;
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object') setFieldErr(e.details as Record<string, string[]>);
      throw e;
    }
  };
  const saveFirst = async () => (dirty || isNew ? save() : data!);

  const remove = () => confirm('Delete this campaign?') &&
    run('del', () => adminApi(`/newsletter/campaigns/${id}`, { method: 'DELETE' }), 'Campaign deleted').then((r) => r && navigate('/admin/newsletter'));
  const stop = () => confirm(data!.status === 'sending' ? 'Stop sending? People who already got it keep it; nobody else will.' : 'Unschedule this campaign? It goes back to being a draft.') &&
    run('stop', () => adminApi<Campaign>(`/newsletter/campaigns/${id}/cancel`, { method: 'POST' }), data!.status === 'sending' ? 'Sending stopped' : 'Back to draft').then((r) => r && setData(r));

  const c = data;
  const title = isNew ? 'New campaign' : c!.subject || 'Campaign';
  return (
    <Page title={title} back={{ to: '/admin/newsletter', label: 'Newsletter' }}
      subtitle={c && <><Badge tone={CAMPAIGN_BADGE[c.status][1]}>{CAMPAIGN_BADGE[c.status][0]}</Badge>{c.status === 'scheduled' && <> Sends {fmtDate(c.scheduledAt, true)}</>}</>}
      actions={editable && <>
        {!isNew && <Btn kind="ghost" busy={busy === 'del'} onClick={remove}>Delete</Btn>}
        <Btn busy={busy === 'save'} disabled={!dirty && !isNew} onClick={() => run('save', save, 'Saved')}>{dirty || isNew ? 'Save draft' : 'Saved'}</Btn>
        <Btn onClick={() => setDialog('test')}>Send a test</Btn>
        {c?.status === 'scheduled'
          ? <Btn busy={busy === 'stop'} onClick={stop}>Unschedule</Btn>
          : <Btn onClick={() => setDialog('schedule')}>Schedule</Btn>}
        <Btn kind="primary" onClick={() => setDialog('send')}>Send now</Btn>
      </>}>
      {c && (c.status === 'sending' || c.status === 'sent' || c.status === 'cancelled') && <Progress c={c} onStop={canManage(me) && c.status === 'sending' ? stop : undefined} stopping={busy === 'stop'} />}
      <div className="ad-nl-editor">
        <Card title="Email">
          <fieldset className="ad-form" disabled={!editable}>
            <TextField label="Subject line" value={f.subject} maxLength={150} onChange={(e) => set('subject', e.target.value)} error={fe('subject')} placeholder="New for 2027: Class 10 Science, fully revised" />
            <TextField label="Preview text (optional)" value={f.preheader} maxLength={200} onChange={(e) => set('preheader', e.target.value)} hint="Shown next to the subject in most inboxes." />
            <TextField label="Heading" value={f.heading} maxLength={150} onChange={(e) => set('heading', e.target.value)} hint="The big title inside the email. Empty = the subject." />
            <TextArea label="Message" rows={9} value={f.body} onChange={(e) => set('body', e.target.value)} error={fe('body')}
              hint="Leave a blank line between paragraphs. **bold text** and [link text](https://eldenap.in/…) work." />
            <BookPicker value={f.productIds} onChange={(v) => set('productIds', v)} disabled={!editable} />
            <div className="ad-form-grid">
              <TextField label="Button text (optional)" value={f.ctaLabel} maxLength={60} onChange={(e) => set('ctaLabel', e.target.value)} placeholder="Shop the new titles" />
              <TextField label="Button link" value={f.ctaUrl} onChange={(e) => set('ctaUrl', e.target.value)} error={fe('ctaUrl')} placeholder="https://eldenap.in/catalogue" />
            </div>
          </fieldset>
        </Card>
        <Preview draft={f} />
      </div>
      {dialog === 'test' && <TestDialog onClose={() => setDialog(null)} send={async (to) => {
        const row = await saveFirst();
        if (!row) return;
        const r = await adminApi<{ to: string }>(`/newsletter/campaigns/${row.id}/test`, { method: 'POST', body: to ? { to } : {} });
        return r.to;
      }} defaultTo={me.email} />}
      {dialog === 'schedule' && <ScheduleDialog current={c?.scheduledAt ?? null} onClose={() => setDialog(null)} schedule={async (at) => {
        const row = await saveFirst();
        if (!row) return false;
        const r = await adminApi<Campaign>(`/newsletter/campaigns/${row.id}/schedule`, { method: 'POST', body: { at } });
        if (row.id === id) setData(r); else navigate(`/admin/newsletter/campaigns/${row.id}`, { replace: true });
        return true;
      }} />}
      {dialog === 'send' && <SendDialog summary={summary.data} subject={f.subject} onClose={() => setDialog(null)} send={async () => {
        const row = await saveFirst();
        if (!row) return false;
        await adminApi(`/newsletter/campaigns/${row.id}/send`, { method: 'POST' });
        if (row.id === id) reload(); else navigate(`/admin/newsletter/campaigns/${row.id}`, { replace: true });
        return true;
      }} />}
    </Page>
  );
}

function Progress({ c, onStop, stopping }: { c: Campaign; onStop?: () => void; stopping: boolean }) {
  const done = c.sentCount + c.failedCount;
  const pct = c.recipients ? Math.round((done / c.recipients) * 100) : 0;
  return (
    <Card title={c.status === 'sending' ? 'Sending…' : c.status === 'sent' ? 'Sent' : 'Stopped'} actions={onStop && <Btn size="sm" kind="danger" busy={stopping} onClick={onStop}>Stop sending</Btn>}>
      <div className="ad-nl-progress"><span style={{ width: `${pct}%` }} /></div>
      <p className="ad-muted">
        {n(c.sentCount)} of {n(c.recipients)} sent{c.failedCount > 0 && `, ${n(c.failedCount)} failed`}.
        {c.status === 'sending' && ' Emails go out in small batches within the daily limit. Sending carries on in the background, and goes faster while this page is open.'}
        {c.sentAt && ` Finished ${fmtDate(c.sentAt, true)}.`}
      </p>
    </Card>
  );
}

/** Pick books to show in the email, each with its cover, price and a link. */
function BookPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  const { data } = useAdmin<{ items: { id: string; title: string; classLabel: string; status: string }[] }>('/products?status=active&limit=200');
  const [q, setQ] = useState('');
  const items = data?.items ?? [];
  const picked = value.map((pid) => items.find((p) => p.id === pid) ?? { id: pid, title: 'Unavailable book', classLabel: '', status: '' });
  const matches = q.trim() ? items.filter((p) => !value.includes(p.id) && `${p.title} ${p.classLabel}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  return (
    <div className="ad-field">
      <span>Books to feature (optional)</span>
      {picked.length > 0 && (
        <ul className="ad-nl-books">
          {picked.map((p) => (
            <li key={p.id}><span>{p.title}{p.classLabel && <small> · {p.classLabel}</small>}</span>{!disabled && <button type="button" className="ad-link" onClick={() => onChange(value.filter((x) => x !== p.id))}>Remove</button>}</li>
          ))}
        </ul>
      )}
      {!disabled && value.length < 12 && (
        <div className="ad-nl-search">
          <input type="search" placeholder="Search active books to add" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search books to add" />
          {matches.length > 0 && (
            <ul className="ad-nl-results">
              {matches.map((p) => <li key={p.id}><button type="button" onClick={() => { onChange([...value, p.id]); setQ(''); }}>{p.title}{p.classLabel && <small> · {p.classLabel}</small>}</button></li>)}
            </ul>
          )}
        </div>
      )}
      <small>Each book appears with its cover, price and a link to buy.</small>
    </div>
  );
}

/** The email as subscribers will see it, updated as you type. */
function Preview({ draft }: { draft: Draft }) {
  const [html, setHtml] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const key = useMemo(() => JSON.stringify(draft), [draft]);
  const seq = useRef(0);
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      adminApi<{ html: string }>('/newsletter/campaigns/preview', { body: JSON.parse(key) })
        .then((r) => { if (mine === seq.current) { setHtml(r.html); setErr(null); } })
        .catch((e) => { if (mine === seq.current) setErr((e as Error).message); });
    }, 450);
    return () => clearTimeout(t);
  }, [key]);
  return (
    <Card title="Preview" className="ad-nl-preview" actions={
      <div className="ad-nl-seg">
        <button type="button" className={!mobile ? 'is-on' : ''} onClick={() => setMobile(false)}>Desktop</button>
        <button type="button" className={mobile ? 'is-on' : ''} onClick={() => setMobile(true)}>Phone</button>
      </div>
    }>
      {err && <div className="ad-error">{err}</div>}
      <div className={'ad-nl-frame' + (mobile ? ' is-mobile' : '')}>
        {html ? <iframe title="Email preview" srcDoc={html} sandbox="" /> : <Loading />}
      </div>
      <small className="ad-muted">“Hi {'{first name}'}” and the unsubscribe link are filled in for each person.</small>
    </Card>
  );
}

function TestDialog({ defaultTo, onClose, send }: { defaultTo: string; onClose: () => void; send: (to: string) => Promise<string | undefined> }) {
  const [to, setTo] = useState(defaultTo);
  const { busy, run } = useAction();
  return (
    <Modal title="Send a test" onClose={onClose} footer={<>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'test'} disabled={!to.trim()} onClick={() => run('test', () => send(to.trim()), `Test sent to ${to.trim()}`).then((r) => r && onClose())}>Send test</Btn>
    </>}>
      <div className="ad-form">
        <TextField label="Send to" type="email" value={to} onChange={(e) => setTo(e.target.value)} hint="The subject starts with [Test]. Unsaved changes are saved first." />
      </div>
    </Modal>
  );
}

function ScheduleDialog({ current, onClose, schedule }: { current: string | null; onClose: () => void; schedule: (at: string) => Promise<boolean> }) {
  const [at, setAt] = useState(toLocal(current) || toLocal(new Date(Date.now() + 86400_000).toISOString()).slice(0, 11) + '10:00');
  const { busy, run } = useAction();
  return (
    <Modal title="Schedule" onClose={onClose} footer={<>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'sch'} disabled={!at} onClick={() => run('sch', () => schedule(fromLocal(at)), 'Scheduled').then((ok) => ok && onClose())}>Schedule</Btn>
    </>}>
      <div className="ad-form">
        <TextField label="Start sending at (India time)" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)}
          hint="It goes to everyone subscribed at that moment. Mornings (9–11 am) usually get the most opens." />
      </div>
    </Modal>
  );
}

function SendDialog({ summary, subject, onClose, send }: { summary: Summary | null; subject: string; onClose: () => void; send: () => Promise<boolean> }) {
  const [sure, setSure] = useState(false);
  const { busy, run } = useAction();
  const count = summary?.subscribed ?? 0;
  const days = summary ? Math.ceil(count / Math.max(1, summary.dailyLimit)) : 1;
  return (
    <Modal title="Send this campaign now?" onClose={onClose} footer={<>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'send'} disabled={!sure || !count} onClick={() => run('send', send, 'Sending started').then((ok) => ok && onClose())}>Send to {n(count)} subscriber{count === 1 ? '' : 's'}</Btn>
    </>}>
      <div className="ad-form">
        <p><b>{subject || 'This campaign'}</b> goes to <b>{n(count)}</b> subscriber{count === 1 ? '' : 's'}.{' '}
          {days > 1 ? `With your limit of ${n(summary!.dailyLimit)} a day it will take about ${days} days.` : 'It goes out in batches over the next few minutes.'}</p>
        {!count && <div className="ad-alert ad-alert--amber"><div>There are no subscribers yet.</div></div>}
        <Check label="I’ve sent myself a test and checked it" checked={sure} onChange={setSure} />
      </div>
    </Modal>
  );
}

/* ---------------- Subscribers ---------------- */

function Subscribers({ onChange }: { onChange: () => void }) {
  const { me } = useMe();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<'add' | 'import' | Subscriber | null>(null);
  const { busy, run } = useAction();
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (query) params.set('q', query);
  if (status) params.set('status', status);
  const { data, error, reload } = useAdmin<{ items: Subscriber[]; total: number; page: number; limit: number }>(`/newsletter/subscribers?${params}`);
  const changed = () => { setDialog(null); reload(); onChange(); };
  return (
    <Card flush>
      <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(1); }}>
        <input type="search" className="ad-search" placeholder="Search email, name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
          <option value="">Everyone</option><option value="subscribed">Subscribed</option><option value="pending">Not confirmed</option><option value="unsubscribed">Unsubscribed</option>
        </select>
        <Btn size="sm" type="submit">Search</Btn>
        <span className="ad-grow" />
        <Btn size="sm" busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile('/newsletter/subscribers/export.csv', 'subscribers.csv'))}>Export CSV</Btn>
        {canManage(me) && <><Btn size="sm" onClick={() => setDialog('import')}>Import CSV</Btn><Btn size="sm" kind="primary" onClick={() => setDialog('add')}>Add subscriber</Btn></>}
      </form>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Empty title={query || status ? 'Nobody matches.' : 'No subscribers yet.'}>
          {!query && !status && <p className="ad-muted">People join from the form in the website footer, the /newsletter page, the checkout tick box and their account page.</p>}
        </Empty>
      ) : (
        <div className="ad-table-wrap">
          <table className={'ad-table' + (canManage(me) ? ' ad-table--click' : '')}>
            <thead><tr><th>Subscriber</th><th>Mobile</th><th>Status</th><th>Joined from</th><th>Date</th></tr></thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} onClick={() => canManage(me) && setDialog(s)}>
                  <td><span className="ad-strong">{s.name || s.email}</span>{s.name && <div className="ad-muted">{s.email}</div>}</td>
                  <td className="ad-muted">{s.phone}</td>
                  <td><Badge tone={SUB_BADGE[s.status][1]}>{SUB_BADGE[s.status][0]}</Badge></td>
                  <td className="ad-muted">{SOURCE[s.source] ?? s.source}</td>
                  <td className="ad-muted">{fmtDate(s.status === 'unsubscribed' ? s.unsubscribedAt : s.consentAt ?? s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
      {dialog === 'add' && <AddSubscriber onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog === 'import' && <ImportSubscribers onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog && typeof dialog === 'object' && <EditSubscriber sub={dialog} onClose={() => setDialog(null)} onSaved={changed} />}
    </Card>
  );
}

function AddSubscriber({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ email: '', name: '', phone: '', consent: false });
  const { busy, run } = useAction();
  return (
    <Modal title="Add subscriber" onClose={onClose} footer={<>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'add'} disabled={!f.email.trim() || !f.consent} onClick={() => run('add', () => adminApi('/newsletter/subscribers', { body: f }), 'Subscriber added').then((r) => r && onSaved())}>Add</Btn>
    </>}>
      <div className="ad-form">
        <TextField label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        <div className="ad-form-grid">
          <TextField label="Name (optional)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Mobile (optional)" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <Check label="This person asked to receive our newsletter" hint="For example, they signed up at a book fair or asked by email. Indian law (DPDP Act) and Gmail require consent." checked={f.consent} onChange={(v) => setF({ ...f, consent: v })} />
      </div>
    </Modal>
  );
}

function ImportSubscribers({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; invalid: number } | null>(null);
  const { busy, run } = useAction();
  const rows = csv ? csv.trim().split(/\r?\n/).length - 1 : 0;
  if (result) {
    return (
      <Modal title="Import finished" onClose={onSaved} footer={<><span className="ad-grow" /><Btn kind="primary" onClick={onSaved}>Done</Btn></>}>
        <p><b>{n(result.added)}</b> added. {result.skipped > 0 && <>{n(result.skipped)} skipped (already subscribed, or unsubscribed earlier and never re-added). </>}{result.invalid > 0 && <>{n(result.invalid)} rows had no valid email.</>}</p>
      </Modal>
    );
  }
  return (
    <Modal title="Import subscribers from CSV" onClose={onClose} footer={<>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'imp'} disabled={!csv || !consent} onClick={() => run('imp', () => adminApi<{ added: number; skipped: number; invalid: number }>('/newsletter/subscribers/import', { body: { csv, consent } })).then((r) => r && setResult(r))}>Import</Btn>
    </>}>
      <div className="ad-form">
        <p className="ad-muted">A spreadsheet saved as CSV with an <b>email</b> column, and optionally <b>name</b> and <b>mobile</b>. Up to 20,000 rows.</p>
        <label className="ad-field">
          <span>CSV file</span>
          <input type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { setFileName(file.name); setCsv(await file.text()); } }} />
          {fileName && <small>{fileName}: {n(Math.max(rows, 0))} rows</small>}
        </label>
        <Check label="Everyone on this list agreed to receive our newsletter" hint="Don’t import customer lists or bought lists: people who never opted in mark emails as spam, and Gmail then blocks all your mail, order emails included." checked={consent} onChange={setConsent} />
      </div>
    </Modal>
  );
}

function EditSubscriber({ sub, onClose, onSaved }: { sub: Subscriber; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: sub.name, phone: sub.phone, status: sub.status });
  const { busy, run } = useAction();
  const save = () => run('save', () => adminApi(`/newsletter/subscribers/${sub.id}`, {
    method: 'PUT', body: { name: f.name, phone: f.phone, ...(f.status === 'unsubscribed' && sub.status !== 'unsubscribed' ? { status: 'unsubscribed' } : {}) },
  }), 'Saved').then((r) => r && onSaved());
  const remove = () => confirm(`Delete ${sub.email} completely? (To stop emails but remember their choice, set them to Unsubscribed instead.)`) &&
    run('del', () => adminApi(`/newsletter/subscribers/${sub.id}`, { method: 'DELETE' }), 'Deleted').then((r) => r && onSaved());
  return (
    <Modal title={sub.email} onClose={onClose} footer={<>
      <Btn kind="danger" busy={busy === 'del'} onClick={remove}>Delete</Btn>
      <span className="ad-grow" /><Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" busy={busy === 'save'} onClick={save}>Save</Btn>
    </>}>
      <div className="ad-form">
        <div className="ad-form-grid">
          <TextField label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Mobile" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        {sub.status === 'subscribed' && (
          <SelectField label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as SubStatus })}>
            <option value="subscribed">Subscribed</option><option value="unsubscribed">Unsubscribed (stop sending)</option>
          </SelectField>
        )}
        {sub.status !== 'subscribed' && (
          <p className="ad-muted">{sub.status === 'pending' ? 'Hasn’t confirmed from the email yet.' : `Unsubscribed ${fmtDate(sub.unsubscribedAt)}.`} Only they can subscribe again, from the website, so their consent is on record.</p>
        )}
        <p className="ad-muted">Joined from {SOURCE[sub.source] ?? sub.source}{sub.consentAt && `, consent ${fmtDate(sub.consentAt, true)}`}.</p>
      </div>
    </Modal>
  );
}

/* ---------------- Signed-up accounts ---------------- */

function Accounts() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { busy, run } = useAction();
  const params = new URLSearchParams({ page: String(page), limit: '50' });
  if (query) params.set('q', query);
  const { data, error, reload } = useAdmin<{ items: Account[]; total: number; page: number; limit: number }>(`/newsletter/accounts?${params}`);
  return (
    <Card flush>
      <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); setPage(1); }}>
        <input type="search" className="ad-search" placeholder="Search email, name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn size="sm" type="submit">Search</Btn>
        <span className="ad-grow" />
        <Btn size="sm" busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile('/newsletter/accounts/export.csv', 'accounts.csv'))}>Export CSV</Btn>
      </form>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : data.items.length === 0 ? (
        <Empty title={query ? 'Nobody matches.' : 'No accounts yet.'}>{!query && <p className="ad-muted">Customers appear here once they sign in with Google on the website. Staff logins aren’t listed.</p>}</Empty>
      ) : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Account</th><th>Mobile</th><th>Newsletter</th><th>Signed up</th><th>Last visit</th></tr></thead>
            <tbody>
              {data.items.map((a) => (
                <tr key={a.userId}>
                  <td><span className="ad-strong">{a.name || a.email}</span>{a.name && <div className="ad-muted">{a.email}</div>}</td>
                  <td className="ad-muted">{a.phone || '—'}</td>
                  <td>{a.newsletter ? <Badge tone={SUB_BADGE[a.newsletter][1]}>{SUB_BADGE[a.newsletter][0]}</Badge> : <span className="ad-muted">Not subscribed</span>}</td>
                  <td className="ad-muted">{fmtDate(a.createdAt)}</td>
                  <td className="ad-muted">{fmtDate(a.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />}
      <p className="ad-muted ad-nl-note">Everyone who signed in with Google on the website (staff logins aren’t listed). Signing up doesn’t subscribe anyone: they get newsletters only after turning them on, in their account or at checkout.</p>
    </Card>
  );
}
