// Link previews for competitions. WhatsApp and Facebook don't run JavaScript, so a
// shared /competitions/<slug> link would show the generic site card. vercel.json
// sends that one address here: we return the normal page (index.html) with the
// competition's title, description and image filled in. The app then loads as usual.
import type { Deps } from '../deps.js';
import { esc } from '../lib/format.js';
import { isListed, loadFull, mediaUrl } from '../services/competitions.js';

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

/** The page with this competition's tags, or null to fall back to the plain app. */
export async function competitionPage(deps: Deps, slug: string, origin: string): Promise<string | null> {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const f = await loadFull(deps.db, { slug });
  if (!f || !isListed(f.c, deps.now())) return null;
  const site = deps.env.SITE_URL.replace(/\/$/, '');
  const title = f.c.seoTitle || `${f.c.title} — Elden Academic Press`;
  const description = (f.c.seoDescription || f.c.tagline || f.c.prompt || `A competition by ${f.c.organiserName}.`).slice(0, 200);
  const image = mediaUrl(deps, f.c.ogImageKey ?? f.c.banner16x9Key ?? f.c.image1x1Key);
  const url = `${site}/competitions/${f.c.slug}`;
  let html = await indexHtml(origin);
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`);
  html = setMeta(html, 'name', 'description', description);
  html = setMeta(html, 'property', 'og:title', title);
  html = setMeta(html, 'property', 'og:description', description);
  html = setMeta(html, 'property', 'og:url', url);
  if (image) html = setMeta(html, 'property', 'og:image', image);
  html = setMeta(html, 'name', 'twitter:card', image ? 'summary_large_image' : 'summary');
  html = html.replace('</head>', `    <link rel="canonical" href="${esc(url)}" />\n  </head>`);
  return html;
}
