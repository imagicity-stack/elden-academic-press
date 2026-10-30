// Fill a Supabase database with starter data.
//   DATABASE_URL=… npm run db:seed            → the six standard categories
//   DATABASE_URL=… npm run db:seed -- --demo  → plus the sample catalogue, coupons and Study Hub list
//                                               (testing only: the sample e-book files are not uploaded)
import { connectPostgres } from '../server/db/client.js';
import { seedCategories, seedDemo } from '../server/db/seed.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to your Supabase connection string first.');
  process.exit(1);
}
const db = connectPostgres(url);
if (process.argv.includes('--demo')) await seedDemo(db);
else await seedCategories(db);
console.log('Seeded.');
process.exit(0);
