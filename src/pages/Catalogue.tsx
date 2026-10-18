import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EMPTY, FACETS, SORTS, filterAndSort, optLabel, passes, readParams, toParams, valuesOf, type FacetKey, type Filters, type Sort } from '../catalogue';
import { BOOKS } from '../data';
import { BookCard } from '../components/BookCard';

export function Catalogue() {
  const [sp, setSp] = useSearchParams();
  const { f, q, sort } = readParams(sp);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const update = (nf: Filters, nq: string, ns: Sort) => setSp(toParams(nf, nq, ns), { replace: true });
  const toggle = (k: FacetKey, o: string) =>
    update({ ...f, [k]: f[k].includes(o) ? f[k].filter((x) => x !== o) : [...f[k], o] }, q, sort);
  const clearAll = () => update(EMPTY, '', sort);

  const results = filterAndSort(f, q, sort);
  const qn = q.trim().toLowerCase();

  const chips = FACETS.flatMap(({ key }) => f[key].map((o) => ({ id: key + o, label: optLabel(key, o), remove: () => toggle(key, o) })));
  if (q.trim()) chips.unshift({ id: 'q', label: '“' + q.trim() + '”', remove: () => update(f, '', sort) });

  return (
    <div className="wrap page-cat">
      <div className="crumbs"><Link to="/">Home</Link><span>/</span><span className="crumbs__here">Catalogue</span></div>
      <div className="cat-head">
        <div className="stack-8">
          <h1 className="h1-page">Catalogue</h1>
          <div className="cat-head__count">{results.length + (results.length === 1 ? ' title' : ' titles')}</div>
        </div>
        <div className="cat-head__tools">
          <input className="cat-search" value={q} onChange={(e) => update(f, e.target.value, sort)} placeholder="Search titles, authors, exams…" aria-label="Search the catalogue" />
          <select className="cat-sort" value={sort} onChange={(e) => update(f, q, e.target.value as Sort)} aria-label="Sort">
            {SORTS.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div className="cat-body">
        <aside className="cat-aside">
          <button type="button" className="cat-filters-btn" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            {(filtersOpen ? 'Hide filters' : 'Show filters') + (chips.length ? ' (' + chips.length + ')' : '')}
          </button>
          <div className={'cat-facets' + (filtersOpen ? ' is-open' : '')}>
            {FACETS.map(({ key, label, opts }) => (
              <div key={key} className="facet">
                <div className="facet__label">{label}</div>
                {opts.map((o) => {
                  const on = f[key].includes(o);
                  const count = BOOKS.filter((b) => passes(b, f, qn, key) && valuesOf(b, key).includes(o)).length;
                  return (
                    <button key={o} type="button" role="checkbox" aria-checked={on} className={'facet__opt' + (on ? ' is-on' : '') + (!count && !on ? ' is-empty' : '')} onClick={() => toggle(key, o)}>
                      <span className="facet__box">{on ? '✓' : ''}</span>
                      <span className="facet__name">{optLabel(key, o)}</span>
                      <span className="facet__count">{count}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>
        <div className="cat-results">
          {chips.length > 0 && (
            <div className="chips">
              {chips.map((ch) => (
                <button key={ch.id} type="button" className="chip" onClick={ch.remove}>{ch.label}<span aria-hidden="true">×</span></button>
              ))}
              <button type="button" className="text-link" onClick={clearAll}>Clear all</button>
            </div>
          )}
          {results.length === 0 && (
            <div className="empty">
              <div className="empty__title">No titles match these filters</div>
              <div className="empty__body">Try removing a filter, or ask us — we may have it in print.</div>
              <button type="button" className="btn btn--navy btn--compact" onClick={clearAll}>Clear filters</button>
            </div>
          )}
          <div className="grid-books grid-books--cat">
            {results.map((b) => <BookCard key={b.id} book={b} variant="catalogue" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
