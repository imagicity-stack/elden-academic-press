// Shows the popups built in Admin → Popups. After the cookie choice and once the page has
// settled, it loads the live popups, keeps those this visitor may see on this page
// (src/shared/popups.ts → eligible), and opens the first whose trigger fires: after some
// seconds, at a scroll depth, when the mouse leaves for the address bar, on the Nth page of a
// visit, or from a link to "#popup-<id>". At most one per page, never over another dialog or the
// cookie banner, never at checkout. Admin → Popups → "Preview on the site" opens one here at once.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../store/api';
import { accountToken } from '../../store/account';
import { useCart } from '../../store/cart';
import { getConsent, isStaff, isStudentSession } from '../../consent';
import { orderSource } from '../../attribution';
import { orderChannel } from '../../shared/attribution';
import { eligible, NEVER_ON, pageMatches, PREVIEW_KEY, type LivePopup, type PopupMemory } from '../../shared/popups';
import { ga } from '../../ga';
import { newEventId, rememberUser, track } from '../../meta';
import type { CloseReason } from './PopupView';

const PopupView = lazy(() => import('./PopupView').then((m) => ({ default: m.PopupView })));

const MEMORY = 'elden-popups';
const SESSION = 'elden-popups-session';
/** Between two different popups in one visit. */
const GAP_MS = 2 * 60_000;

interface Session { pages: number; shown: string[]; lastAt: number }
const readJson = <T,>(store: Storage, key: string, fallback: T): T => { try { return { ...fallback, ...JSON.parse(store.getItem(key) ?? '{}') }; } catch { return fallback; } };
const writeJson = (store: Storage, key: string, v: unknown) => { try { store.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } };
const memory = () => readJson<Record<string, PopupMemory>>(localStorage, MEMORY, {});
const remember = (id: string, patch: PopupMemory) => { const m = memory(); m[id] = { ...m[id], ...patch }; writeJson(localStorage, MEMORY, m); };
const session = () => readJson<Session>(sessionStorage, SESSION, { pages: 0, shown: [], lastAt: 0 });

/** First visit in this browser (for the whole of that visit). */
function isNewVisitor() {
  try {
    if (sessionStorage.getItem('elden-new') === '1') return true;
    if (localStorage.getItem('elden-visited')) return false;
    localStorage.setItem('elden-visited', String(Date.now()));
    sessionStorage.setItem('elden-new', '1');
    return true;
  } catch { return false; }
}
const isPhone = () => window.matchMedia('(max-width: 640px), (pointer: coarse) and (max-width: 900px)').matches;
const otherDialogOpen = () => Boolean(document.querySelector('[aria-modal="true"]:not(.pp__box), .cookie, .modal-backdrop'));

function send(id: string, type: 'view' | 'click' | 'close') {
  if (isStaff()) return; // the shop's own visits aren't counted
  fetch(`/api/popups/${id}/event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type }), keepalive: true }).catch(() => {});
}

export function PopupHost() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const cart = useCart();
  const [ready, setReady] = useState(() => getConsent() !== null);
  const [items, setItems] = useState<LivePopup[] | null>(null);
  const [active, setActive] = useState<{ popup: LivePopup; preview: boolean } | null>(null);
  const shownOnPage = useRef(false);
  const cartItems = cart.lines.reduce((n, l) => n + l.quantity, 0);
  const cartRef = useRef(cartItems);
  cartRef.current = cartItems;

  // A preview from the admin's builder: open it straight away (nothing counted or remembered).
  useEffect(() => {
    if (!new URLSearchParams(search).has('popup-preview')) return;
    try {
      const p = JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? 'null') as LivePopup | null;
      if (p) setActive({ popup: p, preview: true });
    } catch { /* ignore */ }
  }, [search]);

  // Wait for the cookie choice, then load once the page has settled.
  useEffect(() => {
    if (ready) return;
    const on = () => setReady(true);
    window.addEventListener('elden:consent', on);
    return () => window.removeEventListener('elden:consent', on);
  }, [ready]);
  useEffect(() => {
    if (!ready || items) return;
    const t = setTimeout(() => { api<{ items: LivePopup[] }>('/popups/live').then((r) => setItems(r.items), () => setItems([])); }, 1200);
    return () => clearTimeout(t);
  }, [ready, items]);

  // Count the pages of this visit.
  useEffect(() => {
    const s = session();
    writeJson(sessionStorage, SESSION, { ...s, pages: s.pages + 1 });
    shownOnPage.current = false;
  }, [pathname]);

  const show = useCallback((p: LivePopup) => {
    if (shownOnPage.current) return false;
    if (otherDialogOpen()) return false;
    shownOnPage.current = true;
    const s = session();
    writeJson(sessionStorage, SESSION, { ...s, shown: [...new Set([...s.shown, p.id])], lastAt: Date.now() });
    remember(p.id, { lastShown: Date.now() });
    setActive({ popup: p, preview: false });
    send(p.id, 'view');
    return true;
  }, []);

  // A link to "#popup-<id>" opens that popup (on any page but checkout and orders).
  useEffect(() => {
    const id = /^#popup-([0-9a-f-]{36})$/.exec(hash)?.[1];
    const p = id && items?.find((x) => x.id === id);
    if (p && !NEVER_ON.some((x) => pageMatches(x, pathname))) { shownOnPage.current = false; show(p); }
  }, [hash, items, pathname, show]);

  // Arm the triggers of the popups this visitor may see on this page.
  useEffect(() => {
    if (!items?.length || active) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    (async () => {
      const s = session();
      if (Date.now() - s.lastAt < GAP_MS) return;
      const src = orderSource();
      const ctx = {
        path: pathname, device: isPhone() ? 'mobile' as const : 'desktop' as const, isNew: isNewVisitor(), signedIn: Boolean(await accountToken().catch(() => null)),
        student: isStudentSession(), channel: orderChannel(src).channel, campaign: (src.last ?? src.first)?.campaign ?? '', cartItems: cartRef.current,
        now: Date.now(), memory: memory(), session: s.shown,
      };
      if (cancelled) return;
      const list = items.filter((p) => p.trigger.type !== 'link' && eligible(p, ctx)).sort((a, b) => b.priority - a.priority);
      const fire = (p: LivePopup) => {
        if (cancelled || shownOnPage.current) return;
        // Another dialog (or the cookie banner) is open: try again a little later.
        if (!show(p) && !shownOnPage.current) { const t = setTimeout(() => fire(p), 2500); cleanups.push(() => clearTimeout(t)); }
      };
      for (const p of list) {
        const t = p.trigger;
        if (t.type === 'delay' || (t.type === 'exit' && ctx.device === 'mobile')) {
          const id = setTimeout(() => fire(p), t.seconds * 1000);
          cleanups.push(() => clearTimeout(id));
        } else if (t.type === 'pageviews') {
          if (s.pages >= t.pageviews) { const id = setTimeout(() => fire(p), 1500); cleanups.push(() => clearTimeout(id)); }
        } else if (t.type === 'scroll') {
          const on = () => {
            const max = document.documentElement.scrollHeight - window.innerHeight;
            if (max <= 0 || (window.scrollY / max) * 100 >= t.percent) { window.removeEventListener('scroll', on); fire(p); }
          };
          window.addEventListener('scroll', on, { passive: true });
          cleanups.push(() => window.removeEventListener('scroll', on));
        } else if (t.type === 'exit') {
          const armedAt = Date.now();
          const on = (e: MouseEvent) => { if (!e.relatedTarget && e.clientY <= 0 && Date.now() - armedAt > 3000) { document.removeEventListener('mouseout', on); fire(p); } };
          document.addEventListener('mouseout', on);
          cleanups.push(() => document.removeEventListener('mouseout', on));
        }
      }
    })();
    return () => { cancelled = true; cleanups.forEach((f) => f()); };
  }, [items, pathname, active, show]);

  const close = useCallback((reason: CloseReason) => {
    if (active && !active.preview) send(active.popup.id, 'close');
    if (active?.preview) { try { localStorage.removeItem(PREVIEW_KEY); } catch { /* ignore */ } }
    void reason;
    setActive(null);
  }, [active]);

  const primary = useCallback((url: string) => {
    if (active && !active.preview) { send(active.popup.id, 'click'); remember(active.popup.id, { converted: true }); }
    setActive(null);
    if (url.startsWith('/')) navigate(url);
    else window.location.assign(url);
  }, [active, navigate]);

  const subscribe = useCallback(async (f: { name?: string; email: string; phone: string }) => {
    if (!active) return;
    const eventId = newEventId();
    await api('/newsletter/subscribe', {
      body: { ...f, source: 'popup', popupId: active.preview ? undefined : active.popup.id, consent: true },
      headers: { 'X-Meta-Event-Id': eventId },
    });
    rememberUser({ email: f.email, phone: f.phone, name: f.name });
    track('Subscribe', { content_name: 'Newsletter' }, { eventId });
    ga('newsletter_signup', { method: 'popup' });
    if (!active.preview) remember(active.popup.id, { converted: true });
  }, [active]);

  const topSlot = useMemo(() => { const el = document.createElement('div'); el.className = 'pp-top-slot'; return el; }, []);
  const isTopBar = active?.popup.design.layout === 'bar' && active.popup.design.position === 'top';
  useEffect(() => {
    if (!isTopBar) return;
    document.body.prepend(topSlot);
    return () => topSlot.remove();
  }, [isTopBar, topSlot]);

  if (!active) return null;
  const view = (
    <Suspense fallback={null}>
      <PopupView key={active.popup.id} content={active.popup.content} design={active.popup.design}
        onClose={close} onPrimary={primary} onSubscribe={subscribe} onApplyCoupon={(code) => cart.setCoupon(code)} />
    </Suspense>
  );
  return isTopBar ? createPortal(view, topSlot) : view;
}
