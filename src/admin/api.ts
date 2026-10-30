import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../store/api';
import { accessToken, supabase } from './auth';

export { ApiError };

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  return fetch('/api/admin' + path, { ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

export async function adminApi<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await authed(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection.', 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('admin:unauthenticated'));
    throw new ApiError(res.status, data.error ?? 'Something went wrong.', data.code, data.details);
  }
  return data as T;
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
  const html = await res.text();
  if (!res.ok) { win?.close(); throw new ApiError(res.status, 'Could not open the document'); }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  if (win) win.location.href = url; else window.location.href = url;
}

/** Upload a file straight to storage with a one-time signed link from the API. */
export async function uploadFile(bucket: 'covers' | 'ebooks' | 'resources', file: File) {
  const signed = await adminApi<{ url: string; token: string; path: string; publicUrl: string | null }>('/uploads', {
    body: { bucket, fileName: file.name, contentType: file.type || 'application/octet-stream', size: file.size },
  });
  if (supabase) {
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type });
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
