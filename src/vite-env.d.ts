/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' shows the full site; anything else shows the coming-soon page. */
  readonly VITE_SITE_LIVE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
