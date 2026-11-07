import { useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { accountApi, type Profile } from '../store/account';
import { errorMessage } from '../store/api';
import { useStoreConfig } from '../store/catalog';
import { FIELD_LABEL, INSTITUTION_TYPES, PROFILE_TYPES, todayIST, type ProfileField, type ProfileValues } from '../shared/profile';
import { ageOn } from '../shared/teams';

type Values = Record<keyof ProfileValues, string>;
const ROLE_FIELDS: Record<string, (keyof ProfileValues)[]> = {
  student: ['dob', 'institutionType', 'institutionName', 'grade', 'guardianName', 'guardianPhone', 'instagram'],
  teacher: ['institutionType', 'institutionName'],
  parent: [],
  other: [],
};
const BASE: (keyof ProfileValues)[] = ['type', 'fullName', 'phone', 'city', 'state'];

/**
 * "Complete your profile": starts with "I am a…", then the details for that kind of person.
 * `onlyMissing` shows just what's still needed (e.g. before registering for a competition),
 * reusing everything already saved.
 */
export function ProfileForm({ profile, name, onSaved, submitLabel = 'Save profile', onlyMissing = false }: {
  profile: Profile; name: string; onSaved: (p: Profile) => void; submitLabel?: string; onlyMissing?: boolean;
}) {
  const cfg = useStoreConfig();
  const [f, setF] = useState<Values>({
    type: profile.type ?? '', fullName: profile.fullName || name, phone: profile.phone, city: profile.city, state: profile.state, dob: profile.dob ?? '',
    institutionType: profile.institutionType, institutionName: profile.institutionName, grade: profile.grade,
    guardianName: profile.guardianName, guardianPhone: profile.guardianPhone, instagram: profile.instagram,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const firstMissing = useMemo(() => new Set(profile.missing), [profile.missing]);
  const set = (k: keyof Values) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setSaved(false); };

  const today = todayIST();
  const age = f.dob ? ageOn(f.dob, today) : null;
  const roleFields = (ROLE_FIELDS[f.type] ?? []).filter((k) => {
    if (k === 'guardianName' || k === 'guardianPhone') return age !== null && age < 18;
    if (k === 'instagram') return age !== null && age >= 13;
    return true;
  });
  // With onlyMissing, show the fields this kind of person needs that the *saved* profile doesn't
  // have yet. Judged by what's saved, not by what's typed, so a box doesn't vanish the moment
  // someone types in it (or picks an option).
  const savedEmpty = (k: keyof ProfileValues) => !profile[k];
  const fields = [...BASE, ...roleFields].filter((k) => !onlyMissing || firstMissing.has(k) || savedEmpty(k));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const payload = Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== '' && (BASE.includes(k as keyof Values) || roleFields.includes(k as keyof Values))));
      const p = await accountApi<Profile>('/profile', { method: 'PUT', body: payload });
      setSaved(true);
      onSaved(p);
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setBusy(false);
    }
  };

  const field = (k: keyof Values) => {
    const label = k === 'instagram' ? 'Instagram username (optional)' : FIELD_LABEL[k as ProfileField];
    switch (k) {
      case 'type':
        return (
          <fieldset key={k} className="profile-form__who">
            <legend>I am a</legend>
            <div className="profile-form__roles" role="radiogroup" aria-label="I am a">
              {PROFILE_TYPES.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={f.type === v} className={'profile-role' + (f.type === v ? ' is-on' : '')} onClick={() => { setF({ ...f, type: v }); setSaved(false); }}>{l}</button>
              ))}
            </div>
          </fieldset>
        );
      case 'state':
        return (
          <label key={k} className="field">{label}
            <select className="input input--white" aria-label={label} value={f.state} onChange={set('state')} required>
              <option value="">Choose…</option>
              {(cfg?.states ?? []).map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
          </label>
        );
      case 'institutionType':
        return (
          <label key={k} className="field">{label}
            <select className="input input--white" aria-label={label} value={f.institutionType} onChange={set('institutionType')} required>
              <option value="">Choose…</option>
              {INSTITUTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        );
      case 'dob':
        return <label key={k} className="field">{label}<input className="input input--white" type="date" value={f.dob} onChange={set('dob')} required max={today} min="1920-01-01" /></label>;
      case 'phone':
      case 'guardianPhone':
        return <label key={k} className="field">{label}<input className="input input--white" type="tel" inputMode="tel" autoComplete={k === 'phone' ? 'tel-national' : 'off'} placeholder="10-digit mobile number" value={f[k]} onChange={set(k)} required maxLength={16} /></label>;
      case 'instagram':
        return <label key={k} className="field">{label}<input className="input input--white" placeholder="@yourname" value={f.instagram} onChange={set('instagram')} maxLength={31} /></label>;
      default: {
        const placeholder = k === 'grade' ? 'e.g. Class 8, or B.A. 2nd year' : k === 'institutionName' ? 'e.g. DAV Public School, Hazaribagh' : undefined;
        return <label key={k} className="field">{label}<input className="input input--white" value={f[k]} onChange={set(k)} required minLength={k === 'grade' ? 1 : 2} maxLength={k === 'institutionName' ? 120 : 80} placeholder={placeholder} autoComplete={k === 'fullName' ? 'name' : k === 'city' ? 'address-level2' : 'off'} /></label>;
      }
    }
  };

  return (
    <form className="profile-form" onSubmit={save}>
      {field('type')}
      <AnimatePresence initial={false}>
        {f.type && (
          <motion.div key="fields" className="profile-form__grid" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {fields.filter((k) => k !== 'type').map(field)}
          </motion.div>
        )}
      </AnimatePresence>
      {f.type === 'student' && age !== null && age < 18 && <p className="profile-form__note">You’re under 18, so we also ask for a parent’s or guardian’s name and number.</p>}
      <div className="profile-form__foot">
        <button type="submit" className="btn btn--ink btn--md" disabled={busy || !f.type}>{busy ? 'Saving…' : submitLabel}</button>
        {saved && <span className="acct-saved" role="status">Saved.</span>}
      </div>
      {err && <div className="field__error" role="alert">{err}</div>}
    </form>
  );
}

/** Right after signing up: complete the profile, or skip it for now (after a clear warning). */
export function ProfileOnboarding({ profile, name, onSaved, onClose }: { profile: Profile; name: string; onSaved: (p: Profile) => void; onClose: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="modal onboard" role="dialog" aria-modal="true" aria-labelledby="onboard-title"
        initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
        {confirm ? (
          <div className="modal__done onboard__confirm">
            <div id="onboard-title" className="modal__title">Skip for now?</div>
            <p className="modal__desc">You won’t be able to register for competitions, and some other features stay locked, until your profile is complete. You can finish it any time from your account.</p>
            <div className="onboard__actions">
              <button type="button" className="btn btn--outline btn--md" onClick={onClose}>Yes, Skip for Now</button>
              <button type="button" className="btn btn--ink btn--md" onClick={() => setConfirm(false)}>No, Complete My Profile</button>
            </div>
          </div>
        ) : (
          <>
            <div className="modal__head">
              <div className="modal__head-text">
                <div id="onboard-title" className="modal__title">Complete your profile</div>
                <div className="modal__desc">Welcome! Tell us a little about yourself. It takes a minute, and you only do it once.</div>
              </div>
            </div>
            <div className="modal__form">
              <ProfileForm profile={profile} name={name} onlyMissing submitLabel="Save and continue" onSaved={(p) => { onSaved(p); if (p.completed) onClose(); }} />
              <button type="button" className="text-link onboard__skip" onClick={() => setConfirm(true)}>Skip for now</button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Show the sign-up step once per browser session for a brand-new account with an incomplete profile. */
export function shouldOnboard(newAccount: boolean | undefined, profile: Profile) {
  if (!newAccount || profile.completed) return false;
  try {
    if (sessionStorage.getItem('elden-onboarded') === '1') return false;
    sessionStorage.setItem('elden-onboarded', '1');
  } catch { /* private mode: show it */ }
  return true;
}
