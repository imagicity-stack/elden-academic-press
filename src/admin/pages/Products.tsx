import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PAL } from '../../data';
import { inr } from '../../store/api';
import { adminApi, downloadFile, useAdmin } from '../api';
import { canManage, useMe } from '../AdminApp';
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, Page, Pagination, STATUS_TONE, useAction } from '../ui';

interface Row {
  id: string; slug: string; title: string; author: string; status: string; classLabel: string; level: string; category: string | null; coverUrl: string | null; palette: number;
  variants: { kind: 'print' | 'digital' | 'bundle'; price: number; stock: number; trackStock: boolean; hasFile: boolean }[];
}
const KIND_LABEL = { print: 'Print', digital: 'E-book', bundle: 'Bundle' };

export default function Products() {
  const { me } = useMe();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const { busy, run } = useAction();
  const cats = useAdmin<{ items: { id: number; name: string }[] }>('/categories');
  const params = new URLSearchParams({ page: sp.get('page') ?? '1', limit: '50' });
  for (const k of ['q', 'status', 'category', 'stock']) if (sp.get(k)) params.set(k, sp.get(k)!);
  const { data, error, reload } = useAdmin<{ items: Row[]; total: number; page: number; limit: number }>(`/products?${params}`);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v); else next.delete(k);
    if (k !== 'page') next.delete('page');
    setSp(next, { replace: true });
    setSelected(new Set());
  };
  const bulk = async (action: string) => {
    const r = await run('bulk', () => adminApi('/products/bulk', { body: { ids: [...selected], action } }), `${selected.size} product${selected.size === 1 ? '' : 's'} updated`);
    if (r !== undefined) { setSelected(new Set()); reload(); }
  };
  const all = data?.items ?? [];
  const toggleAll = () => setSelected(selected.size === all.length ? new Set() : new Set(all.map((p) => p.id)));

  return (
    <Page title="Products" actions={<>
      <Btn busy={busy === 'csv'} onClick={() => run('csv', () => downloadFile('/products/export.csv', 'products.csv'))}>Export</Btn>
      {canManage(me) && <Btn onClick={() => setImporting(true)}>Import</Btn>}
      {canManage(me) && <Btn kind="primary" onClick={() => navigate('/admin/products/new')}>Add product</Btn>}
    </>}>
      <div className="ad-tabs">
        {[['', 'All'], ['active', 'Live'], ['draft', 'Drafts'], ['archived', 'Archived']].map(([v, l]) => (
          <button key={v} type="button" className={'ad-tab' + ((sp.get('status') ?? '') === v ? ' is-on' : '')} onClick={() => setParam('status', v)}>{l}</button>
        ))}
      </div>
      <Card flush>
        <form className="ad-toolbar" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim()); }}>
          <input type="search" className="ad-search" placeholder="Search title, author, ISBN, SKU, class" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={sp.get('category') ?? ''} onChange={(e) => setParam('category', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={sp.get('stock') ?? ''} onChange={(e) => setParam('stock', e.target.value)} aria-label="Stock">
            <option value="">Any stock</option><option value="low">Low stock</option><option value="out">Out of stock</option>
          </select>
          <Btn size="sm" type="submit">Search</Btn>
        </form>
        {selected.size > 0 && canManage(me) && (
          <div className="ad-bulk">
            <b>{selected.size} selected</b>
            <Btn size="sm" busy={busy === 'bulk'} onClick={() => bulk('active')}>Publish</Btn>
            <Btn size="sm" busy={busy === 'bulk'} onClick={() => bulk('draft')}>Move to drafts</Btn>
            <Btn size="sm" busy={busy === 'bulk'} onClick={() => bulk('archived')}>Archive</Btn>
          </div>
        )}
        {error ? <ErrorBox error={error} retry={reload} /> : !data ? <Loading /> : all.length === 0 ? (
          <Empty title="No products here.">{canManage(me) && <Btn kind="primary" onClick={() => navigate('/admin/products/new')}>Add your first product</Btn>}</Empty>
        ) : (
          <div className="ad-table-wrap">
            <table className="ad-table ad-table--click">
              <thead><tr>
                <th className="ad-cb"><input type="checkbox" aria-label="Select all" checked={selected.size === all.length} onChange={toggleAll} /></th>
                <th>Product</th><th>Category</th><th>Formats & prices</th><th className="ad-num">Stock</th><th>Status</th>
              </tr></thead>
              <tbody>
                {all.map((p) => {
                  const print = p.variants.find((v) => v.kind === 'print');
                  const missingFile = p.variants.some((v) => v.kind === 'digital' && !v.hasFile);
                  return (
                    <tr key={p.id} onClick={() => navigate(`/admin/products/${p.id}`)}>
                      <td className="ad-cb" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${p.title}`} checked={selected.has(p.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
                      </td>
                      <td>
                        <div className="ad-prod">
                          {p.coverUrl ? <img src={p.coverUrl} alt="" /> : <span className="ad-prod__swatch" style={{ background: PAL[p.palette]?.bg }} />}
                          <div><Link to={`/admin/products/${p.id}`} className="ad-strong" onClick={(e) => e.stopPropagation()}>{p.title}</Link><div className="ad-muted">{[p.classLabel, p.author].filter(Boolean).join(' · ')}</div></div>
                        </div>
                      </td>
                      <td className="ad-muted">{p.category ?? '—'}</td>
                      <td>{p.variants.map((v) => <div key={v.kind} className="ad-fmt"><span>{KIND_LABEL[v.kind]}</span> {inr(v.price)}</div>)}{missingFile && <Badge tone="red">E-book file missing</Badge>}</td>
                      <td className="ad-num">{print ? (print.trackStock ? <Badge tone={print.stock === 0 ? 'red' : print.stock <= 5 ? 'amber' : 'grey'}>{print.stock}</Badge> : '∞') : '—'}</td>
                      <td><Badge tone={STATUS_TONE[p.status]}>{p.status === 'active' ? 'Live' : p.status === 'draft' ? 'Draft' : 'Archived'}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pagination page={data.page} total={data.total} limit={data.limit} onPage={(p) => setParam('page', String(p))} />}
      </Card>
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); reload(); }} />}
    </Page>
  );
}

interface ImportResult { created: number; updated: number; errors: { row: number; message: string }[]; dryRun: boolean }

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [csv, setCsv] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const { busy, run } = useAction();
  const check = async (text: string) => {
    const r = await run('check', () => adminApi<ImportResult>('/products/import', { body: { csv: text, dryRun: true } }));
    if (r) setPreview(r);
  };
  return (
    <Modal wide title="Import products from a spreadsheet" onClose={onClose} footer={<>
      <Btn onClick={onClose}>Cancel</Btn>
      <Btn kind="primary" disabled={!preview || preview.created + preview.updated === 0} busy={busy === 'go'}
        onClick={() => run('go', () => adminApi<ImportResult>('/products/import', { body: { csv } }), 'Import finished').then((r) => r && onDone())}>
        Import {preview ? `${preview.created + preview.updated} products` : ''}
      </Btn>
    </>}>
      <div className="ad-form">
        <p>Upload a <b>.csv</b> file (save your Excel or Google Sheet as CSV). The easiest start is to <b>Export</b> the current list and edit it. Columns:</p>
        <p className="ad-muted ad-mono">slug, title, status, category, series, author, level (P M S SS C H), class, grade, boards, subject, language, pages, edition, isbn, blurb, print_price, print_sku, stock, weight_g, ebook_price, ebook_sku, bundle_price</p>
        <p className="ad-muted">Rows are matched by slug (or title). New products arrive as drafts unless status says “active”. E-book files and covers are added in each product afterwards.</p>
        <label className="ad-file">
          <input type="file" accept=".csv,text/csv" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const text = await f.text();
            setName(f.name); setCsv(text); setPreview(null);
            check(text);
          }} />
          <span>{name || 'Choose CSV file…'}</span>
        </label>
        {busy === 'check' && <div className="ad-muted">Checking…</div>}
        {preview && (
          <div className={preview.errors.length ? 'ad-alert ad-alert--amber' : 'ad-alert ad-alert--green'}>
            <div><b>{preview.created}</b> new and <b>{preview.updated}</b> updated products ready to import.{preview.errors.length > 0 && <> <b>{preview.errors.length}</b> rows have problems and will be skipped:</>}</div>
            {preview.errors.length > 0 && <ul className="ad-errlist">{preview.errors.slice(0, 20).map((e) => <li key={e.row}>Row {e.row}: {e.message}</li>)}</ul>}
          </div>
        )}
      </div>
    </Modal>
  );
}
