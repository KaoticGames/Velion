import path from 'path';
import { config } from 'dotenv';

// Load the correct env file — dotenv/config only loads .env by default
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
// Fallback to plain .env if present
config({ path: path.resolve(process.cwd(), '.env') });
import { drizzle }  from 'drizzle-orm/node-postgres';
import { migrate }  from 'drizzle-orm/node-postgres/migrator';
import { Pool }     from 'pg';

async function runMigrations() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const db = drizzle(pool);

  console.log('[migrate] Running migrations...');
  const migrationsPath = path.join(__dirname, '../../drizzle');
  console.log('[migrate] Looking for migrations at:', migrationsPath);
  await migrate(db, {
    migrationsFolder: path.join(__dirname, '../../drizzle'),
  });
  console.log('[migrate] All migrations applied successfully.');

  await pool.end();
}

runMigrations().catch((err) => {
  console.error('[migrate] Migration failed:', err);
  process.exit(1);
});