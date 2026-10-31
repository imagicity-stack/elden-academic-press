// The GST invoice as a designed A4 PDF (attached to the confirmation email and
// downloadable from the order page). Fonts: Geist (SIL OFL), in server/assets.
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { orderItems, orders } from '../db/schema.js';
import { inr, istDate } from '../lib/format.js';
import { stateName } from '../lib/states.js';
import type { Settings } from './catalog.js';

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;

// HSN for printed books, SAC for e-books. Confirm these with your accountant.
export const HSN: Record<Item['variantKind'], string> = { print: '4901', digital: '998431', bundle: '4901 / 998431' };

const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex('#0B1220'), muted: hex('#576072'), faint: hex('#8B919D'), line: hex('#E4E0D8'), paper: hex('#F4F2ED'),
  accent: hex('#FF5A1F'), yellow: hex('#FFD84D'), white: rgb(1, 1, 1), ok: hex('#0F7A4F'),
};
const W = 595.28;
const H = 841.89;
const M = 44;

const asset = (name: string) => readFile(new URL(`../assets/${name}`, import.meta.url));
let assets: Promise<{ regular: Uint8Array; semibold: Uint8Array; bold: Uint8Array; mark: Uint8Array }> | undefined;
const loadAssets = () => (assets ??= Promise.all([
  asset('fonts/Geist-Regular.ttf'), asset('fonts/Geist-SemiBold.ttf'), asset('fonts/Geist-Bold.ttf'), asset('elden-mark-light.png'),
]).then(([regular, semibold, bold, mark]) => ({ regular, semibold, bold, mark })).catch((e) => { assets = undefined; throw e; }));

export const invoiceTitle = (s: Settings, items: Item[]) =>
  s.gstin ? (items.every((i) => i.variantKind === 'print') ? 'Bill of Supply' : 'Tax Invoice') : 'Invoice';

const PAY_METHOD: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', wallet: 'Wallet', emi: 'EMI', paylater: 'Pay later', free: 'No payment due' };
const payMethod = (o: Order) => (o.paymentMethod ? PAY_METHOD[o.paymentMethod] ?? o.paymentMethod : o.total ? 'Online' : 'No payment due');

export const invoiceFileName = (o: Order) => `Elden-invoice-${(o.invoiceNumber ?? `order-${o.number}`).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`;

/** Billing / delivery address lines stored on the order. */
export function addressLines(o: Order): string[] {
  if (!o.shipLine1) return [];
  return [o.shipLine1, o.shipLine2, `${o.shipCity}, ${stateName(o.shipState ?? '')} ${o.shipPincode ?? ''}`.trim()].filter((l): l is string => Boolean(l));
}

interface Fonts { regular: PDFFont; semibold: PDFFont; bold: PDFFont }

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, readonly f: Fonts, private mark: PDFImage, private onNewPage: (w: Writer) => void) {}

  newPage() {
    this.page = this.doc.addPage([W, H]);
    this.pages.push(this.page);
    this.y = H - M;
    this.onNewPage(this);
  }

  text(s: string, x: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB; align?: 'left' | 'right'; track?: number } = {}) {
    const font = opts.font ?? this.f.regular;
    const size = opts.size ?? 9.5;
    const track = opts.track ?? 0;
    const width = this.width(s, font, size, track);
    let cx = opts.align === 'right' ? x - width : x;
    if (!track) { this.page.drawText(s, { x: cx, y, font, size, color: opts.color ?? C.ink }); return width; }
    for (const ch of s) {
      this.page.drawText(ch, { x: cx, y, font, size, color: opts.color ?? C.ink });
      cx += font.widthOfTextAtSize(ch, size) + track;
    }
    return width;
  }

  width(s: string, font: PDFFont, size: number, track = 0) {
    return font.widthOfTextAtSize(s, size) + (track ? track * Math.max(0, [...s].length - 1) : 0);
  }

  wrap(s: string, font: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    for (const para of s.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= max) line = next;
        else { if (line) out.push(line); line = word; }
      }
      out.push(line);
    }
    return out;
  }

  label(s: string, x: number, y: number, color = C.faint) {
    this.text(s.toUpperCase(), x, y, { font: this.f.semibold, size: 6.8, color, track: 0.9 });
  }

  rule(y: number, color = C.line, thickness = 0.7, x1 = M, x2 = W - M) {
    this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
  }

  box(x: number, y: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y, width: w, height: h, color });
  }

  logo(x: number, y: number, h: number) {
    const s = this.mark.scaleToFit(h * 3, h);
    this.page.drawImage(this.mark, { x, y, width: s.width, height: s.height });
    return s.width;
  }
}

export async function renderInvoicePdf(o: Order, items: Item[], s: Settings): Promise<Uint8Array> {
  const a = await loadAssets();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const title = invoiceTitle(s, items);
  doc.setTitle(`${title} ${o.invoiceNumber ?? `#${o.number}`}`);
  doc.setAuthor(s.legalName);
  doc.setCreator(s.storeName);
  doc.setProducer(s.storeName);
  const f: Fonts = {
    regular: await doc.embedFont(a.regular, { subset: true }),
    semibold: await doc.embedFont(a.semibold, { subset: true }),
    bold: await doc.embedFont(a.bold, { subset: true }),
  };
  const mark = await doc.embedPng(a.mark);
  const registered = Boolean(s.gstin);

  // Columns: [label, width, align]
  const cols: [string, number, 'left' | 'right'][] = registered
    ? [['Item', 0, 'left'], ['HSN/SAC', 58, 'left'], ['Qty', 28, 'right'], ['Rate', 56, 'right'], ['Discount', 54, 'right'], ['Taxable', 60, 'right'], ['GST', 54, 'right'], ['Amount', 62, 'right']]
    : [['Item', 0, 'left'], ['HSN/SAC', 66, 'left'], ['Qty', 34, 'right'], ['Rate', 70, 'right'], ['Discount', 66, 'right'], ['Amount', 76, 'right']];
  cols[0][1] = W - 2 * M - cols.slice(1).reduce((t, c) => t + c[1], 0);
  const colX: number[] = [];
  cols.reduce((x, c, i) => { colX[i] = c[2] === 'right' ? x + c[1] : x; return x + c[1]; }, M);

  const tableHead = (w: Writer) => {
    cols.forEach(([l, , align], i) => w.text(l.toUpperCase(), colX[i], w.y, { font: w.f.semibold, size: 6.8, color: C.muted, track: 0.9, align }));
    w.rule(w.y - 7, C.ink, 1);
    w.y -= 22;
  };

  const w = new Writer(doc, f, mark, (wr) => {
    if (wr.pages.length === 1) return;
    // Continuation pages: a slim header and the table head again.
    wr.box(0, H - 40, W, 40, C.ink);
    wr.logo(M, H - 31, 22);
    wr.text(`${title} ${o.invoiceNumber ?? `#${o.number}`} (continued)`, W - M, H - 24, { font: f.semibold, size: 9, color: C.white, align: 'right' });
    wr.y = H - 70;
    tableHead(wr);
  });
  w.newPage();
  const pg = () => w.page;

  /* ---------- Header band ---------- */
  w.box(0, H - 132, W, 132, C.ink);
  w.box(0, H - 136, W, 4, C.accent);
  const markW = w.logo(M, H - 92, 46);
  w.text('ELDEN', M + markW + 12, H - 66, { font: f.bold, size: 20, color: C.white, track: 3.4 });
  w.text('ACADEMIC PRESS', M + markW + 13, H - 82, { font: f.semibold, size: 6.6, color: hex('#A9B0BC'), track: 2.2 });
  w.text(title.toUpperCase(), W - M, H - 54, { font: f.semibold, size: 7.5, color: C.yellow, track: 1.6, align: 'right' });
  w.text(o.invoiceNumber ?? `Order #${o.number}`, W - M, H - 80, { font: f.bold, size: 22, color: C.white, align: 'right' });
  w.text(istDate(o.invoiceDate ?? o.paidAt ?? o.createdAt), W - M, H - 98, { font: f.regular, size: 9, color: hex('#C9CED6'), align: 'right' });

  /* ---------- Parties ---------- */
  let y = H - 172;
  const colW = (W - 2 * M - 32) / 3;
  const party = (x: number, label: string, lines: { t: string; bold?: boolean }[]) => {
    w.label(label, x, y);
    let ly = y - 16;
    for (const l of lines) {
      for (const part of w.wrap(l.t, l.bold ? f.semibold : f.regular, 9.5, colW)) {
        w.text(part, x, ly, { font: l.bold ? f.semibold : f.regular, size: 9.5, color: l.bold ? C.ink : C.muted });
        ly -= 13.5;
      }
    }
    return ly;
  };
  const sold = [{ t: s.legalName, bold: true }, ...s.address.split('\n').map((t) => ({ t })), ...(s.gstin ? [{ t: `GSTIN ${s.gstin}` }] : []), { t: s.supportEmail }];
  const addr = addressLines(o);
  const bill = [{ t: o.name, bold: true }, ...(o.requiresShipping ? [] : addr.map((t) => ({ t }))), { t: o.email }, { t: o.phone }];
  const ys = [party(M, 'Sold by', sold), party(M + colW + 16, 'Billed to', bill)];
  if (o.requiresShipping) ys.push(party(M + 2 * (colW + 16), 'Ship to', [{ t: o.shipName ?? o.name, bold: true }, ...addr.map((t) => ({ t }))]));
  y = Math.min(...ys) - 10;

  /* ---------- Meta strip ---------- */
  const meta: [string, string][] = [
    ['Order', `#${o.number}`],
    ['Order date', istDate(o.createdAt)],
    ['Place of supply', `${stateName(o.billingState)} (${o.billingState})`],
    ['Payment', payMethod(o)],
  ];
  w.box(M, y - 44, W - 2 * M, 44, C.paper);
  const cellW = (W - 2 * M) / meta.length;
  meta.forEach(([k, v], i) => {
    const x = M + 14 + i * cellW;
    w.label(k, x, y - 16);
    const t = w.wrap(v, f.semibold, 9, cellW - 20)[0] ?? '';
    w.text(t, x, y - 31, { font: f.semibold, size: 9 });
  });
  w.y = y - 74;

  /* ---------- Items ---------- */
  tableHead(w);
  const bottomLimit = 150;
  for (const i of items) {
    const titleLines = w.wrap(i.title, f.semibold, 9.5, cols[0][1] - 10);
    const sub = `${i.formatLabel}${i.sku ? ` · ${i.sku}` : ''}${registered && i.variantKind === 'bundle' && i.taxAmount ? ' · GST on e-book part' : ''}`;
    const rowH = titleLines.length * 13 + 14;
    if (w.y - rowH < bottomLimit) w.newPage();
    titleLines.forEach((t, k) => w.text(t, colX[0], w.y - k * 13, { font: f.semibold, size: 9.5 }));
    w.text(sub, colX[0], w.y - titleLines.length * 13, { size: 7.8, color: C.faint });
    const cells = registered
      ? [HSN[i.variantKind], String(i.quantity), inr(i.unitPrice), i.discount ? `−${inr(i.discount)}` : '—', inr(i.taxableValue), i.taxAmount ? `${inr(i.taxAmount)}` : 'Exempt', inr(i.lineTotal - i.discount)]
      : [HSN[i.variantKind], String(i.quantity), inr(i.unitPrice), i.discount ? `−${inr(i.discount)}` : '—', inr(i.lineTotal - i.discount)];
    cells.forEach((v, k) => {
      const [, , align] = cols[k + 1];
      w.text(v, colX[k + 1], w.y, { size: k === cells.length - 1 ? 9.5 : 9, font: k === cells.length - 1 ? f.semibold : f.regular, align, color: k === cells.length - 1 ? C.ink : C.muted });
    });
    if (registered && i.taxAmount) w.text(`${i.taxRate}%`, colX[cols.length - 2], w.y - 12, { size: 7.5, color: C.faint, align: 'right' });
    w.y -= rowH;
    w.rule(w.y + 6);
    w.y -= 8;
  }

  /* ---------- Totals ---------- */
  const rows: [string, string][] = [['Subtotal', inr(o.subtotal)]];
  if (o.discount) rows.push([`Discount${o.couponCode ? ` (${o.couponCode})` : ''}`, `−${inr(o.discount)}`]);
  if (o.requiresShipping) rows.push(['Shipping', o.shipping ? inr(o.shipping) : 'Free']);
  const half = Math.floor(o.tax / 2);
  const gst: [string, string][] = registered && o.tax
    ? (o.billingState === s.stateCode ? [['CGST', inr(half)], ['SGST', inr(o.tax - half)]] : [['IGST', inr(o.tax)]])
    : [];
  const needed = rows.length * 18 + 44 + (gst.length ? 18 : 0) + (o.refundedAmount ? 18 : 0) + 20;
  if (w.y - needed < 110) w.newPage();
  const tx = W - M - 230;
  let ty = w.y - 4;
  for (const [k, v] of rows) {
    w.text(k, tx, ty, { size: 9.5, color: C.muted });
    w.text(v, W - M, ty, { size: 9.5, align: 'right' });
    ty -= 18;
  }
  w.box(tx - 12, ty - 22, 230 + 12, 34, C.ink);
  w.text('Total', tx, ty - 9, { font: f.semibold, size: 10.5, color: C.white });
  w.text(inr(o.total), W - M - 12, ty - 10, { font: f.bold, size: 15, color: C.white, align: 'right' });
  ty -= 40;
  if (gst.length) {
    w.text(`Includes GST · ${gst.map(([k, v]) => `${k} ${v}`).join(' · ')}`, W - M, ty, { size: 8, color: C.muted, align: 'right' });
    ty -= 16;
  }
  if (o.refundedAmount) {
    w.text(`Refunded −${inr(o.refundedAmount)}`, W - M, ty, { font: f.semibold, size: 9, color: C.accent, align: 'right' });
    ty -= 16;
  }

  // "Paid" stamp beside the totals.
  if (o.paidAt) {
    const sy = w.y - 20;
    const ref = o.razorpayPaymentId && !o.razorpayPaymentId.startsWith('free_') ? o.razorpayPaymentId : '';
    pg().drawRectangle({ x: M, y: sy - (ref ? 46 : 34), width: 170, height: ref ? 56 : 44, borderColor: C.ok, borderWidth: 1.4 });
    w.text('PAID', M + 12, sy - 8, { font: f.bold, size: 13, color: C.ok, track: 2 });
    w.text(`${istDate(o.paidAt)} · ${payMethod(o)}`, M + 12, sy - 24, { size: 8, color: C.ok });
    if (ref) w.text(`Ref ${ref}`, M + 12, sy - 36, { size: 7.5, color: C.ok });
  }

  /* ---------- Footers ---------- */
  const total = w.pages.length;
  w.pages.forEach((p, idx) => {
    w.page = p;
    if (idx === total - 1) {
      w.text('Thank you for reading with Elden.', M, 86, { font: f.semibold, size: 11 });
      w.text('This is a computer-generated document and needs no signature.', M, 71, { size: 8, color: C.muted });
    }
    w.rule(54, C.line, 0.7);
    const company = `${s.legalName} · ${s.address.replace(/\n/g, ', ')}`;
    w.text(w.wrap(company, f.regular, 7.2, W - 2 * M - 70)[0], M, 40, { size: 7.2, color: C.faint });
    w.text(`Page ${idx + 1} of ${total}`, W - M, 40, { size: 7.2, color: C.faint, align: 'right' });
    w.box(0, 0, W, 5, C.accent);
  });

  return doc.save();
}
