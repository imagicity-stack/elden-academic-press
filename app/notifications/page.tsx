'use client';

import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { Icon, PageHeader, font } from '@/components/ui';

// Placeholder feed until notifications are generated server-side.
const FEED = [
  ['live_tv', 'Geometry Masterclass is live', 'Dr. Ananya Rao just went live.', '5m', '/live', true],
  ['emoji_events', 'EMO registrations close in 12 days', 'Secure your seat for 16 Nov.', '2h', '/olympiads', true],
  ['workspace_premium', 'Certificate earned', 'Organic Chemistry, Illuminated', '1d', '/certificates', false],
  ['sell', 'Festive offer: 20% off', 'Use ELDEN20 at checkout.', '2d', '/cart', false],
  ['leaderboard', 'You climbed 34 places', 'National rank #128 this week.', '3d', '/olympiads?tab=Ranks', false],
] as const;

export default function Notifications() {
  const router = useRouter();
  const { s, markAllRead } = useStore();

  return (
    <main className="scr-in" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <PageHeader
        title="Notifications"
        right={
          <button onClick={markAllRead} style={{ border: 'none', background: 'none', font: font(800, 12), color: 'var(--blue)', cursor: 'pointer', padding: 0 }}>
            Mark all read
          </button>
        }
      />
      <div style={{ padding: '12px 20px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FEED.map(([icon, title, body, time, href, unreadBase]) => {
          const u = unreadBase && !s.readAll;
          return (
            <button key={title} onClick={() => router.push(href)} style={{ background: u ? '#fff' : 'rgba(255,255,255,.5)', borderRadius: 18, padding: 14, display: 'flex', gap: 12, cursor: 'pointer', transition: 'background .3s', border: 'none', textAlign: 'left', width: '100%' }}>
              <span style={{ width: 40, height: 40, flex: 'none', borderRadius: 13, background: u ? '#0A1F4D' : 'var(--tint)', color: u ? '#3DD6CF' : '#0B4FB3', display: 'grid', placeItems: 'center' }}>
                <Icon name={icon} size={20} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.3 }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{body}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>{time}</span>
                {u && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0172EA' }} />}
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
