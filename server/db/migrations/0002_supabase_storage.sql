-- Supabase-only setup (skipped automatically on other Postgres, e.g. local PGlite).
DO $$
BEGIN
  -- Tables created later start locked as well.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated';
  END IF;

  -- File storage: covers and Study Hub files are public; e-books are private
  -- and only ever served through short-lived signed links.
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
      ('covers', 'covers', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
      ('resources', 'resources', true, 52428800, ARRAY['application/pdf']),
      ('ebooks', 'ebooks', false, 314572800, ARRAY['application/pdf', 'application/epub+zip'])
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;
END $$;
