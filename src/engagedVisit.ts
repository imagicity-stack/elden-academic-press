// The browser side of EngagedVisit (src/engagement.ts): page visibility, window scrolling, page
// changes, and the debug log (?debug_pixel=1 for this tab, ?debug_pixel=0 to stop).
import { createEngagement } from './engagement';
import { trackEngagedVisit } from './meta';
import { pixelDebugOn, pixelLog } from './pixelDebug';
/** Pages at least this many screens tall can trigger on scrolling. */
const MIN_SCREENS = 1.5;

function session(): Storage | null { try { return window.sessionStorage; } catch { return null; } }

let engagement: ReturnType<typeof createEngagement> | null = null;
let currentPath = '';

/** Starts once per page load, from the page's first script (src/early.ts). Not on the admin. */
export function startEngagedVisit() {
  if (engagement || typeof document === 'undefined' || /^\/admin(\/|$)/.test(location.pathname)) return;
  const debug = pixelDebugOn();
  const log = pixelLog;
  engagement = createEngagement({
    now: () => performance.now(),
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (t) => window.clearTimeout(t as number),
    send: (data) => trackEngagedVisit({ ...data }),
    storage: session(),
    log,
  });
  currentPath = location.pathname;
  engagement.page(currentPath);
  if (debug) log(`debug on for this tab (?debug_pixel=0 to stop) · page=${currentPath}`);
  if (document.visibilityState === 'visible') engagement.visible(true);
  else log('opened in the background: the timer starts when the tab is shown');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') engagement!.visible(); else engagement!.hidden();
  });
  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
      const room = height - window.innerHeight;
      if (height < window.innerHeight * MIN_SCREENS || room <= 0) return;
      engagement!.scrolled(window.scrollY / room);
    });
  }, { passive: true });
}

/**
 * The app moved to another page, or knows more about it (the book on a book page). The same
 * address again without details changes nothing, so the book's details aren't lost.
 */
export function engagedPage(path: string, content?: { ids?: string[]; name?: string }) {
  if (!engagement || (path === currentPath && !content)) return;
  currentPath = path;
  engagement.page(path, content);
}
