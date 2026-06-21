/**
 * api.test.js — route tests against a seeded temporary SQLite database.
 *
 * Uses Node's built-in test runner (node:test) and Fastify's app.inject()
 * (no real port). Run with:  node --experimental-sqlite --test
 *
 * A throwaway SQLite file is seeded with one fund house / category / scheme
 * and two NAV rows, then the app is built against it. DATABASE_URL is forced
 * empty so the SQLite backend is used even if a local api/.env points at
 * Postgres.
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH   = join(tmpdir(), `mfapi-test-${process.pid}-${Date.now()}.db`)

// Force SQLite + temp DB BEFORE app.js (and its db adapter) is imported.
process.env.DATABASE_URL = ''
process.env.DB_PATH      = DB_PATH
process.env.AXIOM_TOKEN  = ''
process.env.AXIOM_DATASET = ''

function seed() {
  const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const db = new DatabaseSync(DB_PATH)
  db.exec(schema)
  db.exec(`INSERT INTO fund_houses (id, name) VALUES (9, 'HDFC Mutual Fund')`)
  db.exec(`INSERT INTO scheme_categories (id, name, broad_category)
           VALUES (43, 'Equity Scheme - Flexi Cap Fund', 'Equity Scheme')`)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id, isin_growth)
           VALUES (101762, 'HDFC Flexi Cap Fund - Growth Plan', 9, 43, 'INF179K01608')`)
  db.exec(`INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES
           (101762, '2026-06-19', 2001.5), (101762, '2026-06-20', 2000.1)`)
  db.close()
}

let app

before(async () => {
  seed()
  const { build } = await import('../app.js')
  app = await build({ logger: false })
  await app.ready()
})

after(async () => {
  if (app) await app.close()
  for (const suffix of ['', '-wal', '-shm']) {
    try { rmSync(DB_PATH + suffix, { force: true }) } catch { /* ignore */ }
  }
})

// ── Meta ──────────────────────────────────────────────────────

test('GET /health → 200 with sqlite driver', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json(), { status: 'ok', driver: 'sqlite' })
})

test('GET /openapi.json → 200 OpenAPI spec', async () => {
  const res = await app.inject({ url: '/openapi.json' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().openapi, '3.1.0')
})

// ── Lookups ───────────────────────────────────────────────────

test('GET /fund-houses → uses fund_house_id key', async () => {
  const res = await app.inject({ url: '/fund-houses' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().data[0].fund_house_id, 9)
})

test('GET /categories → returns category rows', async () => {
  const res = await app.inject({ url: '/categories' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().data.length, 1)
  assert.equal(res.json().data[0].broad_category, 'Equity Scheme')
})

// ── Search + pagination clamps ────────────────────────────────

test('GET /schemes?q= matches by name', async () => {
  const res = await app.inject({ url: '/schemes?q=flexi' })
  assert.equal(res.json().total, 1)
  assert.equal(res.json().data[0].scheme_code, 101762)
})

test('GET /schemes?q= miss returns empty', async () => {
  const res = await app.inject({ url: '/schemes?q=zzznotathing' })
  assert.equal(res.json().total, 0)
  assert.deepEqual(res.json().data, [])
})

test('limit is clamped to 100', async () => {
  const res = await app.inject({ url: '/schemes?limit=99999' })
  assert.equal(res.json().limit, 100)
})

test('non-numeric limit falls back to default 20', async () => {
  const res = await app.inject({ url: '/schemes?limit=abc' })
  assert.equal(res.json().limit, 20)
})

test('negative page does not 500 and floors to 1', async () => {
  const res = await app.inject({ url: '/schemes?page=-5&limit=2' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().page, 1)
})

// ── Scheme detail + ISIN ──────────────────────────────────────

test('GET /schemes/:code → detail with latest nav', async () => {
  const res = await app.inject({ url: '/schemes/101762' })
  assert.equal(res.statusCode, 200)
  const d = res.json().data
  assert.equal(d.scheme_code, 101762)
  assert.equal(d.fund_house, 'HDFC Mutual Fund')
  assert.equal(d.nav, 2000.1)            // newest of the two rows
  assert.equal(d.nav_date, '2026-06-20')
})

test('GET /schemes/:code → 404 for unknown', async () => {
  const res = await app.inject({ url: '/schemes/999999' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, 'Scheme not found')
})

test('GET /schemes/isin/:isin → resolves to scheme', async () => {
  const res = await app.inject({ url: '/schemes/isin/INF179K01608' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().data.scheme_code, 101762)
})

// ── NAV history ───────────────────────────────────────────────

test('GET /schemes/:code/nav → newest first', async () => {
  const res = await app.inject({ url: '/schemes/101762/nav' })
  const data = res.json().data
  assert.equal(data.length, 2)
  assert.equal(data[0].nav_date, '2026-06-20')
  assert.equal(data[1].nav_date, '2026-06-19')
})

test('GET /schemes/:code/nav?startDate=&endDate= filters range', async () => {
  const res = await app.inject({ url: '/schemes/101762/nav?startDate=2026-06-20&endDate=2026-06-20' })
  assert.equal(res.json().data.length, 1)
  assert.equal(res.json().data[0].nav_date, '2026-06-20')
})

test('GET /schemes/:code/nav/latest → most recent', async () => {
  const res = await app.inject({ url: '/schemes/101762/nav/latest' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().nav, 2000.1)
  assert.equal(res.json().nav_date, '2026-06-20')
})

test('GET /schemes/:code/nav/latest → 404 for unknown', async () => {
  const res = await app.inject({ url: '/schemes/999999/nav/latest' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, 'No NAV data found')
})

// ── Rate limiting ─────────────────────────────────────────────

test('exceeding the rate limit returns 429', async () => {
  process.env.RATE_LIMIT_MAX = '2'
  const { build } = await import('../app.js')
  const limited = await build({ logger: false })
  await limited.ready()

  const codes = []
  for (let i = 0; i < 4; i++) {
    const r = await limited.inject({ url: '/health' })
    codes.push(r.statusCode)
  }

  await limited.close()
  process.env.RATE_LIMIT_MAX = ''

  assert.ok(codes.includes(429), `expected a 429 after the cap; got ${codes.join(',')}`)
})
