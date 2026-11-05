// Form pieces shared by onboarding, the children page and the approval page.
import type { InputHTMLAttributes } from 'react';
import { CLASSES } from '../shared/competition';
import { CONSENT_TEXT, type ConsentKind } from '../shared/consents';
import { useStoreConfig } from '../store/catalog';
import { fieldError } from '../store/api';

export interface ChildDraft { firstName: string; lastName: string; classGrade: string; schoolName: string; city: string; state: string }
export interface ParentDraft { fullName: string; whatsapp: string; city: string; state: string }
export type Consents = Record<ConsentKind, boolean>;

export const emptyChild = (): ChildDraft => ({ firstName: '', lastName: '', classGrade: '', schoolName: '', city: '', state: '' });
export const emptyParent = (): ParentDraft => ({ fullName: '', whatsapp: '', city: '', state: '' });
/** Taking part must be ticked by the parent; book news starts ticked, showing entries doesn't. */
export const defaultConsents = (): Consents => ({ data_processing: false, publication: false, marketing: true });

export const childPayload = (c: ChildDraft) => ({ ...c, classGrade: Number(c.classGrade) || 0 });

function Err({ error, path }: { error: unknown; path: string[] }) {
  const m = fieldError(error, ...path);
  return m ? <span className="field__error">{m}</span> : null;
}

function Input({ label, value, onChange, error, path, ...rest }: {
  label: string; value: string; onChange: (v: string) => void; error?: unknown; path: string[];
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const bad = Boolean(fieldError(error, ...path));
  return (
    <label className={'field' + (bad ? ' has-error' : '')}>{label}
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad || undefined} {...rest} />
      <Err error={error} path={path} />
    </label>
  );
}

export function StateSelect({ value, onChange, error, path }: { value: string; onChange: (v: string) => void; error?: unknown; path: string[] }) {
  const cfg = useStoreConfig();
  const bad = Boolean(fieldError(error, ...path));
  return (
    <label className={'field' + (bad ? ' has-error' : '')}>State
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {(cfg?.states ?? []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
      </select>
      <Err error={error} path={path} />
    </label>
  );
}

export function ChildFields({ value, onChange, error, prefix = [], only }: {
  value: ChildDraft; onChange: (v: ChildDraft) => void; error?: unknown; prefix?: string[]; only?: (keyof ChildDraft)[];
}) {
  const set = (k: keyof ChildDraft) => (v: string) => onChange({ ...value, [k]: v });
  const show = (k: keyof ChildDraft) => !only || only.includes(k);
  return (
    <div className="cp-fields">
      {show('firstName') && <Input label="First name" value={value.firstName} onChange={set('firstName')} error={error} path={[...prefix, 'firstName']} autoComplete="off" required maxLength={60} />}
      {show('lastName') && <Input label="Last name" value={value.lastName} onChange={set('lastName')} error={error} path={[...prefix, 'lastName']} autoComplete="off" required maxLength={60} />}
      {show('classGrade') && (
        <label className={'field' + (fieldError(error, ...prefix, 'classGrade') ? ' has-error' : '')}>Class
          <select className="input" value={value.classGrade} onChange={(e) => set('classGrade')(e.target.value)} required>
            <option value="">Choose…</option>
            {CLASSES.map((n) => <option key={n} value={n}>Class {n}</option>)}
          </select>
          <Err error={error} path={[...prefix, 'classGrade']} />
        </label>
      )}
      {show('schoolName') && <Input label="School" value={value.schoolName} onChange={set('schoolName')} error={error} path={[...prefix, 'schoolName']} required maxLength={150} />}
      {show('city') && <Input label="City or town" value={value.city} onChange={set('city')} error={error} path={[...prefix, 'city']} required maxLength={80} />}
      {show('state') && <StateSelect value={value.state} onChange={set('state')} error={error} path={[...prefix, 'state']} />}
    </div>
  );
}

export function ParentFields({ value, onChange, error, prefix = [] }: { value: ParentDraft; onChange: (v: ParentDraft) => void; error?: unknown; prefix?: string[] }) {
  const set = (k: keyof ParentDraft) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="cp-fields">
      <Input label="Your full name" value={value.fullName} onChange={set('fullName')} error={error} path={[...prefix, 'fullName']} autoComplete="name" required maxLength={120} />
      <Input label="WhatsApp number" value={value.whatsapp} onChange={set('whatsapp')} error={error} path={[...prefix, 'whatsapp']} type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="10-digit mobile" required />
      <Input label="City or town" value={value.city} onChange={set('city')} error={error} path={[...prefix, 'city']} autoComplete="address-level2" required maxLength={80} />
      <StateSelect value={value.state} onChange={set('state')} error={error} path={[...prefix, 'state']} />
    </div>
  );
}

/** The one-time consents for a child, given by the parent. */
export function ConsentChecks({ value, onChange, childName, only }: { value: Consents; onChange: (v: Consents) => void; childName?: string; only?: ConsentKind[] }) {
  const kinds = only ?? (['data_processing', 'publication', 'marketing'] as ConsentKind[]);
  return (
    <div className="cp-consents">
      {kinds.map((k) => (
        <label key={k} className="tick">
          <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} required={CONSENT_TEXT[k].required} />
          <span className="tick__box" aria-hidden="true" />
          <span><b>{CONSENT_TEXT[k].label}</b><small>{childName ? CONSENT_TEXT[k].text.replace(/my child’s/g, `${childName}’s`).replace(/my child/g, childName) : CONSENT_TEXT[k].text}</small></span>
        </label>
      ))}
    </div>
  );
}
