import { useState, type FormEvent } from 'react';
import { accountApi, type AccountType, type Profile } from '../store/account';
import { errorMessage } from '../store/api';
import { useStoreConfig } from '../store/catalog';
import { ACCOUNT_TYPES } from '../shared/competitions';

/** "Complete your profile": name, WhatsApp, city, state and who they are. Used on the account page and before registering. */
export function ProfileForm({ profile, name, onSaved, submitLabel = 'Save profile' }: { profile: Profile; name: string; onSaved: (p: Profile) => void; submitLabel?: string }) {
  const cfg = useStoreConfig();
  const [f, setF] = useState({ fullName: profile.fullName || name, phone: profile.phone, city: profile.city, state: profile.state, type: profile.type ?? '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const p = await accountApi<Profile>('/profile', { method: 'PUT', body: { ...f, type: f.type as AccountType } });
      setSaved(true);
      onSaved(p);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="profile-form" onSubmit={save}>
      <div className="profile-form__grid">
        <label className="field">Full name
          <input className="input input--white" value={f.fullName} onChange={set('fullName')} required minLength={2} maxLength={80} autoComplete="name" />
        </label>
        <label className="field">WhatsApp number
          <input className="input input--white" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="10-digit mobile number" value={f.phone} onChange={set('phone')} required maxLength={16} />
        </label>
        <label className="field">City or town
          <input className="input input--white" value={f.city} onChange={set('city')} required minLength={2} maxLength={60} autoComplete="address-level2" />
        </label>
        <label className="field">State
          <select className="input input--white" aria-label="State" value={f.state} onChange={set('state')} required>
            <option value="">Choose…</option>
            {(cfg?.states ?? []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </label>
        <label className="field">I am a
          <select className="input input--white" aria-label="I am a" value={f.type} onChange={set('type')} required>
            <option value="">Choose…</option>
            {ACCOUNT_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </div>
      <div className="profile-form__foot">
        <button type="submit" className="btn btn--ink btn--md" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {saved && <span className="acct-saved" role="status">Saved.</span>}
      </div>
      {err && <div className="field__error" role="alert">{err}</div>}
    </form>
  );
}
