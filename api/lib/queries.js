/**
 * queries.js — shared data-access layer.
 *
 * The single source of truth for every read query. Both the REST routes
 * (routes/*.js) and the MCP server (routes/mcp.js) call these functions, so the
 * SQL lives in exactly one place and the two surfaces can't drift.
 *
 * Conventions:
 *   • All SQL uses `?` placeholders — portable across SQLite and Postgres.
 *   • Simple lookups return the data payload, or `null` when there is no data.
 *   • Analytics return a discriminated result `{ ok, data }` | `{ ok, status,
 *     error }` so callers can map the two distinct failure modes (no NAV data
 *     vs. insufficient history / bad input) to the right status / message.
 */

import { sql } from '../db/index.js'
import {
  trailingReturns, rollingReturns, riskMetrics, simulateSip, parseWindow,
} from './finance.js'

// Pagination bounds — keep result sets small and predictable.
const DEFAULT_LIMIT = 20
const MAX_LIMIT     = 100

// ── SQL ───────────────────────────────────────────────────────

const LIST = `
  SELECT
    s.scheme_code,
    s.scheme_name,
    f.name  AS fund_house,
    c.name  AS category,
    c.broad_category
  FROM schemes s
  LEFT JOIN fund_houses       f ON f.id = s.fund_house_id
  LEFT JOIN scheme_categories c ON c.id = s.scheme_category_id
  WHERE
    (CAST(? AS TEXT)    IS NULL OR LOWER(s.scheme_name) LIKE LOWER(?))
    AND (CAST(? AS INTEGER) IS NULL OR s.fund_house_id      = ?)
    AND (CAST(? AS INTEGER) IS NULL OR s.scheme_category_id = ?)
    AND (CAST(? AS TEXT)    IS NULL OR c.broad_category     = ?)
  ORDER BY s.scheme_name
  LIMIT ? OFFSET ?
`

const LIST_COUNT = `
  SELECT COUNT(*) AS total
  FROM schemes s
  LEFT JOIN scheme_categories c ON c.id = s.scheme_category_id
  WHERE
    (CAST(? AS TEXT)    IS NULL OR LOWER(s.scheme_name) LIKE LOWER(?))
    AND (CAST(? AS INTEGER) IS NULL OR s.fund_house_id      = ?)
    AND (CAST(? AS INTEGER) IS NULL OR s.scheme_category_id = ?)
    AND (CAST(? AS TEXT)    IS NULL OR c.broad_category     = ?)
`

const SCHEME_DETAIL = `
  SELECT
    s.scheme_code,
    s.scheme_name,
    s.isin_growth,
    s.isin_div_reinvestment,
    s.last_synced_at,
    f.name AS fund_house,
    c.name AS category,
    c.broad_category,
    (SELECT nav      FROM nav_history n WHERE n.scheme_code = s.scheme_code ORDER BY nav_date DESC LIMIT 1) AS nav,
    (SELECT nav_date FROM nav_history n WHERE n.scheme_code = s.scheme_code ORDER BY nav_date DESC LIMIT 1) AS nav_date
  FROM schemes s
  LEFT JOIN fund_houses       f ON f.id = s.fund_house_id
  LEFT JOIN scheme_categories c ON c.id = s.scheme_category_id
`

const BY_CODE = SCHEME_DETAIL + `WHERE s.scheme_code = ?`
const BY_ISIN = SCHEME_DETAIL + `WHERE s.isin_growth = ? OR s.isin_div_reinvestment = ?`

const NAV = `
  SELECT s.scheme_name, n.nav_date, n.nav
  FROM nav_history n
  JOIN schemes s ON s.scheme_code = n.scheme_code
  WHERE n.scheme_code = ?
    AND (CAST(? AS TEXT) IS NULL OR n.nav_date >= ?)
    AND (CAST(? AS TEXT) IS NULL OR n.nav_date <= ?)
  ORDER BY n.nav_date DESC
`

const NAV_LATEST = `
  SELECT s.scheme_name, n.nav_date, n.nav
  FROM nav_history n
  JOIN schemes s ON s.scheme_code = n.scheme_code
  WHERE n.scheme_code = ?
  ORDER BY n.nav_date DESC
  LIMIT 1
`

const SERIES = `
  SELECT s.scheme_name, n.nav_date, n.nav
  FROM nav_history n
  JOIN schemes s ON s.scheme_code = n.scheme_code
  WHERE n.scheme_code = ?
  ORDER BY n.nav_date ASC
`

const FUND_HOUSES = `
  SELECT id AS fund_house_id, name
  FROM fund_houses
  ORDER BY name
`

const CATEGORIES = `
  SELECT id, name, broad_category
  FROM scheme_categories
  ORDER BY broad_category, name
`

// ── catalogs ──────────────────────────────────────────────────

export async function listFundHouses() {
  return sql.all(FUND_HOUSES)
}

export async function listCategories() {
  return sql.all(CATEGORIES)
}

// ── schemes ───────────────────────────────────────────────────

export async function searchSchemes({ q, fund_house_id, category_id, broad_category, page, limit } = {}) {
  // Clamp pagination to safe bounds — guards against unbounded result sets,
  // NaN (e.g. limit="abc"), and negative offsets (e.g. page=-5).
  const pageN   = Math.max(1, Math.floor(Number(page) || 1))
  const limitN  = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limit) || DEFAULT_LIMIT)))
  const offset  = (pageN - 1) * limitN

  const search   = q ? `%${q}%` : null
  const fhId     = fund_house_id  ? Number(fund_house_id)  : null
  const catId    = category_id    ? Number(category_id)    : null
  const broadCat = broad_category ?? null

  const filters = [search, search, fhId, fhId, catId, catId, broadCat, broadCat]

  const countRow = await sql.get(LIST_COUNT, filters)
  const data     = await sql.all(LIST, [...filters, limitN, offset])

  return { total: Number(countRow.total), page: pageN, limit: limitN, data }
}

export async function getSchemeByCode(code) {
  return (await sql.get(BY_CODE, [Number(code)])) ?? null
}

export async function getSchemeByIsin(isin) {
  return (await sql.get(BY_ISIN, [isin, isin])) ?? null
}

export async function getNavHistory(code, startDate = null, endDate = null) {
  const c = Number(code)
  const rows = await sql.all(NAV, [c, startDate, startDate, endDate, endDate])
  if (!rows.length) return null
  return {
    scheme_code: c,
    scheme_name: rows[0].scheme_name,
    data: rows.map(({ nav_date, nav }) => ({ nav_date, nav })),
  }
}

export async function getLatestNav(code) {
  const c = Number(code)
  const row = await sql.get(NAV_LATEST, [c])
  if (!row) return null
  return { scheme_code: c, scheme_name: row.scheme_name, nav_date: row.nav_date, nav: row.nav }
}

// ── analytics ─────────────────────────────────────────────────

async function loadSeries(code) {
  const rows = await sql.all(SERIES, [Number(code)])
  if (!rows.length) return null
  return {
    scheme_name: rows[0].scheme_name,
    series: rows.map((r) => ({ nav_date: r.nav_date, nav: r.nav })),
  }
}

export async function getReturns(code) {
  const c = Number(code)
  const loaded = await loadSeries(c)
  if (!loaded) return { ok: false, status: 404, error: 'No NAV data found' }
  const result = trailingReturns(loaded.series)
  if (!result) return { ok: false, status: 404, error: 'Insufficient NAV history' }
  return { ok: true, data: { scheme_code: c, scheme_name: loaded.scheme_name, ...result } }
}

export async function getRolling(code, { window = '3Y', beat } = {}) {
  const c = Number(code)
  const win = parseWindow(window)
  if (!win) return { ok: false, status: 400, error: 'Invalid window — use e.g. 1Y, 3Y, 6M' }
  const beatN = Number.isFinite(Number(beat)) ? Number(beat) : 12

  const loaded = await loadSeries(c)
  if (!loaded) return { ok: false, status: 404, error: 'No NAV data found' }

  const rolling = rollingReturns(loaded.series, win, beatN)
  if (!rolling) return { ok: false, status: 404, error: 'Insufficient history for this window' }
  return { ok: true, data: { scheme_code: c, scheme_name: loaded.scheme_name, window, ...rolling } }
}

export async function getRisk(code, { rf } = {}) {
  const c = Number(code)
  const rfN = Number.isFinite(Number(rf)) ? Number(rf) : 6
  const loaded = await loadSeries(c)
  if (!loaded) return { ok: false, status: 404, error: 'No NAV data found' }
  const risk = riskMetrics(loaded.series, rfN)
  if (!risk) return { ok: false, status: 404, error: 'Insufficient NAV history' }
  return { ok: true, data: { scheme_code: c, scheme_name: loaded.scheme_name, ...risk } }
}

export async function getSip(code, { amount, from, to, day } = {}) {
  const c = Number(code)
  const amt = Number(amount) > 0 ? Number(amount) : 5000
  const dayN = Number(day) >= 1 && Number(day) <= 28 ? Math.floor(Number(day)) : undefined

  const loaded = await loadSeries(c)
  if (!loaded) return { ok: false, status: 404, error: 'No NAV data found' }

  const sip = simulateSip(loaded.series, { amount: amt, day: dayN, from: from ?? null, to: to ?? null })
  if (!sip) return { ok: false, status: 400, error: 'No SIP installments fall within the available data range' }
  return { ok: true, data: { scheme_code: c, scheme_name: loaded.scheme_name, frequency: 'monthly', sip } }
}
