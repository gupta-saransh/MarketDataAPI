/**
 * curated-holdings.js -- turn a hand-written portfolio record into the
 * normalized holdings payload.
 *
 * The counterpart to normalizeHoldings() in finapi.js: same output shape, but
 * sourced from data/manual-holdings.js instead of the upstream feed, so nothing
 * downstream can tell the two apart beyond the `manual` flag and a fuller
 * `note`. Pure (no I/O, no DB) so pipeline/seed-holdings.js stays a thin script
 * and this stays trivially unit-testable.
 */

import { sectorForHolding, withPreciousMetalsSector } from './finapi.js'

const round2 = (n) => Math.round(n * 100) / 100

// Sum the N heaviest rows, or null when there are fewer than N -- a partial sum
// would read as a real concentration figure while understating it.
function topN(rows, n) {
  if (rows.length < n) return null
  const sorted = [...rows].sort((a, b) => (b.weightage ?? 0) - (a.weightage ?? 0))
  return round2(sorted.slice(0, n).reduce((acc, r) => acc + (r.weightage ?? 0), 0))
}

/** One record from data/manual-holdings.js -> normalized payload. */
export function buildPayload(rec) {
  const holdings = (rec.holdings ?? []).map(([name, sector, weightage]) => ({
    name,
    sector: sectorForHolding(name, sector),
    weightage,
    market_value_cr: null,
    change_1m: null,
  }))

  const sectors = withPreciousMetalsSector(
    holdings,
    (rec.sectors ?? []).map(([sector, weightage]) => ({
      sector, weightage, market_value_cr: null, change_1m: null,
    })),
  )

  return {
    manual: true,
    note: rec.note ?? null,
    asset_allocation: { equity: null, debt: null, cash: null, other: null, ...rec.asset_allocation },
    market_cap:       { large: null, mid: null, small: null, others: null, ...rec.market_cap },
    concentration: {
      // Only the top slice of the portfolio is published, so the true holding
      // count is unknown -- claiming holdings.length would be a lie.
      number_of_holdings:    null,
      top3_sector_weight:    topN(sectors, 3),
      top5_stocks_weight:    topN(holdings, 5),
      top10_stocks_weight:   topN(holdings, 10),
      average_market_cap_cr: null,
      ...rec.concentration,
    },
    holdings,
    sectors,
  }
}
