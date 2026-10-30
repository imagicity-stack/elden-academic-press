// Small fetch wrapper for the store API.

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string, readonly details?: unknown) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'You seem to be offline. Check your connection and try again.', 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong. Please try again.', data.code, data.details);
  return data as T;
}

/** First message for a field from a 400 response's `details`. */
export function fieldError(err: unknown, ...path: string[]): string | undefined {
  if (!(err instanceof ApiError) || !err.details || typeof err.details !== 'object') return undefined;
  const v = (err.details as Record<string, unknown>)[path[0]];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return undefined;
}

/** A readable message for any error from the API (lists field problems). */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === 'invalid' && e.details && typeof e.details === 'object') {
    return [...new Set(Object.values(e.details as Record<string, string[]>).flat())].join(' · ') || e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

/** ₹ from paise. */
export function inr(paise: number): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 });
}
