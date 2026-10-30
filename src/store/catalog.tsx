import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Category, Kind, Product, Resource, StoreConfig } from './types';

interface Catalog {
  products: Product[];
  categories: Category[];
  status: 'loading' | 'ready' | 'error';
  reload(): void;
  bySlug(slug: string | undefined): Product | undefined;
  byId(id: string | undefined): Product | undefined;
}

const CatalogContext = createContext<Catalog | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<{ items: Product[]; categories: Category[] } | null>(null);
  const [status, setStatus] = useState<Catalog['status']>('loading');
  const load = useCallback(() => {
    setStatus((s) => (s === 'ready' ? s : 'loading'));
    api<{ items: Product[]; categories: Category[] }>('/catalog')
      .then((d) => { setData(d); setStatus('ready'); })
      .catch(() => setStatus((s) => (s === 'ready' ? s : 'error')));
  }, []);
  useEffect(load, [load]);

  const value = useMemo<Catalog>(() => {
    const products = data?.items ?? [];
    const slugs = new Map(products.map((p) => [p.slug, p]));
    const ids = new Map(products.map((p) => [p.id, p]));
    return {
      products, categories: data?.categories ?? [], status, reload: load,
      bySlug: (s) => (s ? slugs.get(s) : undefined),
      byId: (id) => (id ? ids.get(id) : undefined),
    };
  }, [data, status, load]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const c = useContext(CatalogContext);
  if (!c) throw new Error('useCatalog must be used inside <CatalogProvider>');
  return c;
}

let resourcesPromise: Promise<Resource[]> | undefined;
/** Published Study Hub files. */
export function useResources(): { items: Resource[]; status: 'loading' | 'ready' | 'error' } {
  const [state, setState] = useState<{ items: Resource[]; status: 'loading' | 'ready' | 'error' }>({ items: [], status: 'loading' });
  useEffect(() => {
    resourcesPromise ??= api<{ items: Resource[] }>('/resources').then((r) => r.items).catch((e) => { resourcesPromise = undefined; throw e; });
    resourcesPromise.then((items) => setState({ items, status: 'ready' }), () => setState({ items: [], status: 'error' }));
  }, []);
  return state;
}

let configPromise: Promise<StoreConfig> | undefined;
export function useStoreConfig(): StoreConfig | null {
  const [cfg, setCfg] = useState<StoreConfig | null>(null);
  useEffect(() => {
    configPromise ??= api<StoreConfig>('/config').catch((e) => { configPromise = undefined; throw e; });
    configPromise.then(setCfg, () => {});
  }, []);
  return cfg;
}

/* ---------------- Product helpers ---------------- */

export const FORMAT_LABEL: Record<Kind, string> = { print: 'Printed book', digital: 'E-book', bundle: 'E-book + printed copy' };

/** Lowest price the product can be bought for, or null if nothing is available. */
export function fromPrice(p: Product): number | null {
  const prices = (['print', 'digital'] as const).map((k) => p.formats[k]).filter((f) => f?.available).map((f) => f!.price);
  return prices.length ? Math.min(...prices) : null;
}

export const isPurchasable = (p: Product) => fromPrice(p) !== null;

export const productMeta = (p: Product) => [p.classLabel, p.boards.join(', ')].filter(Boolean).join(' · ');

export const formatsLabel = (p: Product) =>
  [p.formats.print && 'Print', p.formats.digital && 'E-book'].filter(Boolean).join(' · ');
