import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool }    from 'pg';
import { config }  from 'dotenv';
import path        from 'path';
import * as schema from './schema';

// Load env here — db/index.ts is imported before dotenv runs in src/index.ts
// due to ES module import hoisting. This ensures DATABASE_URL is always set.
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
config({ path: path.resolve(process.cwd(), '.env') });

const DATABASE_URL = process.env.DATABASE_URL!;

if (!DATABASE_URL) {
  throw new Error(`DATABASE_URL is not set. Check your ${envFile} file.`);
}

const requiresSSL = DATABASE_URL.includes('sslmode=require') ||
                    DATABASE_URL.includes('neon.tech') ||
                    process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: DATABASE_URL,
  max:              10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ssl: requiresSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

export const db = drizzle(pool, {
  schema,
  logger: process.env.NODE_ENV !== 'production',
});

export { pool };
export type DB = typeof db;