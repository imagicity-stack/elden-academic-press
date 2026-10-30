// File storage: Supabase Storage in production; a local folder in development.
// Buckets: `covers` and `resources` are public; `ebooks` is private and only
// ever served through short-lived signed links.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { hmacHex, safeEqual } from './crypto';

export type Bucket = 'covers' | 'ebooks' | 'resources';
export const PUBLIC_BUCKETS: Bucket[] = ['covers', 'resources'];

export interface Storage {
  publicUrl(bucket: Bucket, path: string): string;
  /** A link that works for `seconds` and then expires. */
  signedDownloadUrl(bucket: Bucket, path: string, seconds: number, downloadName?: string): Promise<string>;
  /** A one-time URL the admin's browser uploads a file to directly. */
  signedUploadUrl(bucket: Bucket, path: string): Promise<{ url: string; token: string; path: string }>;
  remove(bucket: Bucket, path: string): Promise<void>;
}

export function supabaseStorage(url: string, serviceKey: string): Storage {
  const client: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    publicUrl: (bucket, path) => client.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    async signedDownloadUrl(bucket, path, seconds, downloadName) {
      const { data, error } = await client.storage.from(bucket).createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);
      if (error || !data) throw new Error(error?.message ?? 'Could not sign download');
      return data.signedUrl;
    },
    async signedUploadUrl(bucket, path) {
      const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) throw new Error(error?.message ?? 'Could not sign upload');
      return { url: data.signedUrl, token: data.token, path: data.path };
    },
    async remove(bucket, path) {
      await client.storage.from(bucket).remove([path]);
    },
  };
}

/**
 * Development storage in a local folder, served by the dev API under
 * /api/dev-files. Links are HMAC-signed with an expiry like the real thing.
 */
export function localStorage(root: string, baseUrl: string, secret = 'local-storage-secret'): Storage & {
  verify(bucket: string, path: string, exp: string, sig: string): boolean;
  write(bucket: Bucket, path: string, data: Uint8Array): Promise<void>;
  root: string;
} {
  const sign = (bucket: string, path: string, exp: string) => hmacHex(secret, `${bucket}/${path}:${exp}`);
  const file = (bucket: string, path: string) => join(root, bucket, path);
  return {
    root,
    publicUrl: (bucket, path) => `${baseUrl}/api/dev/files/${bucket}/${path}`,
    async signedDownloadUrl(bucket, path, seconds) {
      const exp = String(Date.now() + seconds * 1000);
      return `${baseUrl}/api/dev/files/${bucket}/${path}?exp=${exp}&sig=${sign(bucket, path, exp)}`;
    },
    async signedUploadUrl(bucket, path) {
      const exp = String(Date.now() + 2 * 3600_000);
      const token = `${exp}.${sign(bucket, path, exp)}`;
      return { url: `${baseUrl}/api/dev/files/${bucket}/${path}?upload=${token}`, token, path };
    },
    async remove() { /* keep local files */ },
    verify(bucket, path, exp, sig) {
      return Number(exp) > Date.now() && safeEqual(sign(bucket, path, exp), sig);
    },
    async write(bucket, path, data) {
      const f = file(bucket, path);
      await mkdir(dirname(f), { recursive: true });
      await writeFile(f, data);
    },
  };
}
