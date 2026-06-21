/**
 * migrate-to-cockroach.js — one-time SQLite → CockroachDB data copy.
 *
 * Prerequisites:
 *   1. Sign up at cockroachlabs.com → create a free Serverless cluster (pick bom1 / Mumbai)
 *   2. Get the connection string from the Connect dialog (postgresql://...)
 *   3. Add to api/.env:
 *        COCKROACH_URL=postgresql://user:pass@cluster.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full
 *   4. Run:
 *        DB_PATH=./market-data-api.db node --experimental-sqlite pipeline/migrate-to-cockroach.js
 *
 * Idempotent: ON CONFLICT DO NOTHING everywhere — safe to re-run after interruption.
 * Uses keyset pagination for nav_history (100k rows/page) so it never OOMs.
 * Uploads newest NAV data first so the API is usable while the migration runs.
 */

import 'dotenv/config'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const DB_URL = process.env.COCKROACH_URL
if (!DB_URL) {
  console.error('COCKROACH_URL is not set. Add it to api/.env and retry.')
  process.exit(1)
}

const sqlitePath = process.env.DB_PATH ?? join(ROOT, 'market-data-api.db')
const lite = new DatabaseSync(sqlitePath)
const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
})

const BATCH = 5000

// ── Schema ────────────────────────────────────────────────────────────────────
// Written as individual statements so we can execute them one by one.
// CockroachDB is PostgreSQL-compatible — syntax is identical to schema.postgres.sql
// except we skip the Supabase-specific note about pg_trgm being pre-enabled.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS fund_houses (
    id   integer PRIMARY KEY,
    name text    NOT NULL UNIQUE
  )`,

  `CREATE TABLE IF NOT EXISTS scheme_categories (
    id             integer PRIMARY KEY,
    name           text    NOT NULL UNIQUE,
    broad_category text    NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS schemes (
    scheme_code           integer PRIMARY KEY,
    scheme_name           text    NOT NULL,
    fund_house_id         integer REFERENCES fund_houses(id),
    scheme_category_id    integer REFERENCES scheme_categories(id),
    isin_growth           text,
    isin_div_reinvestment text,
    last_synced_at        text    DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
  )`,

  `CREATE TABLE IF NOT EXISTS nav_history (
    scheme_code integer NOT NULL REFERENCES schemes(scheme_code) ON DELETE CASCADE,
    nav_date    date    NOT NULL,
    nav         real    NOT NULL,
    PRIMARY KEY (scheme_code, nav_date)
  )`,

  `CREATE EXTENSION IF NOT EXISTS pg_trgm`,

  `CREATE INDEX IF NOT EXISTS idx_nav_history_scheme_date ON nav_history (scheme_code, nav_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_schemes_fund_house      ON schemes (fund_house_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schemes_category        ON schemes (scheme_category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_schemes_name            ON schemes (scheme_name)`,
  `CREATE INDEX IF NOT EXISTS idx_schemes_name_trgm       ON schemes USING GIN (lower(scheme_name) gin_trgm_ops)`,
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function applySchema(client) {
  for (const stmt of SCHEMA_STATEMENTS) {
    await client.query(stmt)
  }
}

async function copyTable(client, table, cols, rows, conflictCols) {
  if (!rows.length) { console.log(`  ${table}: 0 rows`); return }

  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH)
    const values = []
    const placeholders = slice.map((row, r) => {
      const ph = cols.map((_, c) => `$${r * cols.length + c + 1}`)
      values.push(...cols.map(col => row[col]))
      return `(${ph.join(', ')})`
    })
    const text =
      `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${placeholders.join(', ')} `
      + `ON CONFLICT (${conflictCols.join(', ')}) DO NOTHING`
    const res = await client.query(text, values)
    inserted += res.rowCount ?? 0
    process.stdout.write(`\r  ${table}: ${i + slice.length}/${rows.length} processed`)
  }
  console.log(`\r  ${table}: ${rows.length} processed, ${inserted} inserted${' '.repeat(20)}`)
}

async function copyNavHistory(client) {
  const PAGE = 100000

  // Default to 2yr so the migration completes in one session without drama.
  // Pass NAV_YEARS=6 if you want the full history and have budget/time.
  const cutoffYears = Number(process.env.NAV_YEARS ?? 2)
  const cutoffDate = new Date()
  cutoffDate.setFullYear(cutoffDate.getFullYear() - cutoffYears)
  const CUTOFF = cutoffDate.toISOString().slice(0, 10)
  console.log(`  (NAV cutoff: ${CUTOFF} — ${cutoffYears}yr, override with NAV_YEARS=N)`)

  // Keyset pagination on (nav_date DESC, scheme_code ASC):
  // newest rows land in CockroachDB first so the API is already useful while
  // the migration runs. '9999-99-99' starts everything via nav_date < sentinel.
  const pageStmt = lite.prepare(`
    SELECT scheme_code, nav_date, nav
    FROM nav_history
    WHERE nav_date >= ?
      AND (nav_date < ? OR (nav_date = ? AND scheme_code > ?))
    ORDER BY nav_date DESC, scheme_code ASC
    LIMIT ${PAGE}
  `)

  let lastDate = '9999-99-99', lastCode = -1
  let total = 0, inserted = 0

  while (true) {
    const rows = pageStmt.all(CUTOFF, lastDate, lastDate, lastCode)
    if (!rows.length) break

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH)
      const values = []
      const placeholders = slice.map((_, r) => {
        values.push(slice[r].scheme_code, slice[r].nav_date, slice[r].nav)
        return `($${r * 3 + 1}, $${r * 3 + 2}, $${r * 3 + 3})`
      })
      const text =
        `INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES ${placeholders.join(', ')} `
        + `ON CONFLICT (scheme_code, nav_date) DO NOTHING`
      const res = await client.query(text, values)
      inserted += res.rowCount ?? 0
    }

    total += rows.length
    const last = rows[rows.length - 1]
    lastDate = last.nav_date
    lastCode = last.scheme_code
    process.stdout.write(`\r  nav_history: ${total} processed, ${inserted} inserted`)
  }

  console.log(`\r  nav_history: ${total} processed, ${inserted} inserted${' '.repeat(20)}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const maskedUrl = DB_URL.replace(/:[^:@]+@/, ':***@')
  console.log(`Source SQLite: ${sqlitePath}`)
  console.log(`Destination:   ${maskedUrl}\n`)

  const client = await pool.connect()
  try {
    console.log('Applying schema...')
    await applySchema(client)

    console.log('Copying tables (FK order)...')

    await copyTable(client, 'fund_houses',
      ['id', 'name'],
      lite.prepare('SELECT id, name FROM fund_houses').all(),
      ['id'])

    await copyTable(client, 'scheme_categories',
      ['id', 'name', 'broad_category'],
      lite.prepare('SELECT id, name, broad_category FROM scheme_categories').all(),
      ['id'])

    await copyTable(client, 'schemes',
      ['scheme_code', 'scheme_name', 'fund_house_id', 'scheme_category_id',
       'isin_growth', 'isin_div_reinvestment', 'last_synced_at'],
      lite.prepare(`
        SELECT scheme_code, scheme_name, fund_house_id, scheme_category_id,
               isin_growth, isin_div_reinvestment, last_synced_at
        FROM schemes
      `).all(),
      ['scheme_code'])

    await copyNavHistory(client)
  } finally {
    client.release()
    await pool.end()
  }

  console.log('\nMigration complete.')
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1) })
