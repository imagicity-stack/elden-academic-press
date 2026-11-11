// Counts, anonymously, how the cookie banner is used (Admin → Cookie consent): once when a
// browser first sees it, then the choice and how long it took. No id, name or contact is sent;
// the server only adds one to a counter. Staff checking the site aren't counted.
import { orderSource } from './attribution';
import { isStaff, type Consent } from './consent';
import { api } from './store/api';
import type { ConsentEvent } from './shared/consentStats';

const SEEN = 'elden-consent-seen';

function send(event: ConsentEvent, seconds?: number | null) {
  if (isStaff()) return;
  api('/consent/track', { body: { event, path: location.pathname, seconds: seconds ?? null, visit: orderSource() } }).catch(() => {});
}

/** The banner opened for someone who hasn't chosen yet: counted once per browser. */
export function bannerShown() {
  try {
    if (localStorage.getItem(SEEN)) return;
    localStorage.setItem(SEEN, String(Date.now()));
  } catch { return; }
  send('shown');
}

/** They chose: a first choice (with how long it took), or a change of mind later. */
export function choiceMade(previous: Consent | null, next: Consent) {
  if (previous === null) {
    let seconds: number | null = null;
    try { const at = Number(localStorage.getItem(SEEN)); if (at > 0) seconds = Math.max(0, (Date.now() - at) / 1000); } catch { /* ignore */ }
    send(next === 'all' ? 'accept' : 'essential', seconds);
  } else if (previous !== next) {
    send(next === 'all' ? 'change_all' : 'change_essential');
  }
}
