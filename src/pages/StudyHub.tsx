import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { config } from '../config';
import { HUB_LEVELS, LVS } from '../data';
import { useResources } from '../store/catalog';
import { useSite } from '../site';
import { ElmasterMark } from '../components/Brand';
import { ResourceRow } from '../components/ResourceRow';
import { Arrow, CountUp, EASE, Highlight, Reveal, SplitWords } from '../components/motion';

export function StudyHub() {
  const { openModal } = useSite();
  const [sp, setSp] = useSearchParams();
  const { items, status } = useResources();
  const HUB_KINDS = ['All', ...new Set(items.map((r) => r.kind))];
  const kindParam = sp.get('kind');
  const levelParam = sp.get('level');
  const kind = kindParam && HUB_KINDS.includes(kindParam) ? kindParam : 'All';
  const level = HUB_LEVELS.find((l) => l === levelParam) ?? 'All';

  useEffect(() => { document.title = 'Study Hub — Elden Academic Press'; }, []);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v === 'All') next.delete(k); else next.set(k, v);
    setSp(next, { replace: true });
  };

  const rows = items.filter((r) => (kind === 'All' || r.kind === kind) && (level === 'All' || r.level === level));

  return (
    <div className="hub">
      <section className="hub__hero">
        <div className="wrap hub__hero-inner">
          <div className="hub__hero-text">
            <div className="t-label">Study Hub · free · no sign-up</div>
            <h1 className="t-h1"><SplitWords text="Free study material," /> <span className="serif-i">every session.</span></h1>
            <Reveal delay={0.3}><p className="t-lead">Sample papers, revision notes, answer keys and worksheets for Classes 1–12 and competitive exams.</p></Reveal>
          </div>
          <Reveal delay={0.2} className="hub__count">
            <b><CountUp to={items.length} /></b>
            <span>files to <Highlight delay={0.8}>download</Highlight></span>
          </Reveal>
        </div>
      </section>

      <div className="wrap hub__body">
        <div className="hub__filters">
          <div className="pills" role="group" aria-label="Kind">
            {HUB_KINDS.map((k) => <Tab key={k} group="hub-kind" on={kind === k} onClick={() => set('kind', k)}>{k}</Tab>)}
          </div>
          <div className="levels" role="group" aria-label="Level">
            <span className="levels__label">Level</span>
            {HUB_LEVELS.map((l) => (
              <button key={l} type="button" aria-pressed={level === l} className={'level' + (level === l ? ' is-on' : '')} onClick={() => set('level', l)}>
                {l === 'All' ? 'All levels' : LVS[l]}
              </button>
            ))}
          </div>
        </div>

        <div className="res-list">
          <AnimatePresence mode="popLayout" initial={false}>
            {rows.map((r, i) => (
              <motion.div key={r.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE, delay: Math.min(i, 10) * 0.03 } }} exit={{ opacity: 0, x: -20 }}>
                <ResourceRow r={r} />
              </motion.div>
            ))}
          </AnimatePresence>
          {status === 'loading' && <div className="res-empty">Loading…</div>}
          {status === 'error' && <div className="res-empty">We couldn’t load the Study Hub. Please refresh the page.</div>}
          {status === 'ready' && rows.length === 0 && <div className="res-empty">Nothing here yet for this combination. New material is added through the session.</div>}
        </div>

        <div className="hub__more">
          <Reveal className="hub__card hub__card--ink">
            <div className="t-label">Teachers’ corner</div>
            <h2 className="hub__card-title">Lesson plans, manuals and editable question banks.</h2>
            <p>For schools using Elden titles.</p>
            <button type="button" className="btn btn--yellow btn--lg" onClick={() => openModal('teacher')}>Request teacher access <Arrow /></button>
          </Reveal>
          <Reveal className="hub__card hub__card--elm" delay={0.1}>
            <ElmasterMark className="hub__elm-mark" />
            <h2 className="hub__card-title">Video lessons and timed mock tests.</h2>
            <p>{config.elmasterUrl ? 'Continue on elmaster, our learning platform.' : 'On elmaster, our learning platform.'}</p>
            {config.elmasterUrl && <a href={config.elmasterUrl} target="_blank" rel="noopener" className="btn btn--ink btn--lg">Go to elmaster <Arrow /></a>}
          </Reveal>
        </div>
      </div>
    </div>
  );
}

function Tab({ on, onClick, children, group }: { on: boolean; onClick: () => void; children: string; group: string }) {
  return (
    <button type="button" aria-pressed={on} className={'pill' + (on ? ' is-on' : '')} onClick={onClick}>
      {on && <motion.span layoutId={group} className="pill__bg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
      {children}
    </button>
  );
}
