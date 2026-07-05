import { useEffect, useMemo, useState } from 'react'
import { API_BASE } from './lib/api'
import NavChart from './components/NavChart'
import type { NavPoint, SchemeDetail, Period, ReturnsResp, Risk, RollingResp, SearchRow, SipResp } from './types'

// ── ranges ────────────────────────────────────────────────────
type Range = '1M' | '6M' | '1Y' | '3Y' | 'All'
const RANGES: Range[] = ['1M', '6M', '1Y', '3Y', 'All']
const RANGE_MONTHS: Record<Exclude<Range, 'All'>, number> = { '1M': 1, '6M': 6, '1Y': 12, '3Y': 36 }
// Map a chart range to the matching key in the /returns payload.
const RANGE_KEY: Record<Range, string> = { '1M': '1M', '6M': '6M', '1Y': '1Y', '3Y': '3Y', All: 'inception' }

const DEFAULT_CODE = '101762' // HDFC Flexi Cap, so the page always loads with real data

// ── URL: #funds/<code> makes every fund page shareable ───────
function codeFromHash(): string {
  const m = window.location.hash.match(/^#funds\/(\d+)/)
  return m ? m[1] : DEFAULT_CODE
}

function navigateToCode(code: string) {
  window.location.hash = `#funds/${code}`
}

// ── helpers ───────────────────────────────────────────────────
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<T>
}

const inr = (n: number, d = 2) => n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
const inr0 = (n: number) => Math.round(n).toLocaleString('en-IN')
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

// AMC name fragment -> official domain, for logo lookup. Ordered most-specific
// first; an unmapped fund house falls back to the coloured initial.
const AMC_DOMAINS: [string, string][] = [
  ['aditya birla', 'adityabirlacapital.com'],
  ['sbi', 'sbimf.com'],
  ['hdfc', 'hdfcfund.com'],
  ['icici', 'icicipruamc.com'],
  ['axis', 'axismf.com'],
  ['nippon', 'nipponindiamf.com'],
  ['kotak', 'kotakmf.com'],
  ['uti', 'utimf.com'],
  ['dsp', 'dspim.com'],
  ['mirae', 'miraeassetmf.co.in'],
  ['tata', 'tatamutualfund.com'],
  ['franklin', 'franklintempletonindia.com'],
  ['edelweiss', 'edelweissmf.com'],
  ['bandhan', 'bandhanmutual.com'],
  ['parag parikh', 'amc.ppfas.com'],
  ['ppfas', 'amc.ppfas.com'],
  ['motilal', 'motilaloswalmf.com'],
  ['quantum', 'quantumamc.com'],
  ['quant ', 'quantmutual.com'],
  ['invesco', 'invescomutualfund.com'],
  ['canara', 'canararobeco.com'],
  ['sundaram', 'sundarammutual.com'],
  ['baroda', 'barodabnpparibasmf.in'],
  ['hsbc', 'assetmanagement.hsbc.co.in'],
  ['lic', 'licmf.com'],
  ['pgim', 'pgimindiamf.com'],
  ['union', 'unionmf.com'],
  ['jm financial', 'jmfinancialmf.com'],
  ['mahindra', 'mahindramanulife.com'],
  ['navi', 'navimutualfund.com'],
  ['whiteoak', 'whiteoakamc.com'],
  ['bajaj', 'bajajamc.com'],
  ['360', '360.one'],
  ['samco', 'samcomf.com'],
  ['trust', 'trustmf.com'],
  ['helios', 'helioscapital.in'],
  ['zerodha', 'zerodhafundhouse.com'],
  ['groww', 'growwmf.in'],
  ['taurus', 'taurusmutualfund.com'],
  ['shriram', 'shriramamc.com'],
  ['nj ', 'njmutualfund.com'],
  ['iti ', 'itimf.com'],
]

function amcDomain(name: string): string | null {
  const k = ` ${name.toLowerCase()} `
  for (const [frag, domain] of AMC_DOMAINS) if (k.includes(frag)) return domain
  return null
}

const logoUrl = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=128`

// ── page ──────────────────────────────────────────────────────
export default function FundsPage() {
  const [code, setCode] = useState(codeFromHash)
  const [range, setRange] = useState<Range>('3Y')

  const [detail, setDetail] = useState<SchemeDetail | null>(null)
  const [series, setSeries] = useState<NavPoint[]>([])
  const [ret, setRet] = useState<ReturnsResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // comparison fund
  const [compare, setCompare] = useState<{ code: string; name: string } | null>(null)
  const [compareSeries, setCompareSeries] = useState<NavPoint[] | null>(null)

  // Keep state in sync with the hash so pasted links and back/forward work.
  useEffect(() => {
    const handler = () => setCode(codeFromHash())
    window.addEventListener('hashchange', handler)
    // Normalize a bare #funds to a full shareable URL without adding history.
    if (!/^#funds\/\d+/.test(window.location.hash)) {
      history.replaceState(null, '', `#funds/${codeFromHash()}`)
    }
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  // Load the selected scheme (detail + full NAV history + returns).
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

  // Load the comparison fund's history when one is picked.
  useEffect(() => {
    if (!compare) { setCompareSeries(null); return }
    let active = true
    getJson<{ data: NavPoint[] }>(`/schemes/${compare.code}/nav`)
      .then((nav) => { if (active) setCompareSeries([...nav.data].reverse()) })
      .catch(() => { if (active) setCompareSeries(null) })
    return () => { active = false }
  }, [compare])

  const visible = sliceByRange(series, range)
  const riskFull = computeRisk(series)        // fund property → drives the risk chip
  const riskRange = computeRisk(visible)      // tracks the selected range → drives the tiles
  const headline = ret?.returns?.[RANGE_KEY[range]] ?? rangeReturn(visible)
  const headlineLabel = range === 'All' ? 'Since inception' : headline?.annualized ? `${range} annualised` : `${range} return`
  const oneDay = series.length >= 2
    ? ((series[series.length - 1].nav - series[series.length - 2].nav) / series[series.length - 2].nav) * 100
    : null

  const chips = [detail?.broad_category, detail?.category, riskLabel(riskFull?.vol)].filter(Boolean) as string[]

  // Comparison chart data: intersect the two series by date so the x-axis is
  // shared, then rebase each to 100 at the start of the visible window. That
  // makes the two lines show relative performance, not incomparable NAVs.
  const cmp = useMemo(() => {
    if (!compareSeries || visible.length < 2) return null
    const compByDate = new Map(compareSeries.map((p) => [p.nav_date, p.nav]))
    const a: NavPoint[] = []
    const b: NavPoint[] = []
    for (const p of visible) {
      const other = compByDate.get(p.nav_date)
      if (other == null) continue
      a.push(p)
      b.push({ nav_date: p.nav_date, nav: other })
    }
    if (a.length < 2) return null
    const rebase = (pts: NavPoint[]) => pts.map((p) => ({ nav_date: p.nav_date, nav: (p.nav / pts[0].nav) * 100 }))
    return { a: rebase(a), b: rebase(b) }
  }, [visible, compareSeries])

  const cmpEndA = cmp ? cmp.a[cmp.a.length - 1].nav - 100 : null
  const cmpEndB = cmp ? cmp.b[cmp.b.length - 1].nav - 100 : null

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
        <div className="mb-6">
          <SearchBox
            placeholder="Search a mutual fund… (e.g. Axis Nifty 50, HDFC Flexi Cap)"
            onPick={(row) => navigateToCode(String(row.scheme_code))}
          />
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
              <div className="animate-[fadeIn_.25s_ease]">
                {/* Header */}
                <div className="flex items-start gap-4">
                  <Avatar key={detail.fund_house ?? detail.scheme_name} name={detail.fund_house ?? detail.scheme_name} />
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
                  <ShareButton code={code} />
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

                {/* Compare picker / legend */}
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                  {compare ? (
                    <>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        {detail.scheme_name.slice(0, 32)}{detail.scheme_name.length > 32 ? '…' : ''}
                        {cmpEndA != null && <b>{signed(cmpEndA)}</b>}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        {compare.name.slice(0, 32)}{compare.name.length > 32 ? '…' : ''}
                        {cmpEndB != null && <b>{signed(cmpEndB)}</b>}
                        <button onClick={() => setCompare(null)} aria-label="Remove comparison" className="ml-0.5 font-bold hover:text-indigo-900">×</button>
                      </span>
                      <span className="text-slate-400">
                        {cmp ? 'both rebased to 100 at start of range' : 'loading comparison…'}
                      </span>
                    </>
                  ) : (
                    <div className="w-full sm:w-80">
                      <SearchBox
                        small
                        placeholder="+ Compare with another fund…"
                        onPick={(row) => setCompare({ code: String(row.scheme_code), name: row.scheme_name })}
                      />
                    </div>
                  )}
                </div>

                {/* Chart */}
                <div className="mt-3">
                  {compare && cmp
                    ? <NavChart points={cmp.a} points2={cmp.b} rebased />
                    : <NavChart points={visible} />}
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
              </div>
            )}
          </div>
        )}

        {/* Rolling returns: consistency, not just a headline number */}
        {!error && !loading && <RollingCard code={code} />}

        {/* SIP calculator */}
        {!error && !loading && detail && <SipCard code={code} schemeName={detail.scheme_name} />}

        <p className="mt-6 text-xs leading-relaxed text-slate-400">
          Data from AMFI via the Market Data API. 1Y and 3Y returns are fixed trailing periods
          (annualised above 1Y); volatility, max drawdown and Sharpe are computed over the
          selected range, and shorter ranges are noisier. This is not investment advice, and
          past returns do not guarantee future ones.
        </p>
      </main>
    </div>
  )
}

// Debounced fund search with a loading spinner and empty state. Used for both
// the main fund picker and the comparison picker.
function SearchBox({ placeholder, onPick, small }: {
  placeholder: string
  onPick: (row: SearchRow) => void
  small?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchRow[]>([])
  const [open, setOpen] = useState(false)
  const [searching, setSearching] = useState(false)
  const [noHits, setNoHits] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setNoHits(false); setSearching(false); return }
    setSearching(true)
    const t = setTimeout(() => {
      getJson<{ data: SearchRow[] }>(`/schemes?q=${encodeURIComponent(query.trim())}&limit=8`)
        .then((r) => { setResults(r.data); setNoHits(r.data.length === 0); setOpen(true) })
        .catch(() => { setResults([]); setNoHits(false) })
        .finally(() => setSearching(false))
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const pick = (row: SearchRow) => {
    setQuery('')
    setResults([])
    setNoHits(false)
    setOpen(false)
    onPick(row)
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-slate-400 ${
          small ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm'
        }`}
      />
      {searching && (
        <span className={`absolute right-3 ${small ? 'top-2' : 'top-3.5'} h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500`} />
      )}
      {open && (results.length > 0 || noHits) && (
        <ul className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {noHits && <li className="px-4 py-2 text-xs text-slate-400">No funds match that search.</li>}
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
  )
}

// Copy the shareable #funds/<code> link.
function ShareButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const url = `${window.location.origin}${window.location.pathname}#funds/${code}`
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }).catch(() => {})
  }
  return (
    <button
      onClick={copy}
      className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
    >
      {copied ? 'Link copied ✓' : 'Share'}
    </button>
  )
}

// Rolling-return distribution: how consistent has this fund been across every
// possible holding window, not just the one ending today.
const ROLL_WINDOWS = ['1Y', '3Y', '5Y'] as const

function RollingCard({ code }: { code: string }) {
  const [win, setWin] = useState<(typeof ROLL_WINDOWS)[number]>('1Y')
  const [data, setData] = useState<RollingResp | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'none'>('loading')

  useEffect(() => {
    let active = true
    setState('loading')
    getJson<RollingResp>(`/schemes/${code}/rolling?window=${win}&beat=12`)
      .then((r) => { if (active) { setData(r); setState('ok') } })
      .catch(() => { if (active) { setData(null); setState('none') } })
    return () => { active = false }
  }, [code, win])

  const pos = (v: number) => {
    if (!data) return 0
    const span = data.max - data.min || 1
    return ((v - data.min) / span) * 100
  }

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Rolling {win} returns</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Every possible {win} holding period in this fund's history, not just the latest one.
          </p>
        </div>
        <div className="flex gap-1">
          {ROLL_WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                win === w ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      {state === 'loading' && <div className="mt-5 h-16 animate-pulse rounded bg-slate-100" />}
      {state === 'none' && (
        <p className="mt-5 text-sm text-slate-400">Not enough history for {win} rolling windows.</p>
      )}
      {state === 'ok' && data && (
        <>
          {/* min → max track with a median marker */}
          <div className="mt-6 px-1">
            <div className="relative h-2 rounded-full bg-gradient-to-r from-red-200 via-slate-200 to-emerald-200">
              <span
                className="absolute top-1/2 h-4 w-1 -translate-x-1/2 -translate-y-1/2 rounded bg-slate-900"
                style={{ left: `${pos(data.median)}%` }}
                title={`Median ${signed(data.median)}`}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="text-red-600">worst {signed(data.min)}</span>
              <span className="font-medium text-slate-700">median {signed(data.median)}</span>
              <span className="text-emerald-600">best {signed(data.max)}</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
            <Stat label="Windows measured" value={data.observations.toLocaleString('en-IN')} />
            <Stat label={`Average ${data.annualized ? '(ann.)' : ''}`} value={signed(data.avg)} tone={data.avg} />
            <Stat label={`Beat ${data.beat_pct}% p.a.`} value={`${data.pct_beating.toFixed(1)}%`} hint={`The share of all ${win} windows where the fund returned at least ${data.beat_pct}% annualised. Higher means more consistent.`} />
            <Stat label="Worst window" value={signed(data.min)} tone={data.min} hint={`${data.worst.from} to ${data.worst.to}`} />
          </div>
        </>
      )}
    </div>
  )
}

// SIP calculator: what a fixed monthly investment actually became, with XIRR
// (the return measure that accounts for the timing of every installment).
function SipCard({ code, schemeName }: { code: string; schemeName: string }) {
  const defaultFrom = useMemo(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 3)
    return d.toISOString().slice(0, 10)
  }, [])

  const [amount, setAmount] = useState('5000')
  const [from, setFrom] = useState(defaultFrom)
  const [res, setRes] = useState<SipResp | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  useEffect(() => {
    const amt = Number(amount)
    if (!(amt > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) return
    let active = true
    setState('loading')
    const t = setTimeout(() => {
      getJson<SipResp>(`/schemes/${code}/sip?amount=${amt}&from=${from}`)
        .then((r) => { if (active) { setRes(r); setState('ok') } })
        .catch(() => { if (active) setState('error') })
    }, 350)
    return () => { active = false; clearTimeout(t) }
  }, [code, amount, from])

  const sip = state === 'ok' ? res?.sip : null
  const gain = sip ? sip.current_value - sip.total_invested : null

  return (
    <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-slate-900">SIP calculator</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        What a monthly SIP in {schemeName} would actually have become, using real NAVs on each installment date.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-500">
          Monthly amount (₹)
          <input
            type="number"
            min={100}
            step={500}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 block w-32 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
        <label className="text-xs text-slate-500">
          Starting from
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>
      </div>

      {state === 'loading' && <div className="mt-5 h-16 animate-pulse rounded bg-slate-100" />}
      {state === 'error' && (
        <p className="mt-5 text-sm text-slate-400">
          Couldn't simulate this SIP. Try a start date within the fund's NAV history.
        </p>
      )}
      {sip && gain != null && (
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
          <Stat label={`Invested (${sip.installments} months)`} value={`₹${inr0(sip.total_invested)}`} />
          <Stat label={`Value on ${sip.to}`} value={`₹${inr0(sip.current_value)}`} tone={gain} />
          <Stat label="Gain" value={`${gain >= 0 ? '+' : ''}₹${inr0(gain)}`} tone={gain} />
          <Stat
            label="XIRR"
            value={sip.xirr_pct != null ? signed(sip.xirr_pct) : 'n/a'}
            tone={sip.xirr_pct}
            hint="Annualised return that accounts for when each installment was invested. This is the right number to compare against FD rates or fund CAGRs."
          />
        </div>
      )}
    </div>
  )
}

// Fund-house logo. Tries the self-hosted file first, then the favicon CDN, then
// a coloured-initial fallback. Reset per fund via a `key` so state doesn't stick.
function Avatar({ name }: { name: string }) {
  const [i, setI] = useState(0)
  const domain = amcDomain(name)
  const sources = domain ? [`/amc/${domain}.png`, logoUrl(domain)] : []
  if (sources[i]) {
    return (
      <img
        src={sources[i]}
        alt={name}
        onError={() => setI((v) => v + 1)}
        className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 bg-white object-contain p-2"
      />
    )
  }
  return (
    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white ${avatarColor(name)}`}>
      {name.trim().charAt(0).toUpperCase()}
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
