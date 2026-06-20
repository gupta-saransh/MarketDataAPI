# MFAPI — India Mutual Fund Data API

A free, public REST API for Indian mutual fund schemes and their NAV (Net Asset Value) history. No authentication required.

- **~9,183 active schemes** across all AMCs
- **2 years of NAV history** per scheme
- **Updated 5× daily** from AMFI (10 AM, 4 PM, 7 PM, 10 PM, 11:30 PM IST)
- **Interactive explorer** at the root URL — try every endpoint in the browser

---

## Base URL

```
https://your-app.vercel.app/api
```

---

## Endpoints

### Health

```
GET /api/health
```
```json
{ "status": "ok", "driver": "postgres" }
```

---

### Fund Houses

```
GET /api/fund-houses
```

Returns all asset management companies (AMCs), ordered by name.

```json
{
  "data": [
    { "fund_house_id": 9, "name": "HDFC Mutual Fund" },
    { "fund_house_id": 3, "name": "Aditya Birla Sun Life Mutual Fund" }
  ]
}
```

---

### Categories

```
GET /api/categories
```

Returns all scheme categories with their broad grouping.

```json
{
  "data": [
    { "id": 43, "name": "Equity Scheme - Flexi Cap Fund", "broad_category": "Equity Scheme" },
    { "id": 12, "name": "Debt Scheme - Banking and PSU Fund", "broad_category": "Debt Scheme" }
  ]
}
```

**Broad categories:** `Equity Scheme`, `Debt Scheme`, `Hybrid Scheme`, `Solution Oriented Scheme`, `Other Scheme`, `Exchange Traded Fund`

---

### Search & List Schemes

```
GET /api/schemes
```

| Parameter | Type | Description |
|---|---|---|
| `q` | string | Case-insensitive name search |
| `fund_house_id` | integer | Filter by AMC (from `/fund-houses`) |
| `category_id` | integer | Filter by category (from `/categories`) |
| `broad_category` | string | Filter by broad category |
| `page` | integer | Page number, 1-based (default: 1) |
| `limit` | integer | Results per page (default: 20) |

All parameters are optional and combinable.

```
GET /api/schemes?q=hdfc&broad_category=Equity Scheme&page=1&limit=5
```

```json
{
  "total": 312,
  "page": 1,
  "limit": 5,
  "data": [
    {
      "scheme_code": 101762,
      "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
      "fund_house": "HDFC Mutual Fund",
      "category": "Equity Scheme - Flexi Cap Fund",
      "broad_category": "Equity Scheme"
    }
  ]
}
```

---

### Scheme Details by Code

```
GET /api/schemes/:code
```

Full scheme metadata including latest NAV.

```
GET /api/schemes/101762
```

```json
{
  "data": {
    "scheme_code": 101762,
    "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
    "isin_growth": "INF179K01608",
    "isin_div_reinvestment": null,
    "last_synced_at": "2026-06-20 08:53:08",
    "fund_house": "HDFC Mutual Fund",
    "category": "Equity Scheme - Flexi Cap Fund",
    "broad_category": "Equity Scheme",
    "nav": 2000.152,
    "nav_date": "2026-06-19"
  }
}
```

404 if scheme not found: `{ "error": "Scheme not found" }`

---

### Scheme Details by ISIN

```
GET /api/schemes/isin/:isin
```

Look up a scheme by ISIN (growth or dividend reinvestment). Returns the same shape as `/schemes/:code`.

```
GET /api/schemes/isin/INF179K01608
```

---

### NAV History

```
GET /api/schemes/:code/nav
```

| Parameter | Type | Description |
|---|---|---|
| `startDate` | string | Inclusive lower bound (`YYYY-MM-DD`) |
| `endDate` | string | Inclusive upper bound (`YYYY-MM-DD`) |

Results are ordered newest first. Both date filters are optional.

```
GET /api/schemes/101762/nav?startDate=2026-06-01&endDate=2026-06-19
```

```json
{
  "scheme_code": 101762,
  "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
  "data": [
    { "nav_date": "2026-06-19", "nav": 2000.152 },
    { "nav_date": "2026-06-18", "nav": 2001.569 }
  ]
}
```

404 if no data: `{ "error": "No NAV data found" }`

---

### Latest NAV

```
GET /api/schemes/:code/nav/latest
```

```
GET /api/schemes/101762/nav/latest
```

```json
{
  "scheme_code": 101762,
  "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
  "nav_date": "2026-06-19",
  "nav": 2000.152
}
```

---

## Self-Hosting

### Prerequisites

- Node.js 22+
- Git

### Local Setup

```bash
git clone https://github.com/gupta-saransh/MarketDataAPI.git
cd MarketDataAPI

# API
cd api
cp .env.example .env       # leave DATABASE_URL unset for SQLite
npm install
npm run seed -- --limit 50 # quick test; full seed: npm run seed (takes hours)
npm run dev                # http://localhost:3001

# Explorer (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                # http://localhost:5173
```

### Deploy to Vercel + Supabase

Full step-by-step in [DEPLOYMENT.md](DEPLOYMENT.md). Summary:

1. Seed locally (`npm run seed` in `api/`)
2. Create a Supabase project — copy the **Transaction pooler** connection string (port 6543)
3. Run `api/db/schema.postgres.sql` in the Supabase SQL editor
4. Set `DATABASE_URL` in `api/.env` and run `npm run migrate` (~10–15 min)
5. Push to GitHub → import into Vercel → add `DATABASE_URL` + `SYNC_NAV_SECRET` env vars → Deploy
6. Add `SYNC_NAV_SECRET` and `VERCEL_APP_URL` as GitHub repository secrets

---

## Data Source & Update Frequency

- **Initial data**: seeded from [mfapi.in](https://api.mfapi.in) (~9,183 schemes, 2-year history)
- **Daily updates**: AMFI publishes `NAVAll.txt` after market close; this API syncs it automatically via GitHub Actions 5× per day

AMFI declares NAV after 9:00 PM IST on trading days. The 10:00 PM and 11:30 PM IST syncs ensure same-day data is captured.

---

## Tech Stack

| Layer | Technology |
|---|---|
| API | Node.js 22, Fastify v4, ESM |
| Database (dev) | SQLite via `node:sqlite` |
| Database (prod) | Supabase Postgres |
| Frontend | React 18, Vite 5, TypeScript, Tailwind CSS v3 |
| Hosting | Vercel (static + serverless) |
| NAV sync | GitHub Actions (cron) |

---

## License

MIT
