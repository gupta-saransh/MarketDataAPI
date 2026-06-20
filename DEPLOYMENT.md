# Deployment Guide

This repo deploys as **one Vercel project**: the API runs as a serverless
function at `/api/*` and the explorer frontend is served as static files at `/`.
Same origin → no CORS, one URL, one "click deploy".

```
                 ┌─────────────────────────────────────────┐
   your-app.vercel.app                                      │
                 │   /              → frontend (static)      │
                 │   /api/*         → Fastify (serverless)   │──► Supabase (Postgres)
                 └─────────────────────────────────────────┘
```

The database backend is chosen by **one env var**:

| `DATABASE_URL` | Backend used        | Where            |
|----------------|---------------------|------------------|
| _unset_        | SQLite (`./mfapi.db`) | local dev      |
| set            | Postgres (`pg`)     | production / Vercel |

Nothing else changes between SQLite and Supabase.

---

## 1. Local development (SQLite)

```bash
# Terminal A — API
cd api
cp .env.example .env          # leave DATABASE_URL unset to use SQLite
npm install
npm run seed -- --limit 50    # quick test seed (or `npm run seed` for all ~37k)
npm run dev                   # http://localhost:3001

# Terminal B — Explorer
cd frontend
cp .env.example .env          # defaults are fine (VITE_API_URL=/api)
npm install
npm run dev                   # http://localhost:5173  (proxies /api → :3001)
```

Open the explorer, expand an endpoint, hit **Run** — it calls your local API.

---

## 2. Move data to Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Get the **connection string** (Project → Settings → Database → Connection string →
   *Transaction pooler*, port `6543`). It looks like:
   ```
   postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
3. Create the tables — paste `api/db/schema.postgres.sql` into the Supabase **SQL editor** and run it
   (or `psql "$DATABASE_URL" -f api/db/schema.postgres.sql`).
4. Copy your seeded SQLite data up:
   ```bash
   cd api
   # add DATABASE_URL=... to api/.env
   npm run migrate
   ```
5. Verify locally against Postgres: with `DATABASE_URL` set, `npm run dev` now serves
   from Supabase. `GET /health` shows `"driver":"postgres"`.

---

## 3. Deploy to Vercel

1. Push the repo to GitHub.
2. In Vercel: **New Project → import the repo.** Leave the root directory as the repo root
   (the included `vercel.json` builds both the API function and the frontend).
3. Add **one** Environment Variable:
   - `DATABASE_URL` = your Supabase connection string.
4. **Deploy.**

Result:
- `https://your-app.vercel.app/`        → the explorer
- `https://your-app.vercel.app/api/health` → `{ "status": "ok", "driver": "postgres" }`
- `https://your-app.vercel.app/api/schemes?q=hdfc` → live data

The explorer defaults to `VITE_API_URL=/api`, so it talks to the same-origin API
automatically — no extra config needed.

### Hosting the API elsewhere (optional)
If you'd rather run the API on a persistent host (Render/Railway) and keep SQLite,
set `VITE_API_URL=https://your-api-host` in the frontend's Vercel env vars. The
explorer will point there instead. (CORS is already open: `origin: '*'`.)

---

## Notes & gotchas

- **SQLite cannot run on Vercel** (ephemeral, read-only filesystem). Production
  *must* use `DATABASE_URL`/Supabase. That's why the migration above is required.
- The API function imports `node:sqlite` only when `DATABASE_URL` is unset, so the
  Vercel build never needs the `--experimental-sqlite` flag.
- `nav_date` / `last_synced_at` are stored as text (`YYYY-MM-DD`) in both backends,
  so date-range queries and response shapes are identical.
- Cold starts: the first request to a warm-from-cold serverless function is slower;
  subsequent ones reuse the warm container.
