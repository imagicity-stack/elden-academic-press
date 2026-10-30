// Printable GST invoice / packing slip (HTML; the browser's Print → Save as PDF makes the file).
import type { orderItems, orders } from '../db/schema.js';
import { esc, inr, istDate } from '../lib/format.js';
import { stateName } from '../lib/states.js';
import type { Settings } from './catalog.js';

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;

// HSN for printed books, SAC for e-books. Confirm these with your accountant.
const HSN: Record<Item['variantKind'], string> = { print: '4901', digital: '998431', bundle: '4901 / 998431' };

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;background:#EEE9E0;font:13px/1.5 Arial,Helvetica,sans-serif;color:#171A1F}
.sheet{max-width:820px;margin:24px auto;background:#fff;padding:36px 40px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{margin:0;font:600 24px Georgia,serif;color:#0E1F33}.muted{color:#6E695F}
.top{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;border-bottom:2px solid #0E1F33;padding-bottom:16px;margin-bottom:18px}
.cols{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:18px}.cols>div{flex:1 1 220px}
.label{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#87561F;margin-bottom:4px;font-weight:bold}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#6E695F;border-bottom:1px solid #CFC5B4;padding:6px 6px}
td{padding:8px 6px;border-bottom:1px solid #EDE7DC;vertical-align:top}.r{text-align:right}
.totals{margin-left:auto;max-width:320px;margin-top:12px}.totals td{border:0;padding:3px 6px}.grand td{font-weight:bold;font-size:15px;border-top:2px solid #0E1F33;padding-top:8px}
.foot{margin-top:28px;font-size:11px;color:#6E695F}.print{margin:0 auto 24px;display:block;padding:10px 18px;border:0;background:#0E1F33;color:#fff;font-weight:bold;cursor:pointer}
@media print{body{background:#fff}.sheet{box-shadow:none;margin:0;max-width:none;padding:0}.print{display:none}}
</style></head><body><div class="sheet">${body}</div><button class="print" onclick="window.print()">Print / Save as PDF</button></body></html>`;

function header(o: Order, s: Settings, title: string) {
  return `<div class="top"><div><h1>${esc(title)}</h1><div class="muted">${esc(s.legalName)}<br>${esc(s.address)}${s.gstin ? `<br>GSTIN ${esc(s.gstin)}` : ''}</div></div>
<div class="r">${o.invoiceNumber ? `<div><strong>Invoice</strong> ${esc(o.invoiceNumber)}</div><div><strong>Date</strong> ${istDate(o.invoiceDate)}</div>` : ''}
<div><strong>Order</strong> #${o.number}</div><div><strong>Place of supply</strong> ${esc(stateName(o.billingState))} (${esc(o.billingState)})</div></div></div>`;
}

function parties(o: Order) {
  const ship = o.requiresShipping
    ? `<div><div class="label">Ship to</div>${esc(o.shipName)}<br>${esc(o.shipLine1)}${o.shipLine2 ? `<br>${esc(o.shipLine2)}` : ''}<br>${esc(o.shipCity)}, ${esc(stateName(o.shipState))} – ${esc(o.shipPincode)}</div>`
    : '';
  return `<div class="cols"><div><div class="label">Bill to</div>${esc(o.name)}<br>${esc(o.email)}<br>${esc(o.phone)}</div>${ship}</div>`;
}

export function renderInvoice(o: Order, items: Item[], s: Settings) {
  const registered = Boolean(s.gstin);
  const intra = o.billingState === s.stateCode;
  const rows = items.map((i) => `<tr><td>${esc(i.title)}<div class="muted">${esc(i.formatLabel)}${i.sku ? ` · ${esc(i.sku)}` : ''}</div></td>
<td>${HSN[i.variantKind]}</td><td class="r">${i.quantity}</td><td class="r">${inr(i.unitPrice)}</td><td class="r">${i.discount ? '−' + inr(i.discount) : '—'}</td>
${registered ? `<td class="r">${inr(i.taxableValue)}</td><td class="r">${i.taxAmount ? `${inr(i.taxAmount)}<div class="muted">${i.variantKind === 'bundle' ? 'e-book part ' : ''}${i.taxRate}%</div>` : 'Exempt'}</td>` : ''}
<td class="r">${inr(i.lineTotal - i.discount)}</td></tr>`).join('');
  const half = Math.floor(o.tax / 2);
  const gst = registered && o.tax
    ? intra ? `<tr><td>CGST</td><td class="r">${inr(half)}</td></tr><tr><td>SGST</td><td class="r">${inr(o.tax - half)}</td></tr>` : `<tr><td>IGST</td><td class="r">${inr(o.tax)}</td></tr>`
    : '';
  const title = registered ? (items.every((i) => i.variantKind === 'print') ? 'Bill of Supply' : 'Tax Invoice') : 'Invoice';
  const body = header(o, s, title) + parties(o) +
    `<table><thead><tr><th>Item</th><th>HSN/SAC</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Discount</th>${registered ? '<th class="r">Taxable</th><th class="r">GST</th>' : ''}<th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="r">${inr(o.subtotal)}</td></tr>${o.discount ? `<tr><td>Discount${o.couponCode ? ` (${esc(o.couponCode)})` : ''}</td><td class="r">−${inr(o.discount)}</td></tr>` : ''}
${o.requiresShipping ? `<tr><td>Shipping</td><td class="r">${o.shipping ? inr(o.shipping) : 'Free'}</td></tr>` : ''}
<tr class="grand"><td>Total</td><td class="r">${inr(o.total)}</td></tr>${gst ? `<tr><td colspan="2" class="muted">GST included in total</td></tr>${gst}` : ''}
${o.refundedAmount ? `<tr><td>Refunded</td><td class="r">−${inr(o.refundedAmount)}</td></tr>` : ''}</table>
<div class="foot">Paid online${o.paymentMethod ? ` (${esc(o.paymentMethod)})` : ''}${o.razorpayPaymentId && !o.razorpayPaymentId.startsWith('free_') ? ` · Ref ${esc(o.razorpayPaymentId)}` : ''}. This is a computer-generated document and needs no signature.</div>`;
  return page(`${title} ${o.invoiceNumber ?? '#' + o.number}`, body);
}

export function renderPackingSlip(o: Order, items: Item[], s: Settings) {
  const physical = items.filter((i) => i.requiresShipping);
  const body = header(o, s, 'Packing slip') + parties(o) +
    `<table><thead><tr><th>Item</th><th>SKU</th><th class="r">Qty</th><th class="r">Packed</th></tr></thead><tbody>${physical
      .map((i) => `<tr><td>${esc(i.title)}<div class="muted">${i.variantKind === 'print' ? 'Printed copy' : 'Printed copy (bundle with e-book)'}</div></td><td>${esc(i.sku ?? '')}</td><td class="r">${i.quantity}</td><td class="r">☐</td></tr>`).join('')}</tbody></table>
${o.customerNote ? `<p><strong>Customer note:</strong> ${esc(o.customerNote)}</p>` : ''}<div class="foot">Thank you for ordering from ${esc(s.storeName)}.</div>`;
  return page(`Packing slip #${o.number}`, body);
}
