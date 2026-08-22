/**
 * finapi.js — client for finapi.upvaly.com (fund portfolio holdings).
 *
 * The one external data source we depend on at request time. It exposes a
 * fund's current portfolio (individual holdings, sector split, asset allocation)
 * keyed by the SAME AMFI scheme code we already store, so no code mapping is
 * needed. It is rate-limited (~120 req/window per endpoint), so callers MUST
 * cache the result — see lib/queries.js getHoldings(), which persists into the
 * fund_holdings table and only refetches after a TTL.
 *
 * `normalizeHoldings` and `num` are pure (no I/O) and unit-tested directly.
 */

const BASE       = process.env.FINAPI_BASE ?? 'https://finapi.upvaly.com'
const TIMEOUT_MS = Number(process.env.FINAPI_TIMEOUT_MS ?? 5000)

export const FINAPI_SOURCE = 'finapi.upvaly.com'

/**
 * Parse a finapi numeric string to Number | null.
 * Handles Indian formatting and unit decoration:
 *   "9,771.49" → 9771.49   "96.24" → 96.24   "-0.67" → -0.67
 *   "₹2,42,065.01 Cr" → 242065.01   "" / null / "N/A" → null
 */
export function num(v) {
  if (v == null) return null
  const cleaned = String(v).replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const n = Number.parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

export const PRECIOUS_METALS_SECTOR = 'Gold & Silver'

// Gold and silver ETFs / FoFs arrive from upstream with no sector at all, so
// downstream they fall in with the unclassified cash-and-debt bucket. Bullion is
// its own asset class, not cash, so give it its own sector.
//
// The \b anchors are load-bearing: they keep real equities whose names merely
// start with those letters out (Goldman Sachs, Goldiam International, Golden
// Tobacco) while still matching 'SBI Gold ETF', 'Gold FoF', 'ETF Gold BeES'.
const PRECIOUS_METAL_RE = /\b(gold|silver)\b/i

const round2 = (n) => Math.round(n * 100) / 100

/** Sector a holding belongs in, overriding upstream for bullion. */
export function sectorForHolding(name, sector = null) {
  return PRECIOUS_METAL_RE.test(name ?? '') ? PRECIOUS_METALS_SECTOR : (sector ?? null)
}

/**
 * Fold reclassified bullion holdings into the sector list.
 *
 * Upstream's sector table only covers equities, so once gold/silver holdings get
 * a sector they still have no row to land in. Sum them into one, and splice it
 * into the (weight-descending) list so the sector mix stays sorted.
 * Both inputs are already-normalized rows; returns a new array.
 */
export function withPreciousMetalsSector(holdings, sectors) {
  const metals = holdings.filter((h) => h.sector === PRECIOUS_METALS_SECTOR)
  if (metals.length === 0) return sectors

  const weightage = round2(metals.reduce((sum, h) => sum + (h.weightage ?? 0), 0))
  if (weightage <= 0) return sectors

  // Only report a rupee value if every constituent carried one; a partial sum
  // would understate the sector rather than simply be unknown.
  const values = metals.map((h) => h.market_value_cr)
  const market_value_cr = values.every((v) => v != null) ? round2(values.reduce((a, b) => a + b, 0)) : null

  const row = { sector: PRECIOUS_METALS_SECTOR, weightage, market_value_cr, change_1m: null }
  const rest = sectors.filter((s) => s.sector !== PRECIOUS_METALS_SECTOR)
  const at = rest.findIndex((s) => (s.weightage ?? 0) < weightage)
  if (at === -1) return [...rest, row]
  return [...rest.slice(0, at), row, ...rest.slice(at)]
}

/**
 * Pure transform: finapi `data` object → normalized allocation payload.
 * Keeps only the portfolio/allocation pieces (the genuinely new data); returns,
 * risk, and rolling are computed by our own analytics, not proxied.
 * Defensive against missing sections (debt funds may omit marketCapWeightage).
 */
export function normalizeHoldings(data) {
  const p  = data?.portfolio ?? {}
  const aa = p.assetAllocation ?? {}
  const mc = p.marketCapWeightage ?? {}
  const cn = p.concentration ?? {}
  const rawHoldings = Array.isArray(data?.holdings) ? data.holdings : []
  const rawSectors  = Array.isArray(data?.sectors)  ? data.sectors  : []

  const holdings = rawHoldings.map((h) => ({
    name:            h.name ?? null,
    sector:          sectorForHolding(h.name, h.sector),
    weightage:       num(h.weightage),
    market_value_cr: num(h.marketValue),
    change_1m:       num(h.change1M),
  }))

  const sectors = withPreciousMetalsSector(holdings, rawSectors.map((s) => ({
    sector:          s.sector ?? null,
    weightage:       num(s.weightage),
    market_value_cr: num(s.marketValue),
    change_1m:       num(s.change1M),
  })))

  return {
    asset_allocation: {
      equity: num(aa.equityAllocation),
      debt:   num(aa.debtAllocation),
      cash:   num(aa.cashAllocation),
      other:  num(aa.otherAllocation),
    },
    market_cap: {
      large:  num(mc.largeCap),
      mid:    num(mc.midCap),
      small:  num(mc.smallCap),
      others: num(mc.others),
    },
    concentration: {
      // finapi's numberOfHoldings occasionally disagrees with the array length;
      // trust the array we actually return.
      number_of_holdings:    holdings.length || num(cn.numberOfHoldings),
      top3_sector_weight:    num(cn.top3SectorWeight),
      top5_stocks_weight:    num(cn.top5StocksWeight),
      top10_stocks_weight:   num(cn.top10StocksWeight),
      average_market_cap_cr: num(cn.averageMarketCap),
    },
    holdings,
    sectors,
  }
}

/**
 * Fetch + normalize one scheme's holdings from finapi.
 * Returns a discriminated result so the caller can distinguish failure modes:
 *   { ok: true,  data }                       — normalized allocation
 *   { ok: false, status: 404, error }         — finapi has no portfolio for this code
 *   { ok: false, status: 429, error }         — finapi rate limit reached
 *   { ok: false, status: 502, error }         — timeout / network / bad upstream shape
 */
export async function fetchHoldings(schemeCode) {
  const url = `${BASE}/api/mf/scheme-code/${encodeURIComponent(schemeCode)}`

  let res
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (err) {
    const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.message ?? 'network error')
    return { ok: false, status: 502, error: `finapi request failed: ${reason}` }
  }

  if (res.status === 404) return { ok: false, status: 404, error: 'finapi has no portfolio for this scheme' }
  if (res.status === 429) return { ok: false, status: 429, error: 'finapi rate limit reached' }
  if (!res.ok)            return { ok: false, status: 502, error: `finapi returned HTTP ${res.status}` }

  let body
  try { body = await res.json() } catch { return { ok: false, status: 502, error: 'finapi returned invalid JSON' } }
  if (body?.status !== 'success' || !body?.data) {
    return { ok: false, status: 502, error: 'finapi returned an unexpected shape' }
  }

  return { ok: true, data: normalizeHoldings(body.data) }
}
