/**
 * holdings.test.js — portfolio holdings feature.
 *
 *  1. Pure unit tests for num() / normalizeHoldings() (no DB, no network).
 *  2. Route + cache tests against a throwaway seeded SQLite DB, with global
 *     fetch stubbed so finapi is never actually called.
 *
 * Run with the rest of the suite:  node --experimental-sqlite --test
 */

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { num, normalizeHoldings } from '../lib/finapi.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── 1. pure normalization ─────────────────────────────────────

test('num parses Indian-formatted numeric strings', () => {
  assert.equal(num('9,771.49'), 9771.49)
  assert.equal(num('96.24'), 96.24)
  assert.equal(num('-0.67'), -0.67)
  assert.equal(num('0.00'), 0)
  assert.equal(num('₹2,42,065.01 Cr'), 242065.01)
})

test('num returns null for empty / missing / non-numeric', () => {
  assert.equal(num(null), null)
  assert.equal(num(undefined), null)
  assert.equal(num(''), null)
  assert.equal(num('N/A'), null)
  assert.equal(num('-'), null)
})

const SAMPLE = {
  portfolio: {
    assetAllocation: { equityAllocation: '96.24', debtAllocation: '0.48', cashAllocation: '3.28', otherAllocation: '0.00' },
    marketCapWeightage: { largeCap: '72.18', midCap: '13.74', smallCap: '9.35', others: '4.73' },
    concentration: { numberOfHoldings: 77, top3SectorWeight: '64.96', top5StocksWeight: '30.56', top10StocksWeight: '46.56', averageMarketCap: '₹2,42,065.01 Cr' },
  },
  holdings: [
    { name: 'ICICI Bank Ltd', sector: 'Financial Services', marketValue: '9,771.49', weightage: '9.18', change1M: '-0.67' },
    { name: 'Axis Bank Ltd', sector: 'Financial Services', marketValue: '7,280.97', weightage: '6.84', change1M: '0.00' },
  ],
  sectors: [
    { sector: 'Financial Services', marketValue: '38,637.30', weightage: '36.28', change1M: '471.40' },
  ],
}

test('normalizeHoldings shapes and coerces the finapi payload', () => {
  const n = normalizeHoldings(SAMPLE)
  assert.deepEqual(n.asset_allocation, { equity: 96.24, debt: 0.48, cash: 3.28, other: 0 })
  assert.deepEqual(n.market_cap, { large: 72.18, mid: 13.74, small: 9.35, others: 4.73 })
  // number_of_holdings trusts the actual array length over finapi's stated count
  assert.equal(n.concentration.number_of_holdings, 2)
  assert.equal(n.concentration.average_market_cap_cr, 242065.01)
  assert.equal(n.holdings[0].name, 'ICICI Bank Ltd')
  assert.equal(n.holdings[0].weightage, 9.18)
  assert.equal(n.holdings[0].market_value_cr, 9771.49)
  assert.equal(n.sectors[0].weightage, 36.28)
})

test('normalizeHoldings is defensive about missing sections', () => {
  const n = normalizeHoldings({})
  assert.deepEqual(n.holdings, [])
  assert.deepEqual(n.sectors, [])
  assert.equal(n.asset_allocation.equity, null)
  assert.equal(n.market_cap.large, null)
  assert.equal(n.concentration.number_of_holdings, null)
})

// ── 2. route + cache behavior ─────────────────────────────────

const DB_PATH = join(tmpdir(), `mf-holdings-test-${process.pid}-${Date.now()}.db`)
process.env.DATABASE_URL   = ''
process.env.DB_PATH        = DB_PATH
process.env.AXIOM_TOKEN    = ''
process.env.AXIOM_DATASET  = ''
process.env.HOLDINGS_TTL_HOURS = '24'

function seed() {
  const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8')
  const db = new DatabaseSync(DB_PATH)
  db.exec(schema)
  db.exec(`INSERT INTO fund_houses (id, name) VALUES (9, 'HDFC Mutual Fund')`)
  db.exec(`INSERT INTO scheme_categories (id, name, broad_category)
           VALUES (43, 'Equity Scheme - Flexi Cap Fund', 'Equity Scheme')`)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id)
           VALUES (101762, 'HDFC Flexi Cap Fund - Growth Plan', 9, 43)`)
  db.close()
}

let app
const realFetch = global.fetch
let fetchCalls = 0

function stubFetch(handler) {
  fetchCalls = 0
  global.fetch = async (...args) => { fetchCalls++; return handler(...args) }
}

const jsonResponse = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json' },
})

before(async () => {
  seed()
  const { build } = await import('../app.js')
  app = await build({ logger: false })
  await app.ready()
})

after(async () => {
  global.fetch = realFetch
  if (app) await app.close()
  for (const s of ['', '-wal', '-shm']) { try { rmSync(DB_PATH + s, { force: true }) } catch { /* ignore */ } }
})

test('GET /schemes/:code/holdings fetches, normalizes, and caches', async () => {
  stubFetch(async () => jsonResponse({ status: 'success', statusCode: 200, data: SAMPLE }))

  const r1 = await app.inject({ method: 'GET', url: '/schemes/101762/holdings' })
  assert.equal(r1.statusCode, 200)
  const b1 = r1.json()
  assert.equal(b1.scheme_name, 'HDFC Flexi Cap Fund - Growth Plan') // identity from our DB
  assert.equal(b1.holdings[0].name, 'ICICI Bank Ltd')
  assert.equal(b1.asset_allocation.equity, 96.24)
  assert.equal(b1.cached, false)
  assert.equal(b1.source, undefined) // upstream vendor is not exposed publicly
  assert.equal(fetchCalls, 1)

  // Second call is served from the DB cache — finapi is NOT hit again.
  const r2 = await app.inject({ method: 'GET', url: '/schemes/101762/holdings' })
  assert.equal(r2.statusCode, 200)
  assert.equal(r2.json().cached, true)
  assert.equal(fetchCalls, 1, 'cache hit must not call finapi')
})

test('holdings response is edge-cached for 1h, not 60s', async () => {
  const r = await app.inject({ method: 'GET', url: '/schemes/101762/holdings' })
  assert.match(r.headers['cache-control'] ?? '', /s-maxage=3600/)
})

test('unknown scheme returns 404 without calling finapi', async () => {
  stubFetch(async () => jsonResponse({ status: 'success', data: SAMPLE }))
  const r = await app.inject({ method: 'GET', url: '/schemes/999999/holdings' })
  assert.equal(r.statusCode, 404)
  assert.equal(fetchCalls, 0)
})

test('finapi 404 negative-caches and returns null allocation', async () => {
  // scheme 202020 exists in our DB but finapi has no portfolio for it
  const db = new DatabaseSync(DB_PATH)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id)
           VALUES (202020, 'Some Debt Fund - Growth', 9, 43)`)
  db.close()

  stubFetch(async () => jsonResponse({ status: 'error', statusCode: 404, message: 'not found' }, 404))
  const r1 = await app.inject({ method: 'GET', url: '/schemes/202020/holdings' })
  assert.equal(r1.statusCode, 200)
  assert.equal(r1.json().holdings, null)
  assert.match(r1.json().note ?? '', /No portfolio data/)
  assert.equal(fetchCalls, 1)

  // negative cache: a repeat does not hit finapi again
  const r2 = await app.inject({ method: 'GET', url: '/schemes/202020/holdings' })
  assert.equal(r2.json().holdings, null)
  assert.equal(fetchCalls, 1)
})

test('finapi failure with no cache surfaces as 503', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id)
           VALUES (303030, 'Another Fund - Growth', 9, 43)`)
  db.close()

  stubFetch(async () => jsonResponse({ status: 'error' }, 429))
  const r = await app.inject({ method: 'GET', url: '/schemes/303030/holdings' })
  assert.equal(r.statusCode, 503)
  assert.match(r.json().error, /temporarily unavailable/)
})
