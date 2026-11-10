// Counts how far visitors get with a competition's registration (Admin → Competitions →
// Analytics). Anonymous: only the competition, the step and the visit's channel are sent, and
// each browser sends each step once (remembered here). Staff browsing the site aren't counted.
import { orderSource } from './attribution';
import { isStaff } from './consent';
import { api } from './store/api';
import type { FunnelStep } from './shared/competitionFunnel';

export function trackStep(slug: string, step: FunnelStep) {
  try {
    if (isStaff()) return;
    const key = `elden-comp:${slug}:${step}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, String(Date.now()));
  } catch { return; /* storage blocked: don't count rather than count twice */ }
  api('/competition-info/' + encodeURIComponent(slug) + '/track', { body: { step, visit: orderSource() } }).catch(() => {});
}
