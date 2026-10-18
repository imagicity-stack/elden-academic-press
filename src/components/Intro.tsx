import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { config } from '../config';
import './intro.css';

/*
 * Opening animation: a closed book opens, its pages riffle across, three pages
 * stop mid-turn and turn bronze, then every shape morphs into the exact Elden
 * mark. The intro screen itself then turns away like a page.
 *
 * Everything is drawn as SVG polygons recomputed each frame: pages are
 * projected from a simple 3D model (rotating about the spine), and each page
 * shares its outline sampling with one shape of the logo so it can morph into it.
 */

type Pt = [number, number];

// Book model, in SVG units. Spine at x = S; pages are W wide, from TY to BY.
const S = 459, W = 620, TY = 370, BY = 1230, CX = 459, CY = 800, D = 2600;
const K = 18; // outline samples per edge

const proj = (u: number, y: number, phi: number): Pt => {
  const x = S + u * Math.cos(phi), z = u * Math.sin(phi), k = D / (D - z);
  return [CX + (x - CX) * k, CY + (y - CY) * k];
};
// Corner order matches the logo shapes' edge order below.
const pageCorners = (phi: number): Pt[] => [proj(0, TY, phi), proj(W, TY, phi), proj(W, BY, phi), proj(0, BY, phi)];
const coverCorners = (phi: number): Pt[] => [proj(W, TY, phi), proj(0, TY, phi), proj(0, BY, phi), proj(W, BY, phi)];

// The mark, traced from assets/elden-mark.png (1211 × 1596 px). Each shape is
// four edges; curves are pre-sampled into polylines.
const bez = (a: Pt, c: Pt, b: Pt, n = 24): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, m = 1 - t;
    return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]] as Pt;
  });
const MARK: Record<'cover' | 'bar1' | 'bar2' | 'bar3', Pt[][]> = {
  cover: [bez([14, 0], [250, 70], [459, 421]), [[459, 421], [459, 1596]], bez([459, 1596], [230, 1370], [14, 1234]), [[14, 1234], [14, 0]]],
  bar1: [[[562, 642], [730, 445]], [[730, 445], [730, 1270]], [[730, 1270], [564, 1596]], [[564, 1596], [562, 642]]],
  bar2: [[[839, 757], [956, 621]], [[956, 621], [956, 1300]], [[956, 1300], [616, 1596]], [[616, 1596], [839, 1268], [839, 757]]],
  bar3: [[[1066, 871], [1183, 740]], [[1183, 740], [1183, 1341]], [[1183, 1341], [670, 1596]], [[670, 1596], [1066, 1307], [1066, 871]]],
};
// Final size and position of the mark inside the stage.
const MARK_SCALE = 0.8, MARK_CX = 598.5, MARK_CY = 798, END_X = 460, END_Y = 750;

/** K points evenly spaced along a polyline (end point excluded). */
function sample(pts: Pt[]): Pt[] {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out: Pt[] = [];
  for (let j = 0, s = 0, d0 = 0; j < K; j++) {
    const d = (total * j) / K;
    while (s < seg.length - 1 && d0 + seg[s] < d) d0 += seg[s++];
    const t = seg[s] ? (d - d0) / seg[s] : 0;
    out.push([pts[s][0] + (pts[s + 1][0] - pts[s][0]) * t, pts[s][1] + (pts[s + 1][1] - pts[s][1]) * t]);
  }
  return out;
}
const outline = (corners: Pt[]) => corners.flatMap((c, i) => sample([c, corners[(i + 1) % 4]]));
const markOutline = (edges: Pt[][]) =>
  edges.flatMap(sample).map(([x, y]): Pt => [END_X + (x - MARK_CX) * MARK_SCALE, END_Y + (y - MARK_CY) * MARK_SCALE]);
const FINAL = { cover: markOutline(MARK.cover), bar1: markOutline(MARK.bar1), bar2: markOutline(MARK.bar2), bar3: markOutline(MARK.bar3) };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: Pt[], b: Pt[], t: number) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)] as Pt);
const toPoints = (pts: Pt[]) => pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const mixColour = (a: string, b: string, t: number) => 'rgb(' + rgb(a).map((v, i) => Math.round(lerp(v, rgb(b)[i], t))).join(',') + ')';
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const prog = (t: number, start: number, dur: number) => clamp01((t - start) / dur);
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out3 = (x: number) => 1 - Math.pow(1 - x, 3);

const PAPER = '#FFFDF8', PAPER_BACK = '#EFE6D6', NAVY = '#0E1F33', NAVY_INSIDE = '#18324E';
const RIFFLE = 5;
const LIFT = [
  { key: 'bar1', angle: 68, colour: '#6B3A0A' },
  { key: 'bar2', angle: 44, colour: '#9C6A2F' },
  { key: 'bar3', angle: 21, colour: '#CC955F' },
] as const;

// Timeline (ms)
const T_COVER = 700, T_RIFFLE = 1300, T_LIFT = 2050, T_TINT = 2300, T_MORPH = 2950, T_WORD = 3550, T_LEAVE = 5000, LEAVE_MS = 1000;

// Lines of "text" printed on each page's front, as distances down the page.
const TEXT_LINES = Array.from({ length: 11 }, (_, i) => TY + 115 + i * 62);
const textPath = (phi: number) =>
  TEXT_LINES.map((y, i) => {
    const a = proj(70, y, phi), b = proj(i === TEXT_LINES.length - 1 ? 70 + (W - 140) * 0.55 : W - 70, y, phi);
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }).join('');

export function Intro({ onLeaving, onDone }: { onLeaving: () => void; onDone: () => void }) {
  const els = useRef<Record<string, SVGPolygonElement | null>>({});
  const text = useRef<Record<string, SVGPathElement | null>>({});
  const decor = useRef<Record<string, SVGElement | null>>({});
  const [phase, setPhase] = useState<'play' | 'word' | 'leave'>('play');
  const left = useRef(false);

  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    setPhase('leave');
    onLeaving();
    window.setTimeout(onDone, LEAVE_MS);
  }, [onLeaving, onDone]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const set = (key: string, pts: Pt[], fill: string, opacity = 1, strokeOpacity = 0) => {
      const el = els.current[key];
      if (!el) return;
      el.setAttribute('points', toPoints(pts));
      el.setAttribute('fill', fill);
      el.setAttribute('opacity', opacity.toFixed(3));
      el.setAttribute('stroke-opacity', strokeOpacity.toFixed(3));
    };
    // Text lines only show on a page's front face
    const setText = (key: string, phi: number, opacity: number) => {
      const el = text.current[key];
      if (!el) return;
      const o = phi < Math.PI / 2 ? opacity : 0;
      el.setAttribute('opacity', o.toFixed(3));
      if (o > 0) el.setAttribute('d', textPath(phi));
    };

    const frame = (now: number) => {
      const t = now - start;
      const m = inOut(prog(t, T_MORPH, 950)); // morph into the mark
      const blockFade = 1 - prog(t, T_TINT + 150, 500);

      // Page block lying open on the right, with lines of "text"
      set('block', outline(pageCorners(0)), PAPER, blockFade, 1);
      setText('block', 0, blockFade);

      // Cover swings open to the left, then becomes the navy page of the mark
      const cPhi = Math.PI * inOut(prog(t, T_COVER, 950));
      const coverFill = cPhi > Math.PI / 2 ? mixColour(NAVY_INSIDE, NAVY, m) : NAVY;
      set('cover', mix(outline(coverCorners(cPhi)), FINAL.cover, m), coverFill);
      decor.current.coverArt?.setAttribute('opacity', (1 - prog(t, T_COVER, 220)).toFixed(3));

      // Riffling pages settle on the left, darken to navy with the cover and
      // morph into the mark's navy page along with it
      const leftTint = inOut(prog(t, T_TINT + 100, 550));
      for (let i = 0; i < RIFFLE; i++) {
        const p = prog(t, T_RIFFLE + i * 120, 700);
        const phi = Math.PI * inOut(p);
        const landed = phi > Math.PI / 2;
        const op = p > 0 ? 1 : 0;
        const fill = landed ? mixColour(PAPER_BACK, NAVY, leftTint) : PAPER;
        set('r' + i, mix(outline(coverCorners(phi)), FINAL.cover, m), fill, op, landed ? 1 - leftTint : 1);
        setText('r' + i, phi, op);
      }

      // Three pages stop mid-turn, turn bronze, and become the mark's bars
      LIFT.forEach((l, j) => {
        const p = out3(prog(t, T_LIFT + j * 110, 850));
        const phi = (l.angle * Math.PI * p) / 180;
        const tint = inOut(prog(t, T_TINT + j * 80, 800));
        set(l.key, mix(outline(pageCorners(phi)), FINAL[l.key], m), mixColour(PAPER, l.colour, tint), 1, 1 - m);
        setText(l.key, phi, 1 - prog(t, T_TINT - 100, 400));
      });

      decor.current.shadow?.setAttribute('flood-opacity', (0.2 * (1 - m)).toFixed(3));

      if (t < T_MORPH + 1000) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const word = window.setTimeout(() => setPhase((ph) => (ph === 'play' ? 'word' : ph)), T_WORD);
    const exit = window.setTimeout(leave, T_LEAVE);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(word); window.clearTimeout(exit); };
  }, [leave]);

  useEffect(() => {
    const onKey = () => leave();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [leave]);

  const poly = (key: string, stroke = true) => (
    <polygon ref={(el) => { els.current[key] = el; }} stroke={stroke ? '#D6CBB8' : 'none'} strokeWidth={2.5} strokeLinejoin="round" opacity={0} />
  );
  const page = (key: string) => (
    <Fragment key={key}>
      {poly(key)}
      <path ref={(el) => { text.current[key] = el; }} className="intro__text" opacity={0} />
    </Fragment>
  );

  return (
    <div className={'intro' + (phase !== 'play' ? ' is-word' : '') + (phase === 'leave' ? ' is-leaving' : '')} onClick={leave} role="presentation">
      <div className="intro__stage">
        <svg viewBox="-200 80 1320 1340" className="intro__svg" aria-hidden="true">
          <defs>
            <filter id="intro-shadow" x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow ref={(el) => { decor.current.shadow = el; }} dx="0" dy="14" stdDeviation="18" floodColor="#0E1F33" floodOpacity="0.2" />
            </filter>
          </defs>
          <g filter="url(#intro-shadow)">
            {page('block')}
            {page('bar3')}
            {page('bar2')}
            {page('bar1')}
            {poly('cover', false)}
            <g ref={(el) => { decor.current.coverArt = el; }} className="intro__cover-art">
              <g transform={`translate(${S + W / 2 - 34} ${CY - 120})`}>
                <rect x="0" y="0" width="16" height="70" fill="#CC955F" />
                <rect x="26" y="15" width="16" height="55" fill="#CC955F" opacity=".7" />
                <rect x="52" y="28" width="16" height="42" fill="#CC955F" opacity=".45" />
              </g>
              <text x={S + W / 2} y={CY + 40} className="intro__cover-title">ELDEN</text>
              <text x={S + W / 2} y={CY + 92} className="intro__cover-sub">ACADEMIC PRESS</text>
            </g>
            {Array.from({ length: RIFFLE }, (_, i) => page('r' + i))}
          </g>
        </svg>
        <div className="intro__word" aria-hidden="true">
          <div className="intro__name">{'ELDEN'.split('').map((c, i) => <span key={i} style={{ '--i': i } as CSSProperties}>{c}</span>)}</div>
          <div className="intro__sub">ACADEMIC PRESS</div>
          <div className="intro__url">{config.siteUrl.replace(/^https?:\/\//, '')}</div>
        </div>
      </div>
      <button type="button" className="intro__skip" onClick={(e) => { e.stopPropagation(); leave(); }}>Skip intro</button>
    </div>
  );
}

const SEEN_KEY = 'elden-intro-seen';

function shouldPlay() {
  if (!config.showIntro) return false;
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    return sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
}

/**
 * Plays the intro over the page once per browser session. While it plays,
 * <html data-intro="playing"> lets page animations wait their turn.
 */
export function WithIntro({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(shouldPlay);

  useLayoutEffect(() => {
    document.documentElement.dataset.intro = show ? 'playing' : 'done';
  }, [show]);

  const onLeaving = useCallback(() => {
    document.documentElement.dataset.intro = 'done';
    try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable */ }
  }, []);
  const onDone = useCallback(() => setShow(false), []);

  return (
    <>
      {children}
      {show && <Intro onLeaving={onLeaving} onDone={onDone} />}
    </>
  );
}
