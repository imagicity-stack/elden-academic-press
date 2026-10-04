'use client';

import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import type { Course } from '@/lib/types';
import { Icon, PageHeader, display, font, outlineBtn, primaryBtn } from '@/components/ui';

export default function Certificates() {
  const router = useRouter();
  const { s, course, showToast } = useStore();
  const done = s.owned.map(course).filter((c): c is Course => !!c && (s.progress[c.id] ?? 0) >= 100);
  const latest = done[0];
  const name = s.profile.name || 'Scholar';
  // Issue dates and IDs are placeholders until certificates are issued server-side.
  const issued = '28 Sep 2026';
  const certId = latest ? `EAP-26-${String(8800 + Number(latest.num) * 41).padStart(5, '0')}` : '';

  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: `${latest?.title} · ElMaster certificate`, url: window.location.href });
      else showToast('Link copied');
    } catch {}
  };

  return (
    <main className="scr-in" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <PageHeader title="Certificates" />
      <div style={{ padding: '14px 20px 0' }}>
        {latest ? (
          <>
            <div style={{ background: '#F8F9FD', borderRadius: 16, padding: 12, boxShadow: '0 24px 50px -24px rgba(10,31,77,.45)', animation: 'pop .6s both' }}>
              <div style={{ border: '1.5px solid #3DD6CF', outline: '1px solid rgba(61,214,207,.45)', outlineOffset: -7, borderRadius: 8, padding: '24px 18px', textAlign: 'center', position: 'relative' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/elmaster-logo.png" alt="ElMaster" style={{ height: 28 }} />
                <div style={{ font: font(700, 8.5), letterSpacing: '.2em', color: 'var(--muted)', marginTop: 6 }}>BY ELDEN ACADEMIC PRESS</div>
                <div style={{ font: font(800, 9), letterSpacing: '.26em', color: '#0172EA', marginTop: 10 }}>CERTIFICATE OF COMPLETION</div>
                <div style={{ font: font(600, 13, undefined, 'var(--fd)'), color: 'var(--muted)', marginTop: 12 }}>This certifies that</div>
                <div style={{ ...display(700, 29, 1.1), marginTop: 4 }}>{name}</div>
                <div style={{ width: 150, height: 1, background: '#3DD6CF', margin: '8px auto' }} />
                <div style={{ font: font(600, 13, undefined, 'var(--fd)'), color: 'var(--muted)' }}>has successfully completed</div>
                <div style={{ fontWeight: 800, fontSize: 14, marginTop: 6 }}>{latest.title}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 22, fontSize: 10, color: 'var(--muted)', textAlign: 'left' }}>
                  <div>
                    <div style={{ font: font(700, 17, undefined, 'var(--fd)'), color: '#0A1F4D' }}>{latest.instructor.replace(/^(Dr\.|Prof\.)\s/, '')}</div>
                    <div style={{ borderTop: '1px solid rgba(10,31,77,.2)', paddingTop: 3, marginTop: 2 }}>Instructor</div>
                  </div>
                  <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(145deg,#E7AE7E,#8A4E1F)', display: 'grid', placeItems: 'center', color: '#EEF5FF' }}>
                    <Icon name="verified" size={24} fill />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 800, color: '#0A1F4D', fontSize: 11 }}>{issued}</div>
                    <div style={{ borderTop: '1px solid rgba(10,31,77,.2)', paddingTop: 3, marginTop: 2 }}>ID {certId}</div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={() => showToast('Downloading PDF…')} style={{ ...primaryBtn(50, 13.5), flex: 1 }}>
                <Icon name="download" size={19} />
                Download PDF
              </button>
              <button onClick={share} style={{ ...outlineBtn(50, 13.5), flex: 1 }}>
                <Icon name="share" size={19} />
                LinkedIn
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '50px 20px 10px' }}>
            <div style={display(700, 22)}>No certificates yet</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Finish a course to earn a verifiable certificate.</div>
          </div>
        )}

        <h2 style={{ ...display(700, 18), margin: '24px 0 10px' }}>All certificates</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {done.map((c) => (
            <button key={c.id} onClick={() => router.push(`/course/${c.id}`)} style={{ background: '#fff', borderRadius: 18, padding: 14, display: 'flex', gap: 12, alignItems: 'center', border: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }}>
              <span style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--tint)', color: '#0B4FB3', display: 'grid', placeItems: 'center' }}>
                <Icon name="workspace_premium" size={21} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 13.5 }}>{c.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Course · {issued}</div>
              </div>
              <Icon name="chevron_right" color="#0172EA" />
            </button>
          ))}
          <div style={{ background: '#fff', borderRadius: 18, padding: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ width: 40, height: 40, borderRadius: 13, background: 'linear-gradient(145deg,#F3D58A,#B8862E)', color: '#5A3A0A', display: 'grid', placeItems: 'center' }}>
              <Icon name="military_tech" size={21} fill />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5 }}>Elden Mathematics Olympiad 2025 — Gold</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>Olympiad · 17 Nov 2025</div>
            </div>
            <Icon name="chevron_right" color="#0172EA" />
          </div>
        </div>
      </div>
    </main>
  );
}
