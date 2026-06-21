/**
 * db/index.js — Database adapter
 *
 * One async query interface, two backends, chosen by env var:
 *
 *   • DATABASE_URL set → Postgres (production — CockroachDB via `pg`)
 *   • unset            → SQLite   (local dev — node:sqlite + ./mfapi.db)
 *
 * Routes only ever call sql.all / sql.get / sql.run with `?` placeholders.
 * The Postgres adapter rewrites them to $1, $2, …
 */

import 'dotenv/config'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const usePostgres = Boolean(process.env.DATABASE_URL)

async function createSqliteAdapter() {
  const { DatabaseSync } = await import('node:sqlite')

  const dbPath = process.env.DB_PATH
    ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'mfapi.db')

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA synchronous = NORMAL')

  const cache = new Map()
  const prep = (text) => {
    let stmt = cache.get(text)
    if (!stmt) { stmt = db.prepare(text); cache.set(text, stmt) }
    return stmt
  }

  return {
    driver: 'sqlite',
    async all(text, params = []) { return prep(text).all(...params) },
    async get(text, params = []) { return prep(text).get(...params) },
    async run(text, params = []) { return { changes: prep(text).run(...params).changes } },
  }
}

async function createPostgresAdapter() {
  const { default: pg } = await import('pg')

  // Return DATE columns as 'YYYY-MM-DD' strings instead of JS Date objects.
  pg.types.setTypeParser(1082, val => val)

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: Number(process.env.PG_POOL_MAX ?? 5),
  })

  const toPg = (text) => { let i = 0; return text.replace(/\?/g, () => `$${++i}`) }

  return {
    driver: 'postgres',
    async all(text, params = []) {
      const res = await pool.query(toPg(text), params)
      return res.rows
    },
    async get(text, params = []) {
      const res = await pool.query(toPg(text), params)
      return res.rows[0] ?? undefined
    },
    async run(text, params = []) {
      const res = await pool.query(toPg(text), params)
      return { changes: res.rowCount ?? 0 }
    },
  }
}

export const sql = usePostgres
  ? await createPostgresAdapter()
  : await createSqliteAdapter()
