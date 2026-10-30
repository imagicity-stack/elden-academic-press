import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Q } from '../db/client';
import { categories, coupons, productVariants, products, settings } from '../db/schema';
import type { CouponRow, Kind, ProductRow } from '../lib/pricing';
import type { Storage } from '../lib/storage';

export type Settings = typeof settings.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Variant = typeof productVariants.$inferSelect;

export async function getSettings(db: Q): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(settings).where(eq(settings.id, 1)))[0];
}

/** What the storefront may know about one way of buying a product. */
export interface PublicFormat { price: number; compareAt: number | null; available: boolean; lowStock: number | null }

export interface CatalogItem {
  id: string;
  slug: string;
  title: string;
  series: string;
  author: string;
  blurb: string;
  description: string;
  category: { id: number; name: string; slug: string } | null;
  level: Product['level'];
  classLabel: string;
  grade: number | null;
  boards: string[];
  subject: string;
  language: string;
  pages: number | null;
  edition: string;
  isbn: string;
  highlights: string[];
  contents: string[];
  coverUrl: string | null;
  palette: number;
  companion: boolean;
  isNew: boolean;
  featured: boolean;
  formats: Partial<Record<Kind, PublicFormat>>;
}

export function publicFormats(variants: Variant[], lowStockThreshold: number): CatalogItem['formats'] {
  const v = (k: Kind) => variants.find((x) => x.kind === k && x.active);
  const print = v('print');
  const digital = v('digital');
  const bundle = v('bundle');
  const printAvailable = Boolean(print && (!print.trackStock || print.stock > 0));
  const low = print && print.trackStock && print.stock > 0 && print.stock <= lowStockThreshold ? print.stock : null;
  const out: CatalogItem['formats'] = {};
  if (print) out.print = { price: print.price, compareAt: print.compareAtPrice, available: printAvailable, lowStock: low };
  if (digital && digital.filePath) out.digital = { price: digital.price, compareAt: digital.compareAtPrice, available: true, lowStock: null };
  if (bundle && print && out.digital) out.bundle = { price: bundle.price, compareAt: bundle.compareAtPrice, available: printAvailable, lowStock: low };
  return out;
}

/** Every active product with its formats, for the storefront. */
export async function loadCatalog(db: Q, storage: Storage): Promise<{ items: CatalogItem[]; categories: { id: number; name: string; slug: string }[] }> {
  const s = await getSettings(db);
  const [rows, vars, cats] = await Promise.all([
    db.select().from(products).where(eq(products.status, 'active')).orderBy(asc(products.sort), desc(products.createdAt)),
    db.select().from(productVariants),
    db.select({ id: categories.id, name: categories.name, slug: categories.slug }).from(categories).orderBy(asc(categories.sort), asc(categories.name)),
  ]);
  const byProduct = new Map<string, Variant[]>();
  for (const v of vars) byProduct.set(v.productId, [...(byProduct.get(v.productId) ?? []), v]);
  const catById = new Map(cats.map((c) => [c.id, c]));
  const items = rows
    .map((p): CatalogItem => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      series: p.series,
      author: p.author,
      blurb: p.blurb,
      description: p.description,
      category: p.categoryId ? catById.get(p.categoryId) ?? null : null,
      level: p.level,
      classLabel: p.classLabel,
      grade: p.grade,
      boards: p.boards,
      subject: p.subject,
      language: p.language,
      pages: p.pages,
      edition: p.edition,
      isbn: p.isbn,
      highlights: p.highlights,
      contents: p.contents,
      coverUrl: p.coverPath ? storage.publicUrl('covers', p.coverPath) : null,
      palette: p.coverPalette,
      companion: p.hasCompanion,
      isNew: p.isNew,
      featured: p.featured,
      formats: publicFormats(byProduct.get(p.id) ?? [], s.lowStockThreshold),
    }))
    .filter((it) => Object.keys(it.formats).length > 0);
  return { items, categories: cats };
}

/** Product + variant rows in the shape the pricing engine needs. */
export async function loadPricingProducts(db: Q, ids: string[]): Promise<Map<string, ProductRow>> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!unique.length) return new Map();
  const [rows, vars] = await Promise.all([
    db.select({ id: products.id, slug: products.slug, title: products.title, status: products.status }).from(products).where(inArray(products.id, unique)),
    db.select().from(productVariants).where(inArray(productVariants.productId, unique)),
  ]);
  return new Map(rows.map((p) => [p.id, {
    ...p,
    variants: vars.filter((v) => v.productId === p.id).map((v) => ({
      kind: v.kind,
      price: v.price,
      compareAtPrice: v.compareAtPrice,
      sku: v.sku,
      stock: v.stock,
      trackStock: v.trackStock,
      weightGrams: v.weightGrams,
      taxRate: v.taxRate,
      active: v.active,
      hasFile: v.kind === 'print' ? undefined : Boolean(vars.find((x) => x.productId === p.id && x.kind === 'digital')?.filePath),
    })),
  }]));
}

export async function findCoupon(db: Q, code: string | null | undefined): Promise<CouponRow | null> {
  if (!code) return null;
  const [c] = await db.select().from(coupons).where(and(eq(coupons.code, code.trim().toUpperCase())));
  return c ?? null;
}
