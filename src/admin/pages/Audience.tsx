// Admin → Audience: everyone who signed up (Google accounts and newsletter subscribers), how
// complete each profile is, and where they came from (Meta ads, Google, a popup, the footer…).
import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { downloadFile, useAdmin } from '../api';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Page, Pagination, useAction, type Tone } from '../ui';
import { inr } from '../../store/api';

type Bucket = 'complete' | 'most' | 'some' | 'barely' | 'none';
interface Person {
  key: string; email: string; name: string; phone: string; account: boolean; newsletter: 'subscribed' | 'pending' | 'unsubscribed' | null; callConsent: boolean;
  type: string | null; progress: { done: number; total: number; percent: number; missing: string[] } | null; bucket: Bucket;
  channel: string; channelDetail: string; channelFrom: 'visit' | 'order' | 'none'; landing: string; campaign: string; form: string; popupName: string;
  orders: number; spent: number; joinedAt: string; lastSeenAt: string | null;
}
interface Data {
  stats: {
    total: number; accounts: number; subscribed: number; joined: number; averageCompletion: number | null; complete: number; buyers: number;
    buckets: Partial<Record<Bucket, number>>;
    channels: { key: string; label: string; n: number }[];
    forms: { key: string; label: string; n: number }[];
    missing: { field: string; n: number }[];
  };
  buckets: { key: Bucket; label: string }[];
  channels: { key: string; label: string; hint: string }[];
  fieldLabels: Record<string, string>;
  items: Person[]; total: number; page: number; limit: number;
}

const PERIODS: [number, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']];
/** One hue, light → dark: how complete a profile is (darker = more complete). "No account" is neutral. */
const BUCKET_COLOR: Record<Bucket, string> = { complete: '#0E1F33', most: '#3B5576', some: '#7E93AE', barely: '#C2CDDA', none: '#E7E2D9' };
const FORM_LABEL: Record<string, string> = {
  footer: 'Footer form', 'newsletter-page': 'Newsletter page', home: 'Home page form', popup: 'Popup', checkout: 'Checkout',
  signup: 'Google sign-in', account: 'Account page', admin: 'Added by the team', import: 'Imported',
};
const TYPE_LABEL: Record<string, string> = { student: 'Student', parent: 'Parent', teacher: 'Teacher', other: 'Other' };
const CHANNEL_TONE: Record<string, Tone> = { meta_ads: 'blue', google_ads: 'blue', meta_social: 'navy', search: 'green', email: 'amber', unknown: 'grey', direct: 'grey' };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

export default function Audience() {
  const [days, setDays] = useState(30);
  const [f, setF] = useState<{ q: string; channel: string; bucket: string; form: string }>({ q: '', channel: '', bucket: '', form: '' });
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const params = new URLSearchParams({ days: String(days), page: String(page), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const { data, error, reload } = useAdmin<Data>(`/audience?${params}`);
  const { busy, run } = useAction();
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: x[k] === v ? '' : v })); setPage(1); };
  const filtered = Object.values(f).some(Boolean);

  return (
    <Page title="Audience" subtitle="Everyone who signed up: how complete their profile is, and where they came from."
      actions={<Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile(`/audience/export.csv?${params}`, 'audience.csv'))}>Export CSV</Btn>}>
      <div className="ad-row ad-mt">
        <div className="au-seg" role="group" aria-label="Period">
          {PERIODS.map(([d, l]) => <button key={d} type="button" className={days === d ? 'is-on' : ''} onClick={() => { setDays(d); setPage(1); }}>{l}</button>)}
        </div>
        <span className="ad-muted">“New” and the two source charts count people who joined in this period.</span>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="ad-stack ad-mt">
          <Tiles d={data} days={days} />
          <div className="ad-grid-2">
            <Bars title="Where new people came from" hint="The channel that brought them to the site before they signed up."
              rows={data.stats.channels} active={f.channel} onPick={(k) => set('channel', k)} />
            <Bars title="Where they signed up" hint="The form or place they joined from."
              rows={data.stats.forms} active={f.form} onPick={(k) => set('form', k)} />
          </div>
          <Completion d={data} active={f.bucket} onPick={(k) => set('bucket', k)} />
          <Card flush title={<>People {filtered && <Btn size="sm" kind="ghost" onClick={() => { setF({ q: '', channel: '', bucket: '', form: '' }); setQ(''); setPage(1); }}>Clear filters</Btn>}</>}>
            <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setF((x) => ({ ...x, q: q.trim() })); setPage(1); }}>
              <input type="search" placeholder="Name, email or mobile" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
              <select value={f.channel} onChange={(e) => { setF((x) => ({ ...x, channel: e.target.value })); setPage(1); }} aria-label="Came from">
                <option value="">Any source</option>{data.channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <select value={f.bucket} onChange={(e) => { setF((x) => ({ ...x, bucket: e.target.value })); setPage(1); }} aria-label="Profile">
                <option value="">Any profile</option>{data.buckets.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
              </select>
              <Btn size="sm" type="submit">Search</Btn>
            </form>
            <People d={data} />
            <Pagination page={data.page} total={data.total} limit={data.limit} onPage={setPage} />
          </Card>
        </div>
      )}
    </Page>
  );
}

/* ---------------- Headline numbers ---------------- */

function Tiles({ d, days }: { d: Data; days: number }) {
  const s = d.stats;
  return (
    <div className="ad-stats">
      <div className="ad-stat"><span>People</span><b>{s.total.toLocaleString('en-IN')}</b><small>{s.accounts} with an account · {s.subscribed} on the newsletter</small></div>
      <div className="ad-stat"><span>New in {PERIODS.find(([x]) => x === days)?.[1] ?? `${days} days`}</span><b>{s.joined.toLocaleString('en-IN')}</b><small>{s.buyers} people have bought</small></div>
      <div className="ad-stat au-stat-ring">
        <Ring percent={s.averageCompletion ?? 0} size={56} />
        <div><span>Average profile</span><b>{s.averageCompletion === null ? '—' : `${s.averageCompletion}%`}</b><small>across {s.accounts} accounts</small></div>
      </div>
      <div className="ad-stat"><span>Complete profiles</span><b>{s.complete.toLocaleString('en-IN')}</b><small>{pct(s.complete, s.accounts)}% of accounts</small></div>
    </div>
  );
}

/* ---------------- Charts ---------------- */

/** Horizontal bars, one hue, largest first; clicking one filters the list below. */
function Bars({ title, hint, rows, active, onPick }: { title: string; hint: string; rows: { key: string; label: string; n: number }[]; active: string; onPick: (k: string) => void }) {
  const total = rows.reduce((n, r) => n + r.n, 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card title={title}>
      <p className="ad-muted au-hint">{hint}</p>
      {!rows.length ? <Empty title="Nobody joined in this period." /> : (
        <ul className="au-bars">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}>
              <button type="button" className={'au-bar' + (active === r.key ? ' is-on' : '') + (active && active !== r.key ? ' is-dim' : '')} onClick={() => onPick(r.key)}
                title={`${r.label}: ${r.n} (${pct(r.n, total)}%). Click to show these people.`}>
                <span className="au-bar__label">{r.label}</span>
                <span className="au-bar__track"><span className="au-bar__fill" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} /></span>
                <span className="au-bar__value"><b>{r.n}</b> <small>{pct(r.n, total)}%</small></span>
              </button>
            </li>
          ))}
          {rows.length > 8 && <li className="ad-muted">+ {rows.length - 8} more (in the CSV)</li>}
        </ul>
      )}
    </Card>
  );
}

/** Everyone split by how complete their profile is: one stacked bar, then what's most often missing. */
function Completion({ d, active, onPick }: { d: Data; active: string; onPick: (k: string) => void }) {
  const s = d.stats;
  const total = d.buckets.reduce((n, b) => n + (s.buckets[b.key] ?? 0), 0);
  return (
    <Card title="Profile completion">
      <div className="au-stack" role="img" aria-label={d.buckets.map((b) => `${b.label}: ${s.buckets[b.key] ?? 0}`).join(', ')}>
        {d.buckets.filter((b) => s.buckets[b.key]).map((b) => (
          <button key={b.key} type="button" className={'au-stack__seg' + (active && active !== b.key ? ' is-dim' : '')} style={{ flexGrow: s.buckets[b.key], background: BUCKET_COLOR[b.key] }}
            title={`${b.label}: ${s.buckets[b.key]} (${pct(s.buckets[b.key] ?? 0, total)}%). Click to show these people.`} onClick={() => onPick(b.key)} />
        ))}
      </div>
      <ul className="au-legend">
        {d.buckets.map((b) => (
          <li key={b.key}>
            <button type="button" className={active === b.key ? 'is-on' : ''} onClick={() => onPick(b.key)}>
              <i style={{ background: BUCKET_COLOR[b.key] }} />{b.label} <b>{s.buckets[b.key] ?? 0}</b>
            </button>
          </li>
        ))}
      </ul>
      {s.missing.length > 0 && (
        <div className="ad-mt">
          <span className="ad-label">Most often left out</span>
          <div className="au-chips">{s.missing.map((m) => <span key={m.field} className="au-chip">{d.fieldLabels[m.field] ?? m.field} <b>{m.n}</b></span>)}</div>
        </div>
      )}
    </Card>
  );
}

/** A progress ring: one hue on a pale track, the percentage in the middle. */
function Ring({ percent, size = 38 }: { percent: number; size?: number }) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg className="au-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${percent}% complete`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7E2D9" strokeWidth="4" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={percent >= 100 ? '#2F7A45' : '#0E1F33'} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={`${(c * Math.min(100, percent)) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size > 44 ? 13 : 10} fontWeight="700" fill="#171A1F">{percent}%</text>
    </svg>
  );
}

/* ---------------- The list ---------------- */

function People({ d }: { d: Data }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!d.items.length) return <Empty title="Nobody matches." />;
  const channelLabel = (k: string) => d.channels.find((c) => c.key === k)?.label ?? 'Not recorded';
  return (
    <div className="ad-table-wrap">
      <table className="ad-table au-table">
        <thead><tr><th>Person</th><th>Profile</th><th>Came from</th><th>Signed up on</th><th>Newsletter</th><th className="ad-num">Orders</th><th>Joined</th></tr></thead>
        <tbody>
          {d.items.map((p) => (
            <Fragment key={p.key}>
              <tr className="au-row" onClick={() => setOpen(open === p.key ? null : p.key)} aria-expanded={open === p.key}>
                <td>
                  <div className="au-person">
                    <span className="au-avatar" aria-hidden="true">{initials(p.name || p.email)}</span>
                    <span><span className="ad-strong">{p.name || p.email}</span>{p.name && <div className="ad-muted">{p.email}</div>}</span>
                  </div>
                </td>
                <td>{p.progress ? (
                  <div className="au-progress"><Ring percent={p.progress.percent} /><small className="ad-muted">{p.progress.done} of {p.progress.total}{p.type ? ` · ${TYPE_LABEL[p.type] ?? p.type}` : ''}</small></div>
                ) : <Badge tone="grey">No account</Badge>}</td>
                <td>
                  <Badge tone={CHANNEL_TONE[p.channel] ?? 'grey'}>{channelLabel(p.channel)}</Badge>
                  {(p.channelDetail || p.channelFrom === 'order') && <div className="ad-muted au-small">{p.channelDetail}{p.channelFrom === 'order' ? `${p.channelDetail ? ' · ' : ''}from their first order` : ''}</div>}
                </td>
                <td>{p.form === 'popup' ? <><span className="au-popup">Popup</span> <span className="ad-muted">{p.popupName}</span></> : FORM_LABEL[p.form] ?? <span className="ad-muted">—</span>}</td>
                <td>{p.newsletter === 'subscribed' ? <Badge tone="green">Subscribed</Badge> : p.newsletter === 'unsubscribed' ? <Badge tone="grey">Unsubscribed</Badge> : p.newsletter === 'pending' ? <Badge tone="amber">Not confirmed</Badge> : <span className="ad-muted">—</span>}
                  {p.callConsent && <div className="ad-muted au-small">Calls & WhatsApp OK</div>}</td>
                <td className="ad-num">{p.orders ? <>{p.orders}<div className="ad-muted au-small">{inr(p.spent)}</div></> : <span className="ad-muted">—</span>}</td>
                <td className="ad-muted">{date(p.joinedAt)}</td>
              </tr>
              {open === p.key && (
                <tr className="au-detail"><td colSpan={7}>
                  <div className="au-detail__grid">
                    <div>
                      <span className="ad-label">Still to fill in</span>
                      {!p.progress ? <p className="ad-muted">Newsletter only: they haven't created an account yet.</p>
                        : p.progress.missing.length ? <div className="au-chips">{p.progress.missing.map((m) => <span key={m} className="au-chip">{d.fieldLabels[m] ?? m}</span>)}</div>
                          : <p className="ad-pos">Everything is filled in.</p>}
                    </div>
                    <div>
                      <span className="ad-label">How they found us</span>
                      <p>{channelLabel(p.channel)}{p.channelDetail ? ` · ${p.channelDetail}` : ''}{p.campaign && !p.channelDetail.includes(p.campaign) ? ` · campaign “${p.campaign}”` : ''}</p>
                      {p.landing && <p className="ad-muted">First page: <span className="ad-code">{p.landing}</span></p>}
                      {p.channelFrom === 'order' && <p className="ad-muted">Signed up before sources were recorded: this is their first order's source.</p>}
                    </div>
                    <div>
                      <span className="ad-label">Contact</span>
                      <p>{p.phone || <span className="ad-muted">No mobile</span>}</p>
                      <p className="ad-muted">Last visit {date(p.lastSeenAt)}</p>
                      {p.orders > 0 && <Link to={`/admin/orders?q=${encodeURIComponent(p.email)}`}>See their orders</Link>}
                    </div>
                  </div>
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
