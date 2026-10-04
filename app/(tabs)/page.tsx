'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CATS } from '@/lib/cats';
import { FEATURED_EXAM } from '@/lib/seed';
import { fmt, greeting, initialsOf } from '@/lib/format';
import { useStore } from '@/lib/store';
import { BookCover, D, HeartButton, Icon, ProgressBar, Rating, RoundButton, SectionHead, display, font } from '@/components/ui';

export default function Home() {
  const router = useRouter();
  const { s, catalog, course, toggleWish } = useStore();
  const name = s.profile.name || 'Scholar';

  const inProgress = s.owned.map(course).filter((c) => c && (s.progress[c.id] ?? 0) < 100);
  const cont = inProgress.find((c) => c && s.currentLesson[c.id] !== undefined) ?? inProgress[0];
  const lessonIdx = cont ? s.currentLesson[cont.id] ?? 0 : 0;
  const lessonTitle = cont ? catalog.lessons.find((l) => l.courseId === cont.id && l.position === lessonIdx)?.title : '';

  const emo = catalog.exams.find((e) => e.id === FEATURED_EXAM.id);
  const daysLeft = Math.max(0, Math.ceil((new Date(FEATURED_EXAM.regClosesAt).getTime() - Date.now()) / 86400000));
  const emoCta = s.reg.includes(FEATURED_EXAM.id) ? 'Registered · View admit card' : 'Register now';
  const live = catalog.liveClasses.find((l) => l.isLive);
  const popular = [...catalog.courses].sort((a, b) => b.pop - a.pop).slice(0, 6);

  return (
    <div className="scr-in" style={{ padding: 'var(--top) 20px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Link href="/profile" aria-label="Profile" style={{ width: 46, height: 46, flex: 'none', borderRadius: '50%', background: 'linear-gradient(145deg,#3DD6CF,#0B4FB3)', display: 'grid', placeItems: 'center', color: '#F4F5FA', font: font(700, 16) }}>
          {initialsOf(name)}
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{greeting()}</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{name.split(' ')[0]}</div>
        </div>
        <RoundButton icon="search" size={44} label="Search" onClick={() => router.push('/explore')} />
        <RoundButton icon="notifications" size={44} label="Notifications" onClick={() => router.push('/notifications')}>
          {!s.readAll && <span style={{ position: 'absolute', top: 10, right: 11, width: 8, height: 8, borderRadius: '50%', background: '#E5484D', border: '2px solid #fff' }} />}
        </RoundButton>
        <RoundButton icon="shopping_bag" size={44} label="Cart" onClick={() => router.push('/cart')}>
          {s.cart.length > 0 && (
            <span style={{ position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, borderRadius: 9, background: '#0172EA', color: '#fff', font: font(800, 10, '18px'), textAlign: 'center', padding: '0 4px', animation: 'pop .4s' }}>{s.cart.length}</span>
          )}
        </RoundButton>
      </div>

      {emo && (
        <Link href="/olympiads" className="press press-98" style={{ display: 'block', marginTop: 20, minHeight: 206, borderRadius: 28, background: '#0A1F4D', position: 'relative', overflow: 'hidden', padding: 22, color: '#F4F5FA' }}>
          <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle,rgba(1,114,234,.65),transparent 65%)', right: -110, top: -60 }} />
          <div style={{ position: 'absolute', width: 230, height: 230, borderRadius: '50%', border: '1px solid rgba(61,214,207,.25)', right: -60, top: -20 }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/elmaster-mark-light.png" alt="" style={{ position: 'absolute', right: -14, bottom: -24, height: 150, opacity: 0.95 }} />
          <div style={{ position: 'relative', maxWidth: 230 }}>
            <div style={{ font: font(800, 10), letterSpacing: '.18em', color: '#3DD6CF' }}>OLYMPIAD SEASON · {new Date(emo.date).getFullYear()}</div>
            <div style={{ ...display(700, 24, 1.05), marginTop: 10, maxWidth: 200 }}>{emo.name}</div>
            <div style={{ fontSize: 12.5, color: 'rgba(244,245,250,.7)', marginTop: 8 }}>{daysLeft > 0 ? `Registrations close in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Registrations closed'}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 14, height: 34, padding: '0 14px', borderRadius: 17, background: '#3DD6CF', color: '#0A1F4D', font: font(800, 12.5) }}>
              {emoCta}
              <Icon name="arrow_forward" size={17} />
            </div>
          </div>
        </Link>
      )}

      {cont && (
        <>
          <SectionHead title="Continue learning" action="See all" onAction={() => router.push('/learning')} />
          <div style={{ background: '#fff', borderRadius: 22, padding: 12, display: 'flex', gap: 14, alignItems: 'center', boxShadow: '0 10px 30px -18px rgba(10,31,77,.35)' }}>
            <BookCover c={cont} w={64} h={82} radius={12} spine={5} sym={29} symBottom={8} symLeft={11} onClick={() => router.push(`/course/${cont.id}`)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.25 }}>{cont.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                Lesson {lessonIdx + 1} of {cont.lessons} · {lessonTitle}
              </div>
              <ProgressBar pct={s.progress[cont.id] ?? 0} style={{ marginTop: 10 }} />
            </div>
            <Link href={`/learn/${cont.id}`} aria-label="Resume lesson" className="press press-90" style={{ width: 46, height: 46, flex: 'none', borderRadius: '50%', background: '#0A1F4D', color: '#F4F5FA', display: 'grid', placeItems: 'center' }}>
              <Icon name="play_arrow" size={26} fill />
            </Link>
          </div>
        </>
      )}

      <div className="noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '24px -20px 0', padding: '0 20px' }}>
        {CATS.slice(1).map(([label, icon]) => (
          <Link key={label} href={`/explore?cat=${encodeURIComponent(label)}`} style={{ flex: 'none', height: 44, padding: '0 16px 0 12px', borderRadius: 22, background: '#fff', display: 'flex', alignItems: 'center', gap: 8, font: font(700, 13), color: '#0A1F4D' }}>
            <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--tint)', display: 'grid', placeItems: 'center' }}>
              <Icon name={icon} size={17} color="#0B4FB3" />
            </span>
            {label}
          </Link>
        ))}
      </div>

      <SectionHead title="Popular this week" action="See all" onAction={() => router.push('/explore')} />
      <div className="noscroll" style={{ display: 'flex', gap: 14, overflowX: 'auto', margin: '0 -20px', padding: '0 20px 8px' }}>
        {popular.map((c) => (
          <div key={c.id} onClick={() => router.push(`/course/${c.id}`)} className="press" style={{ flex: 'none', width: 158, cursor: 'pointer' }}>
            <BookCover c={c} w="100%" h={200} radius={18} spine={8} sym={55} symBottom={34} symLeft={18} weight={800} lines num={{ top: 13, left: 20, size: 11 }} sub={{ bottom: 14, left: 20 }} shadow="0 14px 26px -16px rgba(10,31,77,.6)">
              <HeartButton on={s.wish.includes(c.id)} onClick={(e) => { e.stopPropagation(); toggleWish(c.id); }} style={{ position: 'absolute', top: 10, right: 10 }} />
            </BookCover>
            <div style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.3, marginTop: 10 }}>{c.title}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <Rating value={c.rating} />
              <span style={{ fontWeight: 800, fontSize: 13.5 }}>{fmt(c.price)}</span>
            </div>
          </div>
        ))}
      </div>

      {live && (
        <Link href="/live" style={{ display: 'block', marginTop: 22, borderRadius: 24, background: 'var(--tint)', padding: 18, position: 'relative', overflow: 'hidden', color: '#0A1F4D' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: font(800, 11), letterSpacing: '.1em', color: '#E5484D' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F0443A', animation: 'pulse 1.4s infinite' }} />
            LIVE NOW · {(live.watching ?? 0).toLocaleString('en-IN')} WATCHING
          </div>
          <div style={{ font: `700 18px/1.15 ${D}`, letterSpacing: '-.025em', marginTop: 10, paddingRight: 40 }}>{live.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 }}>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>with {live.host}</span>
            <span style={{ height: 34, padding: '0 14px', borderRadius: 17, background: '#0A1F4D', color: '#F4F5FA', font: font(800, 12, '34px') }}>Join class</span>
          </div>
        </Link>
      )}

      <Link href="/quiz" style={{ marginTop: 12, borderRadius: 24, background: '#fff', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14, color: '#0A1F4D' }}>
        <div style={{ width: 48, height: 48, borderRadius: 16, background: '#0A1F4D', display: 'grid', placeItems: 'center', color: '#3DD6CF' }}>
          <Icon name="timer" size={24} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14.5 }}>Daily mock · Number Theory</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{catalog.quiz.length} questions · 10 minutes · +40 XP</div>
        </div>
        <Icon name="chevron_right" size={22} color="#0172EA" />
      </Link>
    </div>
  );
}
