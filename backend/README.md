# Velion Mythera — Backend API

Node.js 20+ · Express · TypeScript · PostgreSQL 16 · Drizzle ORM · Socket.io 4

---

## First-time Setup

### 1. Copy environment file
```bash
cd backend
cp .env.example .env.development
```
Open `.env.development` and fill in:
- `DATABASE_URL` — replace `YOUR_PASSWORD` with your PostgreSQL password
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```
  Run it **twice** — one value per secret. They must be different.

### 2. Install dependencies
```bash
npm install
```

### 3. Generate and run database migrations
```bash
# Generate SQL migration files from the Drizzle schema
npm run db:generate

# Apply all migrations to your local velion_dev database
npm run db:migrate
```

### 4. Start the dev server
```bash
npm run dev
```
Server runs on **http://localhost:3001**

Health check: http://localhost:3001/health

---

## Running Both Services (from monorepo root)

```bash
# From velion-mythera/ (the monorepo root)
npm install          # installs concurrently
npm run dev          # starts frontend (5173) + backend (3001) simultaneously
```

Or in separate terminals:
```bash
# Terminal 1
npm run dev:frontend

# Terminal 2
npm run dev:backend
```

---

## Database Commands

| Command | What it does |
|---|---|
| `npm run db:generate` | Reads schema, generates SQL migration files in `./drizzle/` |
| `npm run db:migrate` | Applies pending migrations to the database |
| `npm run db:push` | Push schema directly (dev shortcut — skips migration files) |
| `npm run db:studio` | Opens Drizzle Studio GUI at http://localhost:4983 |

> **Workflow:** After changing any schema file, run `db:generate` then `db:migrate`.
> Commit the generated migration files in `./drizzle/` to version control.

---

## PostgreSQL Windows Setup (Quick Reference)

If you followed the README setup steps, you should have:
- PostgreSQL 16 installed via the official Windows installer
- Database `velion_dev` created in pgAdmin 4
- Connection string: `postgresql://postgres:YOUR_PASSWORD@localhost:5432/velion_dev`

**Test your connection:**
```bash
# In PowerShell or Command Prompt
psql -U postgres -d velion_dev -c "SELECT 1;"
```

---

## Stripe Setup (Dev)

1. Create a free account at https://stripe.com
2. Go to Dashboard → Developers → API Keys → copy the **test** Secret Key
3. Create two Products (one for Player tier, one for DM tier) with monthly prices
4. Copy the Price IDs into `.env.development`
5. For webhooks locally, install Stripe CLI: https://stripe.com/docs/stripe-cli
   ```bash
   stripe login
   stripe listen --forward-to localhost:3001/api/v1/billing/webhook
   ```
   The CLI will print a `whsec_...` webhook secret — add it to `.env.development`

---

## Cloudflare R2 Setup (Dev)

1. Go to https://dash.cloudflare.com → R2 → Create bucket named `velion-dev`
2. R2 → Manage R2 API Tokens → Create Token with Object Read & Write
3. Copy Account ID, Access Key ID, Secret Access Key into `.env.development`
4. In the bucket settings, enable public access and copy the Public URL

> **Note:** Portrait uploads and token art won't work until R2 is configured.
> The rest of the API (auth, characters, combat) works without R2.

---

## Project Structure

```
backend/
├── drizzle/                   # Generated SQL migration files (commit these)
├── drizzle.config.ts          # Drizzle Kit configuration
├── src/
│   ├── db/
│   │   ├── index.ts           # pg Pool + Drizzle client
│   │   ├── migrate.ts         # Migration runner script
│   │   └── schema/
│   │       ├── index.ts       # Re-exports all schema
│   │       ├── users.ts       # users, refresh_tokens, subscriptions
│   │       ├── characters.ts  # characters, equipment, gems, growth pool
│   │       ├── campaigns.ts   # campaigns, campaign_characters, invites
│   │       ├── sessions.ts    # sessions, encounters, participants, log
│   │       ├── library.ts     # weapons, armor, spell gems, enemies
│   │       └── world.ts       # maps, factions, journal, browser sources
│   ├── lib/
│   │   ├── rules.ts           # Rules engine — all SRD formulas, pure functions
│   │   ├── jwt.ts             # Sign/verify access + refresh tokens
│   │   ├── r2.ts              # Cloudflare R2 presigned URLs
│   │   └── stripe.ts          # Stripe checkout, portal, webhook
│   ├── middleware/
│   │   └── auth.ts            # requireAuth, requireDM, requirePaid
│   ├── routes/
│   │   ├── auth.ts            # /auth/* — register, login, refresh, logout
│   │   ├── characters.ts      # /characters/* — full CRUD + level-up + equipment
│   │   ├── campaigns.ts       # /campaigns/* — stub, next phase
│   │   ├── library.ts         # /library/* — weapons, armor, gems, enemies
│   │   ├── billing.ts         # /billing/* — Stripe checkout, portal, webhook
│   │   └── uploads.ts         # /tokens/upload-url — R2 presigned URLs
│   ├── socket/
│   │   └── session.ts         # Socket.io /session namespace — all combat events
│   └── index.ts               # Express app + HTTP server + Socket.io bootstrap
```

---

## API Base URL

Development: `http://localhost:3001/api/v1`
Production:  `https://velion-api.onrender.com/api/v1`

## Deploying to Render

1. Push to GitHub
2. Render Dashboard → New → Web Service → connect repo
3. Root Directory: `backend`
4. Build Command: `npm install && npm run build && npm run db:migrate`
5. Start Command: `node dist/index.js`
6. Set all environment variables from `.env.production`
7. Add Render Managed PostgreSQL → copy the connection string to `DATABASE_URL`
