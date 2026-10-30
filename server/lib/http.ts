import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Q } from '../db/client';
import { rateLimits } from '../db/schema';

export class HttpError extends Error {
  constructor(readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 502 | 503, message: string, readonly code?: string, readonly details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what, 'not_found');

/** Parse and validate a JSON body; 400 with field errors on failure. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const raw = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'Please check the highlighted fields.', 'invalid', z.flattenError(parsed.error).fieldErrors);
  }
  return parsed.data;
}

export function query<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) throw new HttpError(400, 'Invalid query', 'invalid', z.flattenError(parsed.error).fieldErrors);
  return parsed.data;
}

/** Client IP as reported by Vercel's edge (falls back for local dev). */
export function clientIp(c: Context): string {
  return c.req.header('x-real-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
}

/**
 * Fixed-window rate limit stored in Postgres (works across serverless
 * instances). Throws 429 when `limit` is exceeded within `windowSeconds`.
 */
export async function rateLimit(db: Q, key: string, limit: number, windowSeconds: number) {
  const [row] = await db.insert(rateLimits)
    .values({ key, windowStart: sql`now()`, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({ count: rateLimits.count });
  if (row.count > limit) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.', 'rate_limited');
}

// Shared field validators
export const zEmail = z.string().trim().toLowerCase().max(200).pipe(z.email('Enter a valid email address'));
/** Indian mobile number, stored as 10 digits. */
export const zPhone = z.string().trim().transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|0)/, '')).pipe(
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number'),
);
export const zPincode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit PIN code');
export const zText = (max: number) => z.string().trim().max(max);
export const zName = z.string().trim().min(2, 'Enter your name').max(120);
