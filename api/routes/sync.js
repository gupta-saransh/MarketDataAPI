import { createHash, timingSafeEqual } from 'node:crypto'
import { sql } from '../db/index.js'

const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'
const CHUNK    = 500

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
                 Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }

const DATE_RE = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/

// DD-Mon-YYYY -> YYYY-MM-DD, or null if the field is not a date.
// Strict on purpose. A lenient version of this used to build strings like
// 'undefined-NaN-00' out of empty fields and hand them to the DB, where
// nav_date is `date NOT NULL` -- one bad value failed the whole 500-row batch.
export function parseDate(str) {
  const m = DATE_RE.exec(str.trim())
  if (!m) return null
  const mon = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()
  const month = MONTHS[mon]
  if (!month) return null
  return `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`
}

/**
 * Parse AMFI's NAVAll.txt into [scheme_code, 'YYYY-MM-DD', nav] tuples.
 *
 * AMFI has shipped two layouts:
 *   6 fields (pre Aug-2026): Code;ISINGrowth;ISINDivReinv;Name;NAV;DD-Mon-YYYY
 *   8 fields (current):      Code;ISINGrowth;ISINDivReinv;Name;Plan;Option;NAV;DD-Mon-YYYY
 *
 * NAV and date are the LAST TWO fields in both, so index from the end rather
 * than from fixed positions. That survives the column insertion and keeps the
 * archived snapshots in nav-archive/ parseable.
 *
 * `knownCodes` is a Set of scheme_codes we track; pass null to keep every row.
 */
export function parseNavAll(text, knownCodes = null) {
  const rows = []
  for (const line of text.split('\n')) {
    const parts = line.trim().split(';')
    if (parts.length < 6) continue
    const code = Number(parts[0])
    if (!code || (knownCodes && !knownCodes.has(code))) continue
    // Reject non-numeric AND zero/negative: '' coerces to 0, which is not a NAV.
    const nav = Number(parts[parts.length - 2])
    if (!Number.isFinite(nav) || nav <= 0) continue
    const navDate = parseDate(parts[parts.length - 1])
    if (!navDate) continue
    rows.push([code, navDate, nav])
  }
  return rows
}

function batchInsertSQL(n) {
  return `INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES ${
    Array(n).fill('(?,?,?)').join(',')
  } ON CONFLICT(scheme_code, nav_date) DO NOTHING`
}

// Constant-time bearer-token check. Hashing both sides first means the
// comparison length never depends on the secret, so no timing signal leaks.
function authorized(header, secret) {
  const a = createHash('sha256').update(header ?? '').digest()
  const b = createHash('sha256').update(`Bearer ${secret}`).digest()
  return timingSafeEqual(a, b)
}

export default async function syncRoutes(fastify) {
  fastify.post('/sync-nav', async (req, reply) => {
    const secret = process.env.SYNC_NAV_SECRET
    // Fail closed: an unset secret disables the endpoint entirely (this is a
    // write endpoint; running it unauthenticated is never intended in prod).
    // Local dev without a secret should set one in api/.env.
    if (!secret) {
      return reply.code(503).send({ error: 'Sync disabled: SYNC_NAV_SECRET is not configured' })
    }
    if (!authorized(req.headers['authorization'], secret)) {
      return reply.code(401).send({ error: 'Unauthorized' })
    }

    const res = await fetch(AMFI_URL)
    if (!res.ok) throw new Error(`AMFI fetch failed: HTTP ${res.status}`)
    const text = await res.text()

    // Build a Set of scheme_codes we actually track
    const knownCodes = new Set(
      (await sql.all('SELECT scheme_code FROM schemes', [])).map(r => Number(r.scheme_code))
    )

    const rows = parseNavAll(text, knownCodes)

    // Batch upsert in chunks to stay within Vercel's request timeout
    let inserted = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const result = await sql.run(batchInsertSQL(chunk.length), chunk.flat())
      inserted += result.changes
    }

    // The file mixes today's NAVs with last-known NAVs for wound-up schemes
    // (dates as old as 2018), so the newest date is the publish date -- not
    // whichever row happened to come first.
    const navDate = rows.reduce((max, r) => (r[1] > max ? r[1] : max), '') || null
    return {
      nav_date : navDate,
      parsed   : rows.length,
      inserted,
      skipped  : rows.length - inserted,
    }
  })
}
