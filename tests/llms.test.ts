import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

const withLive = async <T>(live: boolean, run: () => Promise<T>) => {
  const before = process.env.VITE_SITE_LIVE;
  process.env.VITE_SITE_LIVE = live ? 'true' : 'false';
  try { return await run(); } finally { process.env.VITE_SITE_LIVE = before; }
};

describe('/llms.txt', () => {
  it('describes the publisher and lists the books on sale with prices and links, once live', async () => {
    const { app } = await setup();
    const res = await withLive(true, async () => app.request('/llms.txt'));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/markdown/);
    expect(text.startsWith('# Elden Academic Press\n\n> ')).toBe(true);
    expect(text).toContain('## Books');
    // Every line in the book list is a Markdown link to the book's page, with its formats and prices.
    const books = text.split('\n').filter((l) => l.startsWith('- [') && l.includes('/books/'));
    expect(books.length).toBeGreaterThan(0);
    for (const l of books) expect(l).toMatch(/^- \[[^\]]+\]\(https:\/\/eldenap\.in\/books\/[a-z0-9-]+\): .*Formats: .*₹/);
    expect(text).toContain('(https://eldenap.in/shipping)');
    expect(text).toContain('(https://eldenap.in/sitemap.xml)');
  });

  it('only describes the publisher and policies before launch', async () => {
    const { app } = await setup();
    const text = await (await withLive(false, async () => app.request('/llms.txt'))).text();
    expect(text).toContain('# Elden Academic Press');
    expect(text).toContain('## Policies');
    expect(text).not.toContain('/books/');
  });
});

describe('robots.txt', () => {
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  it('keeps private pages out, points to the sitemap and llms.txt', () => {
    for (const p of ['/admin', '/api/', '/checkout', '/order/', '/account', '/competitions/*/confirmation/']) expect(robots).toContain(`Disallow: ${p}\n`);
    expect(robots).toContain('Sitemap: https://eldenap.in/sitemap.xml');
    expect(robots).toContain('https://eldenap.in/llms.txt');
    // Books, competitions and resized cover images stay crawlable.
    for (const p of ['/books', '/competitions', '/_vercel']) expect(robots).not.toMatch(new RegExp(`Disallow: ${p}(\\n|/$)`, 'm'));
  });
});

describe('vercel.json', () => {
  it('sends /llms.txt to the server', () => {
    const v = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    expect(v.rewrites).toContainEqual({ source: '/llms.txt', destination: '/api' });
  });
});
