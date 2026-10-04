'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import type { Course } from '@/lib/types';

/** Display font (Plus Jakarta Sans) and body font (Manrope) CSS variables. */
export const D = 'var(--fd)';
export const B = 'var(--fb)';

export const font = (weight: number, size: number, lh?: number | string, family = B) => `${weight} ${size}px${lh ? '/' + lh : ''} ${family}`;
export const display = (weight: number, size: number, lh?: number | string): CSSProperties => ({ font: font(weight, size, lh, D), letterSpacing: '-.025em' });

export function Icon({ name, size = 22, fill, color, style, className = '' }: { name: string; size?: number; fill?: boolean; color?: string; style?: CSSProperties; className?: string }) {
  return (
    <span aria-hidden className={`ms${fill ? ' fill' : ''} ${className}`} style={{ fontSize: size, color, ...style }}>
      {name}
    </span>
  );
}

export function useBack(fallback = '/') {
  const router = useRouter();
  return () => (window.history.length > 1 ? router.back() : router.push(fallback));
}

const circle = (size: number, bg: string): CSSProperties => ({ width: size, height: size, flex: 'none', borderRadius: '50%', border: 'none', background: bg, display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 });

export function RoundButton({ icon, onClick, size = 42, bg = '#fff', color, iconSize = 22, fill, label, children, style }: { icon?: string; onClick?: (e: React.MouseEvent) => void; size?: number; bg?: string; color?: string; iconSize?: number; fill?: boolean; label: string; children?: ReactNode; style?: CSSProperties }) {
  return (
    <button aria-label={label} onClick={onClick} style={{ ...circle(size, bg), color, position: 'relative', ...style }}>
      {icon && <Icon name={icon} size={iconSize} fill={fill} />}
      {children}
    </button>
  );
}

export function BackButton({ icon = 'arrow_back', fallback }: { icon?: string; fallback?: string }) {
  const back = useBack(fallback);
  return <RoundButton icon={icon} label="Back" onClick={back} />;
}

/** "← Title" header used by stacked screens. */
export function PageHeader({ title, right, fallback }: { title: string; right?: ReactNode; fallback?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 'var(--top) 20px 8px' }}>
      <BackButton fallback={fallback} />
      <h1 style={{ ...display(700, 25, 1.05), margin: 0, flex: 1 }}>{title}</h1>
      {right}
    </div>
  );
}

export function SectionHead({ title, action, onAction, style }: { title: string; action?: string; onAction?: () => void; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', margin: '28px 0 12px', ...style }}>
      <h2 style={{ ...display(700, 20), margin: 0 }}>{title}</h2>
      {action && (
        <button onClick={onAction} style={{ border: 'none', background: 'none', font: font(700, 13), color: 'var(--blue)', cursor: 'pointer', padding: 0 }}>
          {action}
        </button>
      )}
    </div>
  );
}

export const chipColors = (active: boolean) => (active ? { bg: '#0A1F4D', fg: '#F4F5FA', bd: '#0A1F4D' } : { bg: '#fff', fg: '#0A1F4D', bd: 'rgba(10,31,77,.1)' });

export function Chip({ active, onClick, children, outlined = true, height = 38, padding = '0 15px', style }: { active: boolean; onClick: () => void; children: ReactNode; outlined?: boolean; height?: number; padding?: string; style?: CSSProperties }) {
  const c = chipColors(active);
  return (
    <button
      aria-pressed={active}
      onClick={onClick}
      style={{ flex: 'none', height, padding, borderRadius: height / 2, border: outlined ? `1.5px solid ${c.bd}` : 'none', background: c.bg, color: c.fg, font: font(700, 13), cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all .2s', ...style }}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ options, value, onChange, height = 34, size = 12.5, style }: { options: readonly T[]; value: T; onChange: (v: T) => void; height?: number; size?: number; style?: CSSProperties }) {
  return (
    <div role="tablist" style={{ display: 'flex', background: 'var(--seg)', borderRadius: 14, padding: 4, ...style }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} role="tab" aria-selected={on} onClick={() => onChange(o)} style={{ flex: 1, height, borderRadius: 10, border: 'none', background: on ? '#fff' : 'transparent', boxShadow: on ? '0 2px 6px rgba(10,31,77,.1)' : 'none', font: font(700, size), color: '#0A1F4D', cursor: 'pointer', transition: 'all .2s' }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function TabLine<T extends string>({ options, value, onChange, style }: { options: readonly T[]; value: T; onChange: (v: T) => void; style?: CSSProperties }) {
  return (
    <div role="tablist" style={{ display: 'flex', gap: 22, borderBottom: '1px solid var(--line)', ...style }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} role="tab" aria-selected={on} onClick={() => onChange(o)} style={{ border: 'none', background: 'none', padding: '0 0 12px', font: font(800, 14), color: on ? '#0A1F4D' : '#959BAD', borderBottom: `2.5px solid ${on ? '#0172EA' : 'transparent'}`, marginBottom: -1, cursor: 'pointer', transition: 'all .2s' }}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{ width: 50, height: 30, flex: 'none', borderRadius: 15, border: 'none', padding: 0, background: on ? '#0172EA' : '#CDD1DE', position: 'relative', cursor: 'pointer', transition: 'background .25s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 24, height: 24, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 4px rgba(0,0,0,.2)', transition: 'left .25s var(--ease)' }} />
    </button>
  );
}

export function ProgressBar({ pct, height = 6, style }: { pct: number; height?: number; style?: CSSProperties }) {
  return (
    <div style={{ height, borderRadius: height / 2, background: 'var(--tint)', overflow: 'hidden', ...style }}>
      <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,#0172EA,#3DD6CF)', borderRadius: height / 2, transition: 'width .6s' }} />
    </div>
  );
}

export function Stars({ size = 14 }: { size?: number }) {
  return (
    <span aria-label="5 stars" className="ms fill" style={{ color: 'var(--star)', fontSize: size, letterSpacing: -2 }}>
      star star star star star
    </span>
  );
}

export function Rating({ value, size = 12 }: { value: number; size?: number }) {
  return (
    <span style={{ fontSize: size, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 2 }}>
      <Icon name="star" size={15} fill color="var(--star)" />
      {value}
    </span>
  );
}

/** The book-style course cover: spine on the left, big two-letter monogram. */
export function BookCover({ c, w, h, radius, spine, sym, symBottom, symLeft, num, sub, lines, shadow, children, onClick, weight = 700 }: {
  c: Pick<Course, 'cover' | 'ink' | 'sym' | 'num' | 'subject'>;
  w: number | string; h: number; radius: number; spine: number; sym: number; symBottom: number; symLeft: number;
  num?: { top: number; left: number; size: number }; sub?: { bottom: number; left: number }; lines?: boolean; shadow?: string;
  children?: ReactNode; onClick?: () => void; weight?: 700 | 800;
}) {
  return (
    <div onClick={onClick} style={{ width: w, height: h, flex: 'none', borderRadius: radius, background: c.cover, position: 'relative', overflow: 'hidden', boxShadow: shadow, cursor: onClick ? 'pointer' : undefined }}>
      {lines && <div style={{ position: 'absolute', inset: 0, background: 'repeating-linear-gradient(90deg,rgba(255,255,255,.03) 0 1px,transparent 1px 4px)' }} />}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: spine, background: `rgba(0,0,0,${spine >= 8 ? 0.18 : 0.2})` }} />
      {num && <div style={{ position: 'absolute', top: num.top, left: num.left, font: font(700, num.size), color: c.ink, opacity: 0.7 }}>{c.num}</div>}
      <div style={{ position: 'absolute', bottom: symBottom, left: symLeft, font: font(weight, sym, 1.05, D), letterSpacing: weight === 800 ? '-.05em' : '-.025em', color: c.ink }}>{c.sym}</div>
      {sub && <div style={{ position: 'absolute', bottom: sub.bottom, left: sub.left, font: font(800, 9), letterSpacing: '.14em', color: c.ink, opacity: 0.8 }}>{c.subject.toUpperCase()}</div>}
      {children}
    </div>
  );
}

export function HeartButton({ on, onClick, size = 34, iconSize = 19, bg = 'rgba(255,255,255,.92)', style }: { on: boolean; onClick: (e: React.MouseEvent) => void; size?: number; iconSize?: number; bg?: string; style?: CSSProperties }) {
  return (
    <button aria-label={on ? 'Remove from wishlist' : 'Save to wishlist'} aria-pressed={on} onClick={onClick} style={{ ...circle(size, bg), ...style }}>
      <Icon name="favorite" size={iconSize} fill={on} color={on ? '#E5484D' : '#0A1F4D'} />
    </button>
  );
}

/** Frosted bar pinned to the bottom of the screen (course, cart, checkout). */
export function BottomBar({ children, animate, style }: { children: ReactNode; animate?: boolean; style?: CSSProperties }) {
  return (
    <div className="fixed-col" style={{ bottom: 0, padding: '14px 20px calc(16px + var(--safe-b))', background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderTop: '1px solid rgba(10,31,77,.06)', display: 'flex', alignItems: 'center', gap: 12, zIndex: 40, animation: animate ? 'sheetUp .4s var(--ease)' : undefined, ...style }}>
      {children}
    </div>
  );
}

export const primaryBtn = (h: number, size = 15): CSSProperties => ({ height: h, borderRadius: h / 2, border: 'none', background: '#0A1F4D', color: '#F4F5FA', font: font(800, size), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 });
export const outlineBtn = (h: number, size = 14): CSSProperties => ({ height: h, borderRadius: h / 2, border: '1.5px solid #0A1F4D', background: 'transparent', color: '#0A1F4D', font: font(800, size), cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 });
export const card = (radius = 20, padding: number | string = 14): CSSProperties => ({ background: '#fff', borderRadius: radius, padding });
export const label: CSSProperties = { font: font(700, 11), letterSpacing: '.08em', color: 'var(--muted)' };
