// Shared motion pieces for the site (Motion, formerly Framer Motion). Every
// animation here respects the visitor's "reduce motion" setting through the
// <MotionConfig reducedMotion="user"> in App.tsx.
import { Fragment, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react';
import { animate, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

export const EASE = [0.2, 0.8, 0.2, 1] as const;

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div' }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: 'div' | 'section' | 'li' | 'span' }) {
  const M = motion[as];
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '0px 0px -12% 0px' }} transition={{ duration: 0.7, ease: EASE, delay }}>
      {children}
    </M>
  );
}

/** A container whose direct <StaggerItem> children reveal one after another. */
export function Stagger({ children, className, gap = 0.08, as = 'div' }: { children: ReactNode; className?: string; gap?: number; as?: 'div' | 'ul' | 'ol' }) {
  const M = motion[as];
  return (
    <M className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: '0px 0px -10% 0px' }} variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }}>
      {children}
    </M>
  );
}

export function StaggerItem({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' }) {
  const M = motion[as];
  return (
    <M className={className} variants={{ hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } } }}>
      {children}
    </M>
  );
}

/** Headline whose words rise out of a mask, one after another. */
export function SplitWords({ text, className, delay = 0, as: Tag = 'span' }: { text: string; className?: string; delay?: number; as?: ElementType }) {
  return (
    <Tag className={className} aria-label={text}>
      {text.split(' ').map((w, i) => (
        <Fragment key={i}>
          <span className="split__mask" aria-hidden="true">
            <motion.span className="split__word" initial={{ y: '110%' }} animate={{ y: '0%' }} transition={{ duration: 0.85, ease: EASE, delay: delay + i * 0.07 }}>
              {w}
            </motion.span>
          </span>{' '}
        </Fragment>
      ))}
    </Tag>
  );
}

/** A word or phrase that gets a highlighter stroke when it scrolls into view. */
export function Highlight({ children, delay = 0.2, color }: { children: ReactNode; delay?: number; color?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -10% 0px' });
  return (
    <span ref={ref} className="hl">
      <motion.span className="hl__mark" aria-hidden="true" style={color ? { background: color } : undefined}
        initial={{ scaleX: 0 }} animate={{ scaleX: inView ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE, delay }} />
      <span className="hl__text">{children}</span>
    </span>
  );
}

/** Tilts toward the pointer in 3D, like a book picked up off the table. */
export function Tilt({ children, className, max = 10 }: { children: ReactNode; className?: string; max?: number }) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0.5);
  const y = useMotionValue(0.5);
  const rx = useSpring(useTransform(y, [0, 1], [max, -max]), { stiffness: 180, damping: 18 });
  const ry = useSpring(useTransform(x, [0, 1], [-max, max]), { stiffness: 180, damping: 18 });
  const glare = useTransform(x, [0, 1], ['-30%', '130%']);
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={'tilt ' + (className ?? '')} style={{ rotateX: rx, rotateY: ry }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left) / r.width);
        y.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => { x.set(0.5); y.set(0.5); }}>
      {children}
      <motion.span className="tilt__glare" aria-hidden="true" style={{ left: glare }} />
    </motion.div>
  );
}

/** Counts up to `to` the first time it is seen. */
export function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [n, setN] = useState(reduce ? to : 0);
  useEffect(() => {
    if (!inView || reduce) { setN(to); return; }
    const c = animate(0, to, { duration: 1.4, ease: EASE, onUpdate: (v) => setN(Math.round(v)) });
    return () => c.stop();
  }, [inView, to, reduce]);
  return <span ref={ref}>{n}{suffix}</span>;
}

/** Endless horizontal ticker. Content is repeated so the loop is seamless. */
export function Marquee({ children, className, speed = 40, reverse = false }: { children: ReactNode; className?: string; speed?: number; reverse?: boolean }) {
  return (
    <div className={'marquee ' + (className ?? '')} style={{ ['--marquee-speed' as string]: `${speed}s` }}>
      <div className={'marquee__track' + (reverse ? ' is-reverse' : '')}>
        <div className="marquee__group">{children}</div>
        <div className="marquee__group" aria-hidden="true" inert>{children}</div>
      </div>
    </div>
  );
}

export function Arrow({ className = 'btn__arrow' }: { className?: string }) {
  return <svg className={className} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 10h11M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
