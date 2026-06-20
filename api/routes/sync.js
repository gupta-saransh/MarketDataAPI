import { sql } from '../db/index.js'

const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt'
const CHUNK    = 200

const MONTHS = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6,
                 Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 }

function parseDate(str) {
  const [d, m, y] = str.trim().split('-')
  const month = MONTHS[m] ?? Number(m)
  return `${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}

function batchInsertSQL(n) {
  return `INSERT INTO nav_history (scheme_code, nav_date, nav) VALUES ${
    Array(n).fill('(?,?,?)').join(',')
  } ON CONFLICT(scheme_code, nav_date) DO NOTHING`
}

export default async function syncRoutes(fastify) {
  fastify.post('/sync-nav', async (req, reply) => {
    const secret = process.env.SYNC_NAV_SECRET
    if (secret) {
      const auth = req.headers['authorization'] ?? ''
      if (auth !== `Bearer ${secret}`) {
        return reply.code(401).send({ error: 'Unauthorized' })
      }
    }

    const res = await fetch(AMFI_URL)
    if (!res.ok) throw new Error(`AMFI fetch failed: HTTP ${res.status}`)
    const text = await res.text()

    // Build a Set of scheme_codes we actually track
    const knownCodes = new Set(
      (await sql.all('SELECT scheme_code FROM schemes', [])).map(r => Number(r.scheme_code))
    )

    // Parse data lines — each has exactly 6 semicolon-separated fields
    // Format: SchemeCode;ISINGrowth;ISINDivReinv;SchemeName;NAV;DD-Mon-YYYY
    const rows = []
    for (const line of text.split('\n')) {
      const parts = line.trim().split(';')
      if (parts.length < 6) continue
      const code = Number(parts[0])
      if (!code || !knownCodes.has(code)) continue
      const nav = Number(parts[4])
      if (isNaN(nav)) continue
      let navDate
      try { navDate = parseDate(parts[5]) } catch { continue }
      rows.push([code, navDate, nav])
    }

    // Batch upsert in chunks to stay within Vercel's request timeout
    let inserted = 0
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const result = await sql.run(batchInsertSQL(chunk.length), chunk.flat())
      inserted += result.changes
    }

    const navDate = rows[0]?.[1] ?? null
    return {
      nav_date : navDate,
      parsed   : rows.length,
      inserted,
      skipped  : rows.length - inserted,
    }
  })
}
