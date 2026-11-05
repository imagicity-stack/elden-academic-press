import { useEffect, useState } from 'react';

/** Time left until `to` (for show only: the server decides deadlines with its own clock). */
export function Countdown({ to, label }: { to: string | null; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!to) return null;
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400_000), h = Math.floor((ms % 86400_000) / 3600_000), m = Math.floor((ms % 3600_000) / 60_000);
  const text = d > 0 ? `${d} day${d === 1 ? '' : 's'} ${h} hr` : h > 0 ? `${h} hr ${m} min` : `${m} min`;
  return <span className="cp-countdown"><span>{label}</span> <b>{text}</b></span>;
}

/** The next date that matters for a competition, and what happens then. */
export function nextMoment(status: string, d: { registrationOpensAt: string | null; registrationClosesAt: string | null; submissionOpensAt: string | null; submissionClosesAt: string | null }) {
  if (status === 'COMING_SOON') return { to: d.registrationOpensAt, label: 'Opens in' };
  if (status === 'REGISTRATION_OPEN') return { to: d.registrationClosesAt, label: 'Registration closes in' };
  if (status === 'SUBMISSIONS_SOON') return { to: d.submissionOpensAt, label: 'Submissions open in' };
  if (status === 'BOTH_OPEN' || status === 'SUBMISSIONS_OPEN') return { to: d.submissionClosesAt, label: 'Entries close in' };
  return { to: null, label: '' };
}
