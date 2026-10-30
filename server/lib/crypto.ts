import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret: string, data: string) => createHmac('sha256', secret).update(data).digest('hex');

/** Constant-time string comparison (safe for signatures and tokens). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
