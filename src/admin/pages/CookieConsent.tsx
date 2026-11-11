// Admin → Cookie consent: how many visitors see the cookie banner and what they choose, by day,
// device, approximate region, traffic channel and page, and how long they take. Anonymous
// counters only: no IP addresses, browser strings or ids are kept.
import { useState } from 'react';
import { useAdmin } from '../api';
import { Card, Empty, ErrorBox, Loading, Page } from '../ui';

interface Part { key: string; label: string; shown: number; accept: number; essential: number; decided: number; acceptRate: number | null }
interface Data {
  totals: { shown: number; accept: number; essential: number; decided: number; noChoice: number; acceptRate: number | null; acceptOfShown: number | null; changedToAll: number; changedToEssential: number };
  daily: { day: string; shown: number; accept: number; essential: number }[];
  byDevice: Part[]; byRegion: Part[]; byChannel: Part[]; byPage: Part[];
  timing: { key: string; label: string; accept: number; essential: number }[];
}

const PERIODS: [number, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [365, '12 months']];
const fmt = (n: number) => n.toLocaleString('en-IN');
const rate = (r: number | null) => (r === null ? '—' : `${r}%`);
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export default function CookieConsent() {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useAdmin<Data>(`/consent?days=${days}`);
  return (
    <Page title="Cookie consent" subtitle="How many visitors see the cookie banner and what they choose. Counted anonymously: no IP addresses or personal details are kept.">
      <div className="ad-row ad-mt">
        <div className="au-seg" role="group" aria-label="Period">
          {PERIODS.map(([d, l]) => <button key={d} type="button" className={days === d ? 'is-on' : ''} onClick={() => setDays(d)}>{l}</button>)}
        </div>
        <span className="ad-muted">Each browser is counted once when it first sees the banner, and once when it chooses.</span>
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <div className="ad-stack ad-mt">
          <Tiles t={data.totals} />
          <Daily rows={data.daily} />
          <div className="ad-grid-2">
            <Table title="By device" rows={data.byDevice} />
            <Table title="By traffic source" rows={data.byChannel} />
          </div>
          <div className="ad-grid-2">
            <Table title="By region (approximate)" hint="From the IP address at the time, which is not stored." rows={data.byRegion} />
            <Table title="By page where they chose" rows={data.byPage} />
          </div>
          <Timing rows={data.timing} />
        </div>
      )}
    </Page>
  );
}

function Tiles({ t }: { t: Data['totals'] }) {
  return (
    <div className="ad-stats">
      <div className="ad-stat"><span>Saw the banner</span><b>{fmt(t.shown)}</b><small>new browsers</small></div>
      <div className="ad-stat"><span>Accepted all</span><b>{fmt(t.accept)}</b><small>{rate(t.acceptRate)} of those who chose</small></div>
      <div className="ad-stat"><span>Only essential</span><b>{fmt(t.essential)}</b><small>{rate(t.acceptRate === null ? null : Math.round((100 - t.acceptRate) * 10) / 10)} of those who chose</small></div>
      <div className="ad-stat"><span>Didn't choose</span><b>{fmt(t.noChoice)}</b><small>saw it and left it open (nothing sent to Meta or Google)</small></div>
      <div className="ad-stat"><span>Changed their mind</span><b>{fmt(t.changedToAll + t.changedToEssential)}</b><small>{t.changedToAll} to all · {t.changedToEssential} to essential</small></div>
    </div>
  );
}

/** Two small charts on the same days: how many saw it, and the share who accepted (two scales, never one shared axis). */
function Daily({ rows }: { rows: Data['daily'] }) {
  if (!rows.length) return null;
  const maxShown = Math.max(1, ...rows.map((r) => r.shown));
  const rateOf = (r: Data['daily'][number]) => (r.accept + r.essential ? (r.accept / (r.accept + r.essential)) * 100 : null);
  return (
    <Card title="Per day">
      <div className="ca-mini">
        <div className="ca-mini__head"><b>Saw the banner</b><span className="ad-muted">{fmt(rows.reduce((n, r) => n + r.shown, 0))} in total</span></div>
        <div className="ca-mini__bars" role="img" aria-label="Browsers that saw the banner, per day">
          {rows.map((r) => (
            <span key={r.day} className="ca-mini__col" title={`${dayLabel(r.day)}: ${fmt(r.shown)} saw it`}>
              <span className="ca-mini__bar" style={{ height: `${r.shown ? Math.max(4, (r.shown / maxShown) * 100) : 0}%` }} />
            </span>
          ))}
        </div>
      </div>
      <div className="ca-mini">
        <div className="ca-mini__head"><b>Accepted all (% of those who chose that day)</b><span className="ad-muted">scale 0–100%</span></div>
        <div className="ca-mini__bars" role="img" aria-label="Acceptance rate per day">
          {rows.map((r) => {
            const v = rateOf(r);
            return (
              <span key={r.day} className="ca-mini__col" title={`${dayLabel(r.day)}: ${v === null ? 'nobody chose' : `${Math.round(v)}% accepted (${r.accept} of ${r.accept + r.essential})`}`}>
                <span className="ca-mini__bar" style={{ height: v === null ? 0 : `${Math.max(3, v)}%` }} />
              </span>
            );
          })}
        </div>
      </div>
      <div className="ca-axis"><span>{dayLabel(rows[0].day)}</span><span>{dayLabel(rows[rows.length - 1].day)}</span></div>
    </Card>
  );
}

/** A breakdown: how many saw it and chose each way, with the acceptance rate as a meter. */
function Table({ title, hint, rows }: { title: string; hint?: string; rows: Part[] }) {
  return (
    <Card title={title} flush>
      {hint && <p className="ad-muted ca-note">{hint}</p>}
      {!rows.length ? <Empty title="Nothing counted in this period." /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th /><th className="ad-num">Saw it</th><th className="ad-num">Accepted</th><th className="ad-num">Essential</th><th>Acceptance</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}>
                <td className="ad-strong">{r.label}</td>
                <td className="ad-num">{fmt(r.shown)}</td>
                <td className="ad-num">{fmt(r.accept)}</td>
                <td className="ad-num">{fmt(r.essential)}</td>
                <td>
                  <div className="cc-meter" title={r.acceptRate === null ? 'Nobody chose yet' : `${r.acceptRate}% of ${r.decided} chose “Accept all”`}>
                    <span className="cc-meter__track"><span className="cc-meter__fill" style={{ width: `${r.acceptRate ?? 0}%` }} /></span>
                    <b>{rate(r.acceptRate)}</b>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Timing({ rows }: { rows: Data['timing'] }) {
  const max = Math.max(1, ...rows.map((r) => r.accept + r.essential));
  const total = rows.reduce((n, r) => n + r.accept + r.essential, 0);
  return (
    <Card title="How long they took to choose">
      {!total ? <p className="ad-muted">Nobody chose in this period.</p> : (
        <ul className="au-bars">
          {rows.map((r) => {
            const n = r.accept + r.essential;
            return (
              <li key={r.key}>
                <div className="au-bar" title={`${r.label}: ${n} chose (${r.accept} accepted, ${r.essential} essential)`}>
                  <span className="au-bar__label">{r.label}</span>
                  <span className="au-bar__track"><span className="au-bar__fill" style={{ width: n ? `${Math.max(2, (n / max) * 100)}%` : 0 }} /></span>
                  <span className="au-bar__value"><b>{n}</b> <small>{n ? `${Math.round((r.accept / n) * 100)}% accepted` : ''}</small></span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
