'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { mmss } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Icon, RoundButton, display, font, outlineBtn, primaryBtn, useBack } from '@/components/ui';

const LIMIT = 600;

export default function Quiz() {
  const router = useRouter();
  const back = useBack('/');
  const { catalog, recordAttempt } = useStore();
  const QUIZ = catalog.quiz;
  const n = QUIZ.length;
  const [qi, setQi] = useState(0);
  const [ans, setAns] = useState<Record<number, number>>({});
  const [left, setLeft] = useState(LIMIT);
  const [done, setDone] = useState(false);

  const score = QUIZ.filter((x, i) => ans[i] === x.a).length;
  const xp = 10 + score * 6;

  const finish = () => {
    if (done) return;
    setDone(true);
    recordAttempt({ score, total: n, timeTaken: LIMIT - left, xp, answers: ans });
  };

  useEffect(() => {
    if (done) return;
    if (left <= 0) return finish();
    const t = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, done]);

  const retry = () => {
    setQi(0);
    setAns({});
    setLeft(LIMIT);
    setDone(false);
  };

  const q = QUIZ[qi];
  if (!q) return null;
  const offset = 452.4 * (1 - score / n);

  return (
    <main className="scr-in" style={{ padding: 'var(--top) 20px calc(30px + var(--safe-b))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <RoundButton icon="close" label="Close test" onClick={back} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Daily mock · Number Theory</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Level 1 · +40 XP</div>
        </div>
        <div aria-label="Time left" style={{ height: 38, padding: '0 14px', borderRadius: 19, background: left < 60 ? '#E5484D' : '#0A1F4D', color: '#F4F5FA', display: 'flex', alignItems: 'center', gap: 6, font: font(800, 14), fontVariantNumeric: 'tabular-nums', transition: 'background .3s' }}>
          <Icon name="timer" size={18} />
          {mmss(left)}
        </div>
      </div>

      {!done ? (
        <>
          <div style={{ display: 'flex', gap: 6, marginTop: 22 }}>
            {QUIZ.map((_, i) => (
              <button key={i} aria-label={`Question ${i + 1}`} onClick={() => setQi(i)} style={{ flex: 1, height: 6, borderRadius: 3, border: 'none', padding: 0, background: i === qi ? '#0A1F4D' : ans[i] !== undefined ? '#3DD6CF' : '#E1E4EE', cursor: 'pointer', transition: 'background .3s' }} />
            ))}
          </div>
          <div key={qi} style={{ animation: 'scrIn .35s both' }}>
            <div style={{ font: font(800, 11), letterSpacing: '.12em', color: '#0172EA', marginTop: 24 }}>
              QUESTION {qi + 1} OF {n}
            </div>
            <h1 style={{ ...display(700, 24, 1.15), margin: '10px 0 0', textWrap: 'pretty' }}>{q.q}</h1>
            <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
              {q.o.map((o, i) => {
                const sel = ans[qi] === i;
                return (
                  <button key={i} role="radio" aria-checked={sel} onClick={() => setAns({ ...ans, [qi]: i })} className="press press-98" style={{ height: 60, borderRadius: 18, border: `1.5px solid ${sel ? '#0A1F4D' : 'transparent'}`, background: sel ? '#0A1F4D' : '#fff', color: sel ? '#F4F5FA' : '#0A1F4D', display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', font: font(700, 16), cursor: 'pointer', textAlign: 'left', transition: 'all .2s' }}>
                    <span style={{ width: 34, height: 34, borderRadius: 11, background: sel ? '#3DD6CF' : 'var(--tint)', color: sel ? '#0A1F4D' : '#0B4FB3', display: 'grid', placeItems: 'center', font: font(800, 13), transition: 'all .2s' }}>{'ABCD'[i]}</span>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 28 }}>
            <button aria-label="Previous question" onClick={() => setQi(Math.max(0, qi - 1))} style={{ width: 58, height: 58, borderRadius: 29, border: 'none', background: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: qi === 0 ? 0.4 : 1 }}>
              <Icon name="arrow_back" size={22} />
            </button>
            <button onClick={() => (qi < n - 1 ? setQi(qi + 1) : finish())} style={{ ...primaryBtn(58), flex: 1 }}>
              {qi < n - 1 ? 'Next question' : 'Submit test'}
            </button>
          </div>
        </>
      ) : (
        <div style={{ animation: 'scrIn .45s both', textAlign: 'center', marginTop: 24 }}>
          <div style={{ position: 'relative', width: 170, height: 170, margin: '0 auto' }}>
            <svg width="170" height="170" viewBox="0 0 170 170" style={{ transform: 'rotate(-90deg)' }}>
              <circle cx="85" cy="85" r="72" fill="none" stroke="#E6F0FF" strokeWidth="14" />
              <circle cx="85" cy="85" r="72" fill="none" stroke="#0172EA" strokeWidth="14" strokeLinecap="round" strokeDasharray="452.4" strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 1.2s var(--ease)' }} />
            </svg>
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <div>
                <div style={display(700, 44, 1.05)}>
                  {score}/{n}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>correct</div>
              </div>
            </div>
          </div>
          <h1 style={{ ...display(700, 25, 1.1), margin: '18px 0 0' }}>{score >= 0.8 * n ? 'Olympiad-ready.' : score >= 0.4 * n ? 'Solid — keep going.' : 'A good start.'}</h1>
          <div style={{ fontSize: 13.5, color: 'var(--muted)', marginTop: 6 }}>{score >= 0.8 * n ? 'Top 8% of students this week' : 'Review the solutions and try again'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 20 }}>
            {[[mmss(LIMIT - left), 'time'], [`${Math.round((score / n) * 100)}%`, 'accuracy'], [`+${xp}`, 'XP']].map(([v, l]) => (
              <div key={l} style={{ background: '#fff', borderRadius: 16, padding: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{v}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, textAlign: 'left' }}>
            {QUIZ.map((x, i) => {
              const ok = ans[i] === x.a;
              return (
                <div key={i} style={{ background: '#fff', borderRadius: 16, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ width: 28, height: 28, flex: 'none', borderRadius: '50%', background: ok ? '#12A150' : '#E5484D', color: '#fff', display: 'grid', placeItems: 'center' }}>
                    <Icon name={ok ? 'check' : 'close'} size={17} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.q}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>Answer: {x.o[x.a]}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
            <button onClick={() => router.push('/olympiads?tab=Ranks')} style={{ ...outlineBtn(54), flex: 1 }}>Leaderboard</button>
            <button onClick={retry} style={{ ...primaryBtn(54, 14), flex: 1 }}>Retry</button>
          </div>
        </div>
      )}
    </main>
  );
}
