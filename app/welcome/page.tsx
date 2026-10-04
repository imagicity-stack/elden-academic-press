'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { Icon, display, font } from '@/components/ui';

const STEPS = [
  { tag: 'ELMASTER · BY ELDEN ACADEMIC PRESS', title: 'Learn from India’s finest minds.', body: 'Courses written and taught by olympiad medallists, IIT faculty and veteran teachers.' },
  { tag: 'OLYMPIADS', title: 'Train for every olympiad.', body: 'Timed mocks, past papers and national leaderboards for EMO, NSO, IEO and more.' },
  { tag: 'CERTIFICATES', title: 'Earn certificates that matter.', body: 'Finish a course and earn a verifiable certificate — plus medals to show for it.' },
];

const book = (extra: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', left: '50%', borderRadius: 14, overflow: 'hidden', ...extra });
const spine = (a: number): React.CSSProperties => ({ position: 'absolute', left: 0, top: 0, bottom: 0, width: 9, background: `rgba(0,0,0,${a})` });
const medal = (size: number, bg: string, delay: number, pos: React.CSSProperties = {}): React.CSSProperties => ({
  position: 'absolute', left: '50%', width: size, height: size, borderRadius: '50%', background: bg, display: 'grid', placeItems: 'center', boxShadow: '0 20px 40px rgba(0,0,0,.35)', animation: `pop .6s ${delay}s both`, ...pos,
});

export default function Welcome() {
  const router = useRouter();
  const { s } = useStore();
  const [step, setStep] = useState(0);
  const st = STEPS[step];
  const next = () => (step < 2 ? setStep(step + 1) : router.push('/signup'));
  const name = s.profile.name || 'Aarav Mehta';

  return (
    <main style={{ minHeight: '100dvh', background: '#0A1F4D', color: '#F4F5FA', display: 'flex', flexDirection: 'column', padding: 'calc(var(--top) + 2px) 28px calc(40px + var(--safe-b))', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', width: 620, height: 620, borderRadius: '50%', border: '1px solid rgba(61,214,207,.14)', top: 40, left: -115 }} />
      <div style={{ position: 'absolute', width: 440, height: 440, borderRadius: '50%', border: '1px solid rgba(61,214,207,.18)', top: 130, left: -25 }} />
      <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.42),transparent 65%)', top: 120, left: -15 }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elmaster-logo-light.png" alt="ElMaster" style={{ height: 30, alignSelf: 'flex-start' }} />
          <span style={{ font: font(700, 9.5), letterSpacing: '.16em', color: 'rgba(244,245,250,.6)' }}>BY ELDEN ACADEMIC PRESS</span>
        </div>
        <button onClick={() => router.push('/signup')} style={{ background: 'rgba(244,245,250,.1)', border: 'none', color: '#F4F5FA', fontWeight: 600, fontSize: 13, padding: '9px 16px', borderRadius: 20, cursor: 'pointer' }}>
          Skip
        </button>
      </div>

      <div style={{ height: 330, position: 'relative', marginTop: 24 }} aria-hidden>
        {step === 0 && (
          <div key="b" style={{ position: 'absolute', inset: 0, animation: 'fadeIn .5s' }}>
            <div style={{ position: 'absolute', left: '50%', top: 40, marginLeft: -150, transform: 'rotate(-14deg)' }}>
              <div style={book({ position: 'relative', left: 0, width: 136, height: 180, background: '#0B4FB3', boxShadow: '0 20px 40px rgba(0,0,0,.35)', animation: 'floaty 5s ease-in-out infinite' })}>
                <div style={spine(0.2)} />
                <div style={{ position: 'absolute', top: 12, left: 20, font: font(600, 11), color: '#D4E5FF', opacity: 0.7 }}>02</div>
                <div style={{ position: 'absolute', bottom: 26, left: 20, font: font(800, 53, 1.05, 'var(--fd)'), letterSpacing: '-.05em', color: '#D4E5FF' }}>Ph</div>
              </div>
            </div>
            <div style={book({ top: 10, width: 150, height: 200, marginLeft: -75, background: '#F4F5FA', boxShadow: '0 24px 50px rgba(0,0,0,.4)', zIndex: 2, animation: 'floaty 5s ease-in-out .6s infinite' })}>
              <div style={spine(0.12)} />
              <div style={{ position: 'absolute', top: 12, left: 20, font: font(600, 11), color: '#0172EA' }}>01</div>
              <div style={{ position: 'absolute', bottom: 30, left: 20, font: font(800, 60, 1.05, 'var(--fd)'), letterSpacing: '-.05em', color: '#0A1F4D' }}>Nt</div>
              <div style={{ position: 'absolute', bottom: 14, left: 22, font: font(700, 9), letterSpacing: '.14em', color: '#0172EA' }}>NUMBER THEORY</div>
            </div>
            <div style={{ position: 'absolute', left: '50%', top: 40, marginLeft: 14, transform: 'rotate(14deg)' }}>
              <div style={book({ position: 'relative', left: 0, width: 136, height: 180, background: '#3DD6CF', boxShadow: '0 20px 40px rgba(0,0,0,.35)', animation: 'floaty 5s ease-in-out 1.2s infinite' })}>
                <div style={spine(0.12)} />
                <div style={{ position: 'absolute', top: 12, left: 20, font: font(600, 11), color: '#0A1F4D', opacity: 0.6 }}>05</div>
                <div style={{ position: 'absolute', bottom: 26, left: 20, font: font(800, 53, 1.05, 'var(--fd)'), letterSpacing: '-.05em', color: '#0A1F4D' }}>Cs</div>
              </div>
            </div>
          </div>
        )}
        {step === 1 && (
          <div key="m" style={{ position: 'absolute', inset: 0, animation: 'fadeIn .5s' }}>
            <div style={medal(120, 'linear-gradient(145deg,#F3D58A,#B8862E)', 0, { top: 30, marginLeft: -60 })}>
              <div style={{ width: 96, height: 96, borderRadius: '50%', border: '2px solid rgba(255,255,255,.5)', display: 'grid', placeItems: 'center', ...display(700, 45, 1.05), color: '#5A3A0A' }}>1</div>
            </div>
            <div style={medal(96, 'linear-gradient(145deg,#EEF0F2,#9EA3A8)', 0.15, { top: 150, marginLeft: -150 })}>
              <div style={{ width: 76, height: 76, borderRadius: '50%', border: '2px solid rgba(255,255,255,.6)', display: 'grid', placeItems: 'center', ...display(700, 35, 1.05), color: '#3D4247' }}>2</div>
            </div>
            <div style={medal(90, 'linear-gradient(145deg,#E7AE7E,#8A4E1F)', 0.3, { top: 160, marginLeft: 56 })}>
              <div style={{ width: 70, height: 70, borderRadius: '50%', border: '2px solid rgba(255,255,255,.45)', display: 'grid', placeItems: 'center', ...display(700, 34, 1.05), color: '#4A2208' }}>3</div>
            </div>
            <div style={{ position: 'absolute', left: '50%', top: 270, transform: 'translateX(-50%)', display: 'flex', gap: 8, font: font(700, 11), letterSpacing: '.1em', color: '#3DD6CF' }}>
              <span>EMO</span><span>·</span><span>NSO</span><span>·</span><span>IEO</span><span>·</span><span>INAO</span>
            </div>
          </div>
        )}
        {step === 2 && (
          <div key="c" style={{ position: 'absolute', inset: 0, animation: 'fadeIn .5s', display: 'grid', placeItems: 'center' }}>
            <div style={{ transform: 'rotate(-5deg)' }}>
              <div style={{ width: 280, height: 200, background: '#F8F9FD', borderRadius: 12, boxShadow: '0 30px 60px rgba(0,0,0,.45)', padding: 10, animation: 'floaty 5s ease-in-out infinite' }}>
                <div style={{ height: '100%', border: '1.5px solid #3DD6CF', borderRadius: 6, outline: '1px solid rgba(61,214,207,.5)', outlineOffset: -6, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, color: '#0A1F4D' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/elmaster-mark.png" alt="" style={{ height: 28 }} />
                  <div style={{ font: font(700, 8), letterSpacing: '.24em', color: '#0172EA', marginTop: 4 }}>CERTIFICATE OF COMPLETION</div>
                  <div style={display(700, 22, 1.1)}>{name}</div>
                  <div style={{ width: 120, height: 1, background: '#3DD6CF', margin: '2px 0' }} />
                  <div style={{ font: font(500, 9), color: 'var(--muted)' }}>Olympiad Mathematics · Number Theory</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />
      <div key={step} style={{ position: 'relative', animation: 'scrIn .5s' }}>
        <div style={{ font: font(700, 11), letterSpacing: '.18em', color: '#3DD6CF' }}>{st.tag}</div>
        <h1 style={{ ...display(700, 35, 1.02), margin: '12px 0 0', textWrap: 'balance' }}>{st.title}</h1>
        <p style={{ font: font(400, 15, 1.55), color: 'rgba(244,245,250,.72)', margin: '14px 0 0', textWrap: 'pretty' }}>{st.body}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 34, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <button key={i} aria-label={`Slide ${i + 1}`} onClick={() => setStep(i)} style={{ height: 6, borderRadius: 3, width: i === step ? 26 : 6, background: i === step ? '#3DD6CF' : 'rgba(244,245,250,.25)', transition: 'all .35s', border: 'none', padding: 0, cursor: 'pointer' }} />
          ))}
        </div>
        <button onClick={next} className="press press-96" style={{ height: 56, padding: '0 26px', borderRadius: 28, border: 'none', background: '#3DD6CF', color: '#0A1F4D', fontWeight: 800, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          {step === 2 ? 'Get started' : 'Next'}
          <Icon name="arrow_forward" size={20} />
        </button>
      </div>
    </main>
  );
}
