// /books/<slug> comes from the server: that book's link preview (title, description, cover,
// address), its structured data and its content in the HTML. No page carries the homepage's
// address or the logo as its preview any more.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { products } from '../server/db/schema.js';
import { setup } from './helpers.js';

const INDEX = readFileSync('index.html', 'utf8');
let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
  const real = globalThis.fetch;
  // The server reads the built index.html from its own address; here, the source file.
  vi.stubGlobal('fetch', (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/index.html')) return new Response(INDEX);
    return real(url, init);
  }) as typeof fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

const page = async (path: string) => {
  const res = await t.app.request(`http://localhost${path}`);
  return { status: res.status, headers: res.headers, html: await res.text() };
};
/** content="…" of a <meta property|name="key">, every occurrence. */
const metas = (html: string, key: string) =>
  [...html.matchAll(new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, '\\$&')}" content="([^"]*)"`, 'g'))].map((m) => m[1]);
const jsonLdBlocks = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

describe('site-wide tags', () => {
  it('index.html no longer sets the homepage address or the logo as every page’s preview', () => {
    expect(metas(INDEX, 'og:url')).toEqual([]);
    expect(metas(INDEX, 'og:image')).toEqual([]);
  });
});

describe('book pages', () => {
  it('carry the book’s own title, description, cover and address, from the database', async () => {
    await t.db.update(products).set({ coverPath: 'maths-cover.jpg', blurb: 'Concepts, worked examples and practice for Class 10.' }).where(eq(products.slug, 'mathematics-today'));
    const [book] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const { status, headers, html } = await page('/books/mathematics-today');
    expect(status).toBe(200);
    expect(headers.get('cache-control')).toMatch(/s-maxage=\d+, stale-while-revalidate/);
    expect(html).toContain(`<title>${book.title} — Elden Academic Press</title>`);
    expect(metas(html, 'og:title')).toEqual([book.title]);
    expect(metas(html, 'og:description')).toEqual(['Concepts, worked examples and practice for Class 10.']);
    expect(metas(html, 'description')).toEqual(['Concepts, worked examples and practice for Class 10.']);
    expect(metas(html, 'og:url')).toEqual(['https://eldenap.in/books/mathematics-today']);
    expect(metas(html, 'og:image')).toEqual(['https://files.test/public/covers/maths-cover.jpg']);
    expect(metas(html, 'og:type')).toEqual(['product']);
    expect(metas(html, 'product:price:currency')).toEqual(['INR']);
    expect(Number(metas(html, 'product:price:amount')[0])).toBeGreaterThan(0);
    expect(metas(html, 'product:retailer_item_id')).toEqual([book.id]);
    expect(metas(html, 'twitter:card')).toEqual(['summary_large_image']);
    expect(html).toContain('<link rel="canonical" href="https://eldenap.in/books/mathematics-today" />');
    expect(html).not.toMatch(/og:image" content="[^"]*elden-mark/);
  });

  it('have the content in the HTML before any script runs, with structured data for Google', async () => {
    const [book] = await t.db.select().from(products).where(eq(products.slug, 'mathematics-today'));
    const { html } = await page('/books/mathematics-today');
    const body = html.slice(html.indexOf('<body>'));
    expect(body.indexOf('<div id="prerender" data-path="/books/mathematics-today">')).toBeLessThan(body.indexOf('<div id="root"></div>'));
    expect(body).toContain(`<h1>${book.title}</h1>`);
    expect(body).toMatch(/<ul class="pr-prices"><li><span>Printed book[^<]*<\/span> <b>₹[\d,]+<\/b>/);
    if (book.author) expect(body).toContain(`by <b>${book.author}</b>`);
    const [schema] = jsonLdBlocks(body);
    expect(schema).toMatchObject({ '@type': ['Product', 'Book'], name: book.title, url: 'https://eldenap.in/books/mathematics-today', sku: book.id });
    expect(schema.offers[0]).toMatchObject({ '@type': 'Offer', priceCurrency: 'INR' });
    // While it's there, the app renders out of sight; it removes it when its own page is ready.
    expect(html).toContain('#prerender~#root{display:none}');
  });

  it('escape the book’s text everywhere', async () => {
    await t.db.update(products).set({ title: 'Maths <script>alert(1)</script> "Today"', blurb: 'A & B </script><b>x</b>' }).where(eq(products.slug, 'mathematics-today'));
    const { html } = await page('/books/mathematics-today');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('</script><b>x</b>');
    expect(html).toContain('<h1>Maths &lt;script&gt;alert(1)&lt;/script&gt; &quot;Today&quot;</h1>');
    expect(metas(html, 'og:title')).toEqual(['Maths &lt;script&gt;alert(1)&lt;/script&gt; &quot;Today&quot;']);
    expect(jsonLdBlocks(html.slice(html.indexOf('<body>')))[0].name).toBe('Maths <script>alert(1)</script> "Today"');
  });

  it('a book with no cover or photo has no preview picture (never the logo)', async () => {
    await t.db.update(products).set({ coverPath: null, images: [] }).where(eq(products.slug, 'mathematics-today'));
    const { html } = await page('/books/mathematics-today');
    expect(metas(html, 'og:image')).toEqual([]);
    expect(metas(html, 'twitter:card')).toEqual(['summary']);
    expect(html).toMatch(/<div class="pr-blank" aria-hidden="true" style="background:[^"]+"><b>/);
  });

  it('an unknown or unpublished book is a 404 that search engines skip, with no preview of its own', async () => {
    const missing = await page('/books/no-such-book');
    expect(missing.status).toBe(404);
    expect(missing.html).toContain('<meta name="robots" content="noindex" />');
    expect(missing.html).not.toContain('id="prerender"');
    expect(metas(missing.html, 'og:url')).toEqual([]);
    await t.db.update(products).set({ status: 'draft' }).where(eq(products.slug, 'mathematics-today'));
    expect((await page('/books/mathematics-today')).status).toBe(404);
  });

  it('fall back to the app’s own page if the server can’t build it', async () => {
    // Reading the catalogue fails (here: the covers' storage), so the page can't be built.
    await t.db.update(products).set({ coverPath: 'maths-cover.jpg' }).where(eq(products.slug, 'mathematics-today'));
    t.deps.storage.publicUrl = () => { throw new Error('storage down'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await t.app.request('http://localhost/books/mathematics-today');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/books/mathematics-today/');
    expect(warn).toHaveBeenCalledWith('[og] book page', 'storage down');
    warn.mockRestore();
  });
});

describe('competition pages', () => {
  it('still get their own address and picture', async () => {
    const { html } = await page('/competitions/doomsday-diaries');
    expect(metas(html, 'og:url')).toEqual(['https://eldenap.in/competitions/doomsday-diaries']);
    expect(metas(html, 'og:image')).toEqual(['https://eldenap.in/assets/competitions/doomsday-diaries-share.jpg']);
  });
});
