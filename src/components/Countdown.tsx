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
  return <span className="comp-countdown"><span>{label}</span> <b>{text}</b></span>;
}
