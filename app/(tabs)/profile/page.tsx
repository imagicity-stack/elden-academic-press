'use client';

import { useRouter } from 'next/navigation';
import { MY_RANK } from '@/lib/seed';
import { initialsOf } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Icon, Toggle, display, font } from '@/components/ui';

export default function Profile() {
  const router = useRouter();
  const { s, course, showToast, setRemindOn, logout } = useStore();
  const name = s.profile.name || 'Scholar';
  const certs = s.owned.filter((id) => course(id) && (s.progress[id] ?? 0) >= 100).length;

  const menu: [string, string, string, () => void][] = [
    ['workspace_premium', 'My certificates', String(certs), () => router.push('/certificates')],
    ['favorite', 'Wishlist', String(s.wish.length), () => router.push('/wishlist')],
    ['live_tv', 'Live classes', '', () => router.push('/live')],
    ['notifications', 'Notifications', s.readAll ? '' : '2 new', () => router.push('/notifications')],
    ['receipt_long', 'Orders & invoices', '', () => showToast('Opening orders')],
    ['family_restroom', 'Parent access', '', () => showToast('Invite sent to parent')],
    ['settings', 'Settings', '', () => showToast('Settings')],
  ];

  // Streak, hours and medals are placeholder figures until tracking lands.
  const stats = [['12', 'day streak'], ['46h', 'learned'], ['3', 'medals']];

  return (
    <div className="scr-in" style={{ padding: 'var(--top) 20px 0' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', paddingTop: 10 }}>
        <div style={{ width: 92, height: 92, borderRadius: '50%', background: 'linear-gradient(145deg,#3DD6CF,#0B4FB3)', display: 'grid', placeItems: 'center', color: '#F4F5FA', ...display(700, 30), boxShadow: '0 0 0 5px #F4F5FA,0 0 0 7px #3DD6CF' }}>{initialsOf(name)}</div>
        <h1 style={{ ...display(700, 25, 1.05), margin: '16px 0 0' }}>{name}</h1>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
          {s.profile.grade} · National rank #{MY_RANK.r}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8, marginTop: 20 }}>
        {stats.map(([v, l]) => (
          <div key={l} style={{ background: '#fff', borderRadius: 18, padding: '14px 8px', textAlign: 'center' }}>
            <div style={display(700, 22, 1.05)}>{v}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 22, marginTop: 14, overflow: 'hidden' }}>
        {menu.map(([icon, label, meta, onClick]) => (
          <button key={label} onClick={onClick} className="row-hover" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', border: 'none', borderBottom: '1px solid rgba(10,31,77,.06)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center' }}>
              <Icon name={icon} size={19} />
            </span>
            <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{label}</span>
            <span style={{ font: font(800, 11), color: '#0172EA' }}>{meta}</span>
            <Icon name="chevron_right" size={20} color="var(--faint)" />
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 22, marginTop: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ width: 36, height: 36, borderRadius: 12, background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center' }}>
          <Icon name="notifications_active" size={19} />
        </span>
        <span style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>Class reminders</span>
        <Toggle on={s.remindOn} onChange={setRemindOn} label="Class reminders" />
      </div>

      <button
        onClick={async () => {
          await logout();
          router.replace('/welcome');
        }}
        style={{ width: '100%', height: 50, borderRadius: 25, border: 'none', background: 'transparent', color: '#E5484D', font: font(800, 14), marginTop: 10, cursor: 'pointer' }}
      >
        Log out
      </button>
    </div>
  );
}
