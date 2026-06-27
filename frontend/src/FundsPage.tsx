import { useEffect, useState } from 'react'
import { API_BASE } from './lib/api'
import NavChart from './components/NavChart'
import type { NavPoint, SchemeDetail, Period, ReturnsResp, Risk, SearchRow } from './types'

// ── ranges ────────────────────────────────────────────────────
type Range = '1M' | '6M' | '1Y' | '3Y' | 'All'
const RANGES: Range[] = ['1M', '6M', '1Y', '3Y', 'All']
const RANGE_MONTHS: Record<Exclude<Range, 'All'>, number> = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36 }
// Map a chart range to the matching key in the /returns payload.
const RANGE_KEY: Record<Range, string> = { '1M': '1M', '6M': '6M', '1Y': '1Y', '3Y': '3Y', All: 'inception' }

// ── helpers ───────────────────────────────────────────────────
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

const inr = (n: number, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const upClass = (n: number) => (n >= 0 ? 'text-emerald-600' : 'text-red-600')

function riskLabel(vol: number | undefined | null): string | null {
  if (vol == null) return null
  if (vol >= 20) return 'Very High Risk'
  if (vol >= 15) return 'High Risk'
  if (vol >= 10) return 'Moderate Risk'
  return 'Low Risk'
}

function sliceByRange(series: NavPoint[], range: Range): NavPoint[] {
  if (range === 'All' || series.length === 0) return series
  const last = new Date(series[series.length - 1].nav_date + 'T00:00:00Z')
  last.setUTCMonth(last.getUTCMonth() - RANGE_MONTHS[range])
  const cutoff = last.toISOString().slice(0, 10)
  return series.filter((p) => p.nav_date >= cutoff)
}

// Fallback range-return if /returns has no entry (e.g. short history).
function rangeReturn(slice: NavPoint[]): Period | null {
  if (slice.length < 2) return null
  const a = slice[0].nav
  const b = slice[slice.length - 1].nav
  const years = (Date.parse(slice[slice.length - 1].nav_date) - Date.parse(slice[0].nav_date)) / (365.25 * 864e5)
  if (years > 1.0001) return { return_pct: (Math.pow(b / a, 1 / years) - 1) * 100, annualized: true }
  return { return_pct: (b / a - 1) * 100, annualized: false }
}

const RISK_FREE = 6 // %, for the Sharpe ratio

// Annualised volatility, max drawdown, CAGR and Sharpe over a slice, computed
// client-side (same formulas as the API's finance.js) so they track the
// selected chart range. The /risk endpoint only covers the whole history.
function computeRisk(slice: NavPoint[]): Risk | null {
  if (slice.length < 3) return null
  const rets: number[] = []
  for (let i = 1; i < slice.length; i++) rets.push(slice[i].nav / slice[i - 1].nav - 1)
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1)
  const vol = Math.sqrt(variance) * Math.sqrt(252) * 100
  let peak = slice[0].nav
  let maxDD = 0
  for (const p of slice) {
    if (p.nav > peak) peak = p.nav
    const dd = (p.nav - peak) / peak
    if (dd < maxDD) maxDD = dd
  }
  const years = (Date.parse(slice[slice.length - 1].nav_date) - Date.parse(slice[0].nav_date)) / (365.25 * 864e5)
  const cagr = years > 0 ? (Math.pow(slice[slice.length - 1].nav / slice[0].nav, 1 / years) - 1) * 100 : 0
  const sharpe = vol > 0 ? (cagr - RISK_FREE) / vol : null
  return { vol, maxDD: Math.abs(maxDD) * 100, cagr, sharpe }
}

const AVATAR_COLORS = ['bg-rose-600', 'bg-emerald-600', 'bg-indigo-600', 'bg-amber-600', 'bg-sky-600', 'bg-violet-600', 'bg-teal-600']
function avatarColor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

// ── page ──────────────────────────────────────────────────────
export default function FundsPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('101762')
  const [range, setRange] = useState<Range>('3Y')

  const [detail, setDetail] = useState<SchemeDetail | null>(null)
  const [series, setSeries] = useState<NavPoint[]>([])
  const [ret, setRet] = useState<ReturnsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounced scheme search.
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    const t = setTimeout(() => {
      getJson<{ data: SearchRow[] }>(`/schemes?q=${encodeURIComponent(query.trim())}&limit=8`)
        .then((r) => { setResults(r.data); setOpen(true) })
        .catch(() => setResults([]))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  // Load the selected scheme (detail + full NAV history + returns + risk).
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    Promise.all([
      getJson<{ data: SchemeDetail }>(`/schemes/${code}`),
      getJson<{ data: NavPoint[] }>(`/schemes/${code}/nav`),
      getJson<ReturnsResp>(`/schemes/${code}/returns`).catch(() => null),
    ])
      .then(([d, nav, r]) => {
        if (!active) return
        setDetail(d.data)
        setSeries([...nav.data].reverse()) // API returns newest-first → ascending
        setRet(r)
        setLoading(false)
      })
      .catch((e) => {
        if (!active) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => { active = false }
  }, [code])

  const pick = (row: SearchRow) => {
    setCode(String(row.scheme_code))
    setQuery('')
    setResults([])
    setOpen(false)
  }

  const visible = sliceByRange(series, range)
  const riskFull = computeRisk(series)        // fund property → drives the risk chip
  const riskRange = computeRisk(visible)      // tracks the selected range → drives the tiles
  const headline = ret?.returns?.[RANGE_KEY[range]] ?? rangeReturn(visible)
  const headlineLabel = range === 'All' ? 'Since inception' : headline?.annualized ? `${range} annualised` : `${range} return`
  const oneDay = series.length >= 2
    ? ((series[series.length - 1].nav - series[series.length - 2].nav) / series[series.length - 2].nav) * 100
    : null

  const chips = [detail?.broad_category, detail?.category, riskLabel(riskFull?.vol)].filter(Boolean) as string[]
  const avatarText = (detail?.fund_house ?? detail?.scheme_name ?? '?').trim().charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Nav */}
      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <a href="#" className="font-semibold tracking-tight text-slate-900">Market Data API</a>
          <div className="flex items-center gap-4 text-sm">
            <a href="#" className="text-slate-400 transition-colors hover:text-slate-700">Home</a>
            <a href="#docs" className="text-slate-400 transition-colors hover:text-slate-700">API Reference</a>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Search */}
        <div className="relative mb-6">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Search a mutual fund… (e.g. Axis Nifty 50, HDFC Flexi Cap)"
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-400"
          />
          {open && results.length > 0 && (
            <ul className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
              {results.map((r) => (
                <li key={String(r.scheme_code)}>
                  <button
                    onMouseDown={(e) => { e.preventDefault(); pick(r) }}
                    className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                  >
                    <div className="text-sm text-slate-800">{r.scheme_name}</div>
                    <div className="text-xs text-slate-400">{r.fund_house ?? 'n/a'} · {r.category ?? 'n/a'}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Couldn't load this scheme ({error}). Is the API running?
          </div>
        )}

        {/* Card */}
        {!error && (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            {loading || !detail ? (
              <div className="animate-pulse space-y-4">
                <div className="h-10 w-2/3 rounded bg-slate-100" />
                <div className="h-8 w-1/3 rounded bg-slate-100" />
                <div className="h-72 rounded bg-slate-100" />
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-start gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white ${avatarColor(detail.fund_house ?? detail.scheme_name)}`}>
                    {avatarText}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-semibold leading-snug tracking-tight text-slate-900">
                      {detail.scheme_name}
                    </h1>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {chips.map((c) => (
                        <span key={c} className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Headline return */}
                <div className="mt-6">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${upClass(headline?.return_pct ?? 0)}`}>
                      {headline ? signed(headline.return_pct) : 'n/a'}
                    </span>
                    <span className="text-sm text-slate-400">{headlineLabel}</span>
                  </div>
                  {oneDay != null && (
                    <div className={`mt-0.5 text-sm ${upClass(oneDay)}`}>{signed(oneDay)} <span className="text-slate-400">1D</span></div>
                  )}
                </div>

                {/* Chart */}
                <div className="mt-4">
                  <NavChart points={visible} />
                  <div className="mt-3 flex justify-center gap-1.5">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setRange(r)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          range === r ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stat tiles */}
                <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-slate-100 pt-6 sm:grid-cols-3">
                  <Stat
                    label={`NAV · ${detail.nav_date ?? 'n/a'}`}
                    value={detail.nav != null ? `₹${inr(detail.nav)}` : 'n/a'}
                    hint="The fund's price for one unit on this date. You buy and sell units at this price."
                  />
                  <Stat
                    label="1Y return"
                    value={ret?.returns?.['1Y'] ? signed(ret.returns['1Y'].return_pct) : 'n/a'}
                    tone={ret?.returns?.['1Y']?.return_pct}
                    hint="How much the fund grew over the last 1 year. +10% means ₹100 would have become ₹110."
                  />
                  <Stat
                    label="3Y return (CAGR)"
                    value={ret?.returns?.['3Y'] ? signed(ret.returns['3Y'].return_pct) : 'n/a'}
                    tone={ret?.returns?.['3Y']?.return_pct}
                    hint="Average growth per year over 3 years. +15% means it grew about 15% each year on average."
                  />
                  <Stat
                    label={`Volatility (ann.) · ${range}`}
                    value={riskRange ? `${riskRange.vol.toFixed(2)}%` : 'n/a'}
                    hint="How bumpy the ride is. Around 13% means a typical year's return usually stays within about 13% above or below its average. Higher means bigger swings."
                  />
                  <Stat
                    label={`Max drawdown · ${range}`}
                    value={riskRange ? `-${riskRange.maxDD.toFixed(2)}%` : 'n/a'}
                    tone={-1}
                    hint="The worst fall from a high point to a low point. -13% means ₹100 once dropped to ₹87 before recovering. Recovering a 13% fall needs about a 15% gain."
                  />
                  <Stat
                    label={`Sharpe ratio · ${range}`}
                    value={riskRange?.sharpe != null ? riskRange.sharpe.toFixed(2) : 'n/a'}
                    hint="Reward for the risk taken. Below 1 is okay, around 1 is good, above 2 is excellent. It asks whether the bumpiness was worth the returns."
                  />
                </div>

                <p className="mt-6 text-xs leading-relaxed text-slate-400">
                  1Y and 3Y returns are fixed trailing periods (annualised above 1Y). Volatility, max
                  drawdown and Sharpe are computed over the selected range ({range}); shorter ranges are
                  noisier. Data from AMFI via the Market Data API. Not investment advice.
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: number | null; hint?: string }) {
  const color = tone == null ? 'text-slate-900' : tone >= 0 ? 'text-emerald-600' : 'text-red-600'
  return (
    <div>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <span>{label}</span>
        {hint && (
          <span className="group relative inline-flex">
            <span
              tabIndex={0}
              aria-label={hint}
              className="flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-slate-300 text-[9px] font-semibold leading-none text-slate-400"
            >
              i
            </span>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-52 -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg group-hover:block group-focus-within:block">
              {hint}
            </span>
          </span>
        )}
      </div>
      <div className={`mt-1 text-base font-semibold ${color}`}>{value}</div>
    </div>
  )
}
