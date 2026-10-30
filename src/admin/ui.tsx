import { createContext, useCallback, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../store/api';

export function Page({ title, subtitle, actions, back, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; children: ReactNode }) {
  return (
    <div className="ad-page">
      {back && <Link to={back.to} className="ad-back">← {back.label}</Link>}
      <div className="ad-page__head">
        <div className="ad-page__titles">
          <h1 className="ad-page__title">{title}</h1>
          {subtitle && <div className="ad-page__sub">{subtitle}</div>}
        </div>
        {actions && <div className="ad-page__actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className = '', flush = false }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={`ad-card ${flush ? 'ad-card--flush' : ''} ${className}`}>
      {(title || actions) && <div className="ad-card__head">{title && <h2 className="ad-card__title">{title}</h2>}{actions}</div>}
      {children}
    </section>
  );
}

export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'navy';
export const Badge = ({ tone = 'grey', children }: { tone?: Tone; children: ReactNode }) => <span className={`ad-badge ad-badge--${tone}`}>{children}</span>;

const PAY: Record<string, [string, Tone]> = {
  pending: ['Awaiting payment', 'amber'], paid: ['Paid', 'green'], partially_refunded: ['Partly refunded', 'blue'],
  refunded: ['Refunded', 'grey'], failed: ['Payment failed', 'red'], expired: ['Not paid', 'grey'],
};
const FUL: Record<string, [string, Tone]> = {
  unfulfilled: ['Unfulfilled', 'amber'], packed: ['Packed', 'blue'], shipped: ['Shipped', 'navy'], delivered: ['Delivered', 'green'], not_required: ['Digital', 'grey'],
};
export const PayBadge = ({ s }: { s: string }) => <Badge tone={PAY[s]?.[1]}>{PAY[s]?.[0] ?? s}</Badge>;
export const FulBadge = ({ s }: { s: string }) => <Badge tone={FUL[s]?.[1]}>{FUL[s]?.[0] ?? s}</Badge>;
export const STATUS_TONE: Record<string, Tone> = { active: 'green', draft: 'amber', archived: 'grey' };

export function Btn({ kind = 'secondary', size, busy, children, ...rest }: { kind?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent'; size?: 'sm'; busy?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={`ad-btn ad-btn--${kind}${size ? ' ad-btn--sm' : ''} ${rest.className ?? ''}`}>
      {busy ? <span className="ad-spin" aria-hidden="true" /> : null}{children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ad-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'ad-modal' + (wide ? ' ad-modal--wide' : '')} role="dialog" aria-modal="true">
        <div className="ad-modal__head"><h2>{title}</h2><button type="button" className="ad-x" aria-label="Close" onClick={onClose}>×</button></div>
        <div className="ad-modal__body">{children}</div>
        {footer && <div className="ad-modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

type FieldProps = { label: ReactNode; hint?: ReactNode; error?: string; className?: string };
/** Clean accessible name for the control (otherwise a <select>'s options leak into it). */
const name = (label: ReactNode) => (typeof label === 'string' ? label : undefined);

export function TextField({ label, hint, error, className = '', ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return <label className={`ad-field ${error ? 'has-error' : ''} ${className}`}><span>{label}</span><input aria-label={name(label)} {...rest} />{hint && <small>{hint}</small>}{error && <em>{error}</em>}</label>;
}
export function MoneyField({ label, hint, error, className = '', ...rest }: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`ad-field ${error ? 'has-error' : ''} ${className}`}>
      <span>{label}</span>
      <div className="ad-money"><b>₹</b><input inputMode="decimal" aria-label={name(label)} {...rest} /></div>
      {hint && <small>{hint}</small>}{error && <em>{error}</em>}
    </label>
  );
}
export function TextArea({ label, hint, error, className = '', ...rest }: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <label className={`ad-field ${error ? 'has-error' : ''} ${className}`}><span>{label}</span><textarea aria-label={name(label)} {...rest} />{hint && <small>{hint}</small>}{error && <em>{error}</em>}</label>;
}
export function SelectField({ label, hint, error, className = '', children, ...rest }: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className={`ad-field ${error ? 'has-error' : ''} ${className}`}><span>{label}</span><select aria-label={name(label)} {...rest}>{children}</select>{hint && <small>{hint}</small>}{error && <em>{error}</em>}</label>;
}
export function Check({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={'ad-check' + (disabled ? ' is-disabled' : '')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
    </label>
  );
}
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={'ad-toggle' + (checked ? ' is-on' : '')} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Pagination({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return <div className="ad-pager"><span>{total} result{total === 1 ? '' : 's'}</span></div>;
  return (
    <div className="ad-pager">
      <span>{(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
      <Btn size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>← Previous</Btn>
      <Btn size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next →</Btn>
    </div>
  );
}

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="ad-empty"><div className="ad-empty__title">{title}</div>{children}</div>
);
export const Loading = () => <div className="ad-loading"><span className="ad-spin" /> Loading…</div>;
export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return <div className="ad-error">{errorMessage(error)}{retry && <Btn size="sm" onClick={retry}>Try again</Btn>}</div>;
}

/* ---------------- Toasts ---------------- */

type Toast = { id: number; text: string; tone: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="ad-toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className={`ad-toast ad-toast--${t.tone}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** Run an action with a busy flag and success / error toasts. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(errorMessage(e), 'error');
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [toast]);
  return { busy, run };
}
