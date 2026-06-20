# MFAPI — India Mutual Fund Data API + Explorer

A free, public REST API for Indian mutual fund schemes and their NAV history,
plus a Swagger-style web explorer for it. Data is sourced from
[mfapi.in](https://api.mfapi.in), seeded into a local SQLite database (~37,000
schemes, 5-year NAV history), and served via a Fastify REST API. The same API
runs unchanged on Postgres/Supabase in production.

**Goal / end state:** push to GitHub → migrate data to Supabase → deploy on
Vercel as a single project → public API that anyone can use, with a hosted
explorer UI. See [DEPLOYMENT.md](DEPLOYMENT.md) for the step-by-step.

---

## The one mental model that explains everything

There are **two deploy artifacts in one repo, one Vercel project**:

```
                  your-app.vercel.app
                  ├── /            → frontend explorer (static files)
                  └── /api/*       → Fastify API (serverless function)
                                        │
                                        └─► database (SQLite OR Postgres)
```

**Database backend is chosen by ONE env var — `DATABASE_URL`:**

| `DATABASE_URL` | Backend | Driver module | Where |
|---|---|---|---|
| _unset_ | SQLite (`./mfapi.db`) | `node:sqlite` | local dev |
| set | Postgres | `pg` | production / Vercel (Supabase) |

Nothing else in the code changes between the two. The routes call a single
async adapter; the adapter picks the backend at startup. This is the "change
one config value and everything works" design the project is built around.

**Frontend → API base URL is also ONE value — `VITE_API_URL`, default `/api`:**
- Dev: explorer calls `/api/*`, Vite proxy forwards to `localhost:3001`.
- Prod: explorer calls `/api/*`, Vercel routes to the serverless function.
- Same-origin in prod → **no CORS needed**. Override `VITE_API_URL` only if the
  API is hosted on a different origin (e.g. Render/Railway).

---

## Project Layout

```
MFAPI/
├── api/                          ← Fastify REST API + SQLite pipeline (Node.js 22 ESM)
│   ├── app.js                    ← Fastify app FACTORY (build()), no .listen — shared
│   ├── server.js                 ← Local/always-on entry: build() + listen(:3001)
│   ├── vercel.js                 ← Vercel serverless handler: strips /api, emits to Fastify
│   ├── openapi.js                ← Hand-maintained OpenAPI 3.1 spec (served at /openapi.json)
│   ├── db/
│   │   ├── index.js              ← DB ADAPTER (SQLite vs Postgres by DATABASE_URL) ← routes use this
│   │   ├── client.js             ← Raw SQLite handle (used ONLY by seed.js + migrate source)
│   │   ├── schema.sql            ← SQLite schema
│   │   └── schema.postgres.sql   ← Postgres/Supabase schema (run once before migrate)
│   ├── pipeline/
│   │   ├── seed.js               ← Full NAV seed from mfapi.in → SQLite (raw, sync)
│   │   └── migrate-to-supabase.js← One-time SQLite → Postgres data copy (npm run migrate)
│   ├── routes/
│   │   ├── fund-houses.js        ← GET /fund-houses
│   │   ├── categories.js         ← GET /categories
│   │   └── schemes.js            ← GET /schemes, /schemes/:code, /:code/nav, /:code/nav/latest
│   ├── mfFileMapper.csv          ← 6,778 rows: ISIN (scheme_code), Name
│   ├── mfHouseMapper.csv         ← 42 rows: fund house Name, UniqueCode
│   ├── mfTypeMapper.csv          ← 43 rows: SchemeType, UniqueCode
│   ├── mfapi.db                  ← SQLite database (gitignored, ~900 MB when seeded)
│   ├── package.json
│   └── .env.example
├── frontend/                     ← Swagger-style API explorer (React + Vite + TS + Tailwind)
│   ├── index.html
│   ├── vite.config.ts            ← dev proxy /api → :3001 (strips /api prefix)
│   ├── tailwind.config.js / postcss.config.js
│   ├── tsconfig.json / tsconfig.node.json
│   ├── .env.example
│   └── src/
│       ├── main.tsx, App.tsx, index.css, vite-env.d.ts
│       ├── types.ts              ← minimal OpenAPI + result types
│       ├── lib/api.ts            ← API_BASE, buildUrl(), sendRequest(), checkHealth()
│       ├── hooks/useOpenApi.ts   ← loads /openapi.json, flattens into tag-grouped endpoints
│       └── components/
│           ├── Header.tsx        ← title + base URL + live health dot (polls /health)
│           ├── EndpointGroup.tsx ← one section per OpenAPI tag
│           ├── EndpointCard.tsx  ← method badge + path + expand + example response
│           ├── TryItPanel.tsx    ← param inputs → URL preview → Run → response
│           └── ResponseView.tsx  ← status/timing/copy + pretty JSON
├── vercel.json                   ← single-project: builds api fn + frontend static, routes /api/*
├── DEPLOYMENT.md                 ← full deploy walkthrough (local → Supabase → Vercel)
├── Python_Old_Code/ , OLD_CODE.zip ← legacy, ignore
└── CLAUDE.md                     ← this file
```

---

## Tech Stack

- **Backend**: Node.js 22 ESM (`"type": "module"`), Fastify v4, `@fastify/cors`.
  - Local DB: `node:sqlite` (built-in `DatabaseSync`, needs `--experimental-sqlite` flag).
  - Prod DB: `pg` (node-postgres) → Supabase.
- **Frontend**: React 18, Vite 5, TypeScript (strict), Tailwind CSS v3. No router
  (single page), no data-fetching lib (plain `fetch`).
- **Data source**: [mfapi.in](https://api.mfapi.in).
- **Deployment**: single Vercel project (static frontend + serverless API).

---

## Backend architecture details

### The DB adapter — `api/db/index.js` (the heart of the design)
Exports a single object `sql` with **async** methods:
- `sql.all(text, params)` → array of rows
- `sql.get(text, params)` → first row (or `undefined`)
- `sql.driver` → `'sqlite'` | `'postgres'` (surfaced in `/health`)

Chosen at startup via top-level `await`:
- **SQLite adapter**: dynamically imports `node:sqlite`, opens `DB_PATH` (default
  `./mfapi.db`), sets WAL + foreign_keys + synchronous PRAGMAs, caches prepared
  statements by SQL text, wraps sync `.all()/.get()` in async.
- **Postgres adapter**: dynamically imports `pg`, makes a `Pool` with
  `ssl: { rejectUnauthorized: false }` (Supabase requires SSL), and **rewrites `?`
  placeholders → `$1, $2, …`** before querying.

**Why this matters for writing routes:** write SQL **once**, using `?`
placeholders, in a form portable to both engines. Pass params as a positional
array. The adapter handles the dialect difference. The existing route SQL already
respects this (`LOWER(...) LIKE LOWER(?)` works on both; `?` count must equal the
params array length — including repeated `?` for the `(? IS NULL OR col = ?)`
filter pattern).

`node:sqlite` is imported **only** when `DATABASE_URL` is unset, so Vercel
(which always sets it) never needs the experimental flag.

### App factory split (for serverless)
- `app.js` exports `build()` → configured Fastify instance, **no `.listen()`**.
  Registers CORS (`origin:'*'`), the three route plugins (with prefixes), `/health`,
  and `/openapi.json`.
- `server.js` (local): `await build()` then `.listen(:3001)`.
- `vercel.js` (prod): builds once per warm container, `await app.ready()`, and on
  each request **strips the leading `/api`** from `req.url` then
  `app.server.emit('request', req, res)`. This is why Fastify routes are defined
  *without* an `/api` prefix — the prefix is purely an edge-routing concern
  (handled by the Vite proxy in dev and `vercel.js` in prod).

### OpenAPI spec — `api/openapi.js`
Hand-written OpenAPI 3.1 object served at `GET /openapi.json`. The frontend
renders this directly, so **the docs never drift from the code — but they are NOT
auto-generated. When you add/change a route, update `openapi.js` by hand.** Tags:
`Meta`, `Fund Houses`, `Categories`, `Schemes` (this order drives the UI grouping).

---

## Database Schema

Identical shape in SQLite (`db/schema.sql`) and Postgres (`db/schema.postgres.sql`).
Key portability choice: **`nav_date` and `last_synced_at` are stored as TEXT**
(`YYYY-MM-DD` / `YYYY-MM-DD HH:MM:SS`) in both, so lexical date comparisons and
JSON response shapes are byte-identical across backends.

```sql
fund_houses        (id PK, name UNIQUE)
scheme_categories  (id PK, name UNIQUE, broad_category)        -- broad_category e.g. "Equity Scheme"
schemes            (scheme_code PK, scheme_name, fund_house_id→fund_houses,
                    scheme_category_id→scheme_categories, isin_growth,
                    isin_div_reinvestment, last_synced_at)
nav_history        (scheme_code→schemes ON DELETE CASCADE, nav_date, nav,
                    PRIMARY KEY (scheme_code, nav_date))        -- nav REAL/double precision
```

`broad_category` is derived by splitting `scheme_type` on ` - `
(`"Equity Scheme - Large Cap Fund"` → `"Equity Scheme"`). Known broad values:
`Equity Scheme`, `Debt Scheme`, `Hybrid Scheme`, `Solution Oriented Scheme`,
`Other Scheme`, `Exchange Traded Fund`.

---

## API Endpoints

Base path is `/api` in production (Vercel) and dev (via proxy); the Fastify
server itself serves them unprefixed on `localhost:3001`.

```
GET /health
→ { status: 'ok', driver: 'sqlite' | 'postgres' }

GET /openapi.json
→ OpenAPI 3.1 spec object

GET /fund-houses
→ { data: [{ id, name }] }                          -- ordered by name

GET /categories
→ { data: [{ id, name, broad_category }] }           -- ordered by broad_category, name

GET /schemes?q=&fund_house_id=&category_id=&broad_category=&page=1&limit=20
→ { total, page, limit, data: [{ scheme_code, scheme_name, fund_house, category, broad_category }] }
   - all filters optional + combinable; q is case-insensitive substring; pagination 1-based

GET /schemes/:code
→ { data: { scheme_code, scheme_name, isin_growth, isin_div_reinvestment,
            last_synced_at, fund_house_id, fund_house, category_id, category, broad_category } }
   - 404 { error: 'Scheme not found' }

GET /schemes/:code/nav?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
→ { scheme_code, data: [{ nav_date, nav }] }         -- newest first; dates optional
   - 404 { error: 'No NAV data found' }

GET /schemes/:code/nav/latest
→ { scheme_code, nav_date, nav }
   - 404 { error: 'No NAV data found' }
```

---

## Frontend (explorer) details

Single-page React app. On load, `useOpenApi()` fetches `${API_BASE}/openapi.json`
and flattens `paths` into tag-grouped `Endpoint` objects (`{ method, path, op }`),
preserving the spec's `tags` order. Each endpoint renders as an `EndpointCard`
(collapsed by default). Expanding shows the description, a `TryItPanel`
(generates inputs from the operation's `parameters`, seeds them from
`example`/`default`, builds a live URL preview, fires the request via `fetch`,
and shows status/timing/JSON via `ResponseView`), and the spec's example response.

`API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')`.
The header polls `/health` every 15s for the online/offline dot and driver label.

**No backend coupling beyond the spec:** the UI is fully driven by
`/openapi.json`. Add a route + document it in `openapi.js` and it appears in the
explorer automatically.

---

## Running Locally

```bash
# Terminal A — API (SQLite, default)
cd api
cp .env.example .env            # leave DATABASE_URL UNSET for SQLite
npm install
npm run seed -- --limit 50      # quick test seed; or `npm run seed` for full ~37k (hours)
npm run dev                     # http://localhost:3001  (node --experimental-sqlite --watch)

# Terminal B — Explorer
cd frontend
cp .env.example .env            # defaults fine (VITE_API_URL=/api)
npm install
npm run dev                     # http://localhost:5173  (proxies /api → :3001)
```

### npm scripts
- **api**: `dev` (watch), `start` (prod), `seed`, `seed:force`, `migrate` (SQLite→Postgres).
  All sqlite-touching scripts pass `--experimental-sqlite`.
- **frontend**: `dev`, `build` (`tsc -b && vite build`), `preview`.

---

## Environment Variables

### `api/.env`
| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | _unset_ | **The switch.** Unset → SQLite; set → Postgres/Supabase. |
| `DB_PATH` | `./mfapi.db` | SQLite file path (used only when `DATABASE_URL` unset) |
| `PORT` | `3001` | API server port (local/always-on) |
| `PG_POOL_MAX` | `5` | Postgres pool size |
| `CONCURRENCY` | `8` | Parallel mfapi.in fetches in seed.js (≤ ~15) |
| `NAV_YEARS` | `5` | Years of NAV history to seed |
| `MFAPI_BASE` | `https://api.mfapi.in` | mfapi.in base URL |

### `frontend/.env`
| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `/api` | API base. Same-origin default works in dev+prod. Set to a full URL only if API is on another origin. |
| `VITE_DEV_API_TARGET` | `http://localhost:3001` | Where the dev Vite proxy forwards `/api` |

---

## Seed Pipeline Notes (`pipeline/seed.js`)

- Talks **directly** to raw SQLite (`db/client.js`), synchronous prepared
  statements — it is a **local-only** tool and intentionally NOT routed through
  the async adapter.
- **Resumable**: skips schemes already present in `nav_history` (unless `--force`).
- **Atomic per-scheme**: scheme metadata + all NAV rows in one transaction.
- **Rate limiting**: exponential backoff on 429s (1s→2s→4s→8s), `CONCURRENCY` pool.
- **Date formats**: mfapi.in returns `"DD-Mon-YYYY"` or `"DD-MM-YYYY"`;
  `parseDate()` normalizes to `YYYY-MM-DD`.
- **CSV pre-seeding**: `mfFileMapper.csv` seeds 6,778 scheme names before the slow
  API sync; `mfHouseMapper.csv` + `mfTypeMapper.csv` seed lookup tables.
- `--limit N` caps schemes for a quick test run.

---

## Deployment (summary — full guide in DEPLOYMENT.md)

1. **Seed locally** (`npm run seed`) to build `mfapi.db`.
2. **Create Supabase project**; copy the Transaction-pooler connection string (port 6543).
3. **Create tables**: run `api/db/schema.postgres.sql` in the Supabase SQL editor.
4. **Migrate data**: set `DATABASE_URL` in `api/.env`, then `cd api && npm run migrate`.
5. **Push to GitHub**, import into Vercel (root = repo root; `vercel.json` builds both).
6. **Set `DATABASE_URL`** in Vercel env vars. Deploy.

Result: `your-app.vercel.app/` (explorer) + `your-app.vercel.app/api/*` (public API).

### Known caveats / gotchas
- **SQLite cannot run on Vercel** (ephemeral, read-only FS). Production **requires**
  `DATABASE_URL`. Without it the function boots but every data endpoint errors.
- **`openapi.json` is hand-maintained.** Update it when routes change.
- **The Vercel serverless wiring** (`@vercel/node` + `/api` prefix strip in
  `vercel.js`) is standard but has only been validated by reasoning/local Fastify
  tests — it is fully exercised only on an actual Vercel deploy or via `vercel dev`.
- **Cold starts**: first request to a cold serverless container is slower.
- The seed produces a ~900 MB `mfapi.db`; it is gitignored — do not commit it.

---

## Verified working (as of last build)
- Frontend: `npm run build` passes (tsc strict + vite build).
- API on SQLite: `/health` → `{driver:'sqlite'}`, `/openapi.json`, `/fund-houses`,
  `/schemes?q=hdfc` (total 3301), `/schemes/119551/nav/latest` all return correctly.
- NOT yet exercised end-to-end: Postgres adapter against a real Supabase instance,
  and the live Vercel serverless deploy.
