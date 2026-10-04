'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { FEATURED_EXAM, LEADERBOARD, MEDALS, MOCKS, MY_RANK, PAPERS } from '@/lib/seed';
import { initialsOf } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Chip, Icon, display, font } from '@/components/ui';

const TABS = [['Exams', 'event'], ['Mocks', 'timer'], ['Ranks', 'leaderboard'], ['Papers', 'description'], ['Medals', 'military_tech']] as const;
type Tab = (typeof TABS)[number][0];

const MEDAL_STYLE = {
  gold: { bg: 'linear-gradient(145deg,#F3D58A,#B8862E)', fg: '#5A3A0A', ring: '#B8862E' },
  silver: { bg: 'linear-gradient(145deg,#EEF0F2,#9EA3A8)', fg: '#3D4247', ring: '#9EA3A8' },
  bronze: { bg: 'linear-gradient(145deg,#E7AE7E,#8A4E1F)', fg: '#4A2208', ring: '#8A4E1F' },
  merit: { bg: '#0A1F4D', fg: '#3DD6CF', ring: '' },
  lock: { bg: '#E1E4EE', fg: '#959BAD', ring: '' },
};

export default function OlympiadsPage() {
  return (
    <Suspense>
      <Olympiads />
    </Suspense>
  );
}

function useCountdown(to: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const left = Math.max(0, Math.floor((new Date(to).getTime() - now) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return [
    [String(Math.floor(left / 86400)), 'DAYS'],
    [p(Math.floor((left % 86400) / 3600)), 'HRS'],
    [p(Math.floor((left % 3600) / 60)), 'MIN'],
    [p(left % 60), 'SEC'],
  ];
}

function Olympiads() {
  const router = useRouter();
  const params = useSearchParams();
  const { s, catalog, toggleReg, showToast } = useStore();
  const [tab, setTab] = useState<Tab>((TABS.find(([t]) => t === params.get('tab'))?.[0] as Tab) ?? 'Exams');
  const countdown = useCountdown(FEATURED_EXAM.startsAt);
  const featured = catalog.exams.find((e) => e.id === FEATURED_EXAM.id);
  const featuredReg = s.reg.includes(FEATURED_EXAM.id);
  const dateLabel = new Date(FEATURED_EXAM.startsAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).replace(/,/g, '').toUpperCase();

  const podium = [LEADERBOARD[1], LEADERBOARD[0], LEADERBOARD[2]];
  const podiumStyle = [
    { sz: 50, h: 70, m: MEDAL_STYLE.silver, bar: '#123A80' },
    { sz: 60, h: 100, m: MEDAL_STYLE.gold, bar: '#0A1F4D' },
    { sz: 46, h: 54, m: MEDAL_STYLE.bronze, bar: '#1B4A9C' },
  ];
  const myName = s.profile.name || 'You';
  const ranks = [...LEADERBOARD.slice(3).map((r) => ({ ...r, me: false })), { r: MY_RANK.r, i: initialsOf(myName), n: `${myName} (you)`, s: MY_RANK.s, me: true }];

  return (
    <div className="scr-in" style={{ padding: 'var(--top) 20px 0' }}>
      <h1 style={{ ...display(700, 32, 1.05), margin: 0 }}>Olympiads</h1>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Prepare, compete and climb the national ranks.</div>

      {featured && (
        <div style={{ marginTop: 18, background: '#0A1F4D', borderRadius: 26, padding: 20, color: '#F4F5FA', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', width: 280, height: 280, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.6),transparent 65%)', right: -100, top: -90 }} />
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ font: font(800, 10), letterSpacing: '.16em', color: '#3DD6CF' }}>FEATURED · {dateLabel}</div>
              <div style={{ ...display(700, 22, 1.05), marginTop: 8, maxWidth: 220 }}>
                {featured.name} {new Date(featured.date).getFullYear()}
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/elmaster-mark-light.png" alt="" style={{ height: 50 }} />
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 16, position: 'relative' }}>
            {countdown.map(([v, l]) => (
              <div key={l} style={{ flex: 1, background: 'rgba(244,245,250,.08)', border: '1px solid rgba(244,245,250,.1)', borderRadius: 14, padding: '10px 0', textAlign: 'center' }}>
                <div style={{ ...display(700, 22, 1.05), fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                <div style={{ font: font(700, 9.5), letterSpacing: '.1em', color: 'rgba(244,245,250,.6)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
          <button onClick={() => toggleReg(FEATURED_EXAM.id)} style={{ width: '100%', height: 50, borderRadius: 25, border: 'none', background: featuredReg ? 'rgba(244,245,250,.1)' : '#3DD6CF', color: featuredReg ? '#F4F5FA' : '#0A1F4D', font: font(800, 14), marginTop: 14, cursor: 'pointer', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, transition: 'all .25s' }}>
            <Icon name={featuredReg ? 'verified' : 'how_to_reg'} size={19} />
            {featuredReg ? 'Registered · View admit card' : 'Register now'}
          </button>
        </div>
      )}

      <div className="noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '18px -20px 0', padding: '0 20px' }}>
        {TABS.map(([l, icon]) => (
          <Chip key={l} active={l === tab} onClick={() => setTab(l)} outlined={false} height={40} padding="0 16px">
            <Icon name={icon} size={17} />
            {l}
          </Chip>
        ))}
      </div>

      {tab === 'Exams' && (
        <div className="fade-in" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {catalog.exams.map((e) => {
            const r = s.reg.includes(e.id);
            const d = new Date(e.date + 'T00:00:00');
            return (
              <div key={e.id} style={{ background: '#fff', borderRadius: 20, padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 54, height: 58, flex: 'none', borderRadius: 14, background: 'var(--tint)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ font: font(800, 10), letterSpacing: '.1em', color: '#0172EA' }}>{d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase()}</div>
                  <div style={display(700, 22, 1.05)}>{String(d.getDate()).padStart(2, '0')}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.25 }}>{e.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{e.meta}</div>
                </div>
                <button onClick={() => toggleReg(e.id)} style={{ height: 34, padding: '0 12px', borderRadius: 17, border: `1.5px solid ${r ? '#E2F6EA' : '#0A1F4D'}`, background: r ? '#E2F6EA' : '#0A1F4D', color: r ? '#0F7A3D' : '#F4F5FA', font: font(800, 11.5), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: 'all .25s', flex: 'none' }}>
                  <Icon name={r ? 'check' : 'add'} size={15} />
                  {r ? 'Registered' : 'Register'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'Mocks' && (
        <div className="fade-in" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MOCKS.map((m) => (
            <div key={m.t} onClick={() => router.push('/quiz')} style={{ background: '#fff', borderRadius: 20, padding: 14, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <div style={{ width: 46, height: 46, borderRadius: 15, background: '#0A1F4D', color: '#3DD6CF', display: 'grid', placeItems: 'center' }}>
                <Icon name={m.icon} size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{m.t}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{m.meta}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ font: font(800, 10), color: 'var(--faint)', letterSpacing: '.08em' }}>BEST</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#0B4FB3' }}>{m.best}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'Ranks' && (
        <div className="fade-in" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, background: '#fff', borderRadius: 24, padding: '20px 14px 0', overflow: 'hidden' }}>
            {podium.map((p, i) => {
              const st = podiumStyle[i];
              return (
                <div key={p.r} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: st.sz, height: st.sz, borderRadius: '50%', background: st.m.bg, display: 'grid', placeItems: 'center', font: font(800, 15), color: '#0A1F4D', boxShadow: `0 0 0 3px #fff,0 0 0 5px ${st.m.ring}` }}>{p.i}</div>
                  <div style={{ fontWeight: 800, fontSize: 12.5, marginTop: 8 }}>{p.n}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.s.toLocaleString('en-IN')} pts</div>
                  <div style={{ width: '100%', height: st.h, marginTop: 10, borderRadius: '14px 14px 0 0', background: st.bar, display: 'grid', placeItems: 'center', ...display(700, 25), color: '#F4F5FA', animation: 'scrIn .6s both' }}>{p.r}</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
            {ranks.map((r) => (
              <div key={r.r} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 16, background: r.me ? '#0A1F4D' : '#fff', color: r.me ? '#F4F5FA' : '#0A1F4D' }}>
                <span style={{ width: 34, font: font(800, 13), opacity: 0.7 }}>#{r.r}</span>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: r.me ? '#3DD6CF' : 'var(--tint)', display: 'grid', placeItems: 'center', font: font(800, 11), color: '#0A1F4D' }}>{r.i}</div>
                <span style={{ flex: 1, fontWeight: 800, fontSize: 13.5 }}>{r.n}</span>
                <span style={{ fontWeight: 800, fontSize: 13 }}>{r.s.toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'Papers' && (
        <div className="fade-in" style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {PAPERS.map((p) => (
            <div key={p.t} style={{ background: '#fff', borderRadius: 20, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 52, borderRadius: 8, background: '#F4F5FA', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', font: font(700, 17, undefined, 'var(--fd)'), color: '#0B4FB3' }}>&apos;{p.yy}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{p.t}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>{p.meta}</div>
              </div>
              <button aria-label="View paper" onClick={() => showToast('Downloading PDF…')} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <Icon name="description" size={19} />
              </button>
              <button aria-label="Download paper" onClick={() => showToast('Downloading PDF…')} style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: '#0A1F4D', color: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <Icon name="download" size={19} />
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'Medals' && (
        <div className="fade-in" style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10 }}>
          {MEDALS.map((m) => {
            const st = MEDAL_STYLE[m.kind];
            return (
              <div key={m.l} style={{ background: '#fff', borderRadius: 20, padding: '16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: m.kind === 'lock' ? 0.55 : 1 }}>
                <div style={{ width: 62, height: 62, borderRadius: '50%', background: st.bg, display: 'grid', placeItems: 'center', boxShadow: 'inset 0 0 0 4px rgba(255,255,255,.35)', animation: 'pop .5s both' }}>
                  <Icon name={m.kind === 'lock' ? 'lock' : m.kind === 'merit' ? 'local_fire_department' : 'military_tech'} size={28} fill color={st.fg} />
                </div>
                <div style={{ fontWeight: 800, fontSize: 12, textAlign: 'center' }}>{m.l}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: -6 }}>{m.s}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
