/**
 * migrate-to-supabase.js — one-time SQLite → Supabase/Postgres data copy.
 *
 * Prerequisites:
 *   1. Seed your local SQLite DB first:   npm run seed
 *   2. Create the Postgres tables:        psql "$DATABASE_URL" -f db/schema.postgres.sql
 *   3. Set DATABASE_URL in api/.env to your Supabase connection string.
 *
 * Run:
 *   npm run migrate            # copies fund_houses, scheme_categories, schemes, nav_history
 *
 * Idempotent: uses ON CONFLICT DO NOTHING, so re-running tops up missing rows.
 * Reads SQLite directly (node:sqlite) and bulk-inserts into Postgres in batches.
 */

import 'dotenv/config'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DatabaseSync } from 'node:sqlite'
import pg from 'pg'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) {
  console.error('DATABASE_URL is not set. Point it at your Supabase Postgres database.')
  process.exit(1)
}

const sqlitePath = process.env.DB_PATH ?? join(ROOT, 'mfapi.db')
const lite = new DatabaseSync(sqlitePath)
const pool = new pg.Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })

const BATCH = 5000

/** Bulk-insert rows into `table` (cols) using a single multi-row INSERT per batch. */
async function copyTable(table, cols, rows, conflictCols) {
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
    const res = await pool.query(text, values)
    inserted += res.rowCount
    process.stdout.write(`\r  ${table}: ${i + slice.length}/${rows.length} processed`)
  }
  console.log(`\r  ${table}: ${rows.length} processed, ${inserted} inserted${' '.repeat(20)}`)
}

async function main() {
  console.log(`Source SQLite: ${sqlitePath}`)
  console.log('Destination:   Supabase Postgres\n')

  console.log('Copying tables (FK order)...')

  await copyTable('fund_houses',
    ['id', 'name'],
    lite.prepare('SELECT id, name FROM fund_houses').all(),
    ['id'])

  await copyTable('scheme_categories',
    ['id', 'name', 'broad_category'],
    lite.prepare('SELECT id, name, broad_category FROM scheme_categories').all(),
    ['id'])

  await copyTable('schemes',
    ['scheme_code', 'scheme_name', 'fund_house_id', 'scheme_category_id', 'isin_growth', 'isin_div_reinvestment', 'last_synced_at'],
    lite.prepare(`SELECT scheme_code, scheme_name, fund_house_id, scheme_category_id,
                         isin_growth, isin_div_reinvestment, last_synced_at FROM schemes`).all(),
    ['scheme_code'])

  await copyTable('nav_history',
    ['scheme_code', 'nav_date', 'nav'],
    lite.prepare('SELECT scheme_code, nav_date, nav FROM nav_history').all(),
    ['scheme_code', 'nav_date'])

  await pool.end()
  console.log('\nMigration complete.')
}

main().catch(err => { console.error('\nFatal:', err); process.exit(1) })
