// Writes docs/supabase-setup.sql — run after `npm run db:generate`.
import { writeFileSync } from 'node:fs';
import { buildSetupSql } from '../server/db/setup-sql.js';

writeFileSync(new URL('../docs/supabase-setup.sql', import.meta.url), buildSetupSql());
console.log('Wrote docs/supabase-setup.sql');
