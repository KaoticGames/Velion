import path from 'path';
import { config } from 'dotenv';

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
config({ path: path.resolve(process.cwd(), envFile) });
config({ path: path.resolve(process.cwd(), '.env') });
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema:    './src/db/schema/index.ts',
  out:       './drizzle',
  dialect:   'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict:  true,
});