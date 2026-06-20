/**
 * seed.js — 5-year NAV history seed from mfapi.in into SQLite
 *
 * Usage:
 *   node pipeline/seed.js           # skips schemes already in nav_history
 *   node pipeline/seed.js --force   # re-syncs every scheme regardless
 *
 * Phases:
 *   1. Apply schema (idempotent — CREATE TABLE IF NOT EXISTS)
 *   2. Seed fund_houses + scheme_categories from local CSVs
 *   3. Pre-seed scheme names from mfFileMapper.csv (one bulk transaction)
 *   4. Fetch all ~15 000 scheme codes from mfapi.in
 *   5. For each pending code (CONCURRENCY parallel):
 *        GET /mf/{code}?startDate=   → meta + 5-year nav history
 *        UPSERT schemes + nav_history inside one transaction
 */

import 'dotenv/config'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { db } from '../db/client.js'

const ROOT        = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE        = process.env.MFAPI_BASE ?? 'https://api.mfapi.in'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)
const FORCE       = process.argv.includes('--force')
const NAV_YEARS   = Number(process.env.NAV_YEARS ?? 5)
const LIMIT       = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 ? Number(process.argv[i+1]) : Infinity })()

function navStartDate() {
  const d = new Date()
  d.setFullYear(d.getFullYear() - NAV_YEARS)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const START_DATE = navStartDate()

// ── CSV ──────────────────────────────────────────────────────

function loadCsv(filename) {
  const lines = readFileSync(join(ROOT, filename), 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim())
  const headers = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const parts = []
    let rest = line
    for (let i = 0; i < headers.length - 1; i++) {
      const idx = rest.indexOf(',')
      parts.push(rest.slice(0, idx).trim())
      rest = rest.slice(idx + 1)
    }
    parts.push(rest.trim())
    return Object.fromEntries(headers.map((h, i) => [h, parts[i]]))
  })
}

function broadCategory(name) {
  return name.includes(' - ') ? name.split(' - ')[0] : name
}

// ── Date parsing ─────────────────────────────────────────────

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
                 Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }

function parseDate(str) {
  const [d, m, y] = str.split('-')
  const month = MONTHS[m] ?? Number(m)   // handles both "Apr" and "04"
  return `${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

// ── Transaction helper ────────────────────────────────────────

function inTransaction(fn) {
  db.exec('BEGIN')
  try { fn(); db.exec('COMMIT') }
  catch (e) { db.exec('ROLLBACK'); throw e }
}

// ── Prepared statements ───────────────────────────────────────

function prepareStatements() {
  return {
    upsertFundHouse: db.prepare(
      `INSERT INTO fund_houses (id, name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`
    ),
    upsertCategory: db.prepare(
      `INSERT INTO scheme_categories (id, name, broad_category) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, broad_category = excluded.broad_category`
    ),
    preSeedScheme: db.prepare(
      `INSERT INTO schemes (scheme_code, scheme_name) VALUES (?, ?)
       ON CONFLICT(scheme_code) DO NOTHING`
    ),
    upsertScheme: db.prepare(
      `INSERT INTO schemes
         (scheme_code, scheme_name, fund_house_id, scheme_category_id,
          isin_growth, isin_div_reinvestment, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(scheme_code) DO UPDATE SET
         scheme_name           = excluded.scheme_name,
         fund_house_id         = excluded.fund_house_id,
         scheme_category_id    = excluded.scheme_category_id,
         isin_growth           = excluded.isin_growth,
         isin_div_reinvestment = excluded.isin_div_reinvestment,
         last_synced_at        = datetime('now')`
    ),
    upsertNav: db.prepare(
      `INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES (?, ?, ?)
       ON CONFLICT(scheme_code, nav_date) DO NOTHING`
    ),
    countNav: db.prepare(
      `SELECT DISTINCT scheme_code FROM nav_history`
    ),
  }
}

// ── Phase 1: schema ───────────────────────────────────────────

function applySchema() {
  const sql = readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8')
  db.exec(sql)
}

// ── Phase 2: lookup tables ────────────────────────────────────

function seedLookups(stmts) {
  const houses = loadCsv('mfHouseMapper.csv')
  const types  = loadCsv('mfTypeMapper.csv')

  inTransaction(() => {
    for (const r of houses) stmts.upsertFundHouse.run(Number(r.UniqueCode), r.Name)
    for (const r of types)  stmts.upsertCategory.run(Number(r.UniqueCode), r.SchemeType, broadCategory(r.SchemeType))
  })

  console.log(`  ${houses.length} fund houses, ${types.length} scheme categories loaded`)

  return {
    fundHouseMap: new Map(houses.map(r => [r.Name, Number(r.UniqueCode)])),
    schemeCatMap: new Map(types.map(r => [r.SchemeType, Number(r.UniqueCode)])),
  }
}

// ── Phase 3: pre-seed scheme names ───────────────────────────

function preSeedSchemes(stmts) {
  const rows = loadCsv('mfFileMapper.csv')
  inTransaction(() => {
    for (const r of rows) stmts.preSeedScheme.run(Number(r.ISIN), r.Name)
  })
  console.log(`  ${rows.length} schemes pre-seeded from mfFileMapper.csv`)
}

// ── Network ──────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchWithRetry(url, retries = 4) {
  let delay = 1000
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res.json()
      if (res.status === 429) {
        console.warn(`  [rate-limit] backing off ${delay}ms`)
        await sleep(delay); delay *= 2; continue
      }
      throw new Error(`HTTP ${res.status} — ${url}`)
    } catch (err) {
      if (attempt === retries) throw err
      await sleep(delay); delay *= 2
    }
  }
}

// ── Concurrency pool ─────────────────────────────────────────

function makePool(limit) {
  let active = 0
  const queue = []
  function drain() {
    while (active < limit && queue.length) {
      const { fn, resolve, reject } = queue.shift()
      active++
      fn().then(resolve, reject).finally(() => { active--; drain() })
    }
  }
  return fn => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); drain() })
}

// ── Phase 5: per-scheme upsert ────────────────────────────────

async function processScheme(schemeCode, idx, total, maps, stmts) {
  const data = await fetchWithRetry(`${BASE}/mf/${schemeCode}?startDate=${START_DATE}`)

  if (data.status !== 'SUCCESS') {
    console.warn(`  [skip] ${schemeCode} — status: ${data.status}`)
    return
  }

  const { meta } = data
  const fundHouseId = maps.fundHouseMap.get(meta.fund_house)      ?? null
  const schemeCatId = maps.schemeCatMap.get(meta.scheme_category) ?? null

  const navRows = data.data ?? []
  const parsed  = []
  for (const row of navRows) {
    try { parsed.push([Number(meta.scheme_code), parseDate(row.date), Number(row.nav)]) } catch {}
  }

  // Atomic: scheme metadata + all NAV rows in one transaction
  inTransaction(() => {
    stmts.upsertScheme.run(
      Number(meta.scheme_code),
      meta.scheme_name,
      fundHouseId,
      schemeCatId,
      meta.isin_growth           ?? null,
      meta.isin_div_reinvestment ?? null,
    )
    for (const args of parsed) stmts.upsertNav.run(...args)
  })

  console.log(`  [${idx}/${total}] ${schemeCode} — ${meta.scheme_name} (${parsed.length} nav rows)`)
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log('Phase 1: Applying schema...')
  applySchema()

  const stmts = prepareStatements()

  console.log('Phase 2: Loading lookup tables from CSVs...')
  const maps = seedLookups(stmts)

  console.log('Phase 3: Pre-seeding scheme names from mfFileMapper.csv...')
  preSeedSchemes(stmts)

  console.log(`Phase 4: Fetching scheme list from mfapi.in (NAV from ${START_DATE})...`)
  const allSchemes = await fetchWithRetry(`${BASE}/mf`)
  console.log(`  Total schemes: ${allSchemes.length}`)

  let pending = allSchemes.map(s => s.schemeCode)

  if (!FORCE) {
    const done = new Set(stmts.countNav.all().map(r => r.scheme_code))
    pending = pending.filter(code => !done.has(code))
    console.log(`  Already seeded: ${done.size}  |  Remaining: ${pending.length}`)
  }

  if (isFinite(LIMIT)) {
    pending = pending.slice(0, LIMIT)
    console.log(`  Test mode: capped at ${LIMIT} schemes`)
  }

  if (!pending.length) {
    console.log('Nothing to do. Use --force to re-sync everything.')
    return
  }

  console.log('Phase 5: Seeding NAV history...')
  const total    = pending.length
  const schedule = makePool(CONCURRENCY)
  const failed   = []

  await Promise.all(
    pending.map((code, i) =>
      schedule(async () => {
        try {
          await processScheme(code, i + 1, total, maps, stmts)
        } catch (err) {
          console.error(`  [ERROR] ${code}: ${err.message}`)
          failed.push(code)
        }
      })
    )
  )

  console.log('\n--- Seed complete ---')
  console.log(`Processed: ${total - failed.length} / ${total}`)
  if (failed.length) {
    console.log(`Failed (${failed.length}): ${failed.join(', ')}`)
    console.log('Re-run with the same command to retry failed schemes.')
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
