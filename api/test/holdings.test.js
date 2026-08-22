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

import {
  num, normalizeHoldings, sectorForHolding, withPreciousMetalsSector, PRECIOUS_METALS_SECTOR,
} from '../lib/finapi.js'
import { buildPayload } from '../lib/curated-holdings.js'

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

// ── 1b. gold / silver reclassification ────────────────────────

test('sectorForHolding routes bullion out of the unclassified bucket', () => {
  for (const name of ['SBI Gold ETF', 'Gold FoF', 'Nippon India ETF Gold BeES',
                      'ICICI Prudential Silver ETF', 'Axis Silver ETF', 'gold etf fof']) {
    assert.equal(sectorForHolding(name, null), PRECIOUS_METALS_SECTOR, name)
  }
  // Upstream sometimes files them under cash/debt; the name still wins.
  assert.equal(sectorForHolding('SBI Gold ETF', 'Cash / Debt Instrument'), PRECIOUS_METALS_SECTOR)
})

test('sectorForHolding does not catch equities that merely start with those letters', () => {
  assert.equal(sectorForHolding('Goldman Sachs Group Inc', 'Financial Services'), 'Financial Services')
  assert.equal(sectorForHolding('Goldiam International Ltd', 'Consumer Cyclical'), 'Consumer Cyclical')
  assert.equal(sectorForHolding('Golden Tobacco Ltd', 'Consumer Defensive'), 'Consumer Defensive')
  assert.equal(sectorForHolding('HDFC Bank Ltd', 'Financial Services'), 'Financial Services')
  assert.equal(sectorForHolding('Some Unlisted Co', null), null)
  assert.equal(sectorForHolding(null, null), null)
})

test('withPreciousMetalsSector sums bullion into one weight-sorted row', () => {
  const holdings = [
    { name: 'Axis Gold ETF',   sector: PRECIOUS_METALS_SECTOR, weightage: 8.6,  market_value_cr: 100 },
    { name: 'Axis Silver ETF', sector: PRECIOUS_METALS_SECTOR, weightage: 2.44, market_value_cr: 30 },
    { name: 'HDFC Bank',       sector: 'Financial Services',   weightage: 5,    market_value_cr: 60 },
  ]
  const sectors = [
    { sector: 'Financial Services', weightage: 23.02, market_value_cr: 300, change_1m: 1 },
    { sector: 'Technology',         weightage: 6.11,  market_value_cr: 80,  change_1m: 0 },
    { sector: 'Utilities',          weightage: 1.97,  market_value_cr: 20,  change_1m: 0 },
  ]

  const out = withPreciousMetalsSector(holdings, sectors)
  assert.deepEqual(out.map((s) => s.sector),
    ['Financial Services', PRECIOUS_METALS_SECTOR, 'Technology', 'Utilities'])
  // 8.6 + 2.44 must not surface as 11.040000000000001
  assert.equal(out[1].weightage, 11.04)
  assert.equal(out[1].market_value_cr, 130)
})

test('withPreciousMetalsSector leaves a bullion-free portfolio untouched', () => {
  const sectors = [{ sector: 'Financial Services', weightage: 23.02, market_value_cr: 300, change_1m: 0 }]
  assert.equal(withPreciousMetalsSector([{ name: 'HDFC Bank', sector: 'Financial Services', weightage: 5 }], sectors),
    sectors)
})

test('normalizeHoldings reclassifies bullion end to end', () => {
  const n = normalizeHoldings({
    holdings: [
      { name: 'HDFC Bank Ltd',      sector: 'Financial Services', weightage: '9.18', marketValue: '100' },
      { name: 'Aditya BSL Gold ETF',   sector: null,              weightage: '8.60', marketValue: '90' },
      { name: 'Aditya BSL Silver ETF', sector: null,              weightage: '2.44', marketValue: '25' },
    ],
    sectors: [{ sector: 'Financial Services', weightage: '23.02', marketValue: '300' }],
  })

  assert.equal(n.holdings[1].sector, PRECIOUS_METALS_SECTOR)
  assert.equal(n.holdings[2].sector, PRECIOUS_METALS_SECTOR)
  assert.equal(n.holdings[0].sector, 'Financial Services')
  const gold = n.sectors.find((s) => s.sector === PRECIOUS_METALS_SECTOR)
  assert.ok(gold, 'bullion must appear in the sector mix, not vanish')
  assert.equal(gold.weightage, 11.04)
  assert.equal(gold.market_value_cr, 115)
})

// ── 1c. curated (manual) records ──────────────────────────────

const CURATED = {
  schemes: [140273, 140274],
  as_of: '2026-07-31',
  note: 'Look-through portfolio.',
  asset_allocation: { equity: 97.4, debt: 0, cash: 2.7, other: 0 },
  holdings: [
    ['Amazon.com', 'Consumer Discretionary', 6.4], ['Microsoft', 'Information Technology', 5.3],
    ['Apple', 'Information Technology', 3.9],      ['Wells Fargo', 'Financials', 2.3],
    ['Bank of America', 'Financials', 2.3],        ['Johnson & Johnson', 'Health Care', 2.1],
    ['Chevron', 'Energy', 2.0],                    ['Morgan Stanley', 'Financials', 2.0],
    ['ConocoPhillips', 'Energy', 1.9],             ['Citigroup', 'Financials', 1.8],
  ],
  sectors: [
    ['Financials', 21.0], ['Information Technology', 17.1], ['Health Care', 13.5],
    ['Consumer Discretionary', 12.6], ['Industrials', 10.8], ['Cash', 2.7],
  ],
}

test('buildPayload emits the normalized shape and derives concentration', () => {
  const p = buildPayload(CURATED)
  assert.equal(p.manual, true)
  assert.equal(p.asset_allocation.equity, 97.4)
  assert.equal(p.market_cap.large, null)            // unknown, not zero
  assert.equal(p.holdings[0].name, 'Amazon.com')
  assert.equal(p.holdings[0].sector, 'Consumer Discretionary')
  assert.equal(p.concentration.top5_stocks_weight, 20.2)   // 6.4+5.3+3.9+2.3+2.3
  assert.equal(p.concentration.top10_stocks_weight, 30)    // whole published list
  assert.equal(p.concentration.top3_sector_weight, 51.6)   // 21.0+17.1+13.5
  // Only the top slice is published, so the real count is unknown.
  assert.equal(p.concentration.number_of_holdings, null)
})

test('buildPayload reports null concentration when too few rows are published', () => {
  const p = buildPayload({ holdings: [['Amazon.com', 'Consumer Discretionary', 6.4]], sectors: [] })
  assert.equal(p.concentration.top5_stocks_weight, null)
  assert.equal(p.concentration.top10_stocks_weight, null)
  assert.equal(p.concentration.top3_sector_weight, null)
})

test('the shipped manual-holdings file builds cleanly', async () => {
  const records = (await import('../data/manual-holdings.js')).default
  assert.ok(records.length > 0)
  for (const rec of records) {
    assert.ok(Array.isArray(rec.schemes) && rec.schemes.length, 'record needs scheme codes')
    assert.match(rec.as_of, /^\d{4}-\d{2}-\d{2}$/, 'as_of must be YYYY-MM-DD')
    const p = buildPayload(rec)
    assert.equal(p.manual, true)
    for (const h of p.holdings) {
      assert.ok(h.name, 'holding needs a name')
      assert.ok(Number.isFinite(h.weightage), `bad weight on ${h.name}`)
    }
    for (const s of p.sectors) assert.ok(Number.isFinite(s.weightage), `bad weight on ${s.sector}`)
  }
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

test('a curated row is pinned: served past the TTL, upstream never called', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id)
           VALUES (140274, 'Edelweiss US Value Equity Offshore Fund - Direct Plan - Growth Option', 9, 43)`)
  // fetched_at a year ago: far outside HOLDINGS_TTL_HOURS, so a non-pinned row
  // would refetch here.
  db.prepare(`INSERT INTO fund_holdings (scheme_code, fetched_at, holdings_date, payload)
              VALUES (?, ?, ?, ?)`)
    .run(140274, '2025-08-01T00:00:00.000Z', '2026-07-31', JSON.stringify(buildPayload(CURATED)))
  db.close()

  stubFetch(async () => jsonResponse({ status: 'success', data: SAMPLE }))
  const r = await app.inject({ method: 'GET', url: '/schemes/140274/holdings' })
  assert.equal(r.statusCode, 200)
  const b = r.json()
  assert.equal(fetchCalls, 0, 'a pinned row must never hit upstream')
  assert.equal(b.holdings[0].name, 'Amazon.com')
  assert.equal(b.cached, true)
  assert.equal(b.manual, true)
  assert.match(b.note, /Look-through/)
  // as_of is the portfolio date, not the row's write timestamp
  assert.equal(b.as_of, '2026-07-31')
})

test('a corrupt cached payload refetches instead of throwing', async () => {
  const db = new DatabaseSync(DB_PATH)
  db.exec(`INSERT INTO schemes (scheme_code, scheme_name, fund_house_id, scheme_category_id)
           VALUES (404040, 'Corrupt Cache Fund - Growth', 9, 43)`)
  db.prepare(`INSERT INTO fund_holdings (scheme_code, fetched_at, payload) VALUES (?, ?, ?)`)
    .run(404040, new Date().toISOString(), '{not json')
  db.close()

  stubFetch(async () => jsonResponse({ status: 'success', data: SAMPLE }))
  const r = await app.inject({ method: 'GET', url: '/schemes/404040/holdings' })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json().holdings[0].name, 'ICICI Bank Ltd')
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
