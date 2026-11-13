// /llms.txt (https://llmstxt.org): a plain Markdown guide to the store for AI assistants (ChatGPT,
// Claude, Perplexity, Gemini…), so that when someone asks them about our books they can answer with
// the right titles, prices, formats and links. Built from the live catalogue, like /sitemap.xml:
// a book saved in the admin shows up here within the hour (vercel.json rewrites /llms.txt here).
// Before launch (VITE_SITE_LIVE not "true") it only describes the publisher and its policies.
import type { Deps } from '../deps.js';
import { inr } from '../lib/format.js';
import { getSettings, loadCatalog, type CatalogItem } from '../services/catalog.js';
import { listedCompetitions } from '../../src/shared/competitions.js';
import { dayLabel } from '../../src/shared/teams.js';
import { LV } from '../../src/data.js';
import { config } from '../../src/config.js';

/** One line of Markdown text: no line breaks, and no characters that would break a link list. */
const line = (s: string, max = 220) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
};
const linkText = (s: string) => line(s, 140).replace(/[[\]]/g, '');

function bookLine(b: CatalogItem, base: string): string {
  const about = [b.category?.name, LV[b.level as keyof typeof LV], b.classLabel, b.boards.join(', '), b.subject, b.author && `by ${b.author}`]
    .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
  const formats = [
    b.formats.print && `printed book ${inr(b.formats.print.price)}${b.formats.print.includesEbook ? ' (free e-book included)' : ''}${b.formats.print.available ? '' : ' (out of stock)'}`,
    b.formats.digital && `PDF e-book ${inr(b.formats.digital.price)}`,
  ].filter(Boolean).join(', ');
  const blurb = b.blurb || b.description;
  return `- [${linkText(b.title)}](${base}/books/${encodeURIComponent(b.slug)}): ${[about, formats && `Formats: ${formats}`, blurb && line(blurb)].filter(Boolean).join('. ')}`;
}

export async function llmsTxt(deps: Deps, live: boolean): Promise<string> {
  const base = deps.env.SITE_URL.replace(/\/$/, '');
  const s = await getSettings(deps.db);
  const p = config.policy;
  const out: string[] = [];

  out.push('# Elden Academic Press', '');
  out.push(`> Indian educational publisher of textbooks, reference books, study guides, practice papers, workbooks, e-books and journals, from Class 1 to higher education and research. Books are written with practising teachers and checked against the current syllabus. Printed books are delivered across India and e-books are PDF downloads, both sold at ${base}.`, '');
  out.push('Key facts:');
  out.push(`- Publisher: Elden Academic Press, run by ${config.company.legalName}, ${config.company.address}, India.`);
  out.push(`- Contact: ${config.contactEmail}`);
  out.push('- Prices are in Indian rupees (₹) and include GST. Payment by UPI, cards, net banking and wallets (Razorpay)' + (s.codEnabled ? ', or cash on delivery.' : '.'));
  const shipping = s.shippingFlat === 0 ? 'Delivery is free'
    : `Delivery costs ${inr(s.shippingFlat)} per order${s.freeShippingAbove > 0 ? `, free on orders of ${inr(s.freeShippingAbove)} or more` : ''}`;
  out.push(`- ${shipping}. Printed books are dispatched in ${p.dispatch} and arrive in ${p.delivery}.`);
  out.push('- E-books (PDF) are ready to download as soon as payment is confirmed, from the order page and the customer account.');
  out.push(`- Damaged, misprinted or wrong books can be reported within ${p.reportDays} days of delivery; refunds take ${p.refundTime}.`);
  out.push('- Schools, coaching centres, distributors and teachers can ask for bulk prices, samples and teacher access through the contact page.');
  out.push('');

  if (live) {
    const catalog = await loadCatalog(deps.db, deps.storage);
    const onSale = catalog.items.filter((b) => b.formats.print || b.formats.digital);
    if (onSale.length) {
      out.push('## Books', '');
      // Grouped by category, in the store's own order; books without one at the end.
      const groups = new Map<string, CatalogItem[]>();
      for (const c of catalog.categories) groups.set(c.name, []);
      for (const b of onSale) {
        const k = b.category?.name ?? 'Other books';
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(b);
      }
      for (const [name, books] of groups) {
        if (!books.length) continue;
        out.push(`### ${name}`, '', ...books.map((b) => bookLine(b, base)), '');
      }
    }

    const comps = listedCompetitions().filter((c) => Date.parse(c.closesAt) > deps.now().getTime());
    if (comps.length) {
      out.push('## Competitions', '');
      for (const c of comps) out.push(`- [${linkText(c.title)}](${base}/competitions/${c.slug}): ${line(c.tagline)} Registration closes ${dayLabel(c.closesAt.slice(0, 10))}.`);
      out.push('');
    }

    out.push('## Store and help', '');
    out.push(`- [All books](${base}/catalogue): the full store, with filters by category, level, class, subject, board and format.`);
    out.push(`- [Study Hub](${base}/study-hub): free downloads such as sample papers and worksheets.`);
    out.push(`- [Track an order](${base}/track): find an order's status with its number and email address.`);
    out.push(`- [About Elden](${base}/about): the publisher, publishing with Elden, and journals.`);
    out.push(`- [Contact](${base}/contact): enquiries, bulk and school orders, distributors by state.`);
    out.push('');
  }

  out.push('## Policies', '');
  out.push(`- [Shipping and delivery](${base}/shipping)`);
  out.push(`- [Cancellations, returns and refunds](${base}/refunds)`);
  out.push(`- [Terms of use and sale](${base}/terms)`);
  out.push(`- [Privacy policy](${base}/privacy)`);
  out.push('');
  out.push('## Optional', '');
  out.push(`- [Sitemap](${base}/sitemap.xml): every page and book.`);
  if (live) out.push(`- [Product feed](${base}/feeds/products.xml): printed books with prices and stock, in Google Merchant format.`);
  out.push('');
  return out.join('\n');
}
