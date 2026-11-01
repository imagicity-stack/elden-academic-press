/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'true' shows the full site; anything else shows the coming-soon page. */
  readonly VITE_SITE_LIVE?: string;
  /** Supabase project URL and public (anon / publishable) key, for admin and customer sign-in. */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Google OAuth client ID for the "Sign in with Google" button on /account (public, not a secret). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
