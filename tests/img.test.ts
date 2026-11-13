import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COVER_SIZES, IMAGE_QUALITY, IMAGE_WIDTHS, sizedSrc, sizedSrcSet } from '../src/shared/img';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const COVER = 'https://zrnmeisgzobjfygkouue.supabase.co/storage/v1/object/public/covers/2026/abc/cover.png';

describe('resized images', () => {
  it('asks Vercel only for widths and qualities vercel.json allows', () => {
    expect(vercel.images.sizes).toEqual([...IMAGE_WIDTHS]);
    expect(vercel.images.qualities).toEqual([IMAGE_QUALITY]);
    for (const { widths } of Object.values(COVER_SIZES)) for (const w of widths) expect(IMAGE_WIDTHS).toContain(w);
  });

  it('allows the store’s Supabase covers', () => {
    const [pattern] = vercel.images.remotePatterns;
    const u = new URL(COVER);
    expect(u.hostname).toBe(pattern.hostname);
    expect(new RegExp(pattern.pathname).test(u.pathname)).toBe(true);
  });

  it('builds /_vercel/image addresses, and leaves other images alone', () => {
    expect(sizedSrc(COVER, 512, true)).toBe(`/_vercel/image?url=${encodeURIComponent(COVER)}&w=512&q=${IMAGE_QUALITY}`);
    expect(sizedSrcSet(COVER, [256, 512], true)).toMatch(/w=256&q=\d+ 256w, .*w=512&q=\d+ 512w$/);
    expect(sizedSrc(COVER, 512, false)).toBe(COVER);
    expect(sizedSrcSet(COVER, [256], false)).toBeUndefined();
    expect(sizedSrc('/assets/elden-mark.png', 512, true)).toBe('/assets/elden-mark.png');
    expect(sizedSrc('http://localhost:5173/api/dev/files/covers/x.png', 512, true)).toBe('http://localhost:5173/api/dev/files/covers/x.png');
  });

  it('keeps the page’s catch-all rewrite away from /_vercel/', () => {
    const spa = vercel.rewrites.find((r: { destination: string }) => r.destination === '/index.html');
    expect(new RegExp(`^${spa.source.replace('/(', '/(')}$`).test('/_vercel/image')).toBe(false);
  });
});
