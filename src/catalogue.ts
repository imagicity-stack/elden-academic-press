import { LV, type LevelKey } from './data';
import { fromPrice } from './store/catalog';
import type { Category, Product } from './store/types';

export type FacetKey = 'type' | 'level' | 'class' | 'subject' | 'board' | 'format';
export type Filters = Record<FacetKey, string[]>;

export const FACET_KEYS: FacetKey[] = ['type', 'level', 'class', 'subject', 'board', 'format'];
export const EMPTY: Filters = { type: [], level: [], class: [], subject: [], board: [], format: [] };

export const SORTS = ['Featured', 'Newest', 'Price: low to high', 'Price: high to low', 'Title A–Z'] as const;
export type Sort = (typeof SORTS)[number];

const LEVEL_ORDER = Object.keys(LV) as LevelKey[];

/** Values of a product for one facet. `type` is the category slug; `format` is print / ebook. */
export const valuesOf = (p: Product, k: FacetKey): string[] =>
  k === 'type' ? (p.category ? [p.category.slug] : [])
  : k === 'level' ? [p.level]
  : k === 'class' ? (p.classLabel ? [p.classLabel] : [])
  : k === 'subject' ? (p.subject ? [p.subject] : [])
  : k === 'board' ? p.boards
  : [...(p.formats.print ? ['print'] : []), ...(p.formats.digital ? ['ebook'] : [])];

export interface Facet { key: FacetKey; label: string; opts: { value: string; label: string }[] }

/** Facet options built from what is actually in the catalogue. */
export function buildFacets(products: Product[], categories: Category[]): Facet[] {
  const distinct = (k: FacetKey) => [...new Set(products.flatMap((p) => valuesOf(p, k)))];
  const grade = (label: string) => products.find((p) => p.classLabel === label)?.grade ?? 99;
  return [
    { key: 'type', label: 'Category', opts: categories.filter((c) => products.some((p) => p.category?.id === c.id)).map((c) => ({ value: c.slug, label: c.name })) },
    { key: 'level', label: 'Level', opts: LEVEL_ORDER.filter((l) => products.some((p) => p.level === l)).map((l) => ({ value: l, label: LV[l] })) },
    { key: 'class', label: 'Class / exam', opts: distinct('class').sort((a, b) => grade(a) - grade(b) || a.localeCompare(b)).map((v) => ({ value: v, label: v })) },
    { key: 'subject', label: 'Subject', opts: distinct('subject').sort().map((v) => ({ value: v, label: v })) },
    { key: 'board', label: 'Board', opts: distinct('board').sort().map((v) => ({ value: v, label: v })) },
    { key: 'format', label: 'Format', opts: [{ value: 'print', label: 'Printed book' }, { value: 'ebook', label: 'E-book' }] },
  ].filter((f) => f.opts.length > 0) as Facet[];
}

export const optLabel = (facets: Facet[], k: FacetKey, v: string) => facets.find((f) => f.key === k)?.opts.find((o) => o.value === v)?.label ?? v;

const haystack = (p: Product) =>
  [p.title, p.author, p.subject, p.classLabel, p.category?.name, p.series, p.boards.join(' '), p.isbn].join(' ').toLowerCase();

/** Does a product pass every active filter (optionally ignoring one facet, for facet counts)? */
export const passes = (p: Product, f: Filters, q: string, skip?: FacetKey) =>
  FACET_KEYS.every((k) => k === skip || !f[k].length || valuesOf(p, k).some((v) => f[k].includes(v))) &&
  (!q || q.split(/\s+/).every((w) => haystack(p).includes(w)));

export function filterAndSort(products: Product[], f: Filters, rawQ: string, sort: Sort): Product[] {
  const q = rawQ.trim().toLowerCase();
  const list = products.filter((p) => passes(p, f, q));
  const price = (p: Product) => fromPrice(p) ?? Number.MAX_SAFE_INTEGER;
  switch (sort) {
    case 'Newest': return [...list].sort((a, b) => Number(b.isNew) - Number(a.isNew));
    case 'Price: low to high': return [...list].sort((a, b) => price(a) - price(b));
    case 'Price: high to low': return [...list].sort((a, b) => price(b) - price(a));
    case 'Title A–Z': return [...list].sort((a, b) => a.title.localeCompare(b.title));
    default: return list;
  }
}

export function readParams(sp: URLSearchParams) {
  const f = { ...EMPTY };
  for (const k of FACET_KEYS) f[k] = sp.getAll(k);
  const sortParam = sp.get('sort') as Sort | null;
  return { f, q: sp.get('q') ?? '', sort: sortParam && SORTS.includes(sortParam) ? sortParam : ('Featured' as Sort) };
}

export function toParams(f: Filters, q: string, sort: Sort) {
  const sp = new URLSearchParams();
  if (q) sp.set('q', q);
  for (const k of FACET_KEYS) for (const v of f[k]) sp.append(k, v);
  if (sort !== 'Featured') sp.set('sort', sort);
  return sp;
}

/** Link to the store with preset filters and/or a search query. */
export function catalogueHref(preset: Partial<Filters> = {}, q = '') {
  const s = toParams({ ...EMPTY, ...preset }, q, 'Featured').toString();
  return '/catalogue' + (s ? '?' + s : '');
}

/** Related titles: same level or subject first, then same category. */
export function relatedTo(products: Product[], p: Product, n = 5) {
  return products
    .filter((x) => x.id !== p.id && (x.level === p.level || x.subject === p.subject))
    .concat(products.filter((x) => x.id !== p.id && x.category?.id === p.category?.id))
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, n);
}
