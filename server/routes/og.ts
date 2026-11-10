// Link previews for competitions. WhatsApp and Facebook don't run JavaScript, so a
// shared /competitions/<slug> link would show the generic site card. vercel.json
// sends that one address here: we return the normal page (index.html) with the
// competition's title, description and image filled in. The app then loads as usual.
import type { Deps } from '../deps.js';
import { esc } from '../lib/format.js';
import { findCompetition } from '../../src/shared/competitions.js';

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
  return html;
}
