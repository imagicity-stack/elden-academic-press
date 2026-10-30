-- Security: every store table is reachable only through the server API.
-- Row Level Security is switched on with no policies, so Supabase's public
-- (anon / authenticated) API keys can read or write nothing here. The server
-- connects as the database owner, which bypasses RLS.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
