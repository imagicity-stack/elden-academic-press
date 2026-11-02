// Vercel's CDN keeps public store responses for a minute. Saving a product in the admin
// drops them at once, so the store shows the change on the next reload.
import { addCacheTag, dangerouslyDeleteByTag } from '@vercel/functions';

const CATALOG = 'catalog';

/** Mark this response as catalogue data (no-op outside Vercel). */
export const tagCatalog = () => addCacheTag(CATALOG).catch(() => {});

/** Drop every cached catalogue response (no-op outside Vercel). */
export async function clearCatalogCache() {
  try {
    await dangerouslyDeleteByTag(CATALOG);
  } catch (e) {
    console.warn('[cdn] could not clear the cached catalogue', e);
  }
}
