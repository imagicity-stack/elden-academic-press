import { LVS } from '../data';
import { useSite } from '../site';
import type { Resource } from '../store/types';

const size = (bytes: number | null) => (bytes ? `PDF ${(bytes / 1024 / 1024).toFixed(1)} MB` : 'PDF');

/** Study Hub download row. `compact` is the home-page preview layout. */
export function ResourceRow({ r, compact = false }: { r: Resource; compact?: boolean }) {
  const { downloaded, markDownloaded } = useSite();
  const done = downloaded.has(r.id);
  const button = r.url ? (
    <a href={r.url} target="_blank" rel="noopener" className={'btn-dl' + (done ? ' is-done' : '') + (compact ? ' btn-dl--sm' : '')} onClick={() => markDownloaded(r.id)}>
      {done ? 'Downloaded ✓' : 'Download PDF'}
    </a>
  ) : null;
  if (compact) {
    return (
      <div className="res-row res-row--compact">
        <div className="res-row__body">
          <div className="res-row__title res-row__title--sm">{r.title}</div>
          <div className="res-row__meta">{r.kind} · {LVS[r.level]} · {size(r.size)}</div>
        </div>
        {button}
      </div>
    );
  }
  return (
    <div className="res-row">
      <div className="res-row__kind">{r.kind}</div>
      <div className="res-row__body res-row__body--wide">
        <div className="res-row__title">{r.title}</div>
        <div className="res-row__meta">{[LVS[r.level], r.subject, size(r.size)].filter(Boolean).join(' · ')}</div>
      </div>
      {button}
    </div>
  );
}
