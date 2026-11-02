// E-book files: a book can have several (Part 1, Part 2, Answer key…). Downloads are
// limited per e-book; the limit grows with the number of files (Settings × files).
import { and, eq, inArray } from 'drizzle-orm';
import type { Q } from '../db/client.js';
import { productVariants, type EbookFile } from '../db/schema.js';
import type { Settings } from './catalog.js';

type Variant = typeof productVariants.$inferSelect;

/** The e-book's files in order (older rows have only the single file columns). */
export function ebookFiles(v: Pick<Variant, 'files' | 'filePath' | 'fileName' | 'fileSize'> | undefined | null): EbookFile[] {
  if (!v) return [];
  if (v.files?.length) return v.files;
  return v.filePath ? [{ path: v.filePath, name: v.fileName ?? '', title: '', size: v.fileSize ?? null }] : [];
}

type ItemRef = { id: string; productId: string | null; isDigital: boolean; includesEbook?: boolean };

/** E-books come with e-book purchases, and with printed copies of books that include it free. */
export const comesWithEbook = (i: ItemRef) => i.isDigital || Boolean(i.includesEbook);

/** The e-book files each order item gives access to, by order item id (empty when none). */
export async function filesForItems(db: Q, items: ItemRef[]) {
  const ids = [...new Set(items.filter((i) => comesWithEbook(i) && i.productId).map((i) => i.productId!))];
  const vars = ids.length ? await db.select().from(productVariants).where(and(inArray(productVariants.productId, ids), eq(productVariants.kind, 'digital'))) : [];
  return new Map(items.map((i) => [i.id, comesWithEbook(i) ? ebookFiles(vars.find((v) => v.productId === i.productId)) : []]));
}

/** Cash-on-delivery orders: the free e-book unlocks once the books are delivered. */
export const ebookAwaitsDelivery = (o: { paymentMode: string; deliveredAt: Date | null }) => o.paymentMode === 'cod' && !o.deliveredAt;

/** Downloads allowed for one purchased e-book: the setting, once per file. */
export const downloadLimit = (s: Pick<Settings, 'maxDownloads'>, files: number) => s.maxDownloads * Math.max(1, files);

/** What buyers see for each file: its label, or "Part 2" when a book has several unnamed files. */
export const fileLabel = (f: EbookFile, i: number, count: number) => f.title || (count > 1 ? `Part ${i + 1}` : 'E-book');

/** The file name the download is saved as. */
export function downloadName(f: EbookFile, i: number, count: number, bookTitle: string) {
  if (f.name) return f.name;
  const ext = f.path.split('.').pop()?.toLowerCase() === 'epub' ? 'epub' : 'pdf';
  return `${bookTitle}${count > 1 ? ` - ${fileLabel(f, i, count)}` : ''}.${ext}`;
}
