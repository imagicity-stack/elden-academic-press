// Transactional emails. Plain, table-based HTML that renders in every mail app.
import type { Deps } from '../deps';
import type { enquiries, orderItems, orders } from '../db/schema';
import { esc, inr, istDate } from '../lib/format';
import { sendSafely } from '../lib/mail';
import { stateName } from '../lib/states';
import type { Settings } from './catalog';
import { orderLink } from './orders';

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;
type Enquiry = typeof enquiries.$inferSelect;

const NAVY = '#0E1F33';
const BRONZE = '#9C6A2F';

function layout(s: Settings, title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#F6F0E6;font-family:Arial,Helvetica,sans-serif;color:#171A1F">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F0E6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #E3DCCF">
<tr><td style="background:${NAVY};padding:20px 28px;color:#FAF7F1;font-family:Georgia,serif;font-size:20px;letter-spacing:4px">ELDEN<div style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#CC955F;margin-top:4px">ACADEMIC PRESS</div></td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-family:Georgia,serif;font-weight:normal;font-size:26px;color:${NAVY}">${esc(title)}</h1>
${body}
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #E3DCCF;font-size:12px;color:#7A756B;line-height:1.6">
${esc(s.legalName)} · ${esc(s.address)}<br>Questions? Reply to this email or write to <a href="mailto:${esc(s.supportEmail)}" style="color:${BRONZE}">${esc(s.supportEmail)}</a>.
</td></tr></table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="display:inline-block;background:${NAVY};color:#FFFFFF;text-decoration:none;padding:13px 22px;font-weight:bold;font-size:14px">${esc(label)}</a></p>`;

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${html}</p>`;

function itemsTable(o: Order, items: Item[]) {
  const row = (l: string, r: string, bold = false) =>
    `<tr><td style="padding:6px 0;font-size:14px;${bold ? 'font-weight:bold' : 'color:#45423C'}">${l}</td><td align="right" style="padding:6px 0;font-size:14px;${bold ? 'font-weight:bold' : ''}">${r}</td></tr>`;
  const lines = items.map((i) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #EDE7DC;font-size:14px"><strong>${esc(i.title)}</strong><br><span style="color:#7A756B;font-size:12px">${esc(i.formatLabel)} × ${i.quantity}</span></td><td align="right" style="padding:10px 0;border-bottom:1px solid #EDE7DC;font-size:14px">${inr(i.lineTotal)}</td></tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px">${lines}
${row('Subtotal', inr(o.subtotal))}${o.discount ? row(`Discount${o.couponCode ? ` (${esc(o.couponCode)})` : ''}`, '−' + inr(o.discount)) : ''}
${o.requiresShipping ? row('Shipping', o.shipping ? inr(o.shipping) : 'Free') : ''}${row('Total', inr(o.total), true)}
${o.tax ? `<tr><td colspan="2" style="font-size:12px;color:#7A756B">Includes ${inr(o.tax)} GST</td></tr>` : ''}</table>`;
}

function address(o: Order) {
  if (!o.requiresShipping) return '';
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:#45423C"><strong style="color:#171A1F">Delivering to</strong><br>
${esc(o.shipName)}<br>${esc(o.shipLine1)}${o.shipLine2 ? `, ${esc(o.shipLine2)}` : ''}<br>${esc(o.shipCity)}, ${esc(stateName(o.shipState))} ${esc(o.shipPincode)}</p>`;
}

export async function sendOrderConfirmation(deps: Deps, o: Order, items: Item[], s: Settings) {
  const link = orderLink(deps, o);
  const digital = items.some((i) => i.isDigital);
  const body =
    p(`Hi ${esc(o.name.split(' ')[0])}, thank you for your order. We’ve received your payment.`) +
    (digital ? p('<strong>Your e-books are ready.</strong> Download them from your order page — keep this email, the link is private to you.') : '') +
    (o.requiresShipping ? p('We’ll email you again with tracking details when your books ship.') : '') +
    button(link, digital ? 'View order & download e-books' : 'View your order') +
    itemsTable(o, items) + address(o) +
    `<p style="margin:16px 0 0;font-size:12px;color:#7A756B">Order #${o.number} · ${istDate(o.paidAt)}${o.invoiceNumber ? ` · Invoice ${esc(o.invoiceNumber)}` : ''}</p>`;
  await sendSafely(deps.mailer, { to: o.email, subject: `Order #${o.number} confirmed`, html: layout(s, 'Thank you for your order', body), replyTo: s.supportEmail });
}

export async function sendStoreNewOrder(deps: Deps, o: Order, items: Item[], s: Settings) {
  const to = s.notifyEmails.length ? s.notifyEmails : [s.supportEmail];
  const body = p(`<strong>${esc(o.name)}</strong> · ${esc(o.email)} · ${esc(o.phone)}`) +
    itemsTable(o, items) + address(o) + button(`${deps.env.SITE_URL}/admin/orders/${o.id}`, 'Open in admin');
  await sendSafely(deps.mailer, { to, subject: `New order #${o.number} — ${inr(o.total)}`, html: layout(s, `New order #${o.number}`, body) });
}

export async function sendShipped(deps: Deps, o: Order, s: Settings) {
  const tracking = o.trackingNumber
    ? p(`<strong>${esc(o.courier ?? 'Courier')}</strong> tracking number: <strong>${esc(o.trackingNumber)}</strong>${o.trackingUrl ? ` — <a href="${esc(o.trackingUrl)}" style="color:${BRONZE}">track your parcel</a>` : ''}`)
    : '';
  const body = p(`Hi ${esc(o.name.split(' ')[0])}, your books are on their way.`) + tracking + address(o) + button(orderLink(deps, o), 'View your order');
  await sendSafely(deps.mailer, { to: o.email, subject: `Order #${o.number} has shipped`, html: layout(s, 'Your order has shipped', body), replyTo: s.supportEmail });
}

export async function sendRefundNotice(deps: Deps, o: Order, amount: number, s: Settings) {
  const body = p(`We’ve refunded <strong>${inr(amount)}</strong> for order #${o.number}. It usually reaches your account in 5–7 working days, to the same payment method you used.`) +
    button(orderLink(deps, o), 'View your order');
  await sendSafely(deps.mailer, { to: o.email, subject: `Refund for order #${o.number}`, html: layout(s, 'Refund processed', body), replyTo: s.supportEmail });
}

export async function sendOrderLink(deps: Deps, o: Order, s: Settings) {
  const body = p(`Here’s the private link to your order #${o.number}, placed on ${istDate(o.createdAt)}.`) + button(orderLink(deps, o), 'View your order');
  await sendSafely(deps.mailer, { to: o.email, subject: `Your order #${o.number}`, html: layout(s, 'Your order link', body), replyTo: s.supportEmail });
}

const ENQUIRY_LABEL: Record<Enquiry['kind'], string> = {
  sample: 'Sample copy request', bulk: 'School / bulk enquiry', teacher: 'Teacher access request',
  dist: 'Distributor application', contact: 'Contact message', proposal: 'Author proposal',
};

export async function sendEnquiryNotice(deps: Deps, e: Enquiry, s: Settings) {
  const to = s.notifyEmails.length ? s.notifyEmails : [s.supportEmail];
  const rows: [string, string][] = [
    ['Name', e.name], ['Email', e.email], ['Phone', e.phone], ['Institution', e.institution], ['City', e.city],
    ['Role', e.role], ['Title', e.title], ['Message', e.message],
    ...Object.entries((e.data as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)] as [string, string]),
  ];
  const body = `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5">${rows.filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#7A756B;vertical-align:top">${esc(k)}</td><td style="padding:4px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>` +
    button(`${deps.env.SITE_URL}/admin/enquiries`, 'Open enquiries');
  await sendSafely(deps.mailer, { to, subject: `${ENQUIRY_LABEL[e.kind]} — ${e.name}`, html: layout(s, ENQUIRY_LABEL[e.kind], body), replyTo: e.email || undefined });
}
