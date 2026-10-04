'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useStore } from '@/lib/store';
import { BookCover, Icon, ProgressBar, Segmented, display, font } from '@/components/ui';

const SEG = ['In progress', 'Completed'] as const;
// Weekly study time isn't tracked yet; these are the design's placeholder figures.
const WEEK = { done: 3.4, goal: 5, streak: 12 };

export default function Learning() {
  const router = useRouter();
  const { s, course } = useStore();
  const [seg, setSeg] = useState<(typeof SEG)[number]>('In progress');
  const owned = s.owned.map(course).filter((c) => !!c);
  const certs = owned.filter((c) => (s.progress[c.id] ?? 0) >= 100).length;
  const list = owned.filter((c) => (seg === 'Completed' ? (s.progress[c.id] ?? 0) >= 100 : (s.progress[c.id] ?? 0) < 100));
  const ring = 238.8 * (1 - WEEK.done / WEEK.goal);

  return (
    <div className="scr-in" style={{ padding: 'var(--top) 20px 0' }}>
      <h1 style={{ ...display(700, 32, 1.05), margin: 0 }}>My learning</h1>

      <div style={{ marginTop: 18, background: '#0A1F4D', borderRadius: 26, padding: 20, color: '#F4F5FA', display: 'flex', gap: 18, alignItems: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', width: 240, height: 240, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.5),transparent 65%)', right: -80, bottom: -100 }} />
        <div style={{ position: 'relative', width: 92, height: 92, flex: 'none' }}>
          <svg width="92" height="92" viewBox="0 0 92 92" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="46" cy="46" r="38" fill="none" stroke="rgba(244,245,250,.12)" strokeWidth="9" />
            <circle cx="46" cy="46" r="38" fill="none" stroke="#3DD6CF" strokeWidth="9" strokeLinecap="round" strokeDasharray="238.8" strokeDashoffset={ring} style={{ transition: 'stroke-dashoffset 1s var(--ease)' }} />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
            <div>
              <div style={display(700, 20, 1.05)}>{WEEK.done}h</div>
              <div style={{ fontSize: 10, color: 'rgba(244,245,250,.6)' }}>of {WEEK.goal}h</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ font: font(800, 10), letterSpacing: '.16em', color: '#3DD6CF' }}>THIS WEEK</div>
          <div style={{ ...display(700, 18, 1.1), marginTop: 6 }}>{(WEEK.goal - WEEK.done).toFixed(1)} hours to your weekly goal</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: 'rgba(244,245,250,.75)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="local_fire_department" size={16} fill color="#FF7A3D" />
              {WEEK.streak}-day streak
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="workspace_premium" size={16} color="#3DD6CF" />
              {certs} cert{certs === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 10, marginTop: 12 }}>
        {[['/certificates', 'workspace_premium', 'Certificates'], ['/wishlist', 'favorite', 'Wishlist'], ['/live', 'live_tv', 'Live classes']].map(([href, icon, label]) => (
          <Link key={href} href={href} style={{ height: 76, borderRadius: 18, background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, font: font(800, 12), color: '#0A1F4D' }}>
            <Icon name={icon} size={24} color="#0172EA" />
            {label}
          </Link>
        ))}
      </div>

      <Segmented options={SEG} value={seg} onChange={setSeg} height={36} size={13} style={{ marginTop: 20 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
        {list.map((c) => (
          <div key={c.id} onClick={() => router.push(s.currentLesson[c.id] !== undefined ? `/learn/${c.id}` : `/course/${c.id}`)} style={{ background: '#fff', borderRadius: 22, padding: 12, display: 'flex', gap: 14, alignItems: 'center', cursor: 'pointer', animation: 'scrIn .35s both' }}>
            <BookCover c={c} w={62} h={80} radius={12} spine={5} sym={27} symBottom={8} symLeft={11} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.25 }}>{c.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{c.instructor}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                <ProgressBar pct={s.progress[c.id] ?? 0} style={{ flex: 1 }} />
                <span style={{ font: font(800, 12), color: '#0B4FB3' }}>{s.progress[c.id] ?? 0}%</span>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={display(700, 20)}>{seg === 'Completed' ? 'Nothing finished yet' : 'No courses in progress'}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
              {seg === 'Completed' ? 'Finish a course to earn your certificate.' : <Link href="/explore" style={{ fontWeight: 700 }}>Browse courses</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
