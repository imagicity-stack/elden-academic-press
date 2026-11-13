// Book covers and photos are uploaded as they are (often 2 MB PNGs, 1500 × 2000 px) and shown at a
// few hundred pixels. On Vercel, they go through Vercel's image resizing (vercel.json → images):
// the visitor gets a copy at the width their screen needs, as AVIF or WebP, from our own address
// and Vercel's cache near them. Locally, and for any other address, the original is used.
//
// Widths and qualities must be listed in vercel.json's images.sizes and images.qualities
// (tests/img.test.ts checks), or Vercel refuses the request.

/** Every width we ask for (vercel.json images.sizes lists exactly these). */
export const IMAGE_WIDTHS = [160, 256, 384, 512, 640, 828, 1080, 1600] as const;
export type ImageWidth = (typeof IMAGE_WIDTHS)[number];
/** vercel.json images.qualities. */
export const IMAGE_QUALITY = 70;

/** Only the store's own Supabase public files (vercel.json images.remotePatterns allows these). */
const RESIZABLE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\//;

export const canResize = (src: string) => RESIZABLE.test(src);

/** The address of `src` at `width` pixels, or `src` itself when resizing is off or doesn't apply. */
export function sizedSrc(src: string, width: ImageWidth, enabled: boolean): string {
  if (!enabled || !canResize(src)) return src;
  return `/_vercel/image?url=${encodeURIComponent(src)}&w=${width}&q=${IMAGE_QUALITY}`;
}

/** A srcset for `src` at these widths, or undefined when resizing is off or doesn't apply. */
export function sizedSrcSet(src: string, widths: readonly ImageWidth[], enabled: boolean): string | undefined {
  if (!enabled || !canResize(src)) return undefined;
  return widths.map((w) => `${sizedSrc(src, w, true)} ${w}w`).join(', ');
}

/**
 * How each place shows a cover: the widths offered and the size it takes on screen (CSS px), so the
 * browser picks the smallest copy that is still sharp. The server's ready-made book page uses the
 * same "detail" values, so the app's cover reuses the download instead of fetching it again.
 */
export const COVER_SIZES = {
  // Shelves (200–260 px columns), the catalogue grid (two columns on phones) and related books.
  card: { widths: [256, 384, 512, 640] as const, sizes: '(max-width: 640px) 46vw, 260px' },
  // The book page's main cover: up to 360 px wide, about two thirds of a phone's width.
  detail: { widths: [384, 512, 640, 828, 1080] as const, sizes: '(max-width: 640px) 66vw, 360px' },
  hero: { widths: [384, 512, 640, 828, 1080] as const, sizes: '(max-width: 640px) 66vw, 420px' },
  // Small covers in the cart and at checkout.
  mini: { widths: [160, 256] as const, sizes: '80px' },
  // The row of extra photos under the cover (76 px thumbnails).
  thumb: { widths: [160, 256] as const, sizes: '76px' },
  // The full-screen photo viewer.
  full: { widths: [828, 1080, 1600] as const, sizes: '100vw' },
} satisfies Record<string, { widths: readonly ImageWidth[]; sizes: string }>;
