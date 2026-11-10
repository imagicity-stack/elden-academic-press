// Admin → WhatsApp: the inbox (customers' messages and our replies), what the site sent,
// new-books messages to subscribers, and the settings (switches, template names, connection).
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { adminApi, useAdmin } from '../api';
import { Badge, Btn, Card, Check, Empty, ErrorBox, Loading, Page, TextArea, TextField, Toggle, useAction, type Tone } from '../ui';
import { WA_STATUS_LABEL, WA_TEMPLATES, type WaKind, type WaStatus, type WhatsAppSettings } from '../../shared/whatsapp';

const TABS = [['', 'Inbox'], ['sent', 'Sent'], ['new-books', 'New books'], ['settings', 'Settings']] as const;
const STATUS_TONE: Record<WaStatus, Tone> = { queued: 'blue', sent: 'grey', delivered: 'green', read: 'green', failed: 'red', skipped: 'grey', received: 'blue' };
const KIND_LABEL: Record<WaKind, string> = {
  ...Object.fromEntries(WA_TEMPLATES.map((t) => [t.key, t.label])) as Record<(typeof WA_TEMPLATES)[number]['key'], string>,
  reply: 'Reply', inbound: 'Their message',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const Status = ({ s }: { s: WaStatus }) => <Badge tone={STATUS_TONE[s]}>{WA_STATUS_LABEL[s]}</Badge>;

interface SettingsData {
  settings: WhatsAppSettings;
  templates: typeof WA_TEMPLATES;
  status: { connected: boolean; templates: boolean; webhook: boolean; webhookUrl: string };
  stats: { byKind: Partial<Record<WaKind, Partial<Record<WaStatus, number>>>>; unread: number; optedOut: number; audience: number };
}

export default function WhatsAppAdmin() {
  const { tab = '' } = useParams();
  return (
    <Page title="WhatsApp" subtitle="Messages from the Elden Academic Press WhatsApp number: cart reminders, order updates, new books, and customers' replies.">
      <nav className="ad-tabs ad-mt">
        {TABS.map(([k, l]) => <Link key={k} to={`/admin/whatsapp${k ? `/${k}` : ''}`} className={'ad-tab' + (tab === k ? ' is-on' : '')}>{l}</Link>)}
      </nav>
      <div className="ad-mt">
        <NotConnected />
        {tab === '' && <Inbox />}
        {tab === 'sent' && <Sent />}
        {tab === 'new-books' && <NewBooks />}
        {tab === 'settings' && <SettingsTab />}
        {!TABS.some(([k]) => k === tab) && <Empty title="Not found." />}
      </div>
    </Page>
  );
}

function NotConnected() {
  const { data } = useAdmin<SettingsData>('/whatsapp/settings');
  if (!data) return null;
  if (!data.status.connected) return <div className="ad-warn ad-mb"><b>WhatsApp isn't connected yet.</b> Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in Vercel (Settings tab has the details). Until then nothing is sent; messages wait in the queue.</div>;
  if (!data.settings.enabled) return <div className="ad-warn ad-mb"><b>WhatsApp is switched off.</b> Nothing automatic is sent until you switch it on in Settings. Replies from the inbox still work.</div>;
  return null;
}

/* ---------------- Inbox ---------------- */

interface Conversation { phone: string; name: string; last: string; direction: 'in' | 'out'; status: WaStatus; at: string; unread: number; lastIncoming: string | null }
interface Message { id: string; direction: 'in' | 'out'; kind: WaKind; status: WaStatus; body: string; error: string; createdAt: string; createdBy: string }
interface Thread { phone: string; messages: Message[]; optedOut: boolean; replyUntil: string | null; canReply: boolean; connected: boolean }

function Inbox() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const list = useAdmin<{ items: Conversation[] }>(`/whatsapp/conversations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const phone = sp.get('phone');
  return (
    <div className="ad-grid-2 wa-inbox">
      <Card flush>
        <div className="ad-toolbar ad-pad">
          <input type="search" placeholder="Name or number" onKeyDown={(e) => { if (e.key === 'Enter') setQ((e.target as HTMLInputElement).value); }} aria-label="Search" />
          <Btn size="sm" onClick={list.reload}>Refresh</Btn>
        </div>
        {list.error ? <ErrorBox error={list.error} retry={list.reload} /> : !list.data ? <Loading /> : !list.data.items.length ? <Empty title="No conversations yet." /> : (
          <ul className="wa-list">
            {list.data.items.map((c) => (
              <li key={c.phone}>
                <button type="button" className={'wa-list__item' + (c.phone === phone ? ' is-on' : '')} onClick={() => setSp({ phone: c.phone })}>
                  <span className="wa-list__top"><strong>{c.name || c.phone}</strong><small className="ad-muted">{when(c.at)}</small></span>
                  <span className="wa-list__last">{c.direction === 'out' ? 'You: ' : ''}{c.last}</span>
                  {c.unread > 0 && <em className="wa-unread">{c.unread}</em>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {phone ? <ThreadView phone={phone} onChange={list.reload} /> : <Card><Empty title="Pick a conversation." /></Card>}
    </div>
  );
}

function ThreadView({ phone, onChange }: { phone: string; onChange: () => void }) {
  const { data, error, reload } = useAdmin<Thread>(`/whatsapp/conversations/${encodeURIComponent(phone)}`);
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); if (data) onChange(); }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data) return <Card><Loading /></Card>;
  const send = () => run('send', () => adminApi(`/whatsapp/conversations/${encodeURIComponent(phone)}/reply`, { method: 'POST', body: { text } }), 'Sent').then((r) => { if (r) { setText(''); reload(); } });
  return (
    <Card title={<>{phone} {data.optedOut && <Badge tone="red">Replied STOP</Badge>}</>}
      actions={<><Link className="ad-btn ad-btn--sm ad-btn--ghost" to={`/admin/calls/log?q=${encodeURIComponent(phone.replace(/^\+91/, ''))}`}>Calls</Link><Btn size="sm" onClick={reload}>Refresh</Btn></>}>
      <div className="wa-thread">
        {data.messages.map((m) => (
          <div key={m.id} className={`wa-msg wa-msg--${m.direction}`}>
            <div className="wa-msg__body">{m.body}</div>
            <div className="wa-msg__meta">
              {m.direction === 'out' && <>{KIND_LABEL[m.kind]} · </>}{when(m.createdAt)}{m.direction === 'out' && <> · <Status s={m.status} /></>}
              {m.error && <div className="ad-neg">{m.error}</div>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {data.optedOut ? <p className="ad-muted">This customer asked not to get WhatsApp messages. They can send START to allow them again.</p>
        : !data.connected ? <p className="ad-muted">Replies can be sent once WhatsApp is connected.</p>
          : data.canReply ? (
            <div className="ad-stack-sm ad-mt">
              <TextArea label="Reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000}
                hint={`You can reply freely until ${when(data.replyUntil)} (24 hours after their last message).`} />
              <div><Btn kind="primary" busy={busy === 'send'} disabled={!text.trim()} onClick={send}>Send</Btn></div>
            </div>
          ) : <p className="ad-muted">More than 24 hours have passed since their last message, so WhatsApp only allows an approved template now. Call them, or wait for them to write again.</p>}
    </Card>
  );
}

/* ---------------- Sent ---------------- */

interface SentRow { id: string; phone: string; name: string; kind: WaKind; status: WaStatus; body: string; error: string; dueAt: string; sentAt: string | null; createdAt: string }

function Sent() {
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const qs = new URLSearchParams({ ...(kind ? { kind } : {}), ...(status ? { status } : {}) });
  const { data, error, reload } = useAdmin<{ items: SentRow[] }>(`/whatsapp/messages?${qs}`);
  return (
    <Card flush>
      <div className="ad-toolbar ad-pad">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Message">
          <option value="">All messages</option>{WA_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}<option value="reply">Replies</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">Any status</option>{(['queued', 'sent', 'delivered', 'read', 'failed', 'skipped'] as WaStatus[]).map((s) => <option key={s} value={s}>{WA_STATUS_LABEL[s]}</option>)}
        </select>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : !data.items.length ? <Empty title="Nothing sent yet." /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>{data.items.map((m) => (
              <tr key={m.id}>
                <td>{when(m.status === 'queued' ? m.dueAt : m.sentAt ?? m.createdAt)}{m.status === 'queued' && <><br /><small className="ad-muted">due</small></>}</td>
                <td><Link className="ad-strong" to={`/admin/whatsapp?phone=${encodeURIComponent(m.phone)}`}>{m.name || m.phone}</Link><br /><span className="ad-muted">{m.phone}</span></td>
                <td><strong>{KIND_LABEL[m.kind]}</strong><br /><small className="ad-muted">{m.body.slice(0, 160)}</small></td>
                <td><Status s={m.status} />{m.error && <><br /><small className="ad-neg">{m.error}</small></>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- New books ---------------- */

function NewBooks() {
  const audience = useAdmin<{ count: number }>('/whatsapp/new-books/audience');
  const { busy, run } = useAction();
  const [message, setMessage] = useState('');
  const [link, setLink] = useState(`${location.origin}/books`);
  const [test, setTest] = useState('');
  const t = WA_TEMPLATES.find((x) => x.key === 'new_books')!;
  const send = (testPhone?: string) => {
    if (!testPhone && !window.confirm(`Send this to ${audience.data?.count ?? 0} subscribers on WhatsApp? Meta charges for each marketing message.`)) return;
    run(testPhone ? 'test' : 'send', () => adminApi<{ queued: number }>('/whatsapp/new-books', { method: 'POST', body: { message, link, ...(testPhone ? { testPhone } : {}) } }))
      .then((r) => r && alert(testPhone ? 'Test queued: it goes out now if WhatsApp is on.' : `${r.queued} messages queued. They go out between 9 am and 9 pm.`));
  };
  return (
    <div className="ad-grid-2">
      <Card title="Tell subscribers about new books">
        <p className="ad-muted">Goes to newsletter subscribers who left “Subscribe to calls” ticked and gave a mobile number, except anyone who replied STOP: <strong>{audience.data ? `${audience.data.count} people` : '…'}</strong>. Each person gets it once.</p>
        <TextArea label="Your message ({{2}} in the template)" rows={4} maxLength={600} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Mathematics Today for Class 10 (2027 edition) is out, with 40 solved sample papers." hint="One paragraph, no new lines." />
        <TextField label="Link ({{3}})" value={link} onChange={(e) => setLink(e.target.value)} />
        <div className="ad-row ad-mt">
          <TextField label="Test to one number first" placeholder="10-digit mobile" value={test} onChange={(e) => setTest(e.target.value)} />
          <Btn busy={busy === 'test'} disabled={!message.trim() || !test.trim()} onClick={() => send(test)}>Send test</Btn>
        </div>
        <div className="ad-mt"><Btn kind="primary" busy={busy === 'send'} disabled={!message.trim() || !audience.data?.count} onClick={() => send()}>Send to everyone</Btn></div>
      </Card>
      <Card title="What they'll get">
        <div className="wa-msg wa-msg--out"><div className="wa-msg__body">{t.text.replace('{{1}}', 'Asha').replace('{{2}}', message || '…').replace('{{3}}', link)}</div></div>
        <p className="ad-muted ad-mt">The exact wording is the <span className="ad-code">{t.name}</span> template approved in WhatsApp Manager; this preview uses the site's text.</p>
      </Card>
    </div>
  );
}

/* ---------------- Settings ---------------- */

const SWITCHES: { key: 'cart' | 'orderConfirmed' | 'shipped' | 'ebookReady' | 'callFollowup'; template: (typeof WA_TEMPLATES)[number]['key']; help: string }[] = [
  { key: 'cart', template: 'cart', help: 'Someone ticked the call/WhatsApp box at checkout and didn’t pay. Sent once, between 9 am and 9 pm.' },
  { key: 'orderConfirmed', template: 'order_confirmed', help: 'When the payment comes in (buyers who ticked the box).' },
  { key: 'shipped', template: 'shipped', help: 'When you mark a printed order Shipped with “email the customer” on.' },
  { key: 'ebookReady', template: 'ebook_ready', help: 'Cash on delivery: when the books are delivered and the free e-book unlocks.' },
  { key: 'callFollowup', template: 'call_followup', help: 'After a Sarvam voice call: a thank-you with their link and what happens next; or, when the last try went unanswered, “we tried to call you” (the “Missed our call” template).' },
];

function SettingsTab() {
  const { data, error, reload } = useAdmin<SettingsData>('/whatsapp/settings');
  const { busy, run } = useAction();
  const [s, setS] = useState<WhatsAppSettings | null>(null);
  useEffect(() => { if (data) setS(data.settings); }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (!data || !s) return <Loading />;
  const st = data.status;
  const save = () => run('save', () => adminApi('/whatsapp/settings', { method: 'PUT', body: s }), 'Settings saved').then((r) => r && reload());
  const count = (k: WaKind, ...ss: WaStatus[]) => ss.reduce((n, x) => n + (data.stats.byKind[k]?.[x] ?? 0), 0);
  return (
    <div className="ad-grid-2">
      <div className="ad-stack">
        <Card title="On and off">
          <div className="ad-stack-sm">
            <div className="ad-row"><Toggle checked={s.enabled} label="WhatsApp" onChange={(v) => setS({ ...s, enabled: v })} /><strong>{s.enabled ? 'WhatsApp is on' : 'WhatsApp is off'}</strong></div>
            {SWITCHES.map((x) => (
              <div key={x.key}>
                <Check label={WA_TEMPLATES.find((t) => t.key === x.template)!.label} hint={x.help} checked={s[x.key]} onChange={(v) => setS({ ...s, [x.key]: v })} />
                <small className="ad-muted">Last 30 days: {count(x.template, 'sent', 'delivered', 'read')} sent, {count(x.template, 'read')} read, {count(x.template, 'failed')} failed</small>
              </div>
            ))}
          </div>
          <TextField label="Cart reminder after (minutes)" type="number" min={15} max={1440} value={s.cartDelayMinutes} onChange={(e) => setS({ ...s, cartDelayMinutes: Number(e.target.value) })} />
        </Card>
        <Templates enabled={st.templates} />
        <Card title="Template names (advanced)">
          <TextField label="Language code" value={s.language} onChange={(e) => setS({ ...s, language: e.target.value })} hint="The language the templates are created in: en, en_US, hi…" />
          {data.templates.map((t) => (
            <div key={t.key} className="ad-mt">
              <TextField label={`${t.label} (${t.category === 'MARKETING' ? 'Marketing' : 'Utility'})`} value={s.templates[t.key]} onChange={(e) => setS({ ...s, templates: { ...s.templates, [t.key]: e.target.value } })}
                hint={<>Variables: {t.vars.map((v, i) => `{{${i + 1}}} ${v}`).join(', ')}. Text: “{t.text}”</>} />
            </div>
          ))}
        </Card>
        <div><Btn kind="primary" busy={busy === 'save'} onClick={save}>Save settings</Btn></div>
      </div>
      <Card title="Connection">
        <dl className="ad-dl">
          <dt>Templates</dt><dd>{st.templates ? <Badge tone="green">Can create and check</Badge> : <Badge tone="amber">WHATSAPP_BUSINESS_ACCOUNT_ID not set</Badge>}</dd>
          <dt>Sending</dt><dd>{st.connected ? <Badge tone="green">Connected</Badge> : <Badge tone="amber">WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set</Badge>}</dd>
          <dt>Webhook</dt><dd>{st.webhook ? <Badge tone="green">Ready</Badge> : <Badge tone="amber">WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN not set</Badge>}</dd>
          <dt>Unread</dt><dd>{data.stats.unread}</dd>
          <dt>Replied STOP</dt><dd>{data.stats.optedOut}</dd>
          <dt>New-books audience</dt><dd>{data.stats.audience}</dd>
        </dl>
        <TextArea label="Webhook callback URL (Meta app → WhatsApp → Configuration)" readOnly rows={2} value={st.webhookUrl}
          hint="Verify token: the WHATSAPP_VERIFY_TOKEN value. Subscribe to the “messages” field." />
        <p className="ad-muted">Everything lives in the Elden Academic Press business portfolio. Customers can reply STOP to stop all messages and START to allow them again.</p>
      </Card>
    </div>
  );
}

/* ---------------- Templates in Meta ---------------- */

const TPL_TONE: Record<string, Tone> = { APPROVED: 'green', PENDING: 'amber', IN_APPEAL: 'amber', REJECTED: 'red', PAUSED: 'red', DISABLED: 'red', MISSING: 'grey' };

function Templates({ enabled }: { enabled: boolean }) {
  const { data, error, reload } = useAdmin<{ items: { key: string; name: string; status: string; language: string; rejectedReason: string }[] }>(enabled ? '/whatsapp/templates' : null);
  const { busy, run } = useAction();
  const [results, setResults] = useState<{ name: string; result: string }[] | null>(null);
  const create = () => run('create', () => adminApi<{ results: { name: string; result: string }[] }>('/whatsapp/templates/create', { method: 'POST' })).then((r) => { if (r) { setResults(r.results); reload(); } });
  return (
    <Card title="Templates in WhatsApp" actions={enabled ? <Btn size="sm" onClick={reload}>Check again</Btn> : undefined}>
      {!enabled ? <p className="ad-muted">Add WHATSAPP_TOKEN and WHATSAPP_BUSINESS_ACCOUNT_ID in Vercel to create the templates from here and see whether Meta approved them.</p>
        : error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
          <>
            <table className="ad-table">
              <thead><tr><th>Template</th><th>Meta</th></tr></thead>
              <tbody>{data.items.map((t) => (
                <tr key={t.key}>
                  <td><strong>{KIND_LABEL[t.key as WaKind] ?? t.key}</strong><br /><span className="ad-code">{t.name}</span></td>
                  <td><Badge tone={TPL_TONE[t.status] ?? 'grey'}>{t.status === 'MISSING' ? 'Not created' : t.status.toLowerCase()}</Badge>{t.rejectedReason && <><br /><small className="ad-neg">{t.rejectedReason}</small></>}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="ad-muted ad-mt">Messages use only approved templates; until then they fail with Meta's reason, shown in Sent. Review usually takes minutes, sometimes a day.</p>
            {data.items.some((t) => t.status === 'MISSING') && <Btn kind="primary" busy={busy === 'create'} onClick={create}>Create the missing templates</Btn>}
            {results && <ul className="ad-mt">{results.map((r) => <li key={r.name}><span className="ad-code">{r.name}</span>: {r.result}</li>)}</ul>}
          </>
        )}
    </Card>
  );
}
