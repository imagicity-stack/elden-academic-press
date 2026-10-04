'use client';

import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Icon, display, font } from '@/components/ui';

const CONFETTI = Array.from({ length: 42 }, (_, i) => ({
  l: (i * 37) % 100,
  w: 6 + (i % 3) * 3,
  h: 10 + (i % 4) * 3,
  c: ['#3DD6CF', '#F4F5FA', '#0172EA', '#F3D58A', '#E7AE7E'][i % 5],
  d: (2.6 + (i % 5) * 0.5).toFixed(1),
  dl: ((i * 0.13) % 2.4).toFixed(2),
}));

const big = (h: number, bg: string, fg: string, border?: string): React.CSSProperties => ({ height: h, borderRadius: h / 2, border: border ?? 'none', background: bg, color: fg, font: font(800, 15), cursor: 'pointer' });

export default function Success() {
  const router = useRouter();
  const { s, course } = useStore();
  const first = s.lastOrder[0] ? course(s.lastOrder[0]) : undefined;
  const text = first ? `${first.title}${s.lastOrder.length > 1 ? ` and ${s.lastOrder.length - 1} more are` : ' is'} now on your shelf.` : 'Your courses are now on your shelf.';

  return (
    <main style={{ minHeight: '100dvh', background: '#0A1F4D', color: '#F4F5FA', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 28px calc(40px + var(--safe-b))', textAlign: 'center' }}>
      {CONFETTI.map((f, i) => (
        <span key={i} aria-hidden style={{ position: 'absolute', top: 0, left: `${f.l}%`, width: f.w, height: f.h, background: f.c, borderRadius: 2, animation: `fall ${f.d}s linear ${f.dl}s infinite` }} />
      ))}
      <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.55),transparent 65%)' }} />
      <div style={{ width: 110, height: 110, borderRadius: '50%', background: '#3DD6CF', display: 'grid', placeItems: 'center', animation: 'pop .7s var(--ease) both', position: 'relative', boxShadow: '0 0 0 14px rgba(61,214,207,.15),0 0 0 30px rgba(61,214,207,.07)' }}>
        <Icon name="check" size={60} color="#0A1F4D" style={{ fontWeight: 600 }} />
      </div>
      <h1 style={{ ...display(700, 37, 1.05), margin: '36px 0 0', position: 'relative', animation: 'scrIn .5s .3s both' }}>You&apos;re enrolled.</h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, color: 'rgba(244,245,250,.75)', margin: '12px 0 0', position: 'relative', animation: 'scrIn .5s .4s both', maxWidth: 300 }}>{text} A receipt is on its way to your inbox.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 36, position: 'relative', animation: 'scrIn .5s .5s both' }}>
        <button onClick={() => router.replace(first ? `/learn/${first.id}` : '/learning')} style={big(56, '#3DD6CF', '#0A1F4D')}>Start learning</button>
        <button onClick={() => router.replace('/')} style={big(56, 'transparent', '#F4F5FA', '1.5px solid rgba(244,245,250,.25)')}>Back to home</button>
      </div>
    </main>
  );
}
