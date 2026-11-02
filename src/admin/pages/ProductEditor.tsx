import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LV, PAL, type LevelKey } from '../../data';
import type { Product } from '../../store/types';
import { BookCover } from '../../components/BookCover';
import { adminApi, ApiError, fmtDate, rupees, toPaise, uploadFile, useAdmin } from '../api';
import { canManage, useMe } from '../AdminApp';
import { Badge, Btn, Card, Check, ErrorBox, Loading, MoneyField, Page, SelectField, TextArea, TextField, Toggle, useAction, useToast } from '../ui';

type Kind = 'print' | 'digital' | 'bundle';
interface VariantRow { kind: Kind; price: number; compareAtPrice: number | null; sku: string | null; stock: number; trackStock: boolean; weightGrams: number | null; taxRate: number; filePath: string | null; fileName: string | null; fileSize: number | null; files?: EbookFile[]; active: boolean }
interface EbookFile { path: string; name: string; title: string; size: number | null }
/** A photo besides the cover (inside pages, back cover…). */
interface Photo { path: string; alt: string; url: string }
const MAX_PHOTOS = 20;
const sizeText = (b: number | null) => (!b ? '' : b < 1048576 ? `${Math.ceil(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
interface ProductRow {
  id: string; slug: string; title: string; series: string; author: string; blurb: string; description: string; categoryId: number | null;
  level: LevelKey; classLabel: string; grade: number | null; boards: string[]; subject: string; language: string; pages: number | null;
  edition: string; isbn: string; highlights: string[]; contents: string[]; coverPath: string | null; coverPalette: number; coverUrl: string | null; images?: Photo[];
  hasCompanion: boolean; isNew: boolean; featured: boolean; ebookWithPrint?: boolean; sort: number; status: string; seoTitle: string; seoDescription: string; updatedAt: string;
}
interface Detail {
  product: ProductRow;
  variants: Record<Kind, VariantRow | null>;
  sold: number;
  movements: { id: number; delta: number; stockAfter: number; reason: string; note: string; actor: string; createdAt: string }[];
}

const BOARDS = ['CBSE', 'ICSE', 'State Boards', 'IB', 'Cambridge'];
const LEVELS = Object.keys(LV) as LevelKey[];

const emptyForm = () => ({
  title: '', slug: '', series: '', author: '', blurb: '', description: '',
  categoryId: '' as string, level: 'S' as LevelKey, classLabel: '', grade: '', boards: [] as string[], subject: '', language: 'English',
  pages: '', edition: '', isbn: '', highlights: '', contents: '',
  coverPath: null as string | null, coverUrl: null as string | null, coverPalette: 0,
  images: [] as Photo[],
  hasCompanion: false, isNew: true, featured: false, sort: '0', status: 'draft', seoTitle: '', seoDescription: '',
  /** Buyers of the printed copy also get the e-book files free. */
  ebookWithPrint: false,
  print: { enabled: true, price: '', compareAtPrice: '', sku: '', stock: '0', trackStock: true, weightGrams: '', taxRate: '0' },
  digital: { enabled: false, price: '', compareAtPrice: '', sku: '', taxRate: '18', files: [] as EbookFile[] },
  bundle: { enabled: false, price: '', compareAtPrice: '', sku: '' },
});
type Form = ReturnType<typeof emptyForm>;

function fromDetail(d: Detail): Form {
  const p = d.product;
  const v = d.variants;
  const f = emptyForm();
  return {
    ...f,
    title: p.title, slug: p.slug, series: p.series, author: p.author, blurb: p.blurb, description: p.description,
    categoryId: p.categoryId ? String(p.categoryId) : '', level: p.level, classLabel: p.classLabel, grade: p.grade ? String(p.grade) : '',
    boards: p.boards, subject: p.subject, language: p.language, pages: p.pages ? String(p.pages) : '', edition: p.edition, isbn: p.isbn,
    highlights: p.highlights.join('\n'), contents: p.contents.join('\n'),
    coverPath: p.coverPath, coverUrl: d.product.coverUrl, coverPalette: p.coverPalette, images: p.images ?? [],
    hasCompanion: p.hasCompanion, isNew: p.isNew, featured: p.featured, ebookWithPrint: Boolean(p.ebookWithPrint), sort: String(p.sort), status: p.status, seoTitle: p.seoTitle, seoDescription: p.seoDescription,
    print: v.print ? { enabled: v.print.active, price: rupees(v.print.price), compareAtPrice: rupees(v.print.compareAtPrice), sku: v.print.sku ?? '', stock: String(v.print.stock), trackStock: v.print.trackStock, weightGrams: v.print.weightGrams ? String(v.print.weightGrams) : '', taxRate: String(v.print.taxRate) } : { ...f.print, enabled: false },
    digital: v.digital ? { enabled: v.digital.active, price: rupees(v.digital.price), compareAtPrice: rupees(v.digital.compareAtPrice), sku: v.digital.sku ?? '', taxRate: String(v.digital.taxRate),
      files: v.digital.files?.length ? v.digital.files : v.digital.filePath ? [{ path: v.digital.filePath, name: v.digital.fileName ?? '', title: '', size: v.digital.fileSize }] : [] } : f.digital,
    bundle: v.bundle ? { enabled: v.bundle.active, price: rupees(v.bundle.price), compareAtPrice: rupees(v.bundle.compareAtPrice), sku: v.bundle.sku ?? '' } : f.bundle,
  };
}

const num = (s: string) => (s.trim() === '' ? null : Number(s));
const money = (s: string) => (s.trim() === '' ? null : toPaise(s));
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function toPayload(f: Form, status = f.status) {
  return {
    title: f.title, slug: f.slug || undefined, series: f.series, author: f.author, blurb: f.blurb, description: f.description,
    categoryId: f.categoryId ? Number(f.categoryId) : null, level: f.level, classLabel: f.classLabel, grade: num(f.grade), boards: f.boards,
    subject: f.subject, language: f.language, pages: num(f.pages), edition: f.edition, isbn: f.isbn,
    highlights: lines(f.highlights), contents: lines(f.contents), coverPath: f.coverPath, coverPalette: f.coverPalette,
    images: f.images.map(({ path, alt }) => ({ path, alt })),
    hasCompanion: f.hasCompanion, isNew: f.isNew, featured: f.featured, ebookWithPrint: f.print.enabled && f.ebookWithPrint, sort: Number(f.sort) || 0, status, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
    print: { enabled: f.print.enabled, price: money(f.print.price) ?? 0, compareAtPrice: money(f.print.compareAtPrice), sku: f.print.sku, stock: Number(f.print.stock) || 0, trackStock: f.print.trackStock, weightGrams: num(f.print.weightGrams), taxRate: Number(f.print.taxRate) || 0 },
    digital: { enabled: f.digital.enabled, price: money(f.digital.price) ?? 0, compareAtPrice: money(f.digital.compareAtPrice), sku: f.digital.sku, taxRate: Number(f.digital.taxRate) || 0, files: f.digital.files },
    // Bundles are no longer sold (a printed copy can include the e-book free instead).
    bundle: { enabled: false, price: money(f.bundle.price) ?? 0, compareAtPrice: money(f.bundle.compareAtPrice), sku: f.bundle.sku },
  };
}

/** Client-side checks so obvious mistakes show before saving. */
function problems(f: Form): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.title.trim().length < 2) e.title = 'Add a title';
  if (!f.print.enabled && !f.digital.enabled) e.formats = 'Turn on the printed book, the e-book, or both';
  const bad = (s: string) => s.trim() === '' || Number.isNaN(toPaise(s)) || toPaise(s) < 0;
  if (f.print.enabled && bad(f.print.price)) e.printPrice = 'Enter a price';
  if (f.digital.enabled && bad(f.digital.price)) e.digitalPrice = 'Enter a price';
  return e;
}

export default function ProductEditor() {
  const { id } = useParams();
  const isNew = !id;
  const { me } = useMe();
  const editable = canManage(me);
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useAdmin<Detail>(isNew ? null : `/products/${id}`);
  const cats = useAdmin<{ items: { id: number; name: string }[] }>('/categories');
  const [form, setForm] = useState<Form>(emptyForm);
  const [saved, setSaved] = useState<string>(JSON.stringify(emptyForm()));
  const [serverErr, setServerErr] = useState<ApiError | null>(null);
  const [tried, setTried] = useState(false);
  const { busy, run } = useAction();

  useEffect(() => { if (data) { const f = fromDetail(data); setForm(f); setSaved(JSON.stringify(f)); } }, [data]);
  const dirty = JSON.stringify(form) !== saved;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setV = <K extends 'print' | 'digital' | 'bundle'>(k: K, patch: Partial<Form[K]>) => setForm((f) => ({ ...f, [k]: { ...f[k], ...patch } }));
  const errs = problems(form);
  const show = (k: string) => (tried ? errs[k] : undefined);
  const serverMsg = (k: string) => {
    const d = serverErr?.details as Record<string, string[]> | undefined;
    return d?.[k]?.[0];
  };

  const preview: Product = useMemo(() => ({
    id: 'preview', slug: '', title: form.title || 'Book title', series: form.series, author: form.author, blurb: '', description: '', category: null,
    level: form.level, classLabel: form.classLabel, grade: null, boards: form.boards, subject: '', language: '', pages: null, edition: '', isbn: '',
    highlights: [], contents: [], coverUrl: form.coverUrl, palette: form.coverPalette, companion: false, isNew: false, featured: false, formats: {},
  }), [form]);

  const save = async (status?: string) => {
    setTried(true);
    setServerErr(null);
    if (Object.keys(problems(form)).length) { toast('Fix the highlighted fields first.', 'error'); return; }
    const payload = toPayload(form, status);
    const res = await run('save', async () => {
      try {
        return await adminApi<Detail>(isNew ? '/products' : `/products/${id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
      } catch (e) {
        if (e instanceof ApiError) setServerErr(e);
        throw e;
      }
    }, status === 'active' && form.status !== 'active' ? 'Published — it’s live in the store' : 'Saved');
    if (!res) return;
    const f = fromDetail(res);
    setForm(f); setSaved(JSON.stringify(f));
    if (isNew) navigate(`/admin/products/${res.product.id}`, { replace: true });
  };

  const upload = async (bucket: 'covers' | 'ebooks', file: File) => {
    const r = await run(bucket, () => uploadFile(bucket, file), bucket === 'covers' ? 'Cover uploaded' : 'E-book file uploaded — save to keep it');
    if (!r) return;
    if (bucket === 'covers') setForm((f) => ({ ...f, coverPath: r.path, coverUrl: r.publicUrl }));
    else setFiles((fs) => [...fs, { path: r.path, name: r.name, title: '', size: r.size }]);
  };
  /** The e-book's files: add several at once, label, reorder, replace, remove. */
  const setFiles = (fn: (files: EbookFile[]) => EbookFile[]) => setForm((f) => ({ ...f, digital: { ...f.digital, files: fn(f.digital.files) } }));
  const addFiles = async (list: FileList) => { for (const file of [...list]) await upload('ebooks', file); };
  const replaceFile = async (i: number, file: File) => {
    const r = await run('ebooks', () => uploadFile('ebooks', file), 'File replaced — save to keep it');
    if (r) setFiles((fs) => fs.map((x, k) => (k === i ? { ...x, path: r.path, name: r.name, size: r.size } : x)));
  };
  /** More photos besides the cover: add several at once, describe, reorder, remove. */
  const setPhotos = (fn: (ps: Photo[]) => Photo[]) => setForm((f) => ({ ...f, images: fn(f.images) }));
  const addPhotos = async (list: FileList) => {
    const files = [...list].slice(0, Math.max(0, MAX_PHOTOS - form.images.length));
    if (!files.length) return;
    await run('photos', async () => {
      for (const file of files) {
        const r = await uploadFile('covers', file);
        setPhotos((ps) => [...ps, { path: r.path, url: r.publicUrl ?? '', alt: '' }]);
      }
    }, files.length > 1 ? `${files.length} photos uploaded — save to keep them` : 'Photo uploaded — save to keep it');
  };
  const movePhoto = (i: number, by: number) => setPhotos((ps) => {
    const j = i + by;
    if (j < 0 || j >= ps.length) return ps;
    const next = [...ps];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const moveFile = (i: number, by: number) => setFiles((fs) => {
    const j = i + by;
    if (j < 0 || j >= fs.length) return fs;
    const next = [...fs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const addCategory = async () => {
    const name = prompt('New category name (e.g. “Lab manuals”)');
    if (!name?.trim()) return;
    const c = await run('cat', () => adminApi<{ id: number }>('/categories', { body: { name: name.trim() } }), 'Category added');
    if (c) { cats.reload(); set('categoryId', String(c.id)); }
  };

  const remove = async () => {
    if (!confirm('Remove this product? If it has been ordered before it will be archived instead, so old orders keep their details.')) return;
    const r = await run('del', () => adminApi<{ archived: boolean }>(`/products/${id}`, { method: 'DELETE' }));
    if (r) { toast(r.archived ? 'Archived' : 'Deleted'); navigate('/admin/products'); }
  };

  if (error) return <Page title="Product" back={{ to: '/admin/products', label: 'Products' }}><ErrorBox error={error} retry={reload} /></Page>;
  if (!isNew && !data) return <Page title="Product" back={{ to: '/admin/products', label: 'Products' }}><Loading /></Page>;

  const statusLabel = form.status === 'active' ? 'Live' : form.status === 'draft' ? 'Draft' : 'Archived';

  return (
    <Page
      back={{ to: '/admin/products', label: 'Products' }}
      title={<>{isNew ? 'Add product' : form.title || 'Untitled'} {!isNew && <Badge tone={form.status === 'active' ? 'green' : form.status === 'draft' ? 'amber' : 'grey'}>{statusLabel}</Badge>}</>}
      subtitle={!isNew && data ? <>{data.sold} sold · last saved {fmtDate(data.product.updatedAt, true)} · <a href={`/books/${data.product.slug}`} target="_blank" rel="noopener">View in store ↗</a></> : 'Fill in the details, then save as a draft or publish.'}
      actions={editable && <>
        {dirty && <span className="ad-dirty">Unsaved changes</span>}
        <Btn busy={busy === 'save'} onClick={() => save()}>{form.status === 'active' ? 'Save' : 'Save draft'}</Btn>
        {form.status !== 'active' && <Btn kind="primary" busy={busy === 'save'} onClick={() => save('active')}>Publish</Btn>}
        {!isNew && data?.product.status === 'active' && !dirty && (
          <Btn busy={busy === 'announce'} title="Start a newsletter campaign about this book" onClick={() => run('announce', () => adminApi<{ id: string }>(`/newsletter/campaigns/from-product/${id}`, { method: 'POST' }))
            .then((c) => c && navigate(`/admin/newsletter/campaigns/${c.id}`))}>Announce by email</Btn>
        )}
      </>}
    >
      {serverErr && <div className="ad-alert ad-alert--red"><div>{serverErr.message}{serverErr.details ? ': ' + Object.values(serverErr.details as Record<string, string[]>).flat().join(' · ') : ''}</div></div>}
      <fieldset className="ad-editor" disabled={!editable}>
        <div className="ad-stack">
          <Card title="Basics">
            <div className="ad-form">
              <TextField label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} error={show('title') ?? serverMsg('title')} />
              <div className="ad-form-grid">
                <TextField label="Author / editor" value={form.author} onChange={(e) => set('author', e.target.value)} />
                <TextField label="Series" placeholder="e.g. Elden Core" value={form.series} onChange={(e) => set('series', e.target.value)} />
              </div>
              <TextArea label="Short description" hint="One or two sentences — shown on cards and at the top of the page." rows={2} maxLength={500} value={form.blurb} onChange={(e) => set('blurb', e.target.value)} />
              <TextArea label="Full description" rows={5} value={form.description} onChange={(e) => set('description', e.target.value)} />
            </div>
          </Card>

          <Card title="Formats & prices" actions={show('formats') && <span className="ad-err">{show('formats')}</span>}>
            <div className="ad-formats">
              <div className={'ad-format' + (form.print.enabled ? ' is-on' : '')}>
                <div className="ad-format__head"><Toggle label="Sell the printed book" checked={form.print.enabled} onChange={(v) => setV('print', { enabled: v })} /><b>Printed book</b></div>
                {form.print.enabled && <div className="ad-form-grid">
                  <MoneyField label="Price" value={form.print.price} onChange={(e) => setV('print', { price: e.target.value })} error={show('printPrice')} />
                  <MoneyField label="Compare-at price" hint="Shown struck through (optional)" value={form.print.compareAtPrice} onChange={(e) => setV('print', { compareAtPrice: e.target.value })} />
                  <TextField label="Copies in stock" type="number" min={0} value={form.print.stock} onChange={(e) => setV('print', { stock: e.target.value })} disabled={!form.print.trackStock} hint={!isNew ? 'Changes are logged in stock history' : undefined} />
                  <TextField label="SKU" value={form.print.sku} onChange={(e) => setV('print', { sku: e.target.value })} error={serverErr?.status === 409 ? serverErr.message : undefined} />
                  <TextField label="Weight (grams)" type="number" min={0} value={form.print.weightGrams} onChange={(e) => setV('print', { weightGrams: e.target.value })} />
                  <SelectField label="GST rate" value={form.print.taxRate} onChange={(e) => setV('print', { taxRate: e.target.value })}>{['0', '5', '12', '18'].map((r) => <option key={r} value={r}>{r}%{r === '0' ? ' (printed books)' : ''}</option>)}</SelectField>
                  <Check label="Track stock" hint="Stops selling at zero" checked={form.print.trackStock} onChange={(v) => setV('print', { trackStock: v })} />
                </div>}
                {form.print.enabled && (
                  <div className="ad-free-ebook">
                    <Check label="Include the e-book (PDF) free with every printed copy" hint="Buyers of the printed book also get the e-book files below, at no extra cost. The book page says so."
                      checked={form.ebookWithPrint} onChange={(v) => set('ebookWithPrint', v)} />
                  </div>
                )}
              </div>

              <div className={'ad-format' + (form.digital.enabled || (form.print.enabled && form.ebookWithPrint) ? ' is-on' : '')}>
                <div className="ad-format__head"><Toggle label="Sell the e-book separately" checked={form.digital.enabled} onChange={(v) => setV('digital', { enabled: v })} /><b>E-book (PDF)</b></div>
                {!form.digital.enabled && !(form.print.enabled && form.ebookWithPrint) && (
                  <p className="ad-muted">Turn this on to sell the e-book on its own, or tick “Include the e-book free” on the printed book to give it with every printed copy.</p>
                )}
                {!form.digital.enabled && form.print.enabled && form.ebookWithPrint && (
                  <p className="ad-muted">Not sold on its own: buyers get it free with the printed copy. Upload the files below.</p>
                )}
                {(form.digital.enabled || (form.print.enabled && form.ebookWithPrint)) && <>
                  {form.digital.enabled && <div className="ad-form-grid">
                    <MoneyField label="Price" value={form.digital.price} onChange={(e) => setV('digital', { price: e.target.value })} error={show('digitalPrice')} />
                    <MoneyField label="Compare-at price" value={form.digital.compareAtPrice} onChange={(e) => setV('digital', { compareAtPrice: e.target.value })} />
                    <TextField label="SKU" value={form.digital.sku} onChange={(e) => setV('digital', { sku: e.target.value })} />
                    <SelectField label="GST rate" value={form.digital.taxRate} onChange={(e) => setV('digital', { taxRate: e.target.value })}>{['0', '5', '12', '18'].map((r) => <option key={r} value={r}>{r}%{r === '18' ? ' (e-books)' : ''}</option>)}</SelectField>
                  </div>}
                  <div className={'ad-files' + (serverMsg('digital') ? ' has-error' : '')}>
                    <div className="ad-files__head">
                      <b>E-book files</b>
                      <span className="ad-muted">PDF or EPUB, up to 300 MB each. Buyers get every file, in this order, with its label.</span>
                    </div>
                    {form.digital.files.length === 0 && <div className="ad-files__empty">No file yet.</div>}
                    {form.digital.files.map((f, i) => (
                      <div key={f.path + i} className="ad-files__row">
                        <span className="ad-files__n">{i + 1}</span>
                        <div className="ad-files__main">
                          <input aria-label={`Label for file ${i + 1}`} placeholder={form.digital.files.length > 1 ? `e.g. Part ${i + 1}, Answer key` : 'Label (optional)'} value={f.title} maxLength={120}
                            onChange={(e) => setFiles((fs) => fs.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)))} />
                          <span className="ad-muted">{f.name || f.path.split('/').pop()}{f.size ? ` · ${sizeText(f.size)}` : ''}</span>
                        </div>
                        <div className="ad-files__actions">
                          <button type="button" className="ad-link" disabled={i === 0} onClick={() => moveFile(i, -1)} aria-label="Move up">↑</button>
                          <button type="button" className="ad-link" disabled={i === form.digital.files.length - 1} onClick={() => moveFile(i, 1)} aria-label="Move down">↓</button>
                          <label className="ad-link">Replace<input type="file" hidden accept="application/pdf,application/epub+zip,.pdf,.epub" onChange={(e) => e.target.files?.[0] && replaceFile(i, e.target.files[0])} /></label>
                          <button type="button" className="ad-link ad-neg" onClick={() => confirm(`Remove “${f.title || f.name}” from this e-book? (Buyers who already have it keep their copy.)`) && setFiles((fs) => fs.filter((_, k) => k !== i))}>Remove</button>
                        </div>
                      </div>
                    ))}
                    {serverMsg('digital') && <em className="ad-files__err">{serverMsg('digital')}</em>}
                    <label className="ad-btn ad-btn--secondary ad-btn--sm ad-files__add">
                      {busy === 'ebooks' ? 'Uploading…' : form.digital.files.length ? 'Add another file' : 'Upload file'}
                      <input type="file" hidden multiple accept="application/pdf,application/epub+zip,.pdf,.epub" onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
                    </label>
                    <span className="ad-muted">Stored privately; buyers get expiring download links.</span>
                  </div>
                </>}
              </div>

            </div>
          </Card>

          <Card title="What’s inside">
            <div className="ad-form-grid">
              <TextArea label="Highlights" hint="One per line" rows={5} value={form.highlights} onChange={(e) => set('highlights', e.target.value)} />
              <TextArea label="Table of contents" hint="One chapter per line" rows={5} value={form.contents} onChange={(e) => set('contents', e.target.value)} />
            </div>
          </Card>

          <Card title="Search engines">
            <div className="ad-form">
              <TextField label="Page title" placeholder={form.title} value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} />
              <TextArea label="Description" rows={2} placeholder={form.blurb} value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} />
              <TextField label="Web address" hint={`eldenap.in/books/${form.slug || '…'} — leave blank to make one from the title`} value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} />
            </div>
          </Card>
        </div>

        <div className="ad-stack">
          <Card title="Cover">
            <div className="ad-cover">
              <div className="ad-cover__preview"><BookCover book={preview} /></div>
              <div className="ad-form">
                <label className="ad-btn ad-btn--secondary ad-btn--sm">
                  {busy === 'covers' ? 'Uploading…' : form.coverUrl ? 'Replace image' : 'Upload cover image'}
                  <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && upload('covers', e.target.files[0])} />
                </label>
                {form.coverUrl && <button type="button" className="ad-link" onClick={() => setForm((f) => ({ ...f, coverPath: null, coverUrl: null }))}>Use a typeset cover instead</button>}
                {!form.coverUrl && <>
                  <span className="ad-label">Typeset cover colours</span>
                  <div className="ad-swatches">
                    {PAL.map((c, i) => <button key={i} type="button" aria-label={`Colour ${i + 1}`} className={form.coverPalette === i ? 'is-on' : ''} style={{ background: c.bg, borderColor: c.ac }} onClick={() => set('coverPalette', i)} />)}
                  </div>
                </>}
                <small className="ad-muted">JPG, PNG or WebP, portrait 3:4, at least 900 px wide.</small>
              </div>
            </div>
          </Card>

          <Card title="More photos">
            <div className="ad-form">
              <small className="ad-muted">Inside pages, the back cover, sample chapters… Shown on the book’s page after the cover. The cover above stays the book’s picture everywhere in the store.</small>
              {form.images.length > 0 && (
                <ul className="ad-photos">
                  {form.images.map((ph, i) => (
                    <li key={ph.path} className="ad-photos__item">
                      <img src={ph.url} alt={ph.alt || `Photo ${i + 1}`} loading="lazy" />
                      <input aria-label={`Description of photo ${i + 1}`} placeholder="Description (optional)" value={ph.alt} maxLength={150}
                        onChange={(e) => setPhotos((ps) => ps.map((x, k) => (k === i ? { ...x, alt: e.target.value } : x)))} />
                      <div className="ad-photos__actions">
                        <button type="button" className="ad-link" disabled={i === 0} onClick={() => movePhoto(i, -1)} aria-label={`Move photo ${i + 1} earlier`}>←</button>
                        <button type="button" className="ad-link" disabled={i === form.images.length - 1} onClick={() => movePhoto(i, 1)} aria-label={`Move photo ${i + 1} later`}>→</button>
                        <button type="button" className="ad-link ad-neg" onClick={() => setPhotos((ps) => ps.filter((_, k) => k !== i))}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {form.images.length < MAX_PHOTOS && (
                <label className="ad-btn ad-btn--secondary ad-btn--sm">
                  {busy === 'photos' ? 'Uploading…' : form.images.length ? 'Add more photos' : 'Upload photos'}
                  <input type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={(e) => { if (e.target.files?.length) addPhotos(e.target.files); e.target.value = ''; }} />
                </label>
              )}
              <small className="ad-muted">JPG, PNG or WebP, up to 5 MB each, up to {MAX_PHOTOS}. You can pick several at once. Save to keep them.</small>
            </div>
          </Card>

          <Card title="Organisation">
            <div className="ad-form">
              <div className="ad-with-action">
                <SelectField label="Category" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">— None —</option>
                  {cats.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectField>
                <button type="button" className="ad-link" onClick={addCategory}>+ New</button>
              </div>
              <SelectField label="Level" value={form.level} onChange={(e) => set('level', e.target.value as LevelKey)}>{LEVELS.map((l) => <option key={l} value={l}>{LV[l]}</option>)}</SelectField>
              <div className="ad-form-grid">
                <TextField label="Class / exam" placeholder="Class 8, NEET…" value={form.classLabel} onChange={(e) => {
                  const g = /^Class (\d{1,2})$/i.exec(e.target.value.trim())?.[1];
                  setForm((f) => ({ ...f, classLabel: e.target.value, grade: g ? g : f.grade }));
                }} />
                <TextField label="Grade (1–12)" type="number" min={1} max={12} value={form.grade} onChange={(e) => set('grade', e.target.value)} hint="For sorting" />
              </div>
              <div>
                <span className="ad-label">Boards</span>
                <div className="ad-chips">
                  {[...new Set([...BOARDS, ...form.boards])].map((b) => (
                    <button key={b} type="button" className={form.boards.includes(b) ? 'is-on' : ''} onClick={() => set('boards', form.boards.includes(b) ? form.boards.filter((x) => x !== b) : [...form.boards, b])}>{b}</button>
                  ))}
                  <button type="button" onClick={() => { const b = prompt('Board name'); if (b?.trim()) set('boards', [...form.boards, b.trim()]); }}>+ Other</button>
                </div>
              </div>
              <div className="ad-form-grid">
                <TextField label="Subject" value={form.subject} onChange={(e) => set('subject', e.target.value)} />
                <TextField label="Language" value={form.language} onChange={(e) => set('language', e.target.value)} />
                <TextField label="Pages" type="number" min={1} value={form.pages} onChange={(e) => set('pages', e.target.value)} />
                <TextField label="Edition" placeholder="2027–28" value={form.edition} onChange={(e) => set('edition', e.target.value)} />
              </div>
              <TextField label="ISBN" value={form.isbn} onChange={(e) => set('isbn', e.target.value)} />
            </div>
          </Card>

          <Card title="Visibility">
            <div className="ad-form">
              <SelectField label="Status" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="draft">Draft — hidden from the store</option><option value="active">Live — visible and for sale</option><option value="archived">Archived — hidden, kept for records</option>
              </SelectField>
              <Check label="Show as New" checked={form.isNew} onChange={(v) => set('isNew', v)} />
              <Check label="Featured on the home page" checked={form.featured} onChange={(v) => set('featured', v)} />
              <Check label="Has an elmaster digital companion" checked={form.hasCompanion} onChange={(v) => set('hasCompanion', v)} />
              <TextField label="Sort order" type="number" hint="Lower numbers appear first" value={form.sort} onChange={(e) => set('sort', e.target.value)} />
            </div>
          </Card>

          {!isNew && data && data.movements.length > 0 && (
            <Card title="Stock history" actions={<Link to="/admin/inventory" className="ad-link">Adjust →</Link>} flush>
              <ul className="ad-list">
                {data.movements.map((m) => (
                  <li key={m.id}><span><b className={m.delta < 0 ? 'ad-neg' : 'ad-pos'}>{m.delta > 0 ? '+' : ''}{m.delta}</b> {m.reason}{m.note && ` — ${m.note}`}</span><span className="ad-muted">{m.stockAfter} left · {fmtDate(m.createdAt)}</span></li>
                ))}
              </ul>
            </Card>
          )}
          {!isNew && editable && <Btn kind="danger" busy={busy === 'del'} onClick={remove}>Delete product</Btn>}
        </div>
      </fieldset>
    </Page>
  );
}
