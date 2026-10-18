import { LVS, type Resource } from '../data';
import { useSite } from '../site';

/** Study Hub download row. `compact` is the home-page preview layout. */
export function ResourceRow({ r, compact = false }: { r: Resource; compact?: boolean }) {
  const { downloaded, markDownloaded } = useSite();
  const done = downloaded.has(r.id);
  // TODO: link to the real PDF once files are hosted.
  const button = (
    <button type="button" className={'btn-dl' + (done ? ' is-done' : '') + (compact ? ' btn-dl--sm' : '')} onClick={() => markDownloaded(r.id)}>
      {done ? 'Downloaded ✓' : 'Download PDF'}
    </button>
  );
  if (compact) {
    return (
      <div className="res-row res-row--compact">
        <div className="res-row__body">
          <div className="res-row__title res-row__title--sm">{r.t}</div>
          <div className="res-row__meta">{r.k} · {LVS[r.lv]} · PDF {r.size}</div>
        </div>
        {button}
      </div>
    );
  }
  return (
    <div className="res-row">
      <div className="res-row__kind">{r.k}</div>
      <div className="res-row__body res-row__body--wide">
        <div className="res-row__title">{r.t}</div>
        <div className="res-row__meta">{LVS[r.lv]} · {r.su} · PDF {r.size}</div>
      </div>
      {button}
    </div>
  );
}
