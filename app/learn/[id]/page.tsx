'use client';

import { notFound, useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { mmss } from '@/lib/format';
import { useStore } from '@/lib/store';
import { Icon, TabLine, display, font, useBack } from '@/components/ui';

const TABS = ['Lessons', 'Notes'] as const;
const SPEEDS = [1, 1.25, 1.5, 2];
const secs = (d: string) => d.split(':').reduce((a, p) => a * 60 + Number(p), 0);

export default function PlayerPage() {
  return (
    <Suspense>
      <Player />
    </Suspense>
  );
}

function Player() {
  const { id } = useParams<{ id: string }>();
  const preview = useSearchParams().get('preview') === '1';
  const back = useBack(`/course/${id}`);
  const { s, catalog, course, setLesson, saveNote, showToast } = useStore();
  const c = course(id);
  const lessons = useMemo(() => catalog.lessons.filter((l) => l.courseId === id).sort((a, b) => a.position - b.position), [catalog.lessons, id]);
  const owned = s.owned.includes(id);
  const [idx, setIdx] = useState(() => (owned ? Math.min(s.currentLesson[id] ?? 0, Math.max(0, lessons.length - 1)) : 0));
  const [pos, setPos] = useState(0); // seconds into the lesson
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Lessons');
  const [draft, setDraft] = useState('');
  const lesson = lessons[idx];
  const dur = lesson ? secs(lesson.duration) : 1;
  const posRef = useRef(pos);
  posRef.current = pos;

  // Simulated playback until lesson videos are hosted (see README).
  useEffect(() => {
    if (!playing) return;
    const iv = setInterval(() => {
      const next = posRef.current + speed;
      if (next < dur) return setPos(next);
      setPos(dur);
      setPlaying(false);
      if (owned && idx + 1 < lessons.length) {
        setLesson(id, idx + 1, lessons.length);
        setIdx(idx + 1);
        setPos(0);
        setPlaying(true);
      } else if (owned) setLesson(id, lessons.length, lessons.length);
    }, 1000);
    return () => clearInterval(iv);
  }, [playing, speed, dur, owned, idx, lessons.length, id, setLesson]);

  if (!c || !lesson) notFound();

  const pct = Math.min(100, (pos / dur) * 100);
  const at = mmss(pos);
  const notes = s.notes.filter((n) => n.courseId === id);
  const pick = (i: number) => {
    if (!owned && i > 0) return showToast('Enroll to unlock this lesson');
    setIdx(i);
    setPos(0);
    setPlaying(true);
    if (owned) setLesson(id, i, lessons.length);
  };
  const actions: [string, string, () => void][] = [
    ['edit_note', 'Notes', () => setTab('Notes')],
    ['download', 'Offline', () => showToast('Saved for offline')],
    ['forum', 'Ask doubt', () => showToast('Doubt sent to mentor')],
    ['speed', speed === 1 ? '1.0×' : `${speed}×`, () => {
      const n = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
      setSpeed(n);
      showToast(`Playback speed ${n}×`);
    }],
  ];

  return (
    <main className="fade-in" style={{ paddingBottom: 'calc(24px + var(--safe-b))' }}>
      <div style={{ height: 'calc(290px + env(safe-area-inset-top, 0px))', background: '#06173A', position: 'relative', overflow: 'hidden', color: '#F4F5FA' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 70% 40%,rgba(1,114,234,.48),transparent 60%)' }} />
        <div aria-hidden style={{ position: 'absolute', right: 24, top: 'calc(env(safe-area-inset-top, 0px) + 70px)', font: font(800, 108, 1.05, 'var(--fd)'), letterSpacing: '-.05em', color: 'rgba(61,214,207,.22)' }}>{c.id === 'imo' ? 'a≡b' : c.sym}</div>
        <div style={{ position: 'absolute', left: 24, top: 'calc(env(safe-area-inset-top, 0px) + 110px)', ...display(700, 22, 1.1), maxWidth: 220 }}>{lesson.title}</div>
        <div style={{ position: 'absolute', top: 'calc(var(--top) - 2px)', left: 16, right: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button aria-label="Close player" onClick={back} style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(244,245,250,.12)', color: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="keyboard_arrow_down" size={22} />
          </button>
          <div style={{ flex: 1, font: font(700, 12), color: 'rgba(244,245,250,.7)', textAlign: 'center' }}>
            Lesson {idx + 1} · {c.subject}
          </div>
          <button aria-label="Cast" onClick={() => showToast('Looking for devices…')} style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: 'rgba(244,245,250,.12)', color: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <Icon name="cast" size={20} />
          </button>
        </div>
        <div style={{ position: 'absolute', left: '50%', top: 'calc(env(safe-area-inset-top, 0px) + 180px)', transform: 'translate(-50%,-50%)', display: 'flex', alignItems: 'center', gap: 26 }}>
          <button aria-label="Back 10 seconds" onClick={() => setPos(Math.max(0, pos - 10))} style={{ border: 'none', background: 'none', color: '#F4F5FA', cursor: 'pointer' }}>
            <Icon name="replay_10" size={30} />
          </button>
          <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying(!playing)} className="press press-90" style={{ width: 66, height: 66, borderRadius: '50%', border: 'none', background: '#3DD6CF', color: '#0A1F4D', display: 'grid', placeItems: 'center', cursor: 'pointer', boxShadow: '0 0 0 8px rgba(61,214,207,.2)' }}>
            <Icon name={playing ? 'pause' : 'play_arrow'} size={36} fill />
          </button>
          <button aria-label="Forward 10 seconds" onClick={() => setPos(Math.min(dur, pos + 10))} style={{ border: 'none', background: 'none', color: '#F4F5FA', cursor: 'pointer' }}>
            <Icon name="forward_10" size={30} />
          </button>
        </div>
        <div style={{ position: 'absolute', left: 20, right: 20, bottom: 18 }}>
          <div
            role="slider"
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={dur}
            aria-valuenow={Math.round(pos)}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPos(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur);
            }}
            style={{ height: 16, display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          >
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(244,245,250,.2)', position: 'relative' }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: '#3DD6CF', borderRadius: 2 }} />
              <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 14, height: 14, margin: '-7px 0 0 -7px', borderRadius: '50%', background: '#F4F5FA' }} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', font: font(700, 11), color: 'rgba(244,245,250,.65)', marginTop: 4 }}>
            <span>{at}</span>
            <span>{lesson.duration}</span>
          </div>
        </div>
      </div>

      <div style={{ padding: 20 }}>
        <h1 style={{ ...display(700, 22, 1.1), margin: 0 }}>{lesson.title}</h1>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>
          {c.subject} · {c.instructor}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 16 }}>
          {actions.map(([icon, label, onClick]) => (
            <button key={icon} onClick={onClick} style={{ height: 64, borderRadius: 16, border: 'none', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, font: font(700, 11), cursor: 'pointer' }}>
              <Icon name={icon} size={21} color="#0172EA" />
              {label}
            </button>
          ))}
        </div>

        <TabLine options={TABS} value={tab} onChange={setTab} style={{ marginTop: 20 }} />

        {tab === 'Lessons' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {lessons.map((l, i) => {
              const done = owned && i < idx;
              const cur = i === idx;
              const locked = !owned && i > 0;
              return (
                <div key={l.id} onClick={() => pick(i)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, background: cur ? 'var(--tint)' : 'transparent', cursor: 'pointer', transition: 'background .2s' }}>
                  <div style={{ width: 34, height: 34, flex: 'none', borderRadius: '50%', background: done ? '#0172EA' : cur ? '#0A1F4D' : '#fff', color: done || cur ? '#F4F5FA' : locked ? '#B3B8C7' : '#0172EA', display: 'grid', placeItems: 'center' }}>
                    <Icon name={done ? 'check' : locked ? 'lock' : 'play_arrow'} size={18} fill />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 13.5 }}>
                      {i + 1}. {l.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                      {l.duration}
                      {done ? ' · Completed' : cur ? ' · Now playing' : ''}
                    </div>
                  </div>
                  {cur && playing && (
                    <div aria-hidden style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 16 }}>
                      {[0, 0.2, 0.4].map((d) => (
                        <span key={d} style={{ width: 3, height: 16, background: '#0172EA', borderRadius: 2, transformOrigin: 'bottom', animation: `eq .8s ${d}s infinite` }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {preview && !owned && (
              <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>Free preview · enroll to unlock every lesson</div>
            )}
          </div>
        )}

        {tab === 'Notes' && (
          <div className="fade-in" style={{ marginTop: 14 }}>
            <div style={{ background: '#fff', borderRadius: 18, padding: 14 }}>
              <div style={{ font: font(800, 11), color: '#0172EA' }}>AT {at}</div>
              <textarea aria-label="Note" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Write a note for this moment…" style={{ width: '100%', border: 'none', outline: 'none', resize: 'none', height: 60, font: font(500, 14, 1.5), marginTop: 6, background: 'transparent' }} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => {
                    if (!draft.trim()) return;
                    saveNote({ courseId: id, lessonId: lesson.id, at, text: draft.trim() });
                    setDraft('');
                  }}
                  style={{ height: 34, padding: '0 16px', borderRadius: 17, border: 'none', background: '#0A1F4D', color: '#F4F5FA', font: font(800, 12), cursor: 'pointer' }}
                >
                  Save note
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {notes.map((n) => (
                <div key={n.id} style={{ background: 'var(--tint)', borderRadius: 16, padding: '12px 14px', animation: 'scrIn .3s both' }}>
                  <div style={{ font: font(800, 11), color: '#0B4FB3' }}>
                    {n.at} · Lesson {(lessons.findIndex((l) => l.id === n.lessonId) + 1) || '–'}
                  </div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5, marginTop: 4 }}>{n.text}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
