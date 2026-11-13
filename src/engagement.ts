// "EngagedVisit": a visitor who really looked, sent to Meta once per browser session, when
// either comes first:
//   - 15 seconds of visible time on the site (paused while the tab is hidden, kept across
//     page changes within the visit), or
//   - scrolling half-way down a page: half of the distance the window can scroll, on pages at
//     least 1.5 screens tall (shorter pages rely on the timer). Only real scrolls count, and each
//     new page starts again from the top.
// It lives outside React on purpose: re-renders can't restart the timer.
//
// Debug: open any page with ?debug_pixel=1 and, for that tab, the console says when the timer
// starts, pauses, resumes and when (and why) the event fires. Nothing personal is logged.

export const ENGAGED_EVENT = 'EngagedVisit';
export const ENGAGED_SECONDS = 15;
export const ENGAGED_SCROLL = 0.5;
/** Set (for the session) only when the event is actually sent. */
export const FIRED_KEY = 'elden-engaged-visit';

export type Trigger = 'time' | 'scroll';
export interface EngagedData { trigger: Trigger; engaged_seconds: number; scroll_depth: number; page_type: string; content_ids?: string[]; content_name?: string }

export interface EngagementDeps {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
  /** Sends the event: its event id, or why it wasn't sent. */
  send(data: EngagedData): { eventId: string } | { reason: string };
  /** Session storage (null when blocked). */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  log(message: string): void;
}

/** What kind of page this is, from its address. */
export function pageType(path: string): string {
  if (path === '/' || path === '') return 'home';
  if (/^\/books\//.test(path)) return 'book';
  if (/^\/(catalogue|store)\b/.test(path)) return 'catalogue';
  if (/^\/competitions\//.test(path)) return 'competition';
  if (/^\/(checkout|order\/|track\b)/.test(path)) return 'checkout';
  return 'other';
}

export function createEngagement(d: EngagementDeps) {
  let fired = (() => { try { return d.storage?.getItem(FIRED_KEY) === '1'; } catch { return false; } })();
  let spentMs = 0;
  let runningSince: number | null = null;
  let timer: unknown = null;
  let depth = 0;
  let page = { type: 'other', contentIds: undefined as string[] | undefined, contentName: undefined as string | undefined };
  let stopped = fired;
  let everStarted = false;

  const seconds = () => Math.round((spentMs + (runningSince !== null ? d.now() - runningSince : 0)) / 1000);

  function fire(trigger: Trigger) {
    if (stopped) return;
    stopped = true;
    pause(true);
    const data: EngagedData = {
      trigger, engaged_seconds: seconds(), scroll_depth: Math.round(depth * 100), page_type: page.type,
      ...(page.contentIds ? { content_ids: page.contentIds } : {}), ...(page.contentName ? { content_name: page.contentName } : {}),
    };
    const r = d.send(data);
    if ('reason' in r) { d.log(`${ENGAGED_EVENT} not sent (${trigger}): ${r.reason}`); return; }
    fired = true;
    try { d.storage?.setItem(FIRED_KEY, '1'); } catch { /* private mode: once per page load instead */ }
    d.log(`${ENGAGED_EVENT} sent · trigger=${trigger} · ${data.engaged_seconds}s · scroll ${data.scroll_depth}% · page=${data.page_type} · eventID=${r.eventId}`);
  }

  function schedule() {
    const left = ENGAGED_SECONDS * 1000 - spentMs;
    timer = d.setTimeout(() => { timer = null; fire('time'); }, Math.max(0, left));
  }

  function start() {
    if (stopped || runningSince !== null) return;
    runningSince = d.now();
    schedule();
    d.log(everStarted ? `timer resumed at ${Math.round(spentMs / 1000)}s` : `timer started (${ENGAGED_SECONDS}s visible, or scroll ${ENGAGED_SCROLL * 100}%)`);
    everStarted = true;
  }

  function pause(quiet = false) {
    if (runningSince === null) return;
    spentMs += d.now() - runningSince;
    runningSince = null;
    if (timer !== null) { d.clearTimeout(timer); timer = null; }
    if (!quiet) d.log(`timer paused at ${Math.round(spentMs / 1000)}s (tab hidden)`);
  }

  return {
    /** The page became visible (or loaded visible): count time. */
    visible(first = false) {
      if (fired) { if (first) d.log(`${ENGAGED_EVENT} already sent in this session: not again`); return; }
      start();
    },
    /** The tab was hidden: stop counting. */
    hidden() { if (!stopped) pause(); },
    /** A real scroll: the share of the page's scrollable distance scrolled so far (0 to 1). */
    scrolled(fraction: number) {
      if (stopped) return;
      depth = Math.max(depth, Math.min(1, fraction));
      if (depth >= ENGAGED_SCROLL) fire('scroll');
    },
    /** A new page within the visit: scrolling starts again; the time keeps counting. */
    page(path: string, content?: { ids?: string[]; name?: string }) {
      depth = 0;
      page = { type: pageType(path), contentIds: content?.ids, contentName: content?.name };
    },
    /** For tests and debugging. */
    state: () => ({ fired, stopped, seconds: seconds(), depth, running: runningSince !== null, page: page.type }),
  };
}
