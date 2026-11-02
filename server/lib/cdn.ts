// Vercel's CDN keeps public store responses for a minute. Saving a product in the admin
// drops them at once, so the store shows the change on the next reload.
//
// These are extras: whatever Vercel's helpers do (return nothing, throw, reject or never
// answer), the response still goes out, after at most a moment's wait.
import { addCacheTag, dangerouslyDeleteByTag } from '@vercel/functions';

const CATALOG = 'catalog';

function bounded(what: string, run: () => unknown, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => { console.warn(`[cdn] ${what}: no answer after ${ms} ms`); resolve(); }, ms);
    const done = () => { clearTimeout(timer); resolve(); };
    try {
      Promise.resolve(run()).catch((e) => console.warn(`[cdn] ${what} failed:`, (e as Error)?.message ?? e)).finally(done);
    } catch (e) {
      console.warn(`[cdn] ${what} failed:`, (e as Error)?.message ?? e);
      done();
    }
  });
}

/** Mark this response as catalogue data (no-op outside Vercel). */
export const tagCatalog = () => bounded('tagging the catalogue', () => addCacheTag(CATALOG), 1000);

/** Drop every cached catalogue response (no-op outside Vercel). */
export const clearCatalogCache = () => bounded('clearing the cached catalogue', () => dangerouslyDeleteByTag(CATALOG), 3000);
