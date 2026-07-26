/**
 * apply-holdings-table.js — one-time DDL to add the fund_holdings cache table
 * to an already-migrated production database (CockroachDB / Postgres).
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS) and safe to re-run. Uses the same db
 * adapter as the app, so it connects to whatever DATABASE_URL points at. It
 * refuses to run against SQLite so you can't think you hit prod when you didn't.
 *
 *   cd api && node pipeline/apply-holdings-table.js
 */

import { sql } from '../db/index.js'

if (sql.driver !== 'postgres') {
  console.error(
    'Refusing to run: driver is "' + sql.driver + '", not "postgres".\n' +
    'DATABASE_URL must be set to your CockroachDB connection string so this runs against prod.'
  )
  process.exit(1)
}

const DDL = `
  CREATE TABLE IF NOT EXISTS fund_holdings (
      scheme_code   integer PRIMARY KEY REFERENCES schemes(scheme_code) ON DELETE CASCADE,
      fetched_at    text    NOT NULL,
      holdings_date text,
      payload       text    NOT NULL
  )
`

await sql.run(DDL)
const row = await sql.get('SELECT count(*) AS n FROM fund_holdings')
console.log(`fund_holdings ready on ${sql.driver} (existing rows: ${row.n})`)
process.exit(0)
