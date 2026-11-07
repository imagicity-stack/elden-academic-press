// One popup, as visitors see it, and as the admin's builder previews it (the same component).
// Centred (a bottom sheet on phones), slide-in card, top or bottom bar, or full screen (a centred
// card on phones). No raw HTML: text goes through RichText, links through safeHref.
import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { RichText } from '../RichText';
import { Countdown } from '../Countdown';
import { safeHref } from '../../shared/links';
import type { PopupContent, PopupDesign } from '../../shared/popups';
import '../../popups.css';

export type CloseReason = 'x' | 'dismiss' | 'overlay' | 'esc';
export interface PopupViewProps {
  content: PopupContent;
  design: PopupDesign;
  /** The builder's preview: drawn inside its frame, at this device's size. */
  preview?: 'desktop' | 'mobile';
  /** Start on the "signed up" message (builder preview). */
  initialStage?: 'main' | 'success';
  onClose(reason: CloseReason): void;
  /** The main button (link, coupon and announcement popups). */
  onPrimary(url: string): void;
  onSubscribe(f: { name?: string; email: string; phone: string }): Promise<void>;
  onApplyCoupon?(code: string): void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function PopupView({ content: c, design: d, preview, initialStage = 'main', onClose, onPrimary, onSubscribe, onApplyCoupon }: PopupViewProps) {
  const [stage, setStage] = useState(initialStage);
  useEffect(() => setStage(initialStage), [initialStage]);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const blocking = d.layout === 'modal' || d.layout === 'fullscreen';

  // Keyboard: Esc closes; a centred or full-screen popup takes focus and keeps it until closed.
  useEffect(() => {
    if (preview) return;
    const before = document.activeElement as HTMLElement | null;
    // Into the first field if there is one, else the popup itself (not the ×, which would look selected).
    if (blocking) (box.current?.querySelector<HTMLElement>('input:not([type="checkbox"]):not(.hp)') ?? box.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (blocking || box.current?.contains(document.activeElement))) { e.preventDefault(); onClose('esc'); }
      if (e.key !== 'Tab' || !blocking || !box.current) return;
      const els = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!els.length) return;
      const [first, last] = [els[0], els[els.length - 1]];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (blocking) before?.focus?.(); };
  }, [preview, blocking, onClose]);

  const style = {
    '--pp-bg': d.colors.background, '--pp-text': d.colors.text, '--pp-accent': d.colors.accent, '--pp-accent-text': d.colors.accentText,
    '--pp-radius': `${d.radius}px`, '--pp-overlay': String(d.overlay / 100),
    ...(c.image && d.imagePosition === 'background' ? { '--pp-bg-image': `url("${c.image.replace(/["\\]/g, '')}")` } : {}),
  } as CSSProperties;
  const cls = ['pp', `pp--${d.layout}`, `pp--${d.position}`, `pp--${d.size}`, `pp--img-${c.image ? d.imagePosition : 'none'}`, `pp--${d.align}`, `pp--font-${d.font}`, `pp--anim-${d.animation}`,
    preview ? `pp--contained pp--${preview}` : ''].filter(Boolean).join(' ');
  const href = safeHref(c.button.url);
  const close = (
    <button type="button" className="pp__close" aria-label="Close" onClick={() => onClose('x')}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  );

  if (d.layout === 'bar') {
    return (
      <div className={cls} style={style}>
        <div className="pp__bar" role="region" aria-label={c.heading || 'Announcement'} ref={box}>
          <div className="pp__bar-text"><b>{c.heading}</b>{c.body && <span> {c.body.replace(/[*_[\]()]/g, '')}</span>}</div>
          {c.goal === 'coupon' && c.coupon && <CouponCode code={c.coupon} compact onApply={onApplyCoupon} />}
          {c.button.label && href && <button type="button" className="pp__primary pp__primary--small" onClick={() => onPrimary(href)}>{c.button.label}</button>}
          {close}
        </div>
      </div>
    );
  }

  const success = c.goal === 'subscribe' && stage === 'success';
  const body: ReactNode = success ? (
    <>
      <h2 id={titleId} className="pp__heading">{c.success.heading}</h2>
      {c.success.body && <p className="pp__text">{c.success.body}</p>}
      {c.coupon && <CouponCode code={c.coupon} onApply={onApplyCoupon} />}
      <button type="button" className="pp__primary" onClick={() => onClose('dismiss')}>{c.coupon ? 'Start shopping' : 'Close'}</button>
    </>
  ) : (
    <>
      {c.eyebrow && <div className="pp__eyebrow">{c.eyebrow}</div>}
      <h2 id={titleId} className="pp__heading">{c.heading}</h2>
      {c.body && <RichText text={c.body} className="pp__text" />}
      {c.countdownTo && <div className="pp__countdown"><Countdown to={c.countdownTo} label="Ends in" /></div>}
      {c.goal === 'subscribe' && <SubscribeForm c={c} preview={Boolean(preview)} onDone={() => setStage('success')} onSubscribe={onSubscribe} />}
      {c.goal === 'coupon' && c.coupon && <CouponCode code={c.coupon} onApply={onApplyCoupon} />}
      {c.goal !== 'subscribe' && c.button.label && href && <button type="button" className="pp__primary" onClick={() => onPrimary(href)}>{c.button.label}</button>}
      {c.dismissLabel && <button type="button" className="pp__dismiss" onClick={() => onClose('dismiss')}>{c.dismissLabel}</button>}
    </>
  );

  return (
    <div className={cls} style={style}>
      {blocking && <div className="pp__overlay" onClick={() => onClose('overlay')} aria-hidden="true" />}
      <div className="pp__box" ref={box} role="dialog" aria-modal={blocking ? 'true' : 'false'} aria-labelledby={titleId} tabIndex={-1}>
        {close}
        {c.image && d.imagePosition !== 'background' && <img className="pp__img" src={c.image} alt={c.imageAlt} />}
        <div className="pp__body">{body}</div>
      </div>
    </div>
  );
}

function SubscribeForm({ c, preview, onDone, onSubscribe }: { c: PopupContent; preview: boolean; onDone(): void; onSubscribe: PopupViewProps['onSubscribe'] }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [agree, setAgree] = useState(true);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (preview) { onDone(); return; }
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    if (f.website) return; // a bot filled the hidden field
    setBusy(true); setErr(null);
    try { await onSubscribe({ name: f.name || undefined, email: f.email, phone: f.phone }); onDone(); }
    catch (e2) { setErr((e2 as Error).message || 'Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <form className="pp__form" onSubmit={submit}>
      {c.askName && <input className="pp__input" name="name" autoComplete="name" placeholder="Your name" aria-label="Your name" maxLength={120} />}
      <input className="pp__input" name="email" type="email" autoComplete="email" placeholder="Email address" aria-label="Email address" required maxLength={200} />
      <input className="pp__input" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="Mobile number" aria-label="Mobile number" required maxLength={16} />
      <label className="pp__agree">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
        <span>Email me about new books, sample papers and offers. I can unsubscribe any time.</span>
      </label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      {err && <div className="pp__error" role="alert">{err}</div>}
      <button type="submit" className="pp__primary" disabled={busy}>{busy ? 'One moment…' : c.submitLabel || 'Subscribe'}</button>
    </form>
  );
}

function CouponCode({ code, compact = false, onApply }: { code: string; compact?: boolean; onApply?(code: string): void }) {
  const [done, setDone] = useState<'' | 'copied' | 'applied'>('');
  const copy = () => { navigator.clipboard?.writeText(code).then(() => setDone('copied'), () => {}); };
  return (
    <div className={'pp__coupon' + (compact ? ' pp__coupon--compact' : '')}>
      <code className="pp__code">{code}</code>
      <button type="button" className="pp__coupon-btn" onClick={copy}>{done === 'copied' ? 'Copied' : 'Copy'}</button>
      {onApply && !compact && <button type="button" className="pp__coupon-btn" onClick={() => { onApply(code); setDone('applied'); }}>{done === 'applied' ? 'Added to your cart' : 'Apply to my cart'}</button>}
    </div>
  );
}
