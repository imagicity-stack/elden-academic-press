// Shopping cart: kept in this browser; every price is re-checked by the server.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Kind, Quote } from './types';

export interface CartLine { productId: string; kind: Kind; quantity: number }

export const MAX_QTY: Record<Kind, number> = { print: 50, digital: 1, bundle: 1 };

interface Cart {
  lines: CartLine[];
  count: number;
  coupon: string;
  setCoupon(code: string): void;
  add(line: CartLine): void;
  setQuantity(productId: string, kind: Kind, quantity: number): void;
  remove(productId: string, kind: Kind): void;
  clear(): void;
  drawerOpen: boolean;
  openDrawer(): void;
  closeDrawer(): void;
}

const KEY = 'elden-cart-v1';
const CartContext = createContext<Cart | null>(null);

function load(): { lines: CartLine[]; coupon: string } {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const lines = Array.isArray(raw.lines) ? raw.lines.filter((l: CartLine) => l && typeof l.productId === 'string' && l.kind in MAX_QTY && l.quantity > 0) : [];
    return { lines, coupon: typeof raw.coupon === 'string' ? raw.coupon : '' };
  } catch {
    return { lines: [], coupon: '' };
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }, [state]);
  // Keep tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setState(load()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const add = useCallback((line: CartLine) => setState((s) => {
    // E-book alone and E-book + print are alternatives: keep only the latest choice.
    let lines = s.lines.filter((l) => !(l.productId === line.productId && line.kind !== 'print' && l.kind !== 'print' && l.kind !== line.kind));
    const hit = lines.find((l) => l.productId === line.productId && l.kind === line.kind);
    lines = hit
      ? lines.map((l) => (l === hit ? { ...l, quantity: Math.min(l.quantity + line.quantity, MAX_QTY[l.kind]) } : l))
      : [...lines, { ...line, quantity: Math.min(line.quantity, MAX_QTY[line.kind]) }];
    return { ...s, lines };
  }), []);

  const value = useMemo<Cart>(() => ({
    lines: state.lines,
    count: state.lines.reduce((n, l) => n + l.quantity, 0),
    coupon: state.coupon,
    setCoupon: (coupon) => setState((s) => ({ ...s, coupon: coupon.trim().toUpperCase() })),
    add,
    setQuantity: (productId, kind, quantity) => setState((s) => ({
      ...s,
      lines: s.lines.map((l) => (l.productId === productId && l.kind === kind ? { ...l, quantity: Math.max(1, Math.min(quantity, MAX_QTY[kind])) } : l)),
    })),
    remove: (productId, kind) => setState((s) => ({ ...s, lines: s.lines.filter((l) => !(l.productId === productId && l.kind === kind)) })),
    clear: () => setState({ lines: [], coupon: '' }),
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
  }), [state, add, drawerOpen]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error('useCart must be used inside <CartProvider>');
  return c;
}

/** Live server quote for the cart (debounced). */
export function useQuote(lines: CartLine[], coupon: string, state?: string | null) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const key = JSON.stringify([lines, coupon, state ?? null]);

  const refresh = useCallback(() => {
    const id = ++seq.current;
    if (!lines.length) { setQuote(null); setLoading(false); return; }
    setLoading(true);
    api<{ quote: Quote }>('/cart/quote', { body: { items: lines, couponCode: coupon || null, state: state || null } })
      .then((r) => { if (id === seq.current) { setQuote(r.quote); setError(null); } })
      .catch((e: Error) => { if (id === seq.current) setError(e.message); })
      .finally(() => { if (id === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    const t = setTimeout(refresh, 200);
    return () => clearTimeout(t);
  }, [refresh]);

  return { quote, loading, error, refresh };
}
