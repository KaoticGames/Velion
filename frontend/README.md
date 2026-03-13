# Velion Mythera — Frontend

React 18 + TypeScript + Vite frontend for the Velion Mythera VTT platform.

---

## Prerequisites

- Node.js 20+ (`node -v` to check)
- npm 10+ (ships with Node 20)

---

## First-time Setup

```bash
# 1. Clone / open in VSCode
cd velion-mythera

# 2. Install dependencies
npm install

# 3. Set up environment files
cp .env.example .env.development
# Edit .env.development if your backend runs on a port other than 3001
```

---

## Development

```bash
npm run dev
```

- Runs on **http://localhost:5173**
- Hot Module Replacement (HMR) enabled
- All `/api/*` and `/socket.io/*` calls proxied to `localhost:3001` (your backend)
- `VITE_ENABLE_MOCK_AUTH=true` by default — **no backend required** to use the character sheet
- A DEV MODE badge appears in the nav when mock auth is active
- The character sheet opens at `/characters/new` without logging in

### Dev workflow without a backend

1. `npm run dev`
2. Navigate to `http://localhost:5173/characters/new`
3. The full character sheet is immediately usable in local-state mode
4. A **DEV · SHEET STATUS** panel in the bottom-right shows connection state

### Dev workflow with the backend running

1. Start the API server: `cd ../velion-api && npm run dev` (port 3001)
2. Set `VITE_ENABLE_MOCK_AUTH=false` in `.env.development`
3. `npm run dev`
4. Register at `/register` → full auth + persistence flow active

---

## Production Build

```bash
# Build optimised bundle
npm run build

# Preview the production build locally (before deploying)
npm run preview
```

- `npm run build` outputs to `dist/`
- `npm run preview` serves the built output at **http://localhost:4173**
- Source maps are **disabled** in production (enable for staging in `vite.config.ts`)
- Vendor chunks are split for better CDN caching (React, Socket.io, etc.)

---

## Deploying to Render

1. Push to GitHub
2. In Render Dashboard → New → Static Site
3. Connect your repo
4. Build command: `npm run build`
5. Publish directory: `dist`
6. Set environment variables in Render (from `.env.production`):
   - `VITE_API_URL` → your Render backend URL + `/api/v1`
   - `VITE_SOCKET_URL` → your Render backend URL
   - `VITE_APP_NAME` → `Velion Mythera`
   - `VITE_ENABLE_MOCK_AUTH` → `false`
   - `VITE_ENABLE_DEV_TOOLS` → `false`

> **Important:** Never set `VITE_ENABLE_MOCK_AUTH=true` in production.
> All `VITE_*` variables are bundled into the client — they are not secrets.

---

## Project Structure

```
src/
├── styles/
│   └── globals.css              # Design tokens, resets, scrollbars
├── lib/
│   └── api.ts                   # Axios instance, JWT interceptors, silent refresh
├── store/
│   └── authStore.ts             # Zustand: user, accessToken, login/logout/hydrate
├── hooks/
│   ├── useCharacter.ts          # TanStack Query: character REST operations
│   └── useCombatSync.ts         # Socket.io: live combat HP/RP/state sync
├── components/
│   ├── Layout.tsx               # Root layout: NavBar + Outlet
│   ├── NavBar.tsx               # Sticky top nav with auth state
│   └── ProtectedRoute.tsx       # Auth guard (bypassed in dev mock mode)
├── pages/
│   ├── Landing.tsx              # Public hero + features + pricing
│   ├── Login.tsx                # Auth: email + password
│   ├── Register.tsx             # Auth: create account
│   ├── Characters.tsx           # Character list grid
│   ├── CharacterSheetPage.tsx   # Sheet wrapper (hooks + DEV overlay)
│   └── Stubs.tsx                # Campaigns, Library, Compendium, 404 stubs
├── character-sheet/
│   └── VelionCharacterSheet.jsx # The complete Velion Mythera character sheet
│                                # (OE DC fix applied; all other rules verified correct)
├── router.tsx                   # React Router v6 route definitions
├── App.tsx                      # QueryClient + auth hydration + RouterProvider
└── main.tsx                     # React root entry point
```

---

## Environment Variables Reference

| Variable | Dev default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001/api/v1` | Axios base URL |
| `VITE_SOCKET_URL` | `http://localhost:3001` | Socket.io connection URL |
| `VITE_API_URL_PROXY` | `http://localhost:3001` | Vite dev proxy target |
| `VITE_SOCKET_URL_PROXY` | `http://localhost:3001` | Vite WS proxy target |
| `VITE_APP_NAME` | `Velion Mythera [DEV]` | Browser tab title |
| `VITE_ENABLE_MOCK_AUTH` | `true` | Skip login in dev |
| `VITE_ENABLE_DEV_TOOLS` | `true` | Show DEV overlay on sheet page |

---

## Integration Roadmap

The character sheet (`VelionCharacterSheet.jsx`) currently runs in self-contained
local state. The integration phases from the SheetSpec are:

- **Phase 1** — Wire `useCharacter` data into sheet's `INIT_*` state on mount
- **Phase 2** — Build 3 library browser modals (Armor, Weapon, Gem)
- **Phase 3** — OE DC fix ✅ (already applied)
- **Phase 4** — Wire `useCombatSync` events to HP/RP/state during sessions
- **Phase 5** — Decompose sheet into sub-components per SheetSpec Section 7

---

## Rules Engine Note

All Velion Mythera formulae in `VelionCharacterSheet.jsx` are verified correct
against the SRD. The only fix applied at scaffold time was:

**Overextension DC** — changed from flat `DC 10` to the correct dynamic formula:
```
DC = 10 + (10 × OE_Amount ÷ Available_RP)   [clamped 10–20]
```
