// Admin → Competitions → Analytics: how far visitors get with a competition's registration
// (the funnel), registrations per day, which channels bring visitors and registrations, and who
// registers. Shared by individual/group competitions and team competitions (DoomsDay Diaries).
import { useState } from 'react';
import { useAdmin } from '../api';
import { Card, Empty, ErrorBox, Loading } from '../ui';

interface Data {
  team: boolean;
  funnel: { key: string; label: string; hint: string; n: number; measured: 'site' | 'db' }[];
  daily: { day: string; visits: number; registrations: number }[];
  channels: { key: string; label: string; visits: number; registrations: number; conversion: number | null }[];
  totals: { registrations: number; people: number; visits: number; conversion: number | null };
  who: { label: string; n: number }[];
  states: { label: string; n: number }[];
  kinds: { label: string; n: number }[];
  measuredSince: string | null;
}

const PERIODS: [number, string][] = [[7, '7 days'], [30, '30 days'], [90, '90 days'], [3650, 'All time']];
const fmt = (n: number) => n.toLocaleString('en-IN');
const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const dayLabel = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function CompetitionAnalytics({ slug }: { slug: string }) {
  const [days, setDays] = useState(30);
  const { data, error, reload } = useAdmin<Data>(`/competitions/${slug}/analytics?days=${days}`);
  return (
    <div className="ad-stack">
      <div className="ad-row">
        <div className="au-seg" role="group" aria-label="Period">
          {PERIODS.map(([d, l]) => <button key={d} type="button" className={days === d ? 'is-on' : ''} onClick={() => setDays(d)}>{l}</button>)}
        </div>
        {data && <span className="ad-muted">Visits and form steps are counted anonymously by the website{data.measuredSince ? ` since ${dayLabel(data.measuredSince)}` : ' from now on'}; registrations come from the saved forms.</span>}
      </div>
      {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : (
        <>
          <div className="ad-stats">
            <div className="ad-stat"><span>Page visits</span><b>{fmt(data.totals.visits)}</b><small>browsers that opened the page</small></div>
            <div className="ad-stat"><span>{data.team ? 'Team applications' : 'Registrations'}</span><b>{fmt(data.totals.registrations)}</b><small>{fmt(data.totals.people)} {data.team ? 'team members' : 'people taking part'}</small></div>
            <div className="ad-stat"><span>Visit to registration</span><b>{data.totals.conversion === null ? '—' : `${data.totals.conversion}%`}</b><small>of visitors registered</small></div>
            <div className="ad-stat"><span>Started the form</span><b>{fmt(data.funnel.find((f) => f.key === 'start')?.n ?? 0)}</b>
              <small>{(() => { const s = data.funnel.find((f) => f.key === 'start')?.n ?? 0; return s ? `${pct(data.totals.registrations, s)}% of them finished` : 'nobody yet'; })()}</small></div>
          </div>
          <Funnel steps={data.funnel} />
          <Daily rows={data.daily} team={data.team} />
          <div className="ad-grid-2">
            <Channels rows={data.channels} />
            <div className="ad-stack">
              <BarList title="Who registers" hint="From the registering account's profile." rows={data.who} />
              <BarList title={data.team ? 'Age groups' : 'Individuals and groups'} rows={data.kinds} />
              <BarList title="States" rows={data.states} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Each step as a bar against the first step, with how many dropped off on the way. */
function Funnel({ steps }: { steps: Data['funnel'] }) {
  const top = Math.max(1, ...steps.map((s) => s.n));
  const first = steps[0]?.n ?? 0;
  return (
    <Card title="Registration funnel">
      <ol className="ca-funnel">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].n : null;
          const drop = prev && prev > s.n ? Math.round(((prev - s.n) / prev) * 100) : 0;
          return (
            <li key={s.key} className="ca-step" title={s.hint}>
              <div className="ca-step__label">
                <b>{s.label}</b>
                <small>{s.measured === 'db' ? 'saved forms' : 'counted on the website'}</small>
              </div>
              <div className="ca-step__bar"><span style={{ width: s.n ? `${Math.max(1.5, (s.n / top) * 100)}%` : 0 }} /></div>
              <div className="ca-step__value">
                <b>{fmt(s.n)}</b>
                <small>{i === 0 ? 'of visitors' : first ? `${pct(s.n, first)}% of visitors` : ''}</small>
                {drop > 0 && <small className="ca-drop">−{drop}% from the step before</small>}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Visits and registrations per day: two small charts on the same days (two scales, never one shared axis). */
function Daily({ rows, team }: { rows: Data['daily']; team: boolean }) {
  if (!rows.length) return null;
  return (
    <Card title="Per day">
      <MiniBars rows={rows} k="visits" label="Page visits" />
      <MiniBars rows={rows} k="registrations" label={team ? 'Team applications' : 'Registrations'} />
      <div className="ca-axis"><span>{dayLabel(rows[0].day)}</span><span>{dayLabel(rows[rows.length - 1].day)}</span></div>
    </Card>
  );
}

function MiniBars({ rows, k, label }: { rows: Data['daily']; k: 'visits' | 'registrations'; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r[k]));
  const total = rows.reduce((n, r) => n + r[k], 0);
  return (
    <div className="ca-mini">
      <div className="ca-mini__head"><b>{label}</b><span className="ad-muted">{fmt(total)} in total · busiest day {fmt(max === 1 && !total ? 0 : max)}</span></div>
      <div className="ca-mini__bars" role="img" aria-label={`${label} per day`}>
        {rows.map((r) => (
          <span key={r.day} className="ca-mini__col" title={`${dayLabel(r.day)}: ${fmt(r[k])}`}>
            <span className="ca-mini__bar" style={{ height: `${r[k] ? Math.max(4, (r[k] / max) * 100) : 0}%` }} />
          </span>
        ))}
      </div>
    </div>
  );
}

/** Which channels bring visitors and registrations, with each channel's conversion. */
function Channels({ rows }: { rows: Data['channels'] }) {
  return (
    <Card title="Where they came from" flush>
      {!rows.length ? <Empty title="No visits or registrations in this period." /> : (
        <div className="ad-table-wrap">
          <table className="ad-table">
            <thead><tr><th>Channel</th><th className="ad-num">Visits</th><th className="ad-num">Registrations</th><th className="ad-num">Conversion</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}>
                <td className="ad-strong">{r.label}</td>
                <td className="ad-num">{fmt(r.visits)}</td>
                <td className="ad-num">{fmt(r.registrations)}</td>
                <td className="ad-num">{r.conversion === null ? <span className="ad-muted">—</span> : `${r.conversion}%`}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="ad-muted ca-note">Visits use the channel of the visit; registrations use where the registering account first came from, so a few can differ.</p>
        </div>
      )}
    </Card>
  );
}

function BarList({ title, hint, rows }: { title: string; hint?: string; rows: { label: string; n: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((n, r) => n + r.n, 0);
  return (
    <Card title={title}>
      {hint && <p className="ad-muted au-hint">{hint}</p>}
      {!rows.length ? <p className="ad-muted">No registrations in this period.</p> : (
        <ul className="au-bars">
          {rows.map((r) => (
            <li key={r.label}>
              <div className="au-bar" title={`${r.label}: ${r.n} (${pct(r.n, total)}%)`}>
                <span className="au-bar__label">{r.label}</span>
                <span className="au-bar__track"><span className="au-bar__fill" style={{ width: `${Math.max(2, (r.n / max) * 100)}%` }} /></span>
                <span className="au-bar__value"><b>{r.n}</b> <small>{pct(r.n, total)}%</small></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
