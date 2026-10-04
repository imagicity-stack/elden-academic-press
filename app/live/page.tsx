'use client';

import { useStore } from '@/lib/store';
import { Icon, PageHeader, display, font } from '@/components/ui';

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400000);
  if (diff === 0) return 'TODAY';
  if (diff === 1) return 'TOMORROW';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/,/g, '').toUpperCase();
}
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

export default function Live() {
  const { s, catalog, toggleRemind, showToast } = useStore();
  const live = catalog.liveClasses.find((l) => l.isLive);
  const upcoming = catalog.liveClasses.filter((l) => !l.isLive && new Date(l.startsAt).getTime() > Date.now() - 3600000);
  const minsIn = live ? Math.max(1, Math.round((Date.now() - new Date(live.startsAt).getTime()) / 60000)) : 0;

  return (
    <main className="scr-in" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <PageHeader title="Live classes" />
      <div style={{ padding: '12px 20px 0' }}>
        {live && (
          <div style={{ height: 200, borderRadius: 24, background: '#06173A', position: 'relative', overflow: 'hidden', color: '#F4F5FA', padding: 18, display: 'flex', flexDirection: 'column' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 80% 20%,rgba(1,114,234,.55),transparent 60%)' }} />
            <div aria-hidden style={{ position: 'absolute', right: 18, top: 24, font: font(800, 79, 1.05, 'var(--fd)'), letterSpacing: '-.05em', color: 'rgba(61,214,207,.25)' }}>⊙</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
              <span style={{ height: 24, padding: '0 10px', borderRadius: 12, background: '#F0443A', font: font(800, 10.5, '24px'), letterSpacing: '.08em', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'pulse 1.4s infinite' }} />
                LIVE
              </span>
              <span style={{ fontSize: 12, color: 'rgba(244,245,250,.7)' }}>{(live.watching ?? 0).toLocaleString('en-IN')} watching</span>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ ...display(700, 20, 1.1), position: 'relative', maxWidth: 260 }}>{live.title}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, position: 'relative' }}>
              <span style={{ fontSize: 12, color: 'rgba(244,245,250,.7)' }}>
                {live.host} · {minsIn} min in
              </span>
              <button onClick={() => showToast('Joining class…')} style={{ height: 36, padding: '0 16px', borderRadius: 18, border: 'none', background: '#3DD6CF', color: '#0A1F4D', font: font(800, 12.5), cursor: 'pointer' }}>
                Join now
              </button>
            </div>
          </div>
        )}

        <h2 style={{ ...display(700, 18), margin: '22px 0 10px' }}>Upcoming</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {upcoming.map((u) => {
            const on = s.remind.includes(u.id);
            return (
              <div key={u.id} style={{ background: '#fff', borderRadius: 20, padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 56, flex: 'none', textAlign: 'center' }}>
                  <div style={{ font: font(800, 10), color: '#0172EA', letterSpacing: '.06em' }}>{dayLabel(u.startsAt)}</div>
                  <div style={{ font: font(700, 17, undefined, 'var(--fd)'), marginTop: 2 }}>{timeLabel(u.startsAt)}</div>
                </div>
                <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.3 }}>{u.title}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3 }}>{u.host}</div>
                </div>
                <button aria-label={on ? 'Remove reminder' : 'Remind me'} aria-pressed={on} onClick={() => toggleRemind(u.id)} style={{ width: 38, height: 38, flex: 'none', borderRadius: '50%', border: 'none', background: on ? '#0A1F4D' : 'var(--tint)', color: on ? '#3DD6CF' : '#0B4FB3', display: 'grid', placeItems: 'center', cursor: 'pointer', transition: 'all .25s' }}>
                  <Icon name="notifications" size={19} fill={on} />
                </button>
              </div>
            );
          })}
          {upcoming.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No classes scheduled yet.</div>}
        </div>
      </div>
    </main>
  );
}
