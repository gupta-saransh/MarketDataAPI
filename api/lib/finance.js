/**
 * finance.js — pure financial math over a NAV series.
 *
 * Every function takes a chronologically ASCENDING series:
 *   series = [{ nav_date: 'YYYY-MM-DD', nav: Number }, ...]
 *
 * No I/O, no DB — just math, so it's trivially unit-testable. Dates are
 * 'YYYY-MM-DD' strings, which compare lexically (so binary search works).
 */

const MS_PER_DAY = 86_400_000
const TRADING_DAYS = 252 // annualization factor for daily volatility

// ── date helpers ──────────────────────────────────────────────

function toUTC(dateStr) {
  return new Date(dateStr + 'T00:00:00Z').getTime()
}

export function yearsBetween(a, b) {
  return (toUTC(b) - toUTC(a)) / (365.25 * MS_PER_DAY)
}

/** Shift a 'YYYY-MM-DD' by calendar years/months/days. */
export function shiftDate(dateStr, { years = 0, months = 0, days = 0 }) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCFullYear(d.getUTCFullYear() + years)
  d.setUTCMonth(d.getUTCMonth() + months)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Last point with nav_date <= target (nearest trading day on/before). */
export function navAsOf(series, target) {
  let lo = 0, hi = series.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (series[mid].nav_date <= target) { ans = mid; lo = mid + 1 }
    else hi = mid - 1
  }
  return ans === -1 ? null : series[ans]
}

// ── returns ───────────────────────────────────────────────────

const PERIODS = {
  '1M': { months: 1 }, '3M': { months: 3 }, '6M': { months: 6 },
  '1Y': { years: 1 },  '3Y': { years: 3 },  '5Y': { years: 5 },
}

/**
 * Point-to-point return between two NAVs. Absolute for <= 1 year, annualized
 * (CAGR) beyond that — the standard Indian MF convention.
 */
export function pointToPoint(startNav, endNav, years) {
  const annualize = years > 1.0001
  const ret = annualize
    ? Math.pow(endNav / startNav, 1 / years) - 1
    : endNav / startNav - 1
  return { return_pct: ret * 100, annualized: annualize }
}

/** Trailing returns (1M…5Y) + since-inception, computed off the latest NAV. */
export function trailingReturns(series) {
  if (series.length < 2) return null
  const end = series[series.length - 1]
  const out = {}

  for (const [key, shift] of Object.entries(PERIODS)) {
    const target = shiftDate(end.nav_date, Object.fromEntries(
      Object.entries(shift).map(([k, v]) => [k, -v])))
    const start = navAsOf(series, target)
    // Need a start point at least near the target (history must reach back).
    if (!start || start.nav_date > target || start === end) { out[key] = null; continue }
    const years = yearsBetween(start.nav_date, end.nav_date)
    out[key] = { ...pointToPoint(start.nav, end.nav, years), from_date: start.nav_date, from_nav: start.nav }
  }

  const first = series[0]
  const incYears = yearsBetween(first.nav_date, end.nav_date)
  out.inception = {
    ...pointToPoint(first.nav, end.nav, incYears),
    from_date: first.nav_date, from_nav: first.nav,
  }
  return { as_of: end.nav_date, latest_nav: end.nav, returns: out }
}

// ── rolling returns ───────────────────────────────────────────

export function parseWindow(w) {
  const m = String(w ?? '').trim().match(/^(\d+)\s*([YyMm])$/)
  if (!m) return null
  const n = Number(m[1])
  return m[2].toUpperCase() === 'Y' ? { years: n } : { months: n }
}

function windowYears(win) {
  return (win.years ?? 0) + (win.months ?? 0) / 12
}

/**
 * Rolling returns: for every trading day, the return over the next `window`,
 * stepped daily across history. Annualized (CAGR) for windows >= 1y, absolute
 * otherwise. Summarized with avg/min/max/median and % of windows beating
 * `beatPct`.
 */
export function rollingReturns(series, win, beatPct = 12) {
  const wYears = windowYears(win)
  const last = series[series.length - 1].nav_date
  const results = []

  for (let i = 0; i < series.length; i++) {
    const start = series[i]
    const target = shiftDate(start.nav_date, win)
    if (target > last) break // window would run past the end of history
    const endPt = navAsOf(series, target)
    if (!endPt || endPt.nav_date <= start.nav_date) continue
    const years = yearsBetween(start.nav_date, endPt.nav_date)
    const { return_pct } = pointToPoint(start.nav, endPt.nav, years)
    results.push({ from: start.nav_date, to: endPt.nav_date, return_pct })
  }

  if (!results.length) return null

  const vals = results.map((r) => r.return_pct).sort((a, b) => a - b)
  const sum = vals.reduce((s, v) => s + v, 0)
  const mid = Math.floor(vals.length / 2)
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2
  const beating = vals.filter((v) => v >= beatPct).length

  let best = results[0], worst = results[0]
  for (const r of results) {
    if (r.return_pct > best.return_pct) best = r
    if (r.return_pct < worst.return_pct) worst = r
  }

  return {
    observations: results.length,
    annualized: wYears > 1.0001,
    avg: sum / vals.length,
    min: vals[0],
    max: vals[vals.length - 1],
    median,
    beat_pct: beatPct,
    pct_beating: (beating / vals.length) * 100,
    best,
    worst,
  }
}

// ── risk metrics ──────────────────────────────────────────────

/** Annualized volatility, max drawdown, CAGR and Sharpe from the NAV series. */
export function riskMetrics(series, riskFreePct = 6) {
  if (series.length < 3) return null

  // Daily simple returns between consecutive trading days.
  const rets = []
  for (let i = 1; i < series.length; i++) {
    rets.push(series[i].nav / series[i - 1].nav - 1)
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)
  const annualizedVol = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS) * 100

  // Max drawdown — worst peak-to-trough decline.
  let peak = series[0].nav, maxDD = 0
  for (const p of series) {
    if (p.nav > peak) peak = p.nav
    const dd = (p.nav - peak) / peak
    if (dd < maxDD) maxDD = dd
  }

  const first = series[0], end = series[series.length - 1]
  const years = yearsBetween(first.nav_date, end.nav_date)
  const cagr = (Math.pow(end.nav / first.nav, 1 / years) - 1) * 100
  const sharpe = annualizedVol > 0 ? (cagr - riskFreePct) / annualizedVol : null

  return {
    annualized_volatility_pct: annualizedVol,
    max_drawdown_pct: Math.abs(maxDD) * 100,
    cagr_pct: cagr,
    sharpe,
    risk_free_pct: riskFreePct,
    observations: series.length,
    from_date: first.nav_date,
    to_date: end.nav_date,
  }
}

// ── XIRR ──────────────────────────────────────────────────────

/**
 * Internal rate of return for dated cashflows (annualized, decimal).
 * cashflows = [{ date: 'YYYY-MM-DD', amount }]  (outflows negative).
 * Newton-Raphson with a bisection fallback. Returns null if it can't solve.
 */
export function xirr(cashflows) {
  if (cashflows.length < 2) return null
  const t0 = toUTC(cashflows[0].date)
  const tf = (d) => (toUTC(d) - t0) / (365 * MS_PER_DAY)

  const npv = (rate) =>
    cashflows.reduce((s, cf) => s + cf.amount / Math.pow(1 + rate, tf(cf.date)), 0)
  const dnpv = (rate) =>
    cashflows.reduce((s, cf) => {
      const t = tf(cf.date)
      return s - (t * cf.amount) / Math.pow(1 + rate, t + 1)
    }, 0)

  // Newton-Raphson
  let rate = 0.1
  for (let i = 0; i < 100; i++) {
    if (rate <= -0.9999) rate = -0.9999
    const f = npv(rate)
    const df = dnpv(rate)
    if (Math.abs(df) < 1e-12) break
    const next = rate - f / df
    if (!isFinite(next)) break
    if (Math.abs(next - rate) < 1e-8) return next
    rate = next
  }

  // Bisection fallback over a sane bracket.
  let lo = -0.9999, hi = 100
  let flo = npv(lo)
  if (flo * npv(hi) > 0) return null // can't bracket a root
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2
    const fm = npv(mid)
    if (Math.abs(fm) < 1e-9) return mid
    if (flo * fm < 0) hi = mid
    else { lo = mid; flo = fm }
  }
  return (lo + hi) / 2
}

/**
 * Simulate a monthly SIP: invest `amount` on `day` of each month from `from`
 * to `to`, buying units at the nearest trading-day NAV on/before each date.
 * Returns invested/value/absolute return and XIRR.
 */
export function simulateSip(series, { amount, from, to, day }) {
  const firstDate = series[0].nav_date
  const lastDate = series[series.length - 1].nav_date
  const start = from && from > firstDate ? from : firstDate
  const end = to && to < lastDate ? to : lastDate
  const investDay = day ?? Number(start.slice(8, 10))

  const cashflows = []
  let units = 0
  let installments = 0
  let cursor = `${start.slice(0, 7)}-${String(investDay).padStart(2, '0')}`
  if (cursor < start) cursor = shiftDate(cursor, { months: 1 })

  while (cursor <= end) {
    const pt = navAsOf(series, cursor)
    if (pt) {
      units += amount / pt.nav
      installments++
      cashflows.push({ date: pt.nav_date, amount: -amount })
    }
    cursor = shiftDate(cursor, { months: 1 })
  }

  if (installments === 0) return null

  const endPt = navAsOf(series, end)
  const currentValue = units * endPt.nav
  const invested = amount * installments
  cashflows.push({ date: endPt.nav_date, amount: currentValue })
  const rate = xirr(cashflows)

  return {
    amount, day: investDay, from: start, to: endPt.nav_date,
    installments,
    total_invested: invested,
    units,
    current_value: currentValue,
    absolute_return_pct: (currentValue / invested - 1) * 100,
    xirr_pct: rate == null ? null : rate * 100,
  }
}
