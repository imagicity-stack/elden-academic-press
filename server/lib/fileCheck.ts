// Students' uploads: what a file really is (from its first bytes, not its name or
// what the browser said), and removing hidden photo metadata (EXIF, including GPS
// location; XMP; IPTC; comments) without re-encoding the picture. No dependencies.

export type Sniffed = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf' | 'video/mp4';

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));

export function sniff(b: Uint8Array): Sniffed | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && ascii(b, 0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') return 'video/mp4';
  return null;
}

export const isImage = (m: string) => m === 'image/jpeg' || m === 'image/png' || m === 'image/webp';

/* ---------------- JPEG ---------------- */

/** Drop APP1 (EXIF/XMP), APP12, APP13 (IPTC) and COM segments; keep everything else. */
function stripJpeg(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) break;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xda) { out.push(b.subarray(i)); i = b.length; break; } // start of scan: image data to the end
    if (marker === 0xd9) { out.push(b.subarray(i, i + 2)); i += 2; break; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error('damaged JPEG');
    const drop = marker === 0xe1 || marker === 0xec || marker === 0xed || marker === 0xfe;
    if (!drop) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  if (i < b.length) out.push(b.subarray(i));
  return concat(out);
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    i += 2 + len;
  }
  return null;
}

/* ---------------- PNG ---------------- */

const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(b: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = ascii(b, i + 4, 4);
    const end = i + 12 + len;
    if (end > b.length) throw new Error('damaged PNG');
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return concat(out);
}

const pngSize = (b: Uint8Array) => (b.length >= 24 ? { width: readU32(b, 16), height: readU32(b, 20) } : null);

/* ---------------- WebP ---------------- */

function stripWebp(b: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let i = 12;
  let vp8x: Uint8Array | null = null;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = readU32le(b, i + 4);
    const end = i + 8 + len + (len % 2);
    if (end > b.length + 1) throw new Error('damaged WebP');
    const chunk = b.slice(i, Math.min(end, b.length));
    if (type === 'VP8X') vp8x = chunk;
    if (type !== 'EXIF' && type !== 'XMP ') chunks.push(chunk);
    i = end;
  }
  if (vp8x) vp8x[8] &= ~(0x08 | 0x04); // the "has EXIF / has XMP" flags
  const body = concat(chunks);
  const head = new Uint8Array(12);
  head.set(b.subarray(0, 4));
  writeU32le(head, 4, body.length + 4);
  head.set(b.subarray(8, 12), 8);
  return concat([head, body]);
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  const type = ascii(b, 12, 4);
  if (type === 'VP8X' && b.length >= 30) return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  if (type === 'VP8 ' && b.length >= 30) return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  if (type === 'VP8L' && b.length >= 25) {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/* ---------------- Shared ---------------- */

export function stripImageMetadata(b: Uint8Array, mime: string): Uint8Array {
  if (mime === 'image/jpeg') return stripJpeg(b);
  if (mime === 'image/png') return stripPng(b);
  if (mime === 'image/webp') return stripWebp(b);
  return b;
}

export function imageSize(b: Uint8Array, mime: string) {
  try {
    if (mime === 'image/jpeg') return jpegSize(b);
    if (mime === 'image/png') return pngSize(b);
    if (mime === 'image/webp') return webpSize(b);
  } catch { /* unknown */ }
  return null;
}

/** True if the picture still carries EXIF/XMP (where GPS location lives). */
export function hasPhotoMetadata(b: Uint8Array, mime: string): boolean {
  const text = ascii(b, 0, Math.min(b.length, 256 * 1024));
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 4 <= b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda || m === 0xd9) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      if (m === 0xe1 || m === 0xed) return true;
      i += 2 + len;
    }
    return false;
  }
  if (mime === 'image/png') return text.includes('eXIf') || text.includes('tEXt') || text.includes('iTXt');
  if (mime === 'image/webp') return text.includes('EXIF') || text.includes('XMP ');
  return false;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const readU32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const readU32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
function writeU32le(b: Uint8Array, i: number, v: number) { b[i] = v & 0xff; b[i + 1] = (v >> 8) & 0xff; b[i + 2] = (v >> 16) & 0xff; b[i + 3] = (v >> 24) & 0xff; }
