// The store's public settings (/api/config). No React here: the first script on the page (src/early.ts)
// needs them for the cookie switch, before the app has downloaded.
import { api } from './api';
import type { StoreConfig } from './types';

let configPromise: Promise<StoreConfig> | undefined;
/** The store's public settings, fetched once per page (index.html starts the download). */
export function loadStoreConfig(): Promise<StoreConfig> {
  configPromise ??= api<StoreConfig>('/config').catch((e) => { configPromise = undefined; throw e; });
  return configPromise;
}
