import { sql } from '../db/index.js'

// ── SQL (portable between SQLite and Postgres; `?` placeholders) ──

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

// ── Route plugin ──────────────────────────────────────────────

export default async function schemesRoutes(fastify) {

  // GET /schemes?q=&fund_house_id=&category_id=&broad_category=&page=1&limit=20
  fastify.get('/', async (req) => {
    const { q, fund_house_id, category_id, broad_category, page = 1, limit = 20 } = req.query

    const offset   = (Number(page) - 1) * Number(limit)
    const search   = q ? `%${q}%` : null
    const fhId     = fund_house_id  ? Number(fund_house_id)  : null
    const catId    = category_id    ? Number(category_id)    : null
    const broadCat = broad_category ?? null

    const filters = [search, search, fhId, fhId, catId, catId, broadCat, broadCat]

    const countRow = await sql.get(LIST_COUNT, filters)
    const data     = await sql.all(LIST, [...filters, Number(limit), offset])

    return { total: Number(countRow.total), page: Number(page), limit: Number(limit), data }
  })

  // GET /schemes/isin/:isin  — lookup by ISIN (growth or div-reinvestment)
  fastify.get('/isin/:isin', async (req, reply) => {
    const scheme = await sql.get(BY_ISIN, [req.params.isin, req.params.isin])
    if (!scheme) return reply.code(404).send({ error: 'Scheme not found' })
    return { data: scheme }
  })

  // GET /schemes/:code
  fastify.get('/:code', async (req, reply) => {
    const scheme = await sql.get(BY_CODE, [Number(req.params.code)])
    if (!scheme) return reply.code(404).send({ error: 'Scheme not found' })
    return { data: scheme }
  })

  // GET /schemes/:code/nav?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
  fastify.get('/:code/nav', async (req, reply) => {
    const code      = Number(req.params.code)
    const startDate = req.query.startDate ?? null
    const endDate   = req.query.endDate   ?? null

    const rows = await sql.all(NAV, [code, startDate, startDate, endDate, endDate])
    if (!rows.length) return reply.code(404).send({ error: 'No NAV data found' })

    const { scheme_name } = rows[0]
    return { scheme_code: code, scheme_name, data: rows.map(({ nav_date, nav }) => ({ nav_date, nav })) }
  })

  // GET /schemes/:code/nav/latest
  fastify.get('/:code/nav/latest', async (req, reply) => {
    const code = Number(req.params.code)
    const row  = await sql.get(NAV_LATEST, [code])
    if (!row) return reply.code(404).send({ error: 'No NAV data found' })
    return { scheme_code: code, scheme_name: row.scheme_name, nav_date: row.nav_date, nav: row.nav }
  })
}
