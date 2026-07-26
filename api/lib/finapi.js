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
  const holdings = Array.isArray(data?.holdings) ? data.holdings : []
  const sectors  = Array.isArray(data?.sectors)  ? data.sectors  : []

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
    holdings: holdings.map((h) => ({
      name:            h.name ?? null,
      sector:          h.sector ?? null,
      weightage:       num(h.weightage),
      market_value_cr: num(h.marketValue),
      change_1m:       num(h.change1M),
    })),
    sectors: sectors.map((s) => ({
      sector:          s.sector ?? null,
      weightage:       num(s.weightage),
      market_value_cr: num(s.marketValue),
      change_1m:       num(s.change1M),
    })),
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
