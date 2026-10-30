// Starter data: categories always; demo products, coupons and Study Hub files
// (from the design's sample catalogue) only when asked for.
import { BOOKS, RES, TYPES, contentsFor, highlightsFor, specsFor } from '../../src/data.js';
import type { Q } from './client.js';
import { categories, coupons, productVariants, products, resources } from './schema.js';

const CATEGORY_NAMES: Record<string, string> = {
  Textbook: 'Textbooks', Reference: 'Reference books', 'Study Guide': 'Study guides',
  'Practice Papers': 'Practice papers', Workbook: 'Workbooks', Journal: 'Journals',
};
export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80);

/** Sample e-book file path used for demo products. */
export const samplePdfPath = (slug: string) => `samples/${slug}.pdf`;

export const STANDARD_CATEGORIES = TYPES.map((t, i) => ({ name: CATEGORY_NAMES[t], slug: slugify(CATEGORY_NAMES[t]), sort: i }));

export async function seedCategories(db: Q) {
  await db.insert(categories).values(STANDARD_CATEGORIES).onConflictDoNothing();
  return db.select().from(categories);
}

export async function seedDemo(db: Q) {
  const cats = await seedCategories(db);
  const catId = (ty: string) => cats.find((c) => c.name === CATEGORY_NAMES[ty])?.id ?? null;
  const STOCK = [120, 85, 60, 200, 45, 150, 3, 90, 70, 110, 140, 0, 55, 95, 40, 30, 25, 20];
  // Journals are sold as single issues.
  const JOURNAL_PRICES: Record<string, [number, number]> = { jer: [450, 299], jasp: [380, 249] };

  for (const [i, b] of BOOKS.entries()) {
    const [pr, eb] = JOURNAL_PRICES[b.id] ?? [b.pr, b.eb];
    const specs = Object.fromEntries(specsFor(b));
    const grade = /^Class (\d+)/.exec(b.cl)?.[1];
    const [p] = await db.insert(products).values({
      slug: slugify(b.t),
      title: b.t,
      series: b.s,
      author: b.a,
      blurb: b.bl,
      description: b.bl,
      categoryId: catId(b.ty),
      level: b.lv,
      classLabel: b.cl,
      grade: grade ? Number(grade) : null,
      boards: b.bd ? [b.bd] : [],
      subject: b.su,
      language: specs.Language ?? 'English',
      pages: b.pg,
      edition: '2027–28',
      isbn: specs.ISBN ?? '',
      highlights: highlightsFor(b),
      contents: contentsFor(b),
      coverPalette: b.p,
      hasCompanion: b.em,
      isNew: b.nw,
      featured: i < 5,
      sort: i,
      status: 'active',
    }).onConflictDoNothing().returning();
    if (!p) continue;

    const sku = b.id.toUpperCase();
    const variants: (typeof productVariants.$inferInsert)[] = [
      { productId: p.id, kind: 'print', price: pr * 100, sku: `${sku}-P`, stock: STOCK[i % STOCK.length], weightGrams: Math.round(b.pg * 2.4 + 60), taxRate: 0 },
    ];
    if (eb) {
      variants.push(
        { productId: p.id, kind: 'digital', price: eb * 100, sku: `${sku}-E`, taxRate: 18, filePath: samplePdfPath(p.slug), fileName: `${p.slug}.pdf`, fileSize: 1024 },
        { productId: p.id, kind: 'bundle', price: (Math.round((pr + eb * 0.5) / 10) * 10 - 1) * 100, sku: `${sku}-B`, taxRate: 0 },
      );
    }
    await db.insert(productVariants).values(variants);
  }

  await db.insert(coupons).values([
    { code: 'WELCOME10', description: '10% off your first order (up to ₹200)', type: 'percent', value: 10, maxDiscount: 20000 },
    { code: 'SCHOOL500', description: '₹500 off orders above ₹5,000', type: 'fixed', value: 50000, minSubtotal: 500000 },
  ]).onConflictDoNothing();

  await db.insert(resources).values(RES.map((r, i) => ({
    title: r.t, kind: r.k, level: r.lv, subject: r.su, published: true, sort: i,
    filePath: `samples/${slugify(r.t)}.pdf`, fileSize: Math.round(parseFloat(r.size) * 1024 * 1024),
  })));
}

/** A tiny valid one-page PDF used as the demo e-book file. */
export function samplePdf(title: string): Uint8Array {
  const safe = title.replace(/[()\\]/g, '');
  const content = `BT /F1 20 Tf 72 720 Td (${safe}) Tj 0 -32 Td /F1 12 Tf (Elden Academic Press - sample e-book) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
