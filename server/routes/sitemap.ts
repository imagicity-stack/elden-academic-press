// /sitemap.xml for search engines: the site's pages and every published
// title. Before launch (VITE_SITE_LIVE not "true") only the home page and
// the policies are listed, since every other address shows the coming-soon page.
import { asc, eq } from 'drizzle-orm';
import type { Deps } from '../deps.js';
import { products } from '../db/schema.js';

const PAGES = ['/', '/catalogue', '/study-hub', '/about', '/contact'];
const POLICIES = ['/terms', '/privacy', '/refunds', '/shipping'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sitemapXml(deps: Deps, live: boolean): Promise<string> {
  const base = deps.env.SITE_URL.replace(/\/$/, '');
  const entries: { loc: string; lastmod?: string }[] = (live ? PAGES : ['/']).concat(POLICIES).map((p) => ({ loc: base + p }));
  if (live) {
    const rows = await deps.db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products)
      .where(eq(products.status, 'active')).orderBy(asc(products.sort), asc(products.title));
    for (const r of rows) entries.push({ loc: `${base}/books/${encodeURIComponent(r.slug)}`, lastmod: r.updatedAt.toISOString().slice(0, 10) });
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.map((e) => `  <url><loc>${esc(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`).join('\n')
    + '\n</urlset>\n';
}
