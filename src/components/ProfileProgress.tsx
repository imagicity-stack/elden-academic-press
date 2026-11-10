// How much of the profile is filled in, on the account page: a bar, the percentage, and the
// next thing to add. Same count as Admin → Audience (src/shared/profile.ts).
import { FIELD_LABEL, profileProgress, type ProfileField } from '../shared/profile';
import type { Profile } from '../store/account';

export function ProfileProgress({ profile }: { profile: Profile }) {
  const p = profileProgress({ ...profile, type: profile.type ?? null });
  const next = p.missing[0] as ProfileField | undefined;
  return (
    <div className="pp" aria-live="polite">
      <div className="pp__top">
        <b>{p.percent === 100 ? 'Your profile is complete' : `Your profile is ${p.percent}% complete`}</b>
        <span>{p.done} of {p.total} details</span>
      </div>
      <div className="pp__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Profile completion">
        <span className="pp__fill" style={{ width: `${p.percent}%` }} />
      </div>
      {next && <p className="pp__next">Next: <b>{FIELD_LABEL[next]}</b>{p.missing.length > 1 ? `, then ${p.missing.length - 1} more` : ''}.</p>}
    </div>
  );
}
