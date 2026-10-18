import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <label className="field">{label}<input className="input" {...input} /></label>;
}

export function SelectField({ label, children, ...rest }: { label: string; children: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  return <label className="field">{label}<select className="input" {...rest}>{children}</select></label>;
}

export function TextField({ label, ...rest }: { label: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <label className="field">{label}<textarea className="input input--area" rows={5} {...rest} /></label>;
}

/** Pill toggle used for roles, Study Hub kinds and distributor states. */
export function Pill({ on, onClick, children, sm = false }: { on: boolean; onClick: () => void; children: ReactNode; sm?: boolean }) {
  return (
    <button type="button" aria-pressed={on} className={'pill' + (on ? ' is-on' : '') + (sm ? ' pill--sm' : '')} onClick={onClick}>
      {children}
    </button>
  );
}
