/**
 * update.js — incremental NAV top-up from mfapi.in into SQLite
 *
 * Appends only the MISSING recent NAV rows for schemes that already have
 * history, bringing each time series up to yesterday. No deletions; uses
 * ON CONFLICT DO NOTHING so it is safe to re-run.
 *
 * Usage:
 *   node --experimental-sqlite pipeline/update.js
 *
 * For each scheme with existing nav_history:
 *   GET /mf/{code}?startDate={its latest nav_date}
 *   INSERT rows where  latest_date < nav_date <= yesterday
 */

import 'dotenv/config'
import { db } from '../db/client.js'

const BASE        = process.env.MFAPI_BASE ?? 'https://api.mfapi.in'
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)

// ── Dates ────────────────────────────────────────────────────

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function yesterday() {
  const d = new Date(); d.setDate(d.getDate() - 1); return iso(d)
}
const END_DATE = yesterday()

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
                 Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }

function parseDate(str) {
  const [d, m, y] = str.split('-')
  const month = MONTHS[m] ?? Number(m)   // handles both "Apr" and "04"
  return `${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

// ── Network ──────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function fetchWithRetry(url, retries = 4) {
  let delay = 1000
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res.json()
      if (res.status === 429) { await sleep(delay); delay *= 2; continue }
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

// ── Transaction + statements ─────────────────────────────────

function inTransaction(fn) {
  db.exec('BEGIN')
  try { fn(); db.exec('COMMIT') }
  catch (e) { db.exec('ROLLBACK'); throw e }
}

const upsertNav = db.prepare(
  `INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES (?, ?, ?)
   ON CONFLICT(scheme_code, nav_date) DO NOTHING`
)
const touchScheme = db.prepare(
  `UPDATE schemes SET last_synced_at = datetime('now') WHERE scheme_code = ?`
)

// ── Per-scheme top-up ────────────────────────────────────────

async function topUp({ scheme_code, last }) {
  const data = await fetchWithRetry(`${BASE}/mf/${scheme_code}?startDate=${last}`)
  if (data.status !== 'SUCCESS') return { code: scheme_code, added: 0, skipped: true }

  const rows = []
  for (const row of (data.data ?? [])) {
    let ymd
    try { ymd = parseDate(row.date) } catch { continue }
    if (ymd > last && ymd <= END_DATE) rows.push([scheme_code, ymd, Number(row.nav)])
  }

  if (rows.length) {
    inTransaction(() => {
      for (const args of rows) upsertNav.run(...args)
      touchScheme.run(scheme_code)
    })
  }
  return { code: scheme_code, added: rows.length, skipped: false }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const all = db.prepare(
    `SELECT scheme_code, MAX(nav_date) last FROM nav_history GROUP BY scheme_code`
  ).all()

  const pending = all.filter(r => r.last < END_DATE)
  console.log(`Schemes with history: ${all.length}`)
  console.log(`Target end date (yesterday): ${END_DATE}`)
  console.log(`Behind & to update: ${pending.length}  |  already current: ${all.length - pending.length}`)

  if (!pending.length) { console.log('Everything is already up to date.'); return }

  const schedule = makePool(CONCURRENCY)
  let done = 0, addedRows = 0, updatedSchemes = 0
  const failed = []

  await Promise.all(pending.map(r => schedule(async () => {
    try {
      const res = await topUp(r)
      addedRows += res.added
      if (res.added > 0) updatedSchemes++
    } catch (err) {
      failed.push(r.scheme_code)
    } finally {
      if (++done % 500 === 0 || done === pending.length) {
        console.log(`  [${done}/${pending.length}] +${addedRows} rows across ${updatedSchemes} schemes`)
      }
    }
  })))

  console.log('\n--- Update complete ---')
  console.log(`Schemes checked : ${pending.length}`)
  console.log(`Schemes updated : ${updatedSchemes}`)
  console.log(`NAV rows added  : ${addedRows}`)
  if (failed.length) {
    console.log(`Failed (${failed.length}): ${failed.slice(0,20).join(', ')}${failed.length>20?' …':''}`)
    console.log('Re-run to retry — already-added rows are skipped via ON CONFLICT.')
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
