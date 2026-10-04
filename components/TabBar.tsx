'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, font } from './ui';

const TABS = [
  ['/', 'Home', 'home'],
  ['/explore', 'Explore', 'explore'],
  ['/olympiads', 'Olympiads', 'emoji_events'],
  ['/learning', 'Learning', 'auto_stories'],
  ['/profile', 'Profile', 'person'],
] as const;

export function TabBar() {
  const path = usePathname();
  const idx = Math.max(0, TABS.findIndex(([href]) => href === path));
  return (
    <div className="fixed-col" style={{ bottom: 0, height: 0, zIndex: 40 }}>
      <nav
        aria-label="Main"
        style={{ position: 'absolute', left: 16, right: 16, bottom: 'calc(24px + var(--safe-b))', height: 70, borderRadius: 35, background: '#0A1F4D', boxShadow: '0 20px 40px -14px rgba(10,31,77,.65)', display: 'flex', padding: '0 6px', animation: 'sheetUp .45s var(--ease)' }}
      >
        <div style={{ position: 'absolute', top: 7, left: `calc(6px + ${idx} * ((100% - 12px) / 5) + ((100% - 12px) / 5 - 67px) / 2)`, width: 67, height: 56, borderRadius: 22, background: '#3DD6CF', transition: 'left .4s cubic-bezier(.3,1.3,.5,1)' }} />
        {TABS.map(([href, label, icon], i) => {
          const on = i === idx;
          return (
            <Link key={href} href={href} aria-current={on ? 'page' : undefined} style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: on ? '#0A1F4D' : 'rgba(244,245,250,.6)', transition: 'color .3s' }}>
              <Icon name={icon} size={23} fill={on} />
              <span style={{ font: font(800, 9.5), letterSpacing: '.02em' }}>{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
