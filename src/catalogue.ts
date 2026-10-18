import { BOOKS, BOARDS, FORMATS, LV, SUBJECTS, TYPES, type Book, type LevelKey } from './data';

export type FacetKey = 'type' | 'level' | 'subject' | 'board' | 'format';
export type Filters = Record<FacetKey, string[]>;

export const FACET_KEYS: FacetKey[] = ['type', 'level', 'subject', 'board', 'format'];
export const EMPTY: Filters = { type: [], level: [], subject: [], board: [], format: [] };

export const SORTS = ['Featured', 'Newest', 'Price: low to high', 'Price: high to low', 'Title A–Z'] as const;
export type Sort = (typeof SORTS)[number];

/** Facet definitions. Level options are stored as keys (P, M, …) and shown by label. */
export const FACETS: { key: FacetKey; label: string; opts: string[] }[] = [
  { key: 'type', label: 'Publication type', opts: TYPES },
  { key: 'level', label: 'Level', opts: Object.keys(LV) },
  { key: 'subject', label: 'Subject', opts: SUBJECTS },
  { key: 'board', label: 'Board', opts: BOARDS },
  { key: 'format', label: 'Format', opts: FORMATS },
];

export const optLabel = (k: FacetKey, o: string) => (k === 'level' ? LV[o as LevelKey] ?? o : o);

export const valuesOf = (bk: Book, k: FacetKey): string[] =>
  k === 'format' ? (bk.eb ? ['Print', 'E-book'] : ['Print'])
  : k === 'level' ? [bk.lv]
  : k === 'type' ? [bk.ty]
  : k === 'subject' ? [bk.su]
  : [bk.bd];

const haystack = (bk: Book) => [bk.t, bk.a, bk.su, bk.cl, bk.ty, bk.s, bk.bd].join(' ').toLowerCase();

/** Does a book pass every active filter (optionally ignoring one facet, for facet counts)? */
export const passes = (bk: Book, f: Filters, q: string, skip?: FacetKey) =>
  FACET_KEYS.every((k) => k === skip || !f[k].length || valuesOf(bk, k).some((v) => f[k].includes(v))) &&
  (!q || haystack(bk).includes(q));

export function filterAndSort(f: Filters, rawQ: string, sort: Sort): Book[] {
  const q = rawQ.trim().toLowerCase();
  const list = BOOKS.filter((bk) => passes(bk, f, q));
  switch (sort) {
    case 'Newest': return [...list].sort((a, b) => Number(b.nw) - Number(a.nw));
    case 'Price: low to high': return [...list].sort((a, b) => a.pr - b.pr);
    case 'Price: high to low': return [...list].sort((a, b) => b.pr - a.pr);
    case 'Title A–Z': return [...list].sort((a, b) => a.t.localeCompare(b.t));
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

/** Link to the catalogue with preset filters and/or a search query. */
export function catalogueHref(preset: Partial<Filters> = {}, q = '') {
  const s = toParams({ ...EMPTY, ...preset }, q, 'Featured').toString();
  return '/catalogue' + (s ? '?' + s : '');
}
