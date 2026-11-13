import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fallbackMessage, withRetry } from '../store/api';
import { accessToken, supabase } from './auth';

export { ApiError };

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch('/api/admin' + path, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

export async function adminApi<T>(path: string, init: { method?: string; body?: unknown; retry?: boolean } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  return withRetry(method === 'GET' || Boolean(init.retry), async () => {
    let res: Response;
    try {
      res = await authed(path, {
        method,
        headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      });
    } catch {
      throw new ApiError(0, 'Can’t reach the server. Check your connection.', 'network');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) window.dispatchEvent(new Event('admin:unauthenticated'));
      throw new ApiError(res.status, data.error ?? fallbackMessage(res.status), data.code, data.details);
    }
    return data as T;
  });
}

/** Load data for a page; `reload()` refetches. */
export function useAdmin<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    adminApi<T>(path)
      .then((d) => { if (id === seq.current) { setData(d); setError(null); } })
      .catch((e) => { if (id === seq.current) setError(e); })
      .finally(() => { if (id === seq.current) setLoading(false); });
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Download a CSV (or any file) that needs the admin's sign-in. */
export async function downloadFile(path: string, fileName: string) {
  const res = await authed(path);
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Open a printable page (invoice, packing slip) in a new tab. */
export async function openPrintable(path: string) {
  const win = window.open('', '_blank');
  const res = await authed(path);
  const data = await res.arrayBuffer();
  if (!res.ok) { win?.close(); throw new ApiError(res.status, 'Could not open the document'); }
  const url = URL.createObjectURL(new Blob([data], { type: res.headers.get('content-type') ?? 'text/html' }));
  if (win) win.location.href = url; else window.location.href = url;
}

/** Upload a file straight to storage with a one-time signed link from the API. */
/**
 * Covers and book photos are shown at a few hundred pixels: a 2 MB, 2000 px PNG straight from a
 * design tool only slows the store down. Big ones are redrawn here at up to 1600 px as WebP (JPEG
 * where the browser can't make WebP) before upload. Anything already small goes up as it is.
 */
const COVER_MAX_SIDE = 1600;
async function shrinkCover(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap === 'undefined') return file;
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return file; }
  try {
    if (file.size <= 350 * 1024 && Math.max(bmp.width, bmp.height) <= COVER_MAX_SIDE) return file;
    const scale = Math.min(1, COVER_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height); // transparent edges on white
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const make = (type: string) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.86));
    let blob = await make('image/webp');
    if (!blob || blob.type !== 'image/webp') blob = await make('image/jpeg');
    if (!blob || blob.size >= file.size) return file;
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.' + ext, { type: blob.type });
  } finally {
    bmp.close();
  }
}

export async function uploadFile(bucket: 'covers' | 'ebooks' | 'resources' | 'competition-media' | 'competition-files', original: File) {
  const file = bucket === 'covers' ? await shrinkCover(original) : original;
  const signed = await adminApi<{ url: string; token: string; path: string; publicUrl: string | null }>('/uploads', {
    body: { bucket, fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size },
  });
  if (supabase) {
    // Every upload gets a new address (year/uuid/name), so a public file never changes: browsers may keep it a year.
    const cacheControl = bucket === 'covers' || bucket === 'competition-media' ? '31536000' : undefined;
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type, ...(cacheControl ? { cacheControl } : {}) });
    if (error) throw new ApiError(500, `Upload failed: ${error.message}`);
  } else {
    const res = await fetch(signed.url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type } });
    if (!res.ok) throw new ApiError(res.status, 'Upload failed');
  }
  return { path: signed.path, publicUrl: signed.publicUrl, name: file.name, size: file.size };
}

/* ---------------- Formatting ---------------- */

export const rupees = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));
export const toPaise = (rupeesText: string) => {
  const n = Number(String(rupeesText).replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
export const fmtDate = (s: string | null | undefined, time = false) =>
  s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(time ? { hour: 'numeric', minute: '2-digit' } : {}) }) : '—';
