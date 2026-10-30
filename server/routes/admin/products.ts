import { Hono, type Context } from 'hono';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppEnv } from '../../app.js';
import type { Q } from '../../db/client.js';
import { categories, inventoryMovements, orderItems, productVariants, products } from '../../db/schema.js';
import { slugify } from '../../db/seed.js';
import { parseCsv, toCsv } from '../../lib/csv.js';
import { body, HttpError, notFound, query, zText } from '../../lib/http.js';
import type { Bucket } from '../../lib/storage.js';
import { getSettings, type Variant } from '../../services/catalog.js';
import { audit, requireRole } from './auth.js';

export const adminProducts = new Hono<AppEnv>();
export const adminInventory = new Hono<AppEnv>();
export const adminCategories = new Hono<AppEnv>();
export const adminUploads = new Hono<AppEnv>();

const LEVELS = ['P', 'M', 'S', 'SS', 'C', 'H'] as const;
const money = z.number().int().min(0).max(100_000_000);
const zSku = z.string().trim().max(60).transform((s) => s || null).nullable().optional();

const zVariant = z.object({
  enabled: z.boolean(),
  price: money,
  compareAtPrice: money.nullable().optional(),
  sku: zSku,
});
const zProduct = z.object({
  title: z.string().trim().min(2, 'Add a title').max(200),
  slug: z.string().trim().max(90).optional(),
  series: zText(120).default(''),
  author: zText(200).default(''),
  blurb: zText(500).default(''),
  description: zText(20_000).default(''),
  categoryId: z.number().int().nullable().optional(),
  level: z.enum(LEVELS),
  classLabel: zText(80).default(''),
  grade: z.number().int().min(1).max(12).nullable().optional(),
  boards: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  subject: zText(80).default(''),
  language: zText(40).default('English'),
  pages: z.number().int().min(1).max(10_000).nullable().optional(),
  edition: zText(40).default(''),
  isbn: zText(20).default(''),
  highlights: z.array(z.string().trim().max(200)).max(20).default([]),
  contents: z.array(z.string().trim().max(200)).max(200).default([]),
  coverPath: z.string().max(300).nullable().optional(),
  coverPalette: z.number().int().min(0).max(5).default(0),
  hasCompanion: z.boolean().default(false),
  isNew: z.boolean().default(false),
  featured: z.boolean().default(false),
  sort: z.number().int().default(0),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  seoTitle: zText(120).default(''),
  seoDescription: zText(300).default(''),
  print: zVariant.extend({
    stock: z.number().int().min(0).max(1_000_000).default(0),
    trackStock: z.boolean().default(true),
    weightGrams: z.number().int().min(0).max(50_000).nullable().optional(),
    taxRate: z.number().int().min(0).max(28).default(0),
  }),
  digital: zVariant.extend({
    taxRate: z.number().int().min(0).max(28).default(18),
    filePath: z.string().max(300).nullable().optional(),
    fileName: z.string().max(200).nullable().optional(),
    fileSize: z.number().int().nullable().optional(),
  }),
  bundle: zVariant,
}).refine((p) => p.print.enabled || p.digital.enabled, { message: 'Turn on at least one format', path: ['print'] })
  .refine((p) => !p.bundle.enabled || (p.print.enabled && p.digital.enabled), { message: 'A bundle needs both print and e-book', path: ['bundle'] })
  .refine((p) => !(p.status === 'active' && p.digital.enabled && !p.digital.filePath), { message: 'Upload the e-book file before publishing', path: ['digital'] });

type ProductInput = z.infer<typeof zProduct>;

async function uniqueSlug(db: Q, wanted: string, exceptId?: string) {
  const base = slugify(wanted) || 'product';
  for (let i = 0; ; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const [hit] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
  }
}

function productColumns(p: ProductInput, slug: string) {
  const { print: _p, digital: _d, bundle: _b, slug: _s, ...rest } = p;
  return { ...rest, slug, categoryId: p.categoryId ?? null, grade: p.grade ?? null, pages: p.pages ?? null, coverPath: p.coverPath ?? null };
}

/** Create/update the three variants; stock changes are logged as inventory movements. */
async function saveVariants(tx: Q, productId: string, p: ProductInput, actor: string) {
  const existing = await tx.select().from(productVariants).where(eq(productVariants.productId, productId));
  const find = (k: Variant['kind']) => existing.find((v) => v.kind === k);
  const sets: [Variant['kind'], Partial<typeof productVariants.$inferInsert>, boolean][] = [
    ['print', { price: p.print.price, compareAtPrice: p.print.compareAtPrice ?? null, sku: p.print.sku ?? null, trackStock: p.print.trackStock, weightGrams: p.print.weightGrams ?? null, taxRate: p.print.taxRate }, p.print.enabled],
    ['digital', { price: p.digital.price, compareAtPrice: p.digital.compareAtPrice ?? null, sku: p.digital.sku ?? null, taxRate: p.digital.taxRate, filePath: p.digital.filePath ?? null, fileName: p.digital.fileName ?? null, fileSize: p.digital.fileSize ?? null }, p.digital.enabled],
    ['bundle', { price: p.bundle.price, compareAtPrice: p.bundle.compareAtPrice ?? null, sku: p.bundle.sku ?? null }, p.bundle.enabled],
  ];
  for (const [kind, values, enabled] of sets) {
    const cur = find(kind);
    if (!cur && !enabled) continue;
    if (cur) {
      await tx.update(productVariants).set({ ...values, active: enabled, updatedAt: sql`now()` }).where(eq(productVariants.id, cur.id));
    } else {
      const [created] = await tx.insert(productVariants).values({ productId, kind, price: values.price!, ...values, active: true, stock: 0 }).returning();
      existing.push(created);
    }
  }
  const print = find('print');
  if (print && p.print.enabled && p.print.stock !== print.stock) {
    const delta = p.print.stock - print.stock;
    await tx.update(productVariants).set({ stock: p.print.stock }).where(eq(productVariants.id, print.id));
    await tx.insert(inventoryMovements).values({ variantId: print.id, delta, stockAfter: p.print.stock, reason: 'edit', actor });
  }
}

const skuTaken = (e: unknown) => /variants_sku_idx|duplicate key/.test(String((e as { message?: string })?.message ?? e) + String((e as { cause?: unknown })?.cause ?? ''));

/* ---------------- Products ---------------- */

const zList = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  category: z.coerce.number().int().optional(),
  format: z.enum(['print', 'digital', 'bundle']).optional(),
  stock: z.enum(['low', 'out']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

adminProducts.get('/', async (c) => {
  const { db, storage } = c.get('deps');
  const f = query(c, zList);
  const s = await getSettings(db);
  const w: (SQL | undefined)[] = [f.status ? eq(products.status, f.status) : sql`${products.status} <> 'archived'`];
  if (f.category) w.push(eq(products.categoryId, f.category));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, '\\$&')}%`;
    w.push(or(ilike(products.title, like), ilike(products.author, like), ilike(products.isbn, like), ilike(products.subject, like), ilike(products.classLabel, like),
      sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.sku ilike ${like})`));
  }
  if (f.format) w.push(sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.kind = ${f.format} and v.active)`);
  if (f.stock) {
    w.push(sql`exists (select 1 from ${productVariants} v where v.product_id = ${products.id} and v.kind = 'print' and v.active and v.track_stock and ${
      f.stock === 'out' ? sql`v.stock = 0` : sql`v.stock <= ${s.lowStockThreshold}`})`);
  }
  const where = and(...w);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(products).where(where).orderBy(asc(products.sort), desc(products.createdAt)).limit(f.limit).offset((f.page - 1) * f.limit),
    db.select({ total: count() }).from(products).where(where),
  ]);
  const vars = rows.length ? await db.select().from(productVariants).where(inArray(productVariants.productId, rows.map((r) => r.id))) : [];
  const cats = await db.select().from(categories);
  return c.json({
    total, page: f.page, limit: f.limit,
    items: rows.map((p) => ({
      id: p.id, slug: p.slug, title: p.title, author: p.author, status: p.status, classLabel: p.classLabel, level: p.level,
      category: cats.find((x) => x.id === p.categoryId)?.name ?? null, coverUrl: p.coverPath ? storage.publicUrl('covers', p.coverPath) : null,
      palette: p.coverPalette, updatedAt: p.updatedAt,
      variants: vars.filter((v) => v.productId === p.id && v.active).map((v) => ({ kind: v.kind, price: v.price, stock: v.stock, trackStock: v.trackStock, hasFile: Boolean(v.filePath) })),
    })),
  });
});

adminProducts.get('/export.csv', async (c) => {
  const { db } = c.get('deps');
  const [rows, vars, cats] = await Promise.all([db.select().from(products).orderBy(asc(products.sort)), db.select().from(productVariants), db.select().from(categories)]);
  const v = (id: string, k: Variant['kind']) => vars.find((x) => x.productId === id && x.kind === k && x.active);
  const rs = (p?: number | null) => (p == null ? '' : (p / 100).toFixed(2));
  const csv = toCsv(rows, [
    ['slug', (p) => p.slug], ['title', (p) => p.title], ['status', (p) => p.status], ['category', (p) => cats.find((x) => x.id === p.categoryId)?.name ?? ''],
    ['series', (p) => p.series], ['author', (p) => p.author], ['level', (p) => p.level], ['class', (p) => p.classLabel], ['grade', (p) => p.grade],
    ['boards', (p) => p.boards], ['subject', (p) => p.subject], ['language', (p) => p.language], ['pages', (p) => p.pages], ['edition', (p) => p.edition],
    ['isbn', (p) => p.isbn], ['blurb', (p) => p.blurb],
    ['print_price', (p) => rs(v(p.id, 'print')?.price)], ['print_sku', (p) => v(p.id, 'print')?.sku], ['stock', (p) => v(p.id, 'print')?.stock], ['weight_g', (p) => v(p.id, 'print')?.weightGrams],
    ['ebook_price', (p) => rs(v(p.id, 'digital')?.price)], ['ebook_sku', (p) => v(p.id, 'digital')?.sku],
    ['bundle_price', (p) => rs(v(p.id, 'bundle')?.price)],
  ]);
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="products.csv"' });
});

/**
 * Spreadsheet import (same columns as the export). Rows are matched by slug
 * (or title); new rows are created as drafts unless `status` says otherwise.
 */
adminProducts.post('/import', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ csv: z.string().min(10).max(5_000_000), dryRun: z.boolean().default(false) }));
  const rows = parseCsv(input.csv);
  if (!rows.length) throw new HttpError(400, 'The file has no rows.');
  const cats = await db.select().from(categories);
  const rupees = (s?: string) => (s ? Math.round(parseFloat(s.replace(/[₹,\s]/g, '')) * 100) : NaN);
  const errors: { row: number; message: string }[] = [];
  let created = 0;
  let updated = 0;
  for (const [i, r] of rows.entries()) {
    const line = i + 2;
    try {
      if (!r.title) throw new Error('title is required');
      const level = (r.level || 'S').toUpperCase();
      if (!(LEVELS as readonly string[]).includes(level)) throw new Error(`level must be one of ${LEVELS.join(', ')}`);
      let catId: number | null = null;
      if (r.category) {
        catId = cats.find((x) => x.name.toLowerCase() === r.category.toLowerCase())?.id ?? null;
        if (!catId && !input.dryRun) {
          const [nc] = await db.insert(categories).values({ name: r.category, slug: slugify(r.category) }).onConflictDoNothing().returning();
          if (nc) { cats.push(nc); catId = nc.id; }
        }
      }
      const pp = rupees(r.print_price), ep = rupees(r.ebook_price), bp = rupees(r.bundle_price);
      const [existing] = await db.select().from(products).where(r.slug ? eq(products.slug, r.slug) : eq(products.title, r.title));
      const vars = existing ? await db.select().from(productVariants).where(eq(productVariants.productId, existing.id)) : [];
      const old = (k: Variant['kind']) => vars.find((v) => v.kind === k);
      const payload = zProduct.parse({
        title: r.title, slug: r.slug || undefined, status: (r.status || existing?.status || 'draft').toLowerCase(),
        series: r.series ?? '', author: r.author ?? '', blurb: r.blurb ?? existing?.blurb ?? '', description: existing?.description || r.blurb || '',
        categoryId: catId ?? existing?.categoryId ?? null, level, classLabel: r.class ?? '', grade: r.grade ? Number(r.grade) : null,
        boards: (r.boards ?? '').split(/[;|]/).map((b) => b.trim()).filter(Boolean), subject: r.subject ?? '', language: r.language || 'English',
        pages: r.pages ? Number(r.pages) : null, edition: r.edition ?? '', isbn: r.isbn ?? '',
        highlights: existing?.highlights ?? [], contents: existing?.contents ?? [], coverPath: existing?.coverPath ?? null, coverPalette: existing?.coverPalette ?? 0,
        print: { enabled: !Number.isNaN(pp), price: Number.isNaN(pp) ? old('print')?.price ?? 0 : pp, sku: r.print_sku || old('print')?.sku, stock: r.stock ? Number(r.stock) : old('print')?.stock ?? 0, weightGrams: r.weight_g ? Number(r.weight_g) : old('print')?.weightGrams ?? null, taxRate: old('print')?.taxRate ?? 0 },
        digital: { enabled: !Number.isNaN(ep), price: Number.isNaN(ep) ? old('digital')?.price ?? 0 : ep, sku: r.ebook_sku || old('digital')?.sku, taxRate: old('digital')?.taxRate ?? 18, filePath: old('digital')?.filePath, fileName: old('digital')?.fileName, fileSize: old('digital')?.fileSize },
        bundle: { enabled: !Number.isNaN(bp), price: Number.isNaN(bp) ? old('bundle')?.price ?? 0 : bp, sku: old('bundle')?.sku },
      });
      if (input.dryRun) { existing ? updated++ : created++; continue; }
      await db.transaction(async (tx) => {
        if (existing) {
          await tx.update(products).set({ ...productColumns(payload, await uniqueSlug(tx, payload.slug || existing.slug, existing.id)), updatedAt: sql`now()` }).where(eq(products.id, existing.id));
          await saveVariants(tx, existing.id, payload, c.get('admin').email);
          updated++;
        } else {
          const [p] = await tx.insert(products).values(productColumns(payload, await uniqueSlug(tx, payload.slug || payload.title))).returning();
          await saveVariants(tx, p.id, payload, c.get('admin').email);
          created++;
        }
      });
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : skuTaken(e) ? 'SKU already used by another product' : (e as Error).message;
      errors.push({ row: line, message: msg });
    }
  }
  if (!input.dryRun) await audit(c, 'product.import', 'product', null, { created, updated, errors: errors.length });
  return c.json({ created, updated, errors, dryRun: input.dryRun });
});

adminProducts.post('/bulk', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({ ids: z.array(z.uuid()).min(1).max(500), action: z.enum(['active', 'draft', 'archived']) }));
  if (input.action === 'active') {
    const missing = await db.select({ title: products.title }).from(products).innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(inArray(products.id, input.ids), eq(productVariants.kind, 'digital'), eq(productVariants.active, true), sql`${productVariants.filePath} is null`));
    if (missing.length) throw new HttpError(400, `Upload the e-book file first for: ${missing.map((m) => m.title).join(', ')}`);
  }
  await db.update(products).set({ status: input.action, updatedAt: sql`now()` }).where(inArray(products.id, input.ids));
  await audit(c, 'product.bulk', 'product', null, input);
  return c.json({ ok: true });
});

async function productDetail(c: Context<AppEnv>, id: string) {
  const { db, storage } = c.get('deps');
  const [p] = await db.select().from(products).where(eq(products.id, id));
  if (!p) throw notFound('Product not found');
  const vars = await db.select().from(productVariants).where(eq(productVariants.productId, id));
  const v = (k: Variant['kind']) => vars.find((x) => x.kind === k);
  const [{ sold }] = await db.select({ sold: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` }).from(orderItems).where(eq(orderItems.productId, id));
  const moves = v('print') ? await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, v('print')!.id)).orderBy(desc(inventoryMovements.createdAt)).limit(20) : [];
  return {
    product: { ...p, coverUrl: p.coverPath ? storage.publicUrl('covers', p.coverPath) : null },
    variants: { print: v('print') ?? null, digital: v('digital') ?? null, bundle: v('bundle') ?? null },
    sold, movements: moves,
  };
}

adminProducts.get('/:id{[0-9a-f-]{36}}', async (c) => c.json(await productDetail(c, c.req.param('id'))));

adminProducts.post('/', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zProduct);
  const id = await db.transaction(async (tx) => {
    const [p] = await tx.insert(products).values(productColumns(input, await uniqueSlug(tx, input.slug || input.title))).returning();
    await saveVariants(tx, p.id, input, c.get('admin').email);
    return p.id;
  }).catch((e) => { if (skuTaken(e)) throw new HttpError(409, 'That SKU is already used by another product.'); throw e; });
  await audit(c, 'product.create', 'product', id, { title: input.title });
  return c.json(await productDetail(c, id), 201);
});

adminProducts.put('/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const id = c.req.param('id');
  const input = await body(c, zProduct);
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(products).where(eq(products.id, id)).for('update');
    if (!cur) throw notFound('Product not found');
    await tx.update(products).set({ ...productColumns(input, await uniqueSlug(tx, input.slug || cur.slug, id)), updatedAt: sql`now()` }).where(eq(products.id, id));
    await saveVariants(tx, id, input, c.get('admin').email);
  }).catch((e) => { if (skuTaken(e)) throw new HttpError(409, 'That SKU is already used by another product.'); throw e; });
  await audit(c, 'product.update', 'product', id, { title: input.title, status: input.status });
  return c.json(await productDetail(c, id));
});

adminProducts.delete('/:id{[0-9a-f-]{36}}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const id = c.req.param('id');
  const [used] = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.productId, id)).limit(1);
  if (used) await db.update(products).set({ status: 'archived', updatedAt: sql`now()` }).where(eq(products.id, id));
  else await db.delete(products).where(eq(products.id, id));
  await audit(c, used ? 'product.archive' : 'product.delete', 'product', id);
  return c.json({ archived: Boolean(used), deleted: !used });
});

/* ---------------- Inventory ---------------- */

adminInventory.get('/', async (c) => {
  const { db } = c.get('deps');
  const f = query(c, z.object({ q: z.string().trim().max(100).optional(), low: z.enum(['1']).optional() }));
  const s = await getSettings(db);
  const like = f.q ? `%${f.q.replace(/[%_]/g, '\\$&')}%` : null;
  const rows = await db.select({
    variantId: productVariants.id, productId: products.id, title: products.title, classLabel: products.classLabel, status: products.status,
    sku: productVariants.sku, stock: productVariants.stock, trackStock: productVariants.trackStock, active: productVariants.active,
  }).from(productVariants).innerJoin(products, eq(products.id, productVariants.productId))
    .where(and(
      eq(productVariants.kind, 'print'), sql`${products.status} <> 'archived'`,
      like ? or(ilike(products.title, like), ilike(productVariants.sku, like)) : undefined,
      f.low ? and(eq(productVariants.trackStock, true), sql`${productVariants.stock} <= ${s.lowStockThreshold}`) : undefined,
    ))
    .orderBy(asc(productVariants.stock), asc(products.title)).limit(1000);
  return c.json({ items: rows, lowStockThreshold: s.lowStockThreshold });
});

adminInventory.post('/:variantId/adjust', async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, z.object({
    delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    set: z.number().int().min(0).max(1_000_000).optional(),
    reason: z.enum(['received', 'correction', 'damaged', 'returned', 'other']),
    note: zText(300).default(''),
  }).refine((v) => (v.delta === undefined) !== (v.set === undefined), 'Give either a change or a new count'));
  const row = await db.transaction(async (tx) => {
    const [v] = await tx.select().from(productVariants).where(and(eq(productVariants.id, c.req.param('variantId')), eq(productVariants.kind, 'print'))).for('update');
    if (!v) throw notFound('Stock item not found');
    const next = input.set ?? v.stock + input.delta!;
    if (next < 0) throw new HttpError(400, `Stock can’t go below zero (currently ${v.stock}).`);
    const [u] = await tx.update(productVariants).set({ stock: next, updatedAt: sql`now()` }).where(eq(productVariants.id, v.id)).returning();
    await tx.insert(inventoryMovements).values({ variantId: v.id, delta: next - v.stock, stockAfter: next, reason: input.reason, note: input.note, actor: c.get('admin').email });
    return u;
  });
  await audit(c, 'inventory.adjust', 'variant', row.id, input);
  return c.json({ stock: row.stock });
});

adminInventory.get('/:variantId/movements', async (c) => {
  const { db } = c.get('deps');
  const rows = await db.select().from(inventoryMovements).where(eq(inventoryMovements.variantId, c.req.param('variantId'))).orderBy(desc(inventoryMovements.createdAt)).limit(200);
  return c.json({ items: rows });
});

/* ---------------- Categories ---------------- */

const zCategory = z.object({ name: z.string().trim().min(2).max(80), description: zText(500).default(''), sort: z.number().int().default(0) });

adminCategories.get('/', async (c) => {
  const { db } = c.get('deps');
  const counts = db.select({ categoryId: products.categoryId, n: sql<number>`count(*)::int`.as('n') }).from(products).where(sql`${products.status} <> 'archived'`).groupBy(products.categoryId).as('pc');
  const rows = await db.select({ id: categories.id, name: categories.name, slug: categories.slug, description: categories.description, sort: categories.sort, products: sql<number>`coalesce(${counts.n}, 0)` })
    .from(categories).leftJoin(counts, eq(counts.categoryId, categories.id)).orderBy(asc(categories.sort), asc(categories.name));
  return c.json({ items: rows });
});

adminCategories.post('/', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zCategory);
  const [row] = await db.insert(categories).values({ ...input, slug: slugify(input.name) }).onConflictDoNothing().returning();
  if (!row) throw new HttpError(409, 'A category with that name already exists.');
  await audit(c, 'category.create', 'category', row.id, input);
  return c.json(row, 201);
});

adminCategories.put('/:id{\\d+}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  const input = await body(c, zCategory);
  const [row] = await db.update(categories).set({ ...input, slug: slugify(input.name) }).where(eq(categories.id, Number(c.req.param('id')))).returning();
  if (!row) throw notFound();
  await audit(c, 'category.update', 'category', row.id, input);
  return c.json(row);
});

adminCategories.delete('/:id{\\d+}', requireRole('manager'), async (c) => {
  const { db } = c.get('deps');
  await db.delete(categories).where(eq(categories.id, Number(c.req.param('id'))));
  await audit(c, 'category.delete', 'category', c.req.param('id'));
  return c.json({ ok: true });
});

/* ---------------- Direct-to-storage uploads ---------------- */

const UPLOAD_RULES: Record<Bucket, { types: string[]; maxMb: number }> = {
  covers: { types: ['image/jpeg', 'image/png', 'image/webp'], maxMb: 5 },
  ebooks: { types: ['application/pdf', 'application/epub+zip'], maxMb: 300 },
  resources: { types: ['application/pdf'], maxMb: 50 },
};

adminUploads.post('/', async (c) => {
  const { storage } = c.get('deps');
  const input = await body(c, z.object({
    bucket: z.enum(['covers', 'ebooks', 'resources']), fileName: z.string().trim().min(1).max(200), contentType: z.string().max(100), size: z.number().int().positive(),
  }));
  const rule = UPLOAD_RULES[input.bucket];
  if (!rule.types.includes(input.contentType)) throw new HttpError(400, `This file type isn’t allowed here (${rule.types.map((t) => t.split('/')[1]).join(', ')} only).`);
  if (input.size > rule.maxMb * 1024 * 1024) throw new HttpError(400, `Files here can be up to ${rule.maxMb} MB.`);
  const ext = input.fileName.includes('.') ? input.fileName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '') : 'bin';
  const base = slugify(input.fileName.replace(/\.[^.]+$/, '')) || 'file';
  const path = `${new Date().getFullYear()}/${randomUUID()}/${base}.${ext}`;
  const signed = await storage.signedUploadUrl(input.bucket, path);
  await audit(c, 'file.upload', input.bucket, path, { fileName: input.fileName, size: input.size });
  return c.json({ ...signed, bucket: input.bucket, publicUrl: input.bucket === 'ebooks' ? null : storage.publicUrl(input.bucket, path) });
});
