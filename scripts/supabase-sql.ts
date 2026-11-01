// Writes docs/supabase-setup.sql and docs/supabase-updates/*.sql — run after `npm run db:generate`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSetupSql, buildUpdateSqls } from '../server/db/setup-sql.js';

writeFileSync(new URL('../docs/supabase-setup.sql', import.meta.url), buildSetupSql());
mkdirSync(new URL('../docs/supabase-updates/', import.meta.url), { recursive: true });
for (const u of buildUpdateSqls()) writeFileSync(new URL(`../docs/supabase-updates/${u.tag}.sql`, import.meta.url), u.sql);
console.log('Wrote docs/supabase-setup.sql and docs/supabase-updates/');
