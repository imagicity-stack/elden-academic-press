import { useSearchParams } from 'react-router-dom';
import { config } from '../config';
import { HUB_KINDS, HUB_LEVELS, LVS, RES } from '../data';
import { useSite } from '../site';
import { ElmasterMark } from '../components/Brand';
import { Pill } from '../components/Field';
import { ResourceRow } from '../components/ResourceRow';

export function StudyHub() {
  const { openModal } = useSite();
  const [sp, setSp] = useSearchParams();
  const kindParam = sp.get('kind');
  const levelParam = sp.get('level');
  const kind = kindParam && HUB_KINDS.includes(kindParam) ? kindParam : 'All';
  const level = HUB_LEVELS.find((l) => l === levelParam) ?? 'All';

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v === 'All') next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
  };

  const rows = RES.filter((r) => (kind === 'All' || r.k === kind) && (level === 'All' || r.lv === level));

  return (
    <div>
      <section className="hub-hero">
        <div className="wrap hub-hero__inner">
          <div className="hub-hero__text">
            <div className="eyebrow eyebrow--11 eyebrow--gold">Study Hub</div>
            <h1 className="h1-hub">Free study material, updated every session.</h1>
            <p className="hub-hero__lede">Sample papers, revision notes, answer keys and worksheets for Classes 1–12 and competitive exams. No sign-up needed.</p>
          </div>
          {config.elmasterUrl ? (
            <a href={config.elmasterUrl} target="_blank" rel="noopener" className="hub-elm">
              <ElmasterMark className="hub-elm__mark" />
              <span className="hub-elm__text">Want video lessons and timed mock tests? Continue on elmaster ↗</span>
            </a>
          ) : (
            <div className="hub-elm">
              <ElmasterMark className="hub-elm__mark" />
              <span className="hub-elm__text">Want video lessons and timed mock tests? Find them on elmaster, our learning platform.</span>
            </div>
          )}
        </div>
      </section>
      <div className="wrap page-hub">
        <div className="stack-14">
          <div className="pills">
            {HUB_KINDS.map((k) => <Pill key={k} on={kind === k} onClick={() => set('kind', k)}>{k}</Pill>)}
          </div>
          <div className="levels">
            <span className="levels__label">Level</span>
            {HUB_LEVELS.map((l) => (
              <button key={l} type="button" aria-pressed={level === l} className={'level' + (level === l ? ' is-on' : '')} onClick={() => set('level', l)}>
                {l === 'All' ? 'All levels' : LVS[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="res-list">
          {rows.map((r) => <ResourceRow key={r.id} r={r} />)}
          {rows.length === 0 && <div className="res-empty">Nothing here yet for this combination — new material is added through the session.</div>}
        </div>
        <div className="teachers-corner">
          <div className="teachers-corner__text">
            <div className="h-card h-card--28">Teachers' corner</div>
            <div className="body body--145">Lesson plans, teacher's manuals and editable question banks for schools using Elden titles.</div>
          </div>
          <button type="button" className="btn btn--navy" onClick={() => openModal('teacher')}>Request teacher access</button>
        </div>
      </div>
    </div>
  );
}
