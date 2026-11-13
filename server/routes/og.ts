// Link previews for competitions and books. WhatsApp and Facebook don't run JavaScript, so a
// shared /competitions/<slug> or /books/<slug> link would show the generic site card. vercel.json
// sends those addresses here: we return the normal page (index.html) with that page's title,
// description and image filled in. A book page also comes with its content and structured data
// already in the HTML (for search engines, and for visitors while the app loads); the app then
// takes over as usual.
import type { Deps } from '../deps.js';
import { esc, inr } from '../lib/format.js';
import { loadCatalog, type CatalogItem } from '../services/catalog.js';
import { findCompetition, imageSrcSet, type Competition } from '../../src/shared/competitions.js';
import { dayLabel } from '../../src/shared/teams.js';
import { bookDescription, bookImages, bookSchema, bookUrl, jsonLd } from '../../src/shared/bookSchema.js';
import { LV, PAL } from '../../src/data.js';
import { COVER_SIZES, sizedSrc, sizedSrcSet } from '../../src/shared/img.js';

/** Vercel's image resizing exists only on Vercel (see src/shared/img.ts). */
const resizeImages = () => Boolean(process.env.VERCEL);

let cached: { at: number; origin: string; html: string } | null = null;

async function indexHtml(origin: string) {
  if (cached && cached.origin === origin && Date.now() - cached.at < 10 * 60_000) return cached.html;
  const res = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`index.html ${res.status}`);
  const html = await res.text();
  cached = { at: Date.now(), origin, html };
  return html;
}

const setMeta = (html: string, attr: 'name' | 'property', key: string, value: string) => {
  const tag = `<meta ${attr}="${key}" content="${esc(value)}" />`;
  const re = new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, '\\$&')}" content="[^"]*"\\s*/?>`);
  return re.test(html) ? html.replace(re, tag) : html.replace('</head>', `    ${tag}\n  </head>`);
};

/**
 * Where to fetch index.html from: this deployment's own address if the request came in on it,
 * else SITE_URL. Never an address taken blindly from the request's Host header, so nobody can
 * make the server fetch, and pass on, another site's page.
 */
export function pageOrigin(site: string, requested: string, vercel: Record<string, string | undefined> = process.env): string {
  const ok = new Set<string>();
  const add = (u?: string) => { if (u) try { ok.add(new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).origin); } catch { /* not a URL */ } };
  add(site);
  try { const u = new URL(site); add(`${u.protocol}//${u.hostname.startsWith('www.') ? u.hostname.slice(4) : `www.${u.hostname}`}`); } catch { /* not a URL */ }
  add(vercel.VERCEL_URL); add(vercel.VERCEL_BRANCH_URL); add(vercel.VERCEL_PROJECT_PRODUCTION_URL);
  if (!vercel.VERCEL) { add('http://localhost'); try { const r = new URL(requested); if (['localhost', '127.0.0.1'].includes(r.hostname)) ok.add(r.origin); } catch { /* not a URL */ } }
  return ok.has(requested) ? requested : new URL(site).origin;
}

/** The page with this competition's tags, or null to fall back to the plain app. */
export async function competitionPage(deps: Deps, slug: string, requestOrigin: string): Promise<string | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const comp = findCompetition(slug);
  if (!comp) return null;
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  const origin = pageOrigin(site, requestOrigin);
  const title = `${comp.title} — Elden Academic Press`;
  const description = (comp.tagline || 'A competition by Elden Academic Press.').slice(0, 200);
  const pic = comp.shareImage || comp.image;
  const image = pic ? (/^https:\/\//.test(pic) ? pic : `${site}${pic.startsWith('/') ? '' : '/'}${pic}`) : null;
  const url = `${site}/competitions/${comp.slug}`;
  let html = await indexHtml(origin);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', url);
  if (image) html = setMeta(html, 'property', 'og:image', image);
  if (image) html = setMeta(html, 'property', 'og:image:alt', comp.title);
  html = setMeta(html, 'name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  if (comp.unlisted) html = html.replace('</head>', '    <meta name="robots" content="noindex" />\n  </head>');
  html = html.replace('</head>', `    <link rel="canonical" href="${esc(url)}" />\n  </head>`);
  // A team competition's page asks for its live details first thing: start that now, alongside the scripts.
  if (comp.team) html = html.replace('</head>', `    <link rel="preload" href="/api/competition-info/${comp.slug}" as="fetch" crossorigin />\n  </head>`);
  // Its banner is the page's biggest picture: start it now (same sizes as the app's, so it's one download).
  const art = compArt(comp);
  if (art) html = addToHead(html, `    <link rel="preload" as="image" href="${esc(art.src)}"${art.srcset ? ` imagesrcset="${esc(art.srcset)}" imagesizes="${esc(art.sizes)}"` : ''} fetchpriority="high" />`);
  // The top of the page, before the app's script runs (ads land here on slow phone data); the app removes it when ready.
  html = addToHead(html, `    <style>${PRERENDER_CSS}${PRERENDER_COMP_CSS}</style>`);
  return html.replace('<div id="root"></div>', `${prerenderCompetition(comp, art)}\n    <div id="root"></div>`);
}

/** The banner as the app shows it (DoomsdayPage's Banner, or the plain competition page's picture). */
function compArt(c: Competition) {
  if (!c.image) return null;
  return { src: c.image, srcset: c.team ? imageSrcSet(c) : undefined, sizes: '(min-width: 960px) 46vw, calc(100vw - 2rem)' };
}

function prerenderCompetition(c: Competition, art: ReturnType<typeof compArt>): string {
  const t = c.team;
  const facts: [string, string][] = t
    ? [['Ages', `${t.minAge} to ${t.maxAge}`], ['Teams', `${t.minMembers} to ${t.maxMembers} members`], ['Entry', 'Free'], ['Deadline', `${dayLabel(t.submissionDeadline.slice(0, 10))}, 11:59 PM IST`]]
    : (c.facts ?? []).slice(0, 4);
  const img = art
    ? `<img class="pr-comp__art" src="${esc(art.src)}"${art.srcset ? ` srcset="${esc(art.srcset)}" sizes="${esc(art.sizes)}"` : ''} width="1400" height="1050" alt="${esc(c.title)}" fetchpriority="high" />`
    : '';
  return `<div id="prerender" data-path="/competitions/${esc(encodeURIComponent(c.slug))}">
      <header class="pr-head"><a href="/" class="pr-brand"><img src="/assets/elden-mark-sm.png" width="22" height="29" alt="" />Elden Academic Press</a><nav><a href="/competitions">Competitions</a><a href="/contact">Contact</a></nav></header>
      <main class="pr-main pr-comp">
        <div class="pr-comp__text">
          <p class="pr-tags">Elden Academic Press presents</p>
          <h1>${esc(c.title)}</h1>
          <p class="pr-blurb">${esc(c.tagline)}</p>
          <a class="pr-cta" href="#${t ? 'team' : 'register'}">${t ? 'Register your team' : 'Register'}</a>
          ${facts.length ? `<dl class="pr-comp__facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        </div>
        ${img}
      </main>
    </div>`;
}

const PRERENDER_COMP_CSS = [
  '.pr-comp{display:grid;gap:28px;align-items:center;padding-top:8px}@media(min-width:960px){.pr-comp{grid-template-columns:1fr 46vw;gap:48px}}',
  '.pr-comp__art{display:block;width:100%;height:auto;border-radius:10px}',
  '.pr-cta{display:inline-block;margin:0 0 22px;padding:14px 22px;border-radius:999px;background:#0B1220;color:#fff!important;font-weight:700;text-decoration:none}',
  '.pr-comp__facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0}',
  '.pr-comp__facts div{padding:10px 12px;background:#fff;border:1px solid #E4E0D8;border-radius:10px}.pr-comp__facts dt{font-size:12px;color:#576072}.pr-comp__facts dd{margin:0;font-weight:700}',
].join('');

const addToHead = (html: string, tags: string) => html.replace('</head>', `${tags}\n  </head>`);

/**
 * A book's page: its own title, description, cover and address for link previews, its
 * structured data, and its content, read from the database. status 404 (with the plain app,
 * not indexed) when there's no such book on sale.
 */
export async function bookPage(deps: Deps, slug: string, requestOrigin: string): Promise<{ status: 200 | 404; html: string }> {
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  const [template, catalog] = await Promise.all([indexHtml(pageOrigin(site, requestOrigin)), loadCatalog(deps.db, deps.storage)]);
  const book = catalog.items.find((b) => b.slug === slug);
  if (!book) return { status: 404, html: addToHead(template, '    <meta name="robots" content="noindex" />') };

  const url = bookUrl(book.slug, site);
  const description = bookDescription(book).slice(0, 200);
  const image = bookImages(book, site)[0];
  const offer = book.formats.print ?? book.formats.digital;
  let html = template.replace(/<title>[^<]*<\/title>/, `<title>${esc(`${book.title} — Elden Academic Press`)}</title>`);
  if (description) {
    html = setMeta(html, 'name', 'description', description);
    html = setMeta(html, 'property', 'og:description', description);
  }
  html = setMeta(html, 'property', 'og:type', 'product');
  html = setMeta(html, 'property', 'og:title', book.title);
  html = setMeta(html, 'property', 'og:url', url);
  if (image) {
    html = setMeta(html, 'property', 'og:image', image);
    html = setMeta(html, 'property', 'og:image:alt', `Cover of ${book.title}`);
  }
  if (offer) {
    html = setMeta(html, 'property', 'product:price:amount', (offer.price / 100).toFixed(2));
    html = setMeta(html, 'property', 'product:price:currency', 'INR');
    html = setMeta(html, 'property', 'product:availability', offer.available ? 'in stock' : 'out of stock');
  }
  // The same id as the product feed and the Pixel's content_ids, so Meta ties the page to the catalogue item.
  html = setMeta(html, 'property', 'product:retailer_item_id', book.id);
  html = setMeta(html, 'name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  // The cover is the page's biggest picture: start it now, at the size the visitor's screen needs.
  const cover = book.coverUrl ? coverImg(book.coverUrl) : null;
  const preload = cover?.srcset
    ? `\n    <link rel="preload" as="image" href="${esc(cover.src)}" imagesrcset="${esc(cover.srcset)}" imagesizes="${esc(cover.sizes)}" fetchpriority="high" />`
    : cover ? `\n    <link rel="preload" as="image" href="${esc(cover.src)}" fetchpriority="high" />` : '';
  html = addToHead(html, `    <link rel="canonical" href="${esc(url)}" />${preload}\n    <style>${PRERENDER_CSS}</style>`);
  // The page itself, before the app's script runs; the app removes it when its own page is ready.
  return { status: 200, html: html.replace('<div id="root"></div>', `${prerenderBook(book, cover)}\n    <div id="root"></div>`) };
}

/** The book page's cover, sized exactly as the app's own (COVER_SIZES.detail), so the app reuses this download. */
function coverImg(url: string) {
  const { widths, sizes } = COVER_SIZES.detail;
  const on = resizeImages();
  return { src: sizedSrc(url, widths[widths.length - 1], on), srcset: sizedSrcSet(url, widths, on), sizes };
}

function stockNote(kind: 'print' | 'digital', f: { available: boolean; lowStock: number | null }) {
  if (kind === 'digital') return f.available ? 'Instant download' : 'Not available';
  if (!f.available) return 'Out of stock';
  return f.lowStock ? `Only ${f.lowStock} left` : 'In stock';
}

/** The book's page as plain HTML: what search engines read, and what a visitor sees until the app loads. */
function prerenderBook(b: CatalogItem, image: ReturnType<typeof coverImg> | null): string {
  const formats = ([['print', b.formats.print?.includesEbook ? 'Printed book + free e-book (PDF)' : 'Printed book'], ['digital', 'E-book (PDF)']] as const)
    .flatMap(([k, label]) => {
      const f = b.formats[k];
      if (!f) return [];
      const was = f.compareAt && f.compareAt > f.price ? ` <s>${esc(inr(f.compareAt))}</s>` : '';
      return [`<li><span>${esc(label)}</span> <b>${esc(inr(f.price))}</b>${was} <span class="pr-stock${f.available ? '' : ' is-out'}">${esc(stockNote(k, f))}</span></li>`];
    });
  const specs = ([
    ['ISBN', b.isbn], ['Pages', b.pages ? String(b.pages) : ''], ['Edition', b.edition],
    [b.boards.length ? 'Board' : 'Exam / series', b.boards.join(', ') || b.classLabel],
    ['Level', LV[b.level as keyof typeof LV] ?? ''], ['Language', b.language],
  ] as [string, string][]).filter(([, v]) => v);
  const tags = [b.category?.name, LV[b.level as keyof typeof LV], b.isNew ? 'New' : ''].filter(Boolean);
  const by = [b.author ? `by <b>${esc(b.author)}</b>` : '', esc([b.classLabel, b.boards.join(', ')].filter(Boolean).join(' · '))].filter(Boolean).join(' · ');
  const cover = image
    ? `<img src="${esc(image.src)}"${image.srcset ? ` srcset="${esc(image.srcset)}" sizes="${esc(image.sizes)}"` : ''} width="360" height="498" alt="Cover of ${esc(b.title)}" fetchpriority="high" />`
    : (() => {
      // No uploaded cover: the app draws one in the book's colours; this is a plain version of it.
      const c = PAL[b.palette] ?? PAL[0];
      return `<div class="pr-blank" aria-hidden="true" style="background:${esc(c.bg)};color:${esc(c.fg)}"><b>${esc(b.title)}</b>${b.author ? `<span>${esc(b.author)}</span>` : ''}</div>`;
    })();
  return `<div id="prerender" data-path="/books/${esc(encodeURIComponent(b.slug))}">
      <header class="pr-head"><a href="/" class="pr-brand"><img src="/assets/elden-mark-sm.png" width="22" height="29" alt="" />Elden Academic Press</a><nav><a href="/store">Store</a><a href="/contact">Contact</a></nav></header>
      <main class="pr-main">
        <nav class="pr-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/store">Store</a> / <span>${esc(b.title)}</span></nav>
        <article class="pr-book">
          <div class="pr-cover">${cover}</div>
          <div class="pr-info">
            ${tags.length ? `<p class="pr-tags">${tags.map((t) => esc(t)).join(' · ')}</p>` : ''}
            <h1>${esc(b.title)}</h1>
            ${by ? `<p class="pr-by">${by}</p>` : ''}
            ${b.blurb ? `<p class="pr-blurb">${esc(b.blurb)}</p>` : ''}
            ${formats.length ? `<ul class="pr-prices">${formats.join('')}</ul>` : ''}
            ${specs.length ? `<dl class="pr-specs">${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
          </div>
        </article>
        ${b.description && b.description !== b.blurb ? `<section class="pr-sec"><h2>Overview</h2><p class="pr-desc">${esc(b.description)}</p></section>` : ''}
        ${b.highlights.length ? `<section class="pr-sec"><h2>What’s inside</h2><ul>${b.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></section>` : ''}
        ${b.contents.length ? `<section class="pr-sec"><h2>Contents</h2><ol>${b.contents.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>` : ''}
        <script type="application/ld+json">${jsonLd(bookSchema(b))}</script>
      </main>
      <footer class="pr-foot">Elden Academic Press · <a href="/store">All books</a> · <a href="/contact">Contact</a></footer>
    </div>`;
}

// The ready-made page's look (the app's own styles arrive with its script). While it's there, the
// app renders out of sight, and swaps in when its book page is ready (src/prerender.ts).
const PRERENDER_CSS = [
  '#prerender~#root{display:none}',
  // The site's stylesheet sets this too; set it from the start so its arrival doesn't nudge the page.
  'body{margin:0}',
  "#prerender{font:16px/1.55 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#0B1220;background:#F4F2ED;min-height:100vh}",
  '#prerender a{color:inherit}#prerender h1,#prerender h2{font-family:inherit;color:#0B1220}',
  '.pr-head,.pr-main,.pr-foot{max-width:1200px;margin:0 auto;padding-left:20px;padding-right:20px}',
  '.pr-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-top:18px;padding-bottom:18px}',
  '.pr-brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:14px}',
  '.pr-head nav{display:flex;gap:18px;font-size:15px}',
  '.pr-main{padding-bottom:48px}.pr-crumbs{font-size:13px;color:#576072;margin:4px 0 24px}',
  '.pr-book{display:grid;gap:32px}@media(min-width:860px){.pr-book{grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:56px;align-items:start}}',
  '.pr-cover img,.pr-blank{display:block;width:100%;max-width:min(400px,70vw);height:auto;margin:0 auto;border-radius:6px;box-shadow:0 18px 40px rgba(11,18,32,.18)}',
  // The cover's space is kept before it arrives (the app's cover shape), so the text beside or below it doesn't jump.
  '.pr-cover img{aspect-ratio:3/4.15;object-fit:cover;background:#E4E0D8}',
  '.pr-blank{aspect-ratio:3/4;background:#1C2638;color:#fff;display:flex;flex-direction:column;justify-content:flex-end;gap:10px;padding:24px;font-size:clamp(20px,5vw,26px);line-height:1.15}.pr-blank span{font-size:14px;opacity:.85}',
  '.pr-tags{margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#576072}',
  '#prerender h1{font-size:clamp(30px,5vw,46px);line-height:1.08;margin:8px 0 10px}',
  '.pr-by{margin:0 0 14px;color:#576072}.pr-blurb{margin:0 0 22px;font-size:18px}',
  '.pr-prices{list-style:none;padding:0;margin:0 0 24px;display:grid;gap:10px}',
  '.pr-prices li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:14px 16px;background:#fff;border:1px solid #E4E0D8;border-radius:10px}',
  '.pr-prices b{font-size:22px}.pr-prices s{color:#8B919D}.pr-stock{font-size:13px;color:#0F7A4F}.pr-stock.is-out{color:#C42D1C}',
  '.pr-specs{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:0;font-size:14px}.pr-specs dt{color:#576072}.pr-specs dd{margin:0}',
  '.pr-sec{max-width:760px;margin-top:40px}#prerender h2{font-size:22px;margin:0 0 10px}.pr-desc{white-space:pre-wrap}',
  '.pr-foot{padding-top:24px;padding-bottom:32px;border-top:1px solid #E4E0D8;font-size:13px;color:#576072}',
].join('');
