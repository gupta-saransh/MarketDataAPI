/**
 * seed-holdings.js -- load hand-curated portfolios into fund_holdings.
 *
 * Reads data/manual-holdings.js and pins each record onto every scheme_code it
 * lists. Pinned rows carry `manual: true`, which makes lib/queries.js
 * getHoldings() serve them straight from the DB forever: no TTL expiry, no
 * upstream call. That is the point -- these funds exist in this file precisely
 * because the upstream feed is wrong or empty for them, so an automatic refresh
 * would undo the curation.
 *
 * Writes to whichever backend DATABASE_URL selects, same as the API. Unset it
 * to load the local SQLite DB; set it to load CockroachDB.
 *
 * Usage (from api/):
 *   npm run holdings:manual
 *   npm run holdings:manual -- --dry-run     # print, touch nothing
 *
 * Idempotent: re-running overwrites the same rows with the current file.
 */

import 'dotenv/config'
import { sql } from '../db/index.js'
import { buildPayload } from '../lib/curated-holdings.js'
import records from '../data/manual-holdings.js'

const DRY_RUN = process.argv.includes('--dry-run')

const UPSERT = `
  INSERT INTO fund_holdings (scheme_code, fetched_at, holdings_date, payload)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (scheme_code) DO UPDATE SET fetched_at    = excluded.fetched_at,
                                          holdings_date = excluded.holdings_date,
                                          payload       = excluded.payload
`

async function main() {
  console.log(`driver: ${sql.driver}${DRY_RUN ? '  (dry run)' : ''}\n`)

  let pinned = 0
  const unknown = []

  for (const rec of records) {
    const payload = JSON.stringify(buildPayload(rec))
    const now = new Date().toISOString()

    for (const code of rec.schemes) {
      const scheme = await sql.get('SELECT scheme_code, scheme_name FROM schemes WHERE scheme_code = ?', [code])
      if (!scheme) {
        unknown.push(code)
        console.log(`  SKIP  ${code}  not in schemes table`)
        continue
      }
      if (!DRY_RUN) await sql.run(UPSERT, [code, now, rec.as_of, payload])
      console.log(`  ${DRY_RUN ? 'would pin' : 'pinned  '}  ${code}  ${scheme.scheme_name}`)
      pinned++
    }
  }

  console.log(`\n${DRY_RUN ? 'Would pin' : 'Pinned'} ${pinned} scheme(s) from ${records.length} record(s).`)
  if (unknown.length) {
    console.error(`Unknown scheme_codes (nothing written): ${unknown.join(', ')}`)
    process.exit(1)
  }
}

await main()
// The pg pool holds the event loop open; this is a one-shot script.
process.exit(0)
