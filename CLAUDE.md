# Market Data API — Indian Mutual Funds + NAV History

A free, public REST API for Indian mutual fund schemes and their NAV history,
plus a Swagger-style web explorer. Data is seeded from [mfapi.in](https://api.mfapi.in)
into a local SQLite database (~14,583 schemes, 6-year NAV history), then
migrated to CockroachDB Serverless for production. The API is served via Fastify
and runs unchanged on both SQLite and Postgres.

**Goal / end state:** GitHub → CockroachDB (data) → Vercel (deploy) → public API + hosted explorer.

---

## The one mental model that explains everything

```
              your-app.vercel.app
              ├── /            → frontend explorer (static files from frontend/dist)
              └── /api/*       → Fastify API (serverless function: api/vercel.js)
                                    │
                                    └─► CockroachDB Serverless (prod) OR SQLite (dev)
```

**Database backend is chosen by ONE env var — `DATABASE_URL`:**

| `DATABASE_URL` | Backend | Where |
|---|---|---|
| _unset_ | SQLite (`./market-data-api.db`) | local dev |
| set | Postgres via `pg` | production / Vercel / CockroachDB |

**Frontend → API base URL: `VITE_API_URL` (default `/api`)**
- Dev: Vite proxies `/api/*` → `localhost:3001` (strips `/api` prefix).
- Prod: same-origin Vercel routing → no CORS needed.

---

## Project Layout

```
market-data-api/
├── package.json                  ← root-only: "vercel-build" script for @vercel/static-build
├── vercel.json                   ← single Vercel project: builds api fn + frontend, routes /api/*
├── .github/
│   └── workflows/
│       ├── sync-nav.yml          ← GitHub Actions cron: POST /api/sync-nav 5× per day (IST)
│       └── archive-nav.yml       ← Daily 11:30 PM IST: commit NAVAll.txt → nav-archive/ (DR backup)
├── nav-archive/                  ← dated raw NAVAll.txt snapshots (DD-MM-YYYY.txt) for rebuild
├── scripts/
│   └── seed-axiom.js             ← fires ~31 sample requests to populate the Axiom dataset
├── api/                          ← Fastify REST API (Node.js 22 ESM)
│   ├── app.js                    ← Fastify FACTORY: build(); CORS + rate-limit + error handler + Axiom hook
│   ├── server.js                 ← Local dev entry: build() + .listen(:3001)
│   ├── vercel.js                 ← Vercel handler: strips /api prefix, emits to Fastify
│   ├── openapi.js                ← Hand-maintained OpenAPI 3.1 spec (GET /openapi.json)
│   ├── db/
│   │   ├── index.js              ← DB ADAPTER — sql.all/get/run; SQLite or Postgres by DATABASE_URL
│   │   ├── client.js             ← Raw DatabaseSync handle (seed.js only)
│   │   ├── schema.sql            ← SQLite schema + indexes
│   │   └── schema.postgres.sql   ← Postgres schema + pg_trgm + indexes (run once in CockroachDB)
│   ├── lib/
│   │   ├── finance.js            ← Pure financial math (CAGR, rolling returns, Sharpe, SIP/XIRR)
│   │   └── queries.js            ← Shared data-access layer (SQL + shaping); used by REST routes AND MCP
│   ├── pipeline/
│   │   ├── seed.js               ← Seeds SQLite from mfapi.in (~14k schemes, resumable)
│   │   ├── migrate-to-supabase.js← Legacy — one-time SQLite → Supabase copy (deprecated)
│   │   ├── migrate-to-cockroach.js← One-time SQLite → CockroachDB copy (BATCH=5000, idempotent)
│   │   └── prune.js              ← Removes nav_history rows older than NAV_YEARS
│   ├── routes/
│   │   ├── fund-houses.js        ← GET /fund-houses
│   │   ├── categories.js         ← GET /categories
│   │   ├── schemes.js            ← GET /schemes, /schemes/:code, /schemes/isin/:isin,
│   │   │                            /:code/nav, /:code/nav/latest
│   │   ├── analytics.js          ← GET /:code/returns, /rolling, /risk, /sip
│   │   ├── sync.js               ← POST /sync-nav (AMFI NAV sync, bearer-auth)
│   │   └── mcp.js                ← POST /mcp — MCP server (Streamable HTTP) for AI agents; see MCP.md
│   ├── test/
│   │   └── finance.test.js       ← Node test runner unit tests for lib/finance.js
│   ├── mfFileMapper.csv          ← 6,778 scheme name mappings
│   ├── mfHouseMapper.csv         ← 42 fund houses
│   ├── mfTypeMapper.csv          ← 43 scheme categories
│   ├── market-data-api.db        ← SQLite DB (gitignored, ~1 GB seeded with 6yr history)
│   ├── package.json
│   └── .env.example
├── frontend/                     ← React 18 + Vite 5 + TypeScript + Tailwind v3
│   ├── index.html
│   ├── vite.config.ts            ← dev proxy /api → :3001
│   ├── .env.example
│   ├── public/
│   │   └── excel-addin/
│   │       ├── google-sheets.js  ← Apps Script custom fns (MF_NAV, MF_DAILY_CHANGE, …) — supported
│   │       └── functions.{js,json,html}, manifest.xml  ← Excel add-in variant (abandoned)
│   └── src/
│       ├── types.ts              ← OpenAPI + result types
│       ├── lib/api.ts            ← API_BASE, buildUrl(), sendRequest(), checkHealth()
│       ├── hooks/useOpenApi.ts   ← fetches /openapi.json, groups by tag
│       └── components/
│           ├── Header.tsx        ← title + health dot (polls /health every 15s)
│           ├── EndpointGroup.tsx ← one section per tag
│           ├── EndpointCard.tsx  ← method + path + example response
│           ├── TryItPanel.tsx    ← param inputs → URL preview → Run → response
│           └── ResponseView.tsx  ← status / timing / copy / JSON
├── DEPLOYMENT.md
├── MCP.md                        ← MCP server design + status (AI-agent access to the data)
└── CLAUDE.md                     ← this file
```

---

## Tech Stack

- **Backend**: Node.js 22 ESM, Fastify v4, `@fastify/cors`, `@fastify/rate-limit`
  - Dev DB: `node:sqlite` (`DatabaseSync`, `--experimental-sqlite`)
  - Prod DB: `pg` (node-postgres) → CockroachDB Serverless (PostgreSQL wire-compatible)
- **Frontend**: React 18, Vite 5, TypeScript (strict), Tailwind CSS v3. No router, no fetch lib.
- **Data**: [mfapi.in](https://api.mfapi.in) (initial seed); [AMFI NAVAll.txt](https://portal.amfiindia.com/spages/NAVAll.txt) (daily sync)
- **Deployment**: Vercel (static frontend + serverless API function), CockroachDB Serverless (Postgres)

---

## Backend Architecture

### DB Adapter — `api/db/index.js`

The heart of the design. Exports `sql` with three async methods:

```js
sql.all(text, params)  // → array of rows
sql.get(text, params)  // → first row or undefined
sql.run(text, params)  // → { changes: N }  (INSERT/UPDATE/DELETE)
sql.driver             // → 'sqlite' | 'postgres'
```

Chosen at startup via top-level `await`. Both adapters:
- Accept `?` placeholders — the Postgres adapter rewrites them to `$1, $2, …`
- **Write all SQL once, portable to both engines**

SQLite adapter: `DatabaseSync` + WAL + FK + synchronous=NORMAL PRAGMAs + prepared-statement cache.
Postgres adapter: `pg.Pool` + `ssl: { rejectUnauthorized: false }` + `pg.types.setTypeParser(1082, val => val)` to return DATE columns as `'YYYY-MM-DD'` strings instead of JS Date objects.

`node:sqlite` is dynamically imported only when `DATABASE_URL` is unset — Vercel never needs `--experimental-sqlite`.

**CockroachDB quirk:** integer columns (e.g. `scheme_code`) are returned as **strings** (`"101762"` not `101762`) by the `pg` driver against CockroachDB. This is known CockroachDB behavior and is non-breaking — all routes treat scheme_code as an opaque identifier.

### App Factory Split

- `app.js`: `build()` → Fastify instance, no `.listen()`. Registers CORS, **rate limiting**, **a global error handler**, all route plugins (including `analytics.js` at `/schemes` prefix), `/health`, `/openapi.json`, and the **Axiom analytics hook**. Built with `trustProxy: true` so `req.ip` resolves to the real client IP behind Vercel's proxy.
- `server.js`: local dev — `build()` + `.listen(3001)`.
- `vercel.js`: Vercel serverless — builds once per warm container, strips `/api` prefix from `req.url`, then `app.server.emit('request', req, res)`.

Fastify routes are defined **without** `/api` prefix. The prefix is a routing concern only (Vite proxy in dev, `vercel.js` in prod).

### Rate Limiting, Error Handling & Input Bounds

These three hardening layers live in `app.js` and `routes/schemes.js`:

- **Rate limiting** (`@fastify/rate-limit`, registered in `app.js`): default **2500 requests/min per client IP**, tunable via `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` env vars (no code change needed). Over-limit → `429`. The store is **in-memory**, so on Vercel it is *per-warm-container* — it throttles single-source bursts but is **not** a hard global cap (would need a Redis store for that). Keying relies on `trustProxy: true`.
- **Global error handler** (`app.setErrorHandler` in `app.js`): **5xx** errors are logged server-side and returned as a generic `{ error: 'Internal Server Error' }` (prevents SQL/schema/connection-string leakage). **4xx** errors keep their real message (e.g. `404 { error: 'Scheme not found' }`, `429` rate-limit message) since those are safe and useful.
- **Pagination clamps** (`routes/schemes.js`): `limit` is clamped to `[1, 100]` (`MAX_LIMIT=100`, `DEFAULT_LIMIT=20`); `page` is floored to `>= 1`. Handles `NaN` (`?limit=abc` → 20) and negatives (`?page=-5` → 1), preventing unbounded result sets and negative-OFFSET 500s.

### Route: POST /sync-nav (`api/routes/sync.js`)

Fetches AMFI's `NAVAll.txt` (one HTTP call, ~1 MB), parses semicolon-delimited lines, filters to known `scheme_code`s, and batch-upserts in CHUNK=500 rows with `ON CONFLICT(scheme_code, nav_date) DO NOTHING`.

Auth: `Authorization: Bearer <SYNC_NAV_SECRET>`. If `SYNC_NAV_SECRET` is unset, auth is disabled.

Returns: `{ nav_date, parsed, inserted, skipped }`.

### Analytics Routes — `api/routes/analytics.js` + `api/lib/finance.js`

Four derived-metric endpoints registered at `/schemes/:code/*`. All read from `nav_history`, compute in-process, return JSON. No writes.

- **`GET /schemes/:code/returns`** — trailing returns (1W/1M/3M/6M/1Y/2Y/3Y/5Y/max) + since-inception CAGR.
- **`GET /schemes/:code/rolling?window=3Y&beat=12`** — rolling-window CAGR distribution; optional `beat` param (in % annualised) returns fraction of windows that beat the threshold.
- **`GET /schemes/:code/risk?rf=6`** — annualised volatility, max drawdown, Sharpe ratio (risk-free rate `rf` in %, default 6).
- **`GET /schemes/:code/sip?amount=5000&from=YYYY-MM-DD&to=YYYY-MM-DD`** — monthly SIP simulation: total invested, current value, absolute gain, XIRR.

Pure math lives in `lib/finance.js` (no I/O, trivially unit-testable). Tests in `api/test/finance.test.js` (Node built-in test runner: `npm test`).

### MCP Server — `api/routes/mcp.js` (+ `api/lib/queries.js`)

Exposes the read-only data to AI agents over the Model Context Protocol at `POST /mcp`
(public `/api/mcp`). **Remote, stateless Streamable HTTP**: a fresh `McpServer` +
`StreamableHTTPServerTransport` (`sessionIdGenerator: undefined`, `enableJsonResponse: true`)
is built per request — required on Vercel, where no session/connection survives between
invocations. The Fastify handler `reply.hijack()`s and hands `request.raw`/`reply.raw` +
the parsed body to the transport. **No new serverless function** (rides inside
`api/vercel.js`), **no `vercel.json` change**, **no Anthropic dependency** (uses
`@modelcontextprotocol/sdk` — the agent-server protocol, not the Claude API).

11 read-only tools (search/detail/ISIN/NAV/latest + returns/rolling/risk/sip + catalogs),
each with a zod `outputSchema` returning `structuredContent`. `/sync-nav` is **not**
exposed. Tools call `lib/queries.js` directly — the **shared data-access layer** that the
REST routes also use, so SQL lives once and the two surfaces can't drift. Open auth
(reuses the global rate limiter); MCP traffic is excluded from the Axiom hook for now.
**Full design + status: `MCP.md`.**

### OpenAPI Spec — `api/openapi.js`

Hand-written OpenAPI 3.1, served at `GET /openapi.json`. **Not auto-generated.** The frontend renders this directly — update it whenever routes change. Example data uses real values from the DB (scheme 101762, HDFC Flexi Cap Fund - Growth Plan). Analytics endpoints (returns/rolling/risk/sip) are documented.

---

## Database Schema

Identical shape in SQLite and Postgres. Dates stored as TEXT (`YYYY-MM-DD`) for lexical comparisons and byte-identical JSON across backends.

```sql
fund_houses        (id PK, name UNIQUE)
scheme_categories  (id PK, name UNIQUE, broad_category)
schemes            (scheme_code PK, scheme_name, fund_house_id→fund_houses,
                    scheme_category_id→scheme_categories, isin_growth,
                    isin_div_reinvestment, last_synced_at TEXT)
nav_history        (scheme_code→schemes CASCADE, nav_date TEXT, nav REAL,
                    PRIMARY KEY (scheme_code, nav_date))
```

**Indexes (both backends):**
- `idx_nav_history_scheme_date` on `nav_history(scheme_code, nav_date DESC)`
- `idx_schemes_fund_house` on `schemes(fund_house_id)`
- `idx_schemes_category` on `schemes(scheme_category_id)`
- `idx_schemes_name` on `schemes(scheme_name)` — ORDER BY
- `idx_schemes_name_trgm` GIN on `lower(scheme_name)` — Postgres only, fast LIKE '%q%'

**DB size (CockroachDB production):** 41 fund_houses, 42 categories, 14,583 schemes, ~9.67M nav_history rows, date range 2021-06-20 → 2026-06-20 (5 years migrated; 6th year pending re-run). Seeded with `NAV_YEARS=5`.

---

## API Endpoints

Base path is `/api` in prod/dev-proxy. Fastify serves them without prefix on `localhost:3001`.

```
GET /health
→ { status: 'ok', driver: 'sqlite' | 'postgres' }

GET /openapi.json
→ OpenAPI 3.1 spec

GET /fund-houses
→ { data: [{ fund_house_id, name }] }            ← note: fund_house_id (not id)

GET /categories
→ { data: [{ id, name, broad_category }] }

GET /schemes?q=&fund_house_id=&category_id=&broad_category=&page=1&limit=20
→ { total, page, limit, data: [{ scheme_code, scheme_name, fund_house, category, broad_category }] }

GET /schemes/:code
→ { data: { scheme_code, scheme_name, isin_growth, isin_div_reinvestment,
            last_synced_at, fund_house, category, broad_category,
            nav, nav_date } }                     ← nav + nav_date from correlated subquery
   404 → { error: 'Scheme not found' }

GET /schemes/isin/:isin                           ← registered BEFORE /:code (static wins)
→ same shape as /schemes/:code
   404 → { error: 'Scheme not found' }

GET /schemes/:code/nav?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
→ { scheme_code, scheme_name, data: [{ nav_date, nav }] }   ← newest first
   404 → { error: 'No NAV data found' }

GET /schemes/:code/nav/latest
→ { scheme_code, scheme_name, nav_date, nav }
   404 → { error: 'No NAV data found' }

GET /schemes/:code/returns
→ { scheme_code, scheme_name, inception_date, inception_cagr,
    returns: { 1W, 1M, 3M, 6M, 1Y, 2Y, 3Y, 5Y, max } }   ← null if insufficient history
   404 → { error: 'No NAV data found for scheme' }

GET /schemes/:code/rolling?window=3Y&beat=12
→ { scheme_code, scheme_name, window, count, min, max, median, mean,
    pct_beat (if beat param given) }
   404 → { error: 'No NAV data found for scheme' }

GET /schemes/:code/risk?rf=6
→ { scheme_code, scheme_name, annualised_volatility, max_drawdown, sharpe_ratio,
    risk_free_rate, from_date, to_date, trading_days }
   404 → { error: 'No NAV data found for scheme' }

GET /schemes/:code/sip?amount=5000&from=YYYY-MM-DD&to=YYYY-MM-DD
→ { scheme_code, scheme_name, amount_per_month, from_date, to_date,
    months, total_invested, current_value, absolute_gain, xirr }
   404 → { error: 'No NAV data found for scheme' }

POST /sync-nav
Headers: Authorization: Bearer <SYNC_NAV_SECRET>
→ { nav_date, parsed, inserted, skipped }
   401 → { error: 'Unauthorized' }
```

**Key SQL patterns:**
- Filter params use `(? IS NULL OR col = ?)` — both `?`s get the same value (null or actual).
- Scheme detail uses correlated subqueries for `nav` + `nav_date` (portable, no extra JOIN).
- ISIN lookup: `WHERE isin_growth = ? OR isin_div_reinvestment = ?`.
- `/schemes/isin/:isin` is registered before `/:code` — Fastify static segments win over params.

---

## Vercel Deployment Config (`vercel.json`)

Uses `builds` array (not zero-config) to prevent Vercel from auto-detecting every `api/*.js` file as a separate serverless function:

```json
{
  "builds": [
    { "src": "api/vercel.js", "use": "@vercel/node" },
    { "src": "package.json", "use": "@vercel/static-build", "config": { "distDir": "frontend/dist" } }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "api/vercel.js" },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
```

Root `package.json` has a `vercel-build` script: `cd frontend && npm install && npm run build`. `distDir: "frontend/dist"` is relative to the repo root (since the source is root `package.json`).

**Why `builds` and not zero-config (`buildCommand`+`outputDirectory`):**
Zero-config auto-detects every `.js` file in `api/` as a serverless function (12+ files → exceeds Vercel Hobby plan's 12-function limit).

---

## GitHub Actions — NAV Sync (`sync-nav.yml`)

Calls `POST /api/sync-nav` 5× per day. Schedules in IST (UTC+5:30):

| IST time | UTC cron |
|---|---|
| 10:00 AM | `30 4 * * *` |
| 4:00 PM | `30 10 * * *` |
| 7:00 PM | `30 13 * * *` |
| 10:00 PM | `30 16 * * *` |
| 11:30 PM | `0 18 * * *` |

Required GitHub secrets: `SYNC_NAV_SECRET`, `VERCEL_APP_URL`.
Also supports `workflow_dispatch` for manual triggers.

---

## GitHub Actions — NAV Archive (`archive-nav.yml`)

Disaster-recovery backup, separate from the sync job. Runs **once daily at 11:30 PM IST** (`0 18 * * *` UTC), downloads AMFI's `NAVAll.txt`, and commits it to `nav-archive/DD-MM-YYYY.txt` in the repo. Purpose: if the DB is ever lost, the full NAV history can be rebuilt from these dated raw files. Needs `permissions: contents: write` to push. Uses `workflow_dispatch` too.

> Known nit: the filename date uses `date -u` (UTC), so a file generated at 18:00 UTC is named with the UTC date rather than the IST date. Cosmetic only.

---

## Analytics — Axiom (`api/app.js` `onResponse` hook)

Fire-and-forget request analytics. An `onResponse` hook POSTs one event per request to Axiom's direct HTTP ingest API (`https://api.axiom.co/v1/datasets/{AXIOM_DATASET}/ingest`, Bearer `AXIOM_TOKEN`). **No Vercel log drain needed** (that requires a Pro plan). Skipped entirely if `AXIOM_TOKEN`/`AXIOM_DATASET` are unset (safe in local dev); `/health` and `/openapi.json` are excluded.

Each event carries ~17 fields: `_time`, `method`, `route` (matched pattern via `req.routeOptions?.url`), `endpoint_type` (mapped label like `nav_latest`/`search`/`scheme_detail`/`returns`/`rolling`/`risk`/`sip`), `status`, `ms` (`reply.elapsedTime`), `scheme_code`, `isin`, `q`, the filter params, `ip` (`x-forwarded-for`), `country`/`city` (Vercel geo headers), `ua`, `referer`. The `fetch` is `.catch(() => {})` — analytics never affects the response.

Build Axiom dashboards **manually** panel-by-panel (the auto-wizard chokes on small data). No bar chart exists — use **Top list** for rankings, **Table** for tabular, **Statistic** for single numbers. Set the dashboard time range to "Last 24 hours"/"Last 7 days" (not "Last 15 mins") to avoid "disposed"/"too little data" errors.

`scripts/seed-axiom.js` fires ~31 requests across all endpoint types to populate the dataset for dashboard building.

---

## Spreadsheet Functions — Google Sheets (`frontend/public/excel-addin/google-sheets.js`)

Google Apps Script custom functions that call the public API like spreadsheet formulas. Paste the whole file into **Extensions → Apps Script → Code.gs → Save**, then use e.g. `=MF_NAV(101762)` in any cell.

Functions: `MF_NAV`, `MF_NAV_DATE`, `MF_NAV_ON(code, date)`, `MF_NAME`, `MF_FUND_HOUSE`, `MF_PREV_NAV`, `MF_DAILY_CHANGE` (%), `MF_DAILY_CHANGE_ABS`. Helpers: `mfGet_` (`UrlFetchApp.fetch`, synchronous), `toApiDate_` (Date/`DD-MM-YYYY`/`YYYY-MM-DD` → `YYYY-MM-DD`), `_lastTwoNavs_` (7-day window → two most recent NAVs).

**Weekend/holiday handling:** NAV exists only for trading days. `MF_NAV_ON` and `_lastTwoNavs_` query a **multi-day look-back window** (`startDate=date-5d..date`) and take `data[0]` (newest-first) — i.e. the nearest trading day on/before the requested date — instead of an exact-date match that would error on weekends/holidays.

**Gotchas (hard-won):**
- Custom functions are **bound to one spreadsheet**. A new blank Sheet has no script → no functions. Use **File → Make a copy** of the master sheet, or deploy as a Workspace **Add-on** (Apps Script **Libraries do NOT work** for custom functions).
- "Unknown function" after pasting is almost always Sheets' **autocomplete cache** — type the formula manually, then close & reopen the spreadsheet to refresh.
- An Excel add-in variant exists under the same folder (`functions.js/.json/.html`, `manifest.xml`) but was abandoned — Excel add-in registration was too painful; Google Sheets is the supported path.

---

## Environment Variables

### `api/.env`
| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | _unset_ | The switch. Unset → SQLite; set → Postgres/CockroachDB. |
| `DB_PATH` | `./market-data-api.db` | SQLite path (ignored when DATABASE_URL is set) |
| `PORT` | `3001` | API listen port (local only) |
| `PG_POOL_MAX` | `5` | Postgres pool size |
| `SYNC_NAV_SECRET` | _unset_ | Bearer token for POST /sync-nav (skip auth if unset) |
| `RATE_LIMIT_MAX` | `2500` | Max requests per window per IP |
| `RATE_LIMIT_WINDOW` | `1 minute` | Rate-limit window (any `@fastify/rate-limit` duration string) |
| `CONCURRENCY` | `8` | Parallel mfapi.in requests in seed.js |
| `NAV_YEARS` | `5` | Years of NAV history to seed/migrate |
| `MFAPI_BASE` | `https://api.mfapi.in` | Seed data source |
| `AXIOM_TOKEN` | _unset_ | Axiom ingest token. Analytics hook is skipped if unset. |
| `AXIOM_DATASET` | _unset_ | Axiom dataset name (e.g. `market-data-api`). |

### `frontend/.env`
| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `/api` | API base URL. Change only if API is on a different origin. |
| `VITE_DEV_API_TARGET` | `http://localhost:3001` | Vite dev proxy target |

### Vercel env vars (set in project settings)
- `DATABASE_URL` — CockroachDB connection string (`postgresql://user:pass@host:26257/dbname?sslmode=verify-full`)
- `SYNC_NAV_SECRET` — must match the GitHub Actions secret of the same name

---

## Running Locally

```bash
# Terminal A — API (SQLite)
cd api
cp .env.example .env      # leave DATABASE_URL unset
npm install
npm run seed -- --limit 50   # fast test; full seed: npm run seed (hours)
npm run dev               # http://localhost:3001

# Terminal B — Explorer
cd frontend
cp .env.example .env
npm install
npm run dev               # http://localhost:5173 (proxies /api → :3001)
```

### npm scripts
- **api**: `dev` (--watch), `start`, `seed`, `seed:force`, `migrate:cockroach`, `prune`, `test`
- **frontend**: `dev`, `build` (`tsc -b && vite build`), `preview`

---

## Deployment Checklist (CockroachDB)

```
[ ] npm run seed               — market-data-api.db seeded locally (NAV_YEARS=5)
[ ] CockroachDB Serverless     — cluster created, database created, user + password set
[ ] schema.postgres.sql run    — 4 tables + indexes created (CockroachDB SQL shell or client)
[ ] DATABASE_URL in api/.env   — cockroachdb connection string, sslmode=verify-full
[ ] npm run migrate:cockroach  — ~10-15 min, 9M+ nav_history rows copied (idempotent)
[ ] SYNC_NAV_SECRET generated  — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
[ ] Pushed to GitHub
[ ] Vercel: New Project → import repo → Framework: Other → Root: /
[ ] Vercel env vars            — DATABASE_URL (CockroachDB) + SYNC_NAV_SECRET
[ ] Vercel deploy              — green build, /api/health → driver:postgres
[ ] GitHub secrets             — SYNC_NAV_SECRET + VERCEL_APP_URL
[ ] Manual workflow run        — Actions → Sync NAV from AMFI → Run workflow → returns JSON
```

---

## Known Gotchas

- **Vercel zero-config auto-detects every `api/*.js`** as a serverless function → exceeds 12-function Hobby limit. Fixed by using `builds` array in `vercel.json`.
- **CockroachDB returns integer columns as strings** — `scheme_code` comes back as `"101762"` not `101762` via the `pg` driver. Non-breaking (treated as opaque identifier throughout), but visible in API JSON responses.
- **CockroachDB connection string** — use `sslmode=verify-full` in the URL; `ssl: { rejectUnauthorized: false }` in `pg.Pool` is sufficient for Serverless.
- **Password special characters** in `DATABASE_URL` must be URL-encoded (`encodeURIComponent()`).
- **SQLite cannot run on Vercel** — ephemeral FS. `DATABASE_URL` is required in production.
- **`openapi.js` is hand-maintained** — update it when routes change.
- **SQLite DB is gitignored** — never commit it (~1 GB with 6yr history).
- **Migration is idempotent** (`ON CONFLICT DO NOTHING`) — safe to re-run if interrupted.
- **`migrate-to-supabase.js` is legacy** — kept for reference, use `migrate-to-cockroach.js` going forward.

---

## Security Posture

### Fixed
- **Rate limiting** — 2500 req/min per IP (see Rate Limiting section). Mitigates brute abuse / pool exhaustion.
- **Pagination clamps** — `limit ≤ 100`, `page ≥ 1`; no unbounded result sets or negative-OFFSET 500s.
- **Error handler** — 5xx internals hidden from clients (no SQL/schema/conn-string disclosure).
- **Turso fully removed** — adapter, env vars, npm dependency all stripped. No dead credential surface.

### Verified safe
- **SQL injection** — all queries use `?` placeholders bound as params, including `LIKE '%q%'` (the `%q%` is a *parameter*, not interpolated). Only string-built SQL is the batch-insert placeholder list in `sync.js`, which interpolates a row *count*, not user data.
- **Frontend XSS** — no `dangerouslySetInnerHTML`/`innerHTML`/`eval`; React escapes by default; URL params `encodeURIComponent`-wrapped.
- **Secrets in git** — `api/.env` is gitignored and was **never committed** (history confirmed clean).

### Open / accepted risks (not yet fixed)
- **Rotate live secrets** — the CockroachDB password, `SYNC_NAV_SECRET`, and `AXIOM_TOKEN` are live in `api/.env` and were read into an AI session. Rotate all three. Old Supabase password (`Saransh_007#`) is now only in `DATABASE_URL_OLD` (dead/renamed key) — decommission Supabase project to fully retire it.
- **DB TLS validation** — `ssl: { rejectUnauthorized: false }` in `db/index.js` accepts any cert (MITM risk). Low risk for CockroachDB Serverless in practice; correct fix is to pin the CA cert.
- **`/sync-nav` auth** — fails *open* if `SYNC_NAV_SECRET` is unset (expensive unauthenticated write), and uses a non-constant-time `!==` compare (theoretical timing attack). Harden: fail closed in prod + `crypto.timingSafeEqual`.
- **CORS `origin: '*'`** — accepted (public read-only API; `/sync-nav` is gated by bearer auth).
- **Analytics PII** — raw client IPs + search terms shipped to Axiom; `x-forwarded-for` is spoofable (only pollutes analytics). Consider a retention policy.

---

## Verified Working

- Frontend: `npm run build` passes (tsc strict + vite build, 152 KB JS gzipped to 49 KB).
- API on SQLite: `/health` → `{driver:'sqlite'}`, all routes return correct data.
- CockroachDB migration: completed — 41 fund_houses, 42 categories, 14,583 schemes, ~9.67M nav_history rows (2021-06-20 → 2026-06-20).
- All 12 smoke-test endpoints pass against CockroachDB (health, fund-houses, categories, schemes search, scheme detail, ISIN lookup, nav/latest, nav range, returns, risk, sip, 404 handling).
- Vercel deployment: pending cutover — update `DATABASE_URL` in Vercel project settings to CockroachDB URL and redeploy.
- AMFI sync: `POST /sync-nav` logic verified; GitHub Actions workflow ready.
