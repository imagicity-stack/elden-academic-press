import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { buildFacets, EMPTY, SORTS, filterAndSort, optLabel, passes, readParams, toParams, valuesOf, type Facet, type FacetKey, type Filters, type Sort } from '../catalogue';
import { useCatalog } from '../store/catalog';
import type { Product } from '../store/types';
import { BookCard } from '../components/BookCard';
import { EASE } from '../components/motion';

export function Catalogue() {
  const { products, categories, status, reload } = useCatalog();
  const [sp, setSp] = useSearchParams();
  const { f, q, sort } = readParams(sp);
  const [sheet, setSheet] = useState(false);
  const facets = useMemo(() => buildFacets(products, categories), [products, categories]);

  const update = (nf: Filters, nq: string, ns: Sort) => setSp(toParams(nf, nq, ns), { replace: true });
  const toggle = (k: FacetKey, o: string) =>
    update({ ...f, [k]: f[k].includes(o) ? f[k].filter((x) => x !== o) : [...f[k], o] }, q, sort);
  const clearAll = () => update(EMPTY, '', sort);

  const results = filterAndSort(products, f, q, sort);
  const qn = q.trim().toLowerCase();
  const typeFacet = facets.find((x) => x.key === 'type');
  const journalsOnly = f.type.length === 1 && f.type[0] === 'journals';

  const chips = facets.flatMap(({ key }) => f[key].map((o) => ({ id: key + o, label: optLabel(facets, key, o), remove: () => toggle(key, o) })));
  if (q.trim()) chips.unshift({ id: 'q', label: '“' + q.trim() + '”', remove: () => update(f, '', sort) });

  useEffect(() => { document.title = (journalsOnly ? 'Journals' : 'Store') + ' — Elden Academic Press'; }, [journalsOnly]);

  return (
    <div className="store">
      <div className="wrap page-head store__head">
        <div className="crumbs"><Link to="/">Home</Link><span>/</span><span className="crumbs__here">{journalsOnly ? 'Journals' : 'Store'}</span></div>
        <div className="store__title-row">
          <h1 className="t-h1">{journalsOnly ? 'Journals' : <>The <span className="serif-i">store.</span></>}</h1>
          <div className="store__count" aria-live="polite">
            {status === 'ready' ? <><b>{results.length}</b> {results.length === 1 ? 'title' : 'titles'}</> : status === 'loading' ? 'Loading…' : ''}
          </div>
        </div>
        <div className="store__tools">
          <label className="store__search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15ZM21 21l-5.2-5.2" /></svg>
            <input value={q} onChange={(e) => update(f, e.target.value, sort)} placeholder="Search titles, authors, subjects, exams…" aria-label="Search the store" />
          </label>
          <select className="input store__sort" value={sort} onChange={(e) => update(f, q, e.target.value as Sort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <button type="button" className="btn btn--outline store__filters-btn" onClick={() => setSheet(true)}>
            Filters{chips.length ? ` · ${chips.length}` : ''}
          </button>
        </div>
        {typeFacet && (
          <div className="store__tabs" role="group" aria-label="Category">
            <TypeTab on={!f.type.length} onClick={() => update({ ...f, type: [] }, q, sort)}>All</TypeTab>
            {typeFacet.opts.map((o) => (
              <TypeTab key={o.value} on={f.type.length === 1 && f.type[0] === o.value} onClick={() => update({ ...f, type: [o.value] }, q, sort)}>{o.label}</TypeTab>
            ))}
          </div>
        )}
      </div>

      <div className="wrap store__body">
        <aside className="store__aside" aria-label="Filters">
          <Facets facets={facets} f={f} products={products} qn={qn} toggle={toggle} />
        </aside>

        <div className="store__results">
          <AnimatePresence initial={false}>
            {chips.length > 0 && (
              <motion.div className="chips" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <AnimatePresence initial={false} mode="popLayout">
                  {chips.map((ch) => (
                    <motion.button layout key={ch.id} type="button" className="chip" onClick={ch.remove} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                      {ch.label}<span aria-hidden="true">×</span><span className="visually-hidden">Remove</span>
                    </motion.button>
                  ))}
                </AnimatePresence>
                <button type="button" className="text-link" onClick={clearAll}>Clear all</button>
              </motion.div>
            )}
          </AnimatePresence>

          {status === 'error' && (
            <div className="empty">
              <div className="empty__title">We couldn’t load the store</div>
              <div className="empty__body">Check your connection and try again.</div>
              <button type="button" className="btn btn--ink btn--md" onClick={reload}>Try again</button>
            </div>
          )}
          {status === 'loading' && (
            <div className="grid-books" aria-busy="true">
              {Array.from({ length: 8 }, (_, i) => <div key={i}><div className="skeleton skeleton--cover" /><div className="skeleton skeleton--line" /><div className="skeleton skeleton--line skeleton--short" /></div>)}
            </div>
          )}
          {status === 'ready' && results.length === 0 && (
            <div className="empty">
              <div className="empty__title">Nothing matches that.</div>
              <div className="empty__body">Try removing a filter, or ask us; we may have it in print.</div>
              <button type="button" className="btn btn--ink btn--md" onClick={clearAll}>Clear filters</button>
            </div>
          )}
          <motion.div className="grid-books" layout>
            <AnimatePresence mode="popLayout" initial={false}>
              {results.map((b, i) => (
                <motion.div key={b.id} layout initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.45, ease: EASE, delay: Math.min(i, 8) * 0.03 }}>
                  <BookCard book={b} variant="catalogue" />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {sheet && (
          <motion.div className="sheet-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSheet(false)}>
            <motion.div className="sheet" role="dialog" aria-modal="true" aria-label="Filters" onClick={(e) => e.stopPropagation()}
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }}>
              <div className="sheet__head">
                <b>Filters</b>
                {chips.length > 0 && <button type="button" className="text-link" onClick={clearAll}>Clear all</button>}
              </div>
              <div className="sheet__body"><Facets facets={facets} f={f} products={products} qn={qn} toggle={toggle} /></div>
              <div className="sheet__foot"><button type="button" className="btn btn--ink btn--lg btn--block" onClick={() => setSheet(false)}>Show {results.length} {results.length === 1 ? 'title' : 'titles'}</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TypeTab({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" aria-pressed={on} className={'pill' + (on ? ' is-on' : '')} onClick={onClick}>
      {on && <motion.span layoutId="store-tab" className="pill__bg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
      {children}
    </button>
  );
}

function Facets({ facets, f, products, qn, toggle }: { facets: Facet[]; f: Filters; products: Product[]; qn: string; toggle: (k: FacetKey, o: string) => void }) {
  return (
    <>
      {facets.map(({ key, label, opts }) => (
        <div key={key} className="facet">
          <div className="facet__label">{label}</div>
          {opts.map(({ value, label: optText }) => {
            const on = f[key].includes(value);
            const count = products.filter((b) => passes(b, f, qn, key) && valuesOf(b, key).includes(value)).length;
            return (
              <button key={value} type="button" role="checkbox" aria-checked={on} className={'facet__opt' + (on ? ' is-on' : '') + (!count && !on ? ' is-empty' : '')} onClick={() => toggle(key, value)}>
                <span className="facet__box" aria-hidden="true">
                  <svg viewBox="0 0 16 16"><motion.path d="M3.5 8.5l3 3 6-7" initial={false} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.25 }} /></svg>
                </span>
                <span className="facet__name">{optText}</span>
                <span className="facet__count">{count}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}
