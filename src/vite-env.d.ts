/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' shows the full site; anything else shows the coming-soon page. */
  readonly VITE_SITE_LIVE?: string;
  /** Supabase project URL and public (anon / publishable) key — used only for admin sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
