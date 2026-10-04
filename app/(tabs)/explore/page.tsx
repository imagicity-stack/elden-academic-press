'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState } from 'react';
import { CATS } from '@/lib/cats';
import { fmt } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Course } from '@/lib/types';
import { BookCover, Chip, HeartButton, Icon, Rating, Segmented, Toggle, display, font, outlineBtn, primaryBtn } from '@/components/ui';

const SORTS = ['Popular', 'Top rated', 'Price'] as const;
const LEVELS = ['Any', 'Beginner', 'Intermediate', 'Advanced'] as const;
const GRADES = ['Any', 'Middle school', 'High school'] as const;

export default function ExplorePage() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}

function Explore() {
  const router = useRouter();
  const params = useSearchParams();
  const { s, catalog, toggleWish } = useStore();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>(params.get('cat') ?? 'All');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('Popular');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>('Any');
  const [gradeF, setGradeF] = useState<(typeof GRADES)[number]>('Any');
  const [under, setUnder] = useState(false);
  const [sheet, setSheet] = useState(false);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const ok = (c: Course) =>
      (cat === 'All' || c.tags.includes(cat)) &&
      (!ql || (c.title + c.instructor + c.subject).toLowerCase().includes(ql)) &&
      (level === 'Any' || c.level === level) &&
      (!under || c.price < 2000) &&
      (gradeF === 'Any' || (gradeF === 'Middle school' ? /Grade [67]/.test(c.grade) : /1[012]/.test(c.grade)));
    return catalog.courses.filter(ok).sort((a, b) => (sort === 'Top rated' ? b.rating - a.rating : sort === 'Price' ? a.price - b.price : b.pop - a.pop));
  }, [catalog.courses, q, cat, level, under, gradeF, sort]);

  const hasFilters = level !== 'Any' || under || gradeF !== 'Any';
  const reset = () => { setLevel('Any'); setUnder(false); setGradeF('Any'); setCat('All'); setQ(''); };

  return (
    <>
      <div className="scr-in" style={{ padding: 'var(--top) 20px 0' }}>
        <h1 style={{ ...display(700, 32, 1.05), margin: 0 }}>Explore</h1>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
          {list.length} {list.length === 1 ? 'course' : 'courses'}
          {cat !== 'All' ? ' in ' + cat : ' · curated by ElMaster faculty'}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <label className="search" style={{ flex: 1, height: 52, borderRadius: 18, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', border: '1.5px solid transparent' }}>
            <Icon name="search" size={22} color="var(--muted)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Courses, subjects, teachers" aria-label="Search courses" style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', font: font(600, 14) }} />
          </label>
          <button aria-label="Filters" onClick={() => setSheet(true)} style={{ width: 52, height: 52, borderRadius: 18, border: 'none', background: '#0A1F4D', color: '#F4F5FA', display: 'grid', placeItems: 'center', cursor: 'pointer', position: 'relative' }}>
            <Icon name="tune" size={22} />
            {hasFilters && <span style={{ position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: '50%', background: '#3DD6CF' }} />}
          </button>
        </div>

        <div className="noscroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', margin: '16px -20px 0', padding: '0 20px' }}>
          {CATS.map(([label]) => (
            <Chip key={label} active={label === cat} onClick={() => setCat(label)} outlined={false}>
              {label}
            </Chip>
          ))}
        </div>

        <Segmented options={SORTS} value={sort} onChange={setSort} style={{ marginTop: 14 }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
          {list.map((c) => (
            <div key={c.id} onClick={() => router.push(`/course/${c.id}`)} className="press press-98" style={{ background: '#fff', borderRadius: 22, padding: 12, display: 'flex', gap: 14, cursor: 'pointer', position: 'relative', animation: 'scrIn .35s both' }}>
              <BookCover c={c} w={78} h={100} radius={13} spine={6} sym={34} symBottom={10} symLeft={12} num={{ top: 8, left: 13, size: 9 }} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingRight: 30 }}>
                <div style={{ font: font(800, 9.5), letterSpacing: '.12em', color: '#0172EA' }}>{c.subject.toUpperCase()}</div>
                <div style={{ fontWeight: 800, fontSize: 14.5, lineHeight: 1.25, marginTop: 4 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{c.instructor}</div>
                <div style={{ flex: 1 }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span style={{ fontWeight: 800, fontSize: 15 }}>{fmt(c.price)}</span>
                  <span style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'line-through' }}>{fmt(c.mrp)}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <Rating value={c.rating} />
                  </span>
                </div>
              </div>
              <HeartButton on={s.wish.includes(c.id)} bg="#F4F5FA" onClick={(e) => { e.stopPropagation(); toggleWish(c.id); }} style={{ position: 'absolute', top: 10, right: 10 }} />
            </div>
          ))}
          {list.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={display(700, 20)}>Nothing matches — yet</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>Try a different subject or clear filters.</div>
              <button onClick={reset} style={{ ...primaryBtn(42, 13), margin: '16px auto 0', padding: '0 20px' }}>Clear filters</button>
            </div>
          )}
        </div>
      </div>

      {sheet && (
        <>
          <div className="fixed-col" onClick={() => setSheet(false)} style={{ top: 0, bottom: 0, background: 'rgba(6,23,58,.45)', zIndex: 70, animation: 'fadeIn .25s' }} />
          <div role="dialog" aria-label="Filters" className="fixed-col" style={{ bottom: 0, background: '#F4F5FA', borderRadius: '30px 30px 0 0', padding: '12px 22px calc(34px + var(--safe-b))', zIndex: 71, animation: 'sheetUp .35s var(--ease)' }}>
            <div style={{ width: 40, height: 5, borderRadius: 3, background: 'rgba(10,31,77,.15)', margin: '0 auto' }} />
            <div style={{ ...display(700, 24), marginTop: 14 }}>Filters</div>
            <SheetLabel>LEVEL</SheetLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {LEVELS.map((l) => <Chip key={l} active={l === level} onClick={() => setLevel(l)}>{l}</Chip>)}
            </div>
            <SheetLabel style={{ marginTop: 20 }}>GRADE</SheetLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
              {GRADES.map((l) => <Chip key={l} active={l === gradeF} onClick={() => setGradeF(l)}>{l}</Chip>)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, background: '#fff', borderRadius: 18, padding: '14px 16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>Under ₹2,000</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Show budget-friendly courses only</div>
              </div>
              <Toggle on={under} onChange={setUnder} label="Under ₹2,000" />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={reset} style={{ ...outlineBtn(54), flex: 1 }}>Reset</button>
              <button onClick={() => setSheet(false)} style={{ ...primaryBtn(54, 14), flex: 2 }}>Show {list.length} results</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SheetLabel({ children, style }: { children: string; style?: React.CSSProperties }) {
  return <div style={{ font: font(800, 11), letterSpacing: '.1em', color: 'var(--muted)', marginTop: 16, ...style }}>{children}</div>;
}
