import { describe, expect, it } from 'vitest';
import { createEngagement, FIRED_KEY, pageType, type EngagedData } from '../src/engagement';

/** A fake clock with timers, a session store, and a record of what was sent and logged. */
function rig(opts: { stored?: string; refuse?: string } = {}) {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const store = new Map<string, string>(opts.stored ? [[FIRED_KEY, opts.stored]] : []);
  const sent: EngagedData[] = [];
  const logs: string[] = [];
  const e = createEngagement({
    now: () => t,
    setTimeout: (fn, ms) => { const id = nextId++; timers.push({ at: t + ms, fn, id }); return id; },
    clearTimeout: (id) => { timers = timers.filter((x) => x.id !== id); },
    send: (d) => { if (opts.refuse) return opts.refuse; sent.push(d); return null; },
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } },
    log: (m) => logs.push(m),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      t = due.at; timers = timers.filter((x) => x !== due); due.fn();
    }
    t = end;
  };
  return { e, sent, logs, store, advance };
}

describe('EngagedVisit', () => {
  it('fires once after 15 seconds of visible time, with the trigger and page', () => {
    const r = rig();
    r.e.page('/books/board-booster', { ids: ['p1'], name: 'Board Booster' });
    r.e.visible(true);
    r.advance(14_900);
    expect(r.sent).toHaveLength(0);
    r.advance(200);
    expect(r.sent).toEqual([{ trigger: 'time', engaged_seconds: 15, scroll_depth: 0, page_type: 'book', content_ids: ['p1'], content_name: 'Board Booster' }]);
    expect(r.store.get(FIRED_KEY)).toBe('1');
    r.advance(60_000);
    r.e.scrolled(1);
    expect(r.sent).toHaveLength(1);
    expect(r.logs[0]).toMatch(/timer started/);
    expect(r.logs.at(-1)).toMatch(/EngagedVisit sent · trigger=time · 15s/);
  });

  it('pauses while the tab is hidden and resumes where it left off', () => {
    const r = rig();
    r.e.page('/');
    r.e.visible(true);
    r.advance(10_000);
    r.e.hidden();
    r.advance(120_000); // two minutes in another tab don't count
    expect(r.sent).toHaveLength(0);
    r.e.visible();
    r.advance(4_000);
    expect(r.sent).toHaveLength(0);
    r.advance(1_000);
    expect(r.sent[0]).toMatchObject({ trigger: 'time', engaged_seconds: 15, page_type: 'home' });
    expect(r.logs.join(' | ')).toMatch(/timer paused at 10s.*timer resumed at 10s/);
  });

  it('keeps counting across page changes (re-renders and new pages never restart it)', () => {
    const r = rig();
    r.e.page('/');
    r.e.visible(true);
    r.advance(8_000);
    r.e.page('/books/x');
    r.e.visible(); // a page change or re-render asking again: no restart
    r.advance(7_000);
    expect(r.sent[0]).toMatchObject({ trigger: 'time', page_type: 'book' });
  });

  it('fires on scrolling half-way down, before the 15 seconds', () => {
    const r = rig();
    r.e.page('/books/x');
    r.e.visible(true);
    r.advance(3_000);
    r.e.scrolled(0.3);
    expect(r.sent).toHaveLength(0);
    r.e.scrolled(0.55);
    expect(r.sent).toEqual([expect.objectContaining({ trigger: 'scroll', scroll_depth: 55, engaged_seconds: 3 })]);
    r.advance(20_000); // the timer is cleared: no second event
    expect(r.sent).toHaveLength(1);
  });

  it('scrolling starts again on each new page', () => {
    const r = rig();
    r.e.page('/');
    r.e.visible(true);
    r.e.scrolled(0.45);
    r.e.page('/books/x');
    r.e.scrolled(0.2);
    expect(r.sent).toHaveLength(0);
    r.e.scrolled(0.5);
    expect(r.sent[0]).toMatchObject({ trigger: 'scroll', page_type: 'book', scroll_depth: 50 });
  });

  it('does not fire again in the same session, and the key is only set when it was really sent', () => {
    const done = rig({ stored: '1' });
    done.e.visible(true);
    done.advance(30_000);
    done.e.scrolled(1);
    expect(done.sent).toHaveLength(0);
    expect(done.logs[0]).toMatch(/already sent in this session/);

    const off = rig({ refuse: 'Pixel off: signed into the admin' });
    off.e.visible(true);
    off.advance(15_000);
    expect(off.store.has(FIRED_KEY)).toBe(false);
    expect(off.logs.at(-1)).toMatch(/not sent \(time\): Pixel off: signed into the admin/);
  });

  it('names page types', () => {
    expect(['/', '/books/a', '/catalogue', '/store?x=1', '/competitions/doomsday-diaries', '/checkout', '/about'].map(pageType))
      .toEqual(['home', 'book', 'catalogue', 'catalogue', 'competition', 'checkout', 'other']);
  });
});
