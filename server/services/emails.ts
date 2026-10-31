// Transactional emails. Table-based HTML with inline styles so they render the
// same in Gmail, Outlook and Apple Mail; a plain-text part is added on send.
import { and, eq, inArray } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { productVariants, type enquiries, type orderItems, type orders } from '../db/schema.js';
import { esc, inr, istDate } from '../lib/format.js';
import { addressList, sendSafely, type Attachment } from '../lib/mail.js';
import type { Settings } from './catalog.js';
import { addressLines, invoiceFileName, renderInvoicePdf } from './invoicePdf.js';
import { orderLink, orderToken } from './orders.js';

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;
type Enquiry = typeof enquiries.$inferSelect;

const INK = '#0B1220';
const ACCENT = '#FF5A1F';
const YELLOW = '#FFD84D';
const PAPER = '#F4F2ED';
const MUTED = '#576072';
const LINE = '#E4E0D8';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;

/** E-books are attached to the confirmation while their total size stays under this. */
const ATTACH_LIMIT = 15 * 1024 * 1024;

const td = (style: string, html: string) => `<tr><td style="${style}">${html}</td></tr>`;
const section = (html: string, pad = '0 32px 28px') => td(`background:#FFFFFF;padding:${pad}`, html);
const p = (html: string, style = '') => `<p style="margin:0 0 14px;font:400 15px/1.6 ${FONT};color:${MUTED};${style}">${html}</p>`;
const h2 = (text: string) => `<h2 style="margin:0 0 14px;font:700 18px/1.2 ${FONT};color:${INK};letter-spacing:-0.2px">${text}</h2>`;
const label = (text: string, color = MUTED) => `<div style="font:600 11px/1.2 ${FONT};letter-spacing:1.2px;text-transform:uppercase;color:${color}">${text}</div>`;

const button = (href: string, text: string, bg = ACCENT, fg = '#FFFFFF') =>
  `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${bg}"><a href="${esc(href)}" style="display:inline-block;padding:15px 26px;font:700 15px/1 ${FONT};color:${fg};text-decoration:none">${esc(text)} &rarr;</a></td></tr></table>`;

function layout(deps: Deps, s: Settings, o: { preheader: string; kicker: string; title: string; intro: string; body: string; footerNote?: string }) {
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:${PAPER};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAPER}">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
${td(`background:${INK};padding:22px 32px`, `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:12px;vertical-align:middle"><img src="${site}/assets/elden-mark-light.png" width="30" alt="" style="display:block;height:auto;border:0"></td>
<td style="vertical-align:middle"><div style="font:800 19px/1 ${FONT};letter-spacing:5px;color:#FFFFFF">ELDEN</div><div style="font:600 8.5px/1 ${FONT};letter-spacing:3px;color:#A9B0BC;margin-top:6px">ACADEMIC PRESS</div></td>
</tr></table>`)}
${td(`background:${ACCENT};height:4px;font-size:0;line-height:0`, '&nbsp;')}
${section(`<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${YELLOW};padding:6px 10px">${label(esc(o.kicker), INK)}</td></tr></table>
<h1 style="margin:20px 0 12px;font:800 32px/1.08 ${FONT};letter-spacing:-1px;color:${INK}">${esc(o.title)}</h1>
${p(o.intro, 'font-size:16px')}`, '36px 32px 18px')}
${o.body}
${td(`padding:26px 32px 8px;font:400 12.5px/1.7 ${FONT};color:#8B919D`, `${o.footerNote ? `${o.footerNote}<br>` : ''}Questions? Just reply to this email or write to <a href="mailto:${esc(s.supportEmail)}" style="color:${INK}">${esc(s.supportEmail)}</a>.<br><br>
<strong style="color:${MUTED}">${esc(s.storeName)}</strong> · ${esc(s.legalName)}<br>${esc(s.address).replace(/\n/g, ', ')}<br>
<a href="${site}/terms" style="color:#8B919D">Terms</a> &nbsp;·&nbsp; <a href="${site}/privacy" style="color:#8B919D">Privacy</a> &nbsp;·&nbsp; <a href="${site}/refunds" style="color:#8B919D">Refunds</a> &nbsp;·&nbsp; <a href="${site}" style="color:#8B919D">eldenap.in</a>`)}
</table></td></tr></table></body></html>`;
}

function itemsTable(o: Order, items: Item[]) {
  const row = (l: string, r: string, strong = false) =>
    `<tr><td style="padding:5px 0;font:${strong ? 700 : 400} ${strong ? 17 : 14}px/1.4 ${FONT};color:${strong ? INK : MUTED}">${l}</td><td align="right" style="padding:5px 0;font:${strong ? 800 : 500} ${strong ? 17 : 14}px/1.4 ${FONT};color:${INK}">${r}</td></tr>`;
  const lines = items.map((i) => `<tr>
<td style="padding:14px 0;border-bottom:1px solid ${LINE};font:600 15px/1.35 ${FONT};color:${INK}">${esc(i.title)}<div style="margin-top:3px;font:400 13px/1.4 ${FONT};color:${MUTED}">${esc(i.formatLabel)}${i.quantity > 1 ? ` × ${i.quantity}` : ''}</div></td>
<td align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ${LINE};font:600 15px/1.35 ${FONT};color:${INK};white-space:nowrap;vertical-align:top">${inr(i.lineTotal)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lines}
<tr><td colspan="2" style="height:10px;font-size:0">&nbsp;</td></tr>
${row('Subtotal', inr(o.subtotal))}${o.discount ? row(`Discount${o.couponCode ? ` (${esc(o.couponCode)})` : ''}`, '−' + inr(o.discount)) : ''}
${o.requiresShipping ? row('Delivery', o.shipping ? inr(o.shipping) : 'Free') : ''}
<tr><td colspan="2" style="padding-top:8px;border-bottom:2px solid ${INK};font-size:0">&nbsp;</td></tr>
${row('Total paid', inr(o.total), true)}
${o.tax ? `<tr><td colspan="2" style="font:400 12.5px/1.4 ${FONT};color:#8B919D">Includes ${inr(o.tax)} GST</td></tr>` : ''}</table>`;
}

function addressBlock(o: Order) {
  const lines = addressLines(o);
  if (!lines.length) return '';
  return section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${PAPER};padding:18px 20px">
${label(o.requiresShipping ? 'Delivering to' : 'Billing address')}
<div style="margin-top:8px;font:400 14.5px/1.6 ${FONT};color:${INK}"><strong>${esc(o.shipName ?? o.name)}</strong><br>${lines.map(esc).join('<br>')}<br>${esc(o.phone)}</div>
</td></tr></table>`);
}

function metaStrip(cells: [string, string][]) {
  return section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE}"><tr>
${cells.map(([k, v], i) => `<td style="padding:14px ${i === cells.length - 1 ? 0 : 12}px 14px 0;vertical-align:top">${label(k)}<div style="margin-top:6px;font:700 15px/1.3 ${FONT};color:${INK}">${esc(v)}</div></td>`).join('')}
</tr></table>`);
}

/** The order's e-book files, attached while they fit within the size limit. */
async function ebookAttachments(deps: Deps, items: Item[]): Promise<{ files: Attachment[]; attached: Set<string> }> {
  const digital = items.filter((i) => i.isDigital && i.productId);
  const attached = new Set<string>();
  const files: Attachment[] = [];
  if (!digital.length) return { files, attached };
  const variants = await deps.db.select().from(productVariants)
    .where(and(inArray(productVariants.productId, digital.map((i) => i.productId!)), eq(productVariants.kind, 'digital')));
  let total = 0;
  for (const i of digital) {
    const v = variants.find((x) => x.productId === i.productId);
    if (!v?.filePath || (v.fileSize && total + v.fileSize > ATTACH_LIMIT)) continue;
    try {
      const content = await deps.storage.read('ebooks', v.filePath);
      if (total + content.length > ATTACH_LIMIT) continue;
      total += content.length;
      const name = v.fileName || `${i.title}.pdf`;
      files.push({ filename: name, content, contentType: name.endsWith('.epub') ? 'application/epub+zip' : 'application/pdf' });
      attached.add(i.id);
    } catch (e) {
      console.error('[mail] could not attach e-book', v.filePath, (e as Error).message);
    }
  }
  return { files, attached };
}

export async function sendOrderConfirmation(deps: Deps, o: Order, items: Item[], s: Settings) {
  const link = orderLink(deps, o);
  const token = orderToken(deps.env.ORDER_LINK_SECRET, o.id);
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  const digital = items.filter((i) => i.isDigital);
  const first = esc(o.name.split(' ')[0]);

  const attachments: Attachment[] = [];
  let attached = new Set<string>();
  try {
    if (o.invoiceNumber) attachments.push({ filename: invoiceFileName(o), content: await renderInvoicePdf(o, items, s), contentType: 'application/pdf' });
    const ebooks = await ebookAttachments(deps, items);
    attachments.push(...ebooks.files);
    attached = ebooks.attached;
  } catch (e) {
    console.error('[mail] attachments failed for order', o.number, (e as Error).message);
  }

  const ebookRows = digital.map((i) => `<tr>
<td style="padding:14px 0;border-top:1px solid rgba(255,255,255,0.14);font:600 15px/1.35 ${FONT};color:#FFFFFF">${esc(i.title)}<div style="margin-top:3px;font:400 12.5px/1.4 ${FONT};color:#A9B0BC">${attached.has(i.id) ? 'PDF attached to this email · also downloadable' : 'Ready to download'}</div></td>
<td align="right" style="padding:14px 0 14px 12px;border-top:1px solid rgba(255,255,255,0.14)"><a href="${site}/api/orders/${o.number}/download/${i.id}?t=${token}" style="display:inline-block;background:${YELLOW};padding:10px 14px;font:700 13px/1 ${FONT};color:${INK};text-decoration:none;white-space:nowrap">Download</a></td></tr>`).join('');

  const body = [
    metaStrip([['Order', `#${o.number}`], ['Paid on', istDate(o.paidAt ?? o.createdAt)], ['Total', inr(o.total)]]),
    digital.length ? section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${INK};padding:22px 22px 8px">
${label('Your e-books', YELLOW)}<div style="margin:10px 0 4px;font:700 20px/1.25 ${FONT};color:#FFFFFF">Start reading now.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${ebookRows}</table>
</td></tr><tr><td style="background:${INK};padding:0 22px 18px;font:400 12.5px/1.5 ${FONT};color:#A9B0BC">Download links are private to you and allow ${s.maxDownloads} downloads${s.downloadExpiryDays ? ` within ${s.downloadExpiryDays} days` : ''}. Please save the file on your device.</td></tr></table>`) : '',
    o.requiresShipping ? section(`${h2('What happens next')}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${[['1', 'We pack your books', 'Checked and packed at our Hazaribagh office.'], ['2', 'We ship and email you', 'You’ll get the courier name and tracking number.'], ['3', 'Delivered to your door', 'Anywhere in India.']]
  .map(([n, t, d]) => `<tr><td style="width:34px;padding:0 0 12px;vertical-align:top"><div style="width:24px;height:24px;background:${INK};color:#FFFFFF;font:700 12px/24px ${FONT};text-align:center">${n}</div></td><td style="padding:0 0 12px;font:600 14.5px/1.4 ${FONT};color:${INK}">${t}<div style="font:400 13.5px/1.4 ${FONT};color:${MUTED}">${d}</div></td></tr>`).join('')}
</table>`) : '',
    section(`${h2('Order summary')}${itemsTable(o, items)}`),
    addressBlock(o),
    section(`${o.invoiceNumber ? p(`Your ${s.gstin ? 'GST invoice' : 'invoice'} <strong style="color:${INK}">${esc(o.invoiceNumber)}</strong> is attached as a PDF.`) : ''}
${button(link, digital.length ? 'View your order & downloads' : 'Track your order')}`, '4px 32px 32px'),
  ].join('');

  await sendSafely(deps.mailer, {
    to: o.email,
    subject: `Order #${o.number} confirmed${digital.length ? ': your e-books are ready' : ''}`,
    html: layout(deps, s, {
      preheader: `Thank you for your order. ${digital.length ? 'Your e-books are ready to download.' : 'We’ll email you when it ships.'}`,
      kicker: 'Order confirmed',
      title: `Thank you, ${o.name.split(' ')[0]}.`,
      intro: `We’ve received your payment for order <strong style="color:${INK}">#${o.number}</strong>.${digital.length ? ' Your e-books are ready below.' : ' Here are the details.'}`,
      body,
      footerNote: `Keep this email: the links in it are private to your order, ${first}.`,
    }),
    replyTo: s.supportEmail,
    attachments,
  });
}

/** Internal recipients for new orders: Settings → order alerts, else MAIL_TO, else the support address. */
function staffRecipients(deps: Deps, s: Settings) {
  const mailTo = addressList(deps.env.MAIL_TO);
  return s.notifyEmails.length ? s.notifyEmails : mailTo.length ? mailTo : [s.supportEmail];
}

export async function sendStoreNewOrder(deps: Deps, o: Order, items: Item[], s: Settings) {
  const body = [
    metaStrip([['Order', `#${o.number}`], ['Total', inr(o.total)], ['Fulfil', o.requiresShipping ? 'Ship' : 'Digital only']]),
    section(`${h2('Customer')}${p(`<strong style="color:${INK}">${esc(o.name)}</strong><br>${esc(o.email)} · ${esc(o.phone)}`)}`),
    section(`${h2('Items')}${itemsTable(o, items)}`),
    addressBlock(o),
    o.customerNote ? section(`${h2('Customer note')}${p(esc(o.customerNote))}`) : '',
    section(button(`${deps.env.SITE_URL}/admin/orders/${o.id}`, 'Open in admin', INK), '4px 32px 32px'),
  ].join('');
  await sendSafely(deps.mailer, {
    to: staffRecipients(deps, s),
    subject: `New order #${o.number} · ${inr(o.total)} · ${o.name}`,
    html: layout(deps, s, { preheader: `${o.name} paid ${inr(o.total)}`, kicker: 'New order', title: `Order #${o.number}`, intro: `${esc(o.name)} paid ${inr(o.total)}${o.requiresShipping ? '. Printed books to pack.' : ' for e-books only.'}`, body }),
    replyTo: o.email,
  });
}

export async function sendShipped(deps: Deps, o: Order, s: Settings) {
  const tracking = o.trackingNumber
    ? section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${INK};padding:20px 22px">
${label(esc(o.courier ?? 'Courier'), YELLOW)}<div style="margin:8px 0 ${o.trackingUrl ? 14 : 0}px;font:700 22px/1.2 ${FONT};color:#FFFFFF;letter-spacing:0.5px">${esc(o.trackingNumber)}</div>
${o.trackingUrl ? button(o.trackingUrl, 'Track your parcel', YELLOW, INK) : ''}</td></tr></table>`)
    : '';
  const body = tracking + addressBlock(o) + section(button(orderLink(deps, o), 'View your order', INK), '4px 32px 32px');
  await sendSafely(deps.mailer, {
    to: o.email, subject: `Your books are on their way · order #${o.number}`, replyTo: s.supportEmail,
    html: layout(deps, s, { preheader: o.trackingNumber ? `Tracking number ${o.trackingNumber}` : 'Your order has shipped', kicker: 'Shipped', title: 'Your books are on their way.', intro: `Order <strong style="color:${INK}">#${o.number}</strong> has left our office.`, body }),
  });
}

export async function sendRefundNotice(deps: Deps, o: Order, amount: number, s: Settings) {
  const body = metaStrip([['Order', `#${o.number}`], ['Refunded', inr(amount)], ['Back in', '5–7 working days']]) +
    section(p('The refund goes back to the payment method you used. Your bank may take a few days to show it.') + button(orderLink(deps, o), 'View your order', INK), '4px 32px 32px');
  await sendSafely(deps.mailer, {
    to: o.email, subject: `Refund of ${inr(amount)} for order #${o.number}`, replyTo: s.supportEmail,
    html: layout(deps, s, { preheader: `We’ve refunded ${inr(amount)}`, kicker: 'Refund issued', title: `We’ve refunded ${inr(amount)}.`, intro: `For order <strong style="color:${INK}">#${o.number}</strong>.`, body }),
  });
}

export async function sendOrderLink(deps: Deps, o: Order, s: Settings) {
  const body = section(button(orderLink(deps, o), 'Open your order'), '4px 32px 32px');
  await sendSafely(deps.mailer, {
    to: o.email, subject: `Your order #${o.number}`, replyTo: s.supportEmail,
    html: layout(deps, s, { preheader: 'The private link to your order', kicker: 'Your order', title: `Order #${o.number}`, intro: `Here’s the private link to your order, placed on ${istDate(o.createdAt)}. It shows delivery status, your invoice and any e-book downloads.`, body }),
  });
}

const ENQUIRY_LABEL: Record<Enquiry['kind'], string> = {
  sample: 'Sample copy request', bulk: 'School / bulk enquiry', teacher: 'Teacher access request',
  dist: 'Distributor application', contact: 'Contact message', proposal: 'Author proposal',
};

/** Contact forms and enquiries go to MAIL_TO (else Settings → order alerts, else the support address). Reply goes straight to the sender. */
export async function sendEnquiryNotice(deps: Deps, e: Enquiry, s: Settings) {
  const mailTo = addressList(deps.env.MAIL_TO);
  const to = mailTo.length ? mailTo : s.notifyEmails.length ? s.notifyEmails : [s.supportEmail];
  const rows: [string, string][] = [
    ['Name', e.name], ['Email', e.email], ['Phone', e.phone], ['Institution', e.institution], ['City', e.city],
    ['Role', e.role], ['Title', e.title],
    ...Object.entries((e.data as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  const body = section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="width:130px;padding:10px 12px 10px 0;border-bottom:1px solid ${LINE};vertical-align:top">${label(esc(k))}</td><td style="padding:10px 0;border-bottom:1px solid ${LINE};font:400 15px/1.5 ${FONT};color:${INK}">${esc(v)}</td></tr>`).join('')}</table>`) +
    (e.message ? section(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:${PAPER};padding:18px 20px;border-left:3px solid ${ACCENT};font:400 15px/1.6 ${FONT};color:${INK};white-space:pre-wrap">${esc(e.message)}</td></tr></table>`) : '') +
    section(button(`${deps.env.SITE_URL}/admin/enquiries`, 'Open enquiries', INK), '4px 32px 32px');
  await sendSafely(deps.mailer, {
    to, subject: `${ENQUIRY_LABEL[e.kind]}: ${e.name}${e.institution ? `, ${e.institution}` : ''}`, replyTo: e.email || undefined,
    html: layout(deps, s, { preheader: e.message.slice(0, 120), kicker: ENQUIRY_LABEL[e.kind], title: e.name, intro: e.email ? 'Reply to this email to answer them directly.' : 'They left a phone number only.', body }),
  });
}
