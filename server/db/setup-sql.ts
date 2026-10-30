// One script that sets up a new Supabase database from the dashboard's SQL
// Editor: every migration, the standard categories, and the migration history
// (so a later `npm run db:migrate` only applies newer migrations).
// Regenerate docs/supabase-setup.sql with `npm run db:setup-sql`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './client.js';
import { STANDARD_CATEGORIES } from './seed.js';

const HEADER = `-- Elden Academic Press — database setup for Supabase
--
-- Run this ONCE on a new Supabase project:
--   Supabase dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It creates the store's tables, locks them against Supabase's public API keys
-- (the store's server is the only thing that reads them), creates the storage
-- buckets for covers, Study Hub files and e-books, and adds the standard categories.
-- Everything runs as one transaction: if anything fails, nothing is changed.
-- "already exists" errors mean the database has already been set up.
--
-- Generated from server/db/migrations by \`npm run db:setup-sql\` — do not edit.
`;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildSetupSql(dir = MIGRATIONS_DIR): string {
  const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };
  const migrations = journal.entries.map((m) => {
    const sql = readFileSync(join(dir, `${m.tag}.sql`), 'utf8');
    return { ...m, sql, hash: createHash('sha256').update(sql).digest('hex') };
  });
  return [
    HEADER,
    ...migrations.map((m) => `-- ===== ${m.tag} =====\n\n${m.sql.trim()}\n`),
    `-- ===== Migration history =====

CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES
${migrations.map((m) => `  (${lit(m.hash)}, ${m.when})`).join(',\n')};
`,
    `-- ===== Standard categories (rename or add more in the admin) =====

INSERT INTO categories (name, slug, sort) VALUES
${STANDARD_CATEGORIES.map((c) => `  (${lit(c.name)}, ${lit(c.slug)}, ${c.sort})`).join(',\n')}
ON CONFLICT (slug) DO NOTHING;
`,
  ].join('\n');
}
