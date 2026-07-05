import { useEffect, useRef, useState } from 'react'

const BASE = 'https://market-data-api-psi.vercel.app/api'
const GITHUB = 'https://github.com/your-github/market-data-api'

// Count-up on first render so the stats read as live data, not static copy.
function CountUp({ to, suffix = '', duration = 900 }: { to: number; suffix?: string; duration?: number }) {
  const [v, setV] = useState(0)
  const raf = useRef(0)
  useEffect(() => {
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setV(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [to, duration])
  return <span>{v.toLocaleString('en-IN')}{suffix}</span>
}

const ENDPOINT_GROUPS: { title: string; blurb: string; endpoints: [string, string][] }[] = [
  {
    title: 'Discovery',
    blurb: 'Find the scheme code you need.',
    endpoints: [
      ['/schemes?q=hdfc flexi', 'search 14,583 schemes by name, AMC, or category'],
      ['/fund-houses', 'all 41 AMCs'],
      ['/categories', 'all scheme categories, grouped'],
    ],
  },
  {
    title: 'Data',
    blurb: 'Raw NAVs, straight from AMFI.',
    endpoints: [
      ['/schemes/:code', 'scheme detail + latest NAV'],
      ['/schemes/isin/:isin', 'lookup by ISIN'],
      ['/schemes/:code/nav', '5 years of daily NAV history'],
      ['/schemes/:code/nav/latest', 'latest NAV only'],
      ['/nav/latest?codes=a,b,c', 'batch: up to 100 latest NAVs in one call'],
    ],
  },
  {
    title: 'Analytics',
    blurb: 'The math you would otherwise do in a spreadsheet.',
    endpoints: [
      ['/schemes/:code/returns', 'trailing returns, 1W to 5Y + inception CAGR'],
      ['/schemes/:code/rolling?window=3Y', 'rolling-return distribution (consistency)'],
      ['/schemes/:code/risk', 'volatility, max drawdown, Sharpe'],
      ['/schemes/:code/sip?amount=5000', 'SIP simulation with XIRR'],
    ],
  },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">

      {/* Nav */}
      <nav className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold tracking-tight text-white">Market Data API</span>
          <div className="flex items-center gap-5 text-sm">
            <a href="#funds" className="text-slate-400 transition-colors hover:text-white">Fund Visualizer</a>
            <a href="#docs" className="text-slate-400 transition-colors hover:text-white">API Reference</a>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="text-slate-400 transition-colors hover:text-white">GitHub</a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <header className="mx-auto max-w-5xl px-6 pb-20 pt-24 sm:pt-32">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Free. No API key. No signup. No catch.
        </div>
        <h1 className="max-w-3xl text-5xl font-bold leading-[1.05] tracking-tight text-white sm:text-6xl">
          Every Indian mutual fund.
          <br />
          <span className="text-emerald-400">One API call away.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-400">
          14,583 schemes. Five years of daily NAV history. Trailing and rolling returns,
          volatility, drawdowns, Sharpe, SIP simulation with XIRR. Synced from AMFI five
          times a day, served as plain JSON.
        </p>
        <p className="mt-3 max-w-2xl text-sm text-slate-500">
          For developers building portfolio trackers, researchers backtesting ideas, people
          who live in spreadsheets, and AI agents that need real fund data.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href="#funds" className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-emerald-400">
            Open the Fund Visualizer
          </a>
          <a href="#docs" className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
            Explore the API
          </a>
        </div>
      </header>

      {/* Terminal: the actual product, front and center */}
      <section className="mx-auto w-full max-w-5xl px-6">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-[#0b1120] shadow-2xl shadow-emerald-950/20">
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-red-500/60" />
              <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
              <span className="h-3 w-3 rounded-full bg-green-500/60" />
            </div>
            <span className="font-mono text-[11px] text-slate-600">try it in your terminal right now</span>
          </div>
          <div className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed">
            <div className="whitespace-nowrap">
              <span className="select-none text-slate-600">$ </span>
              <span className="text-emerald-400">curl</span>
              <span className="text-slate-300"> {BASE}/schemes/101762/nav/latest</span>
            </div>
            <pre className="mt-3 text-slate-300">{`{
  "scheme_code": 101762,
  "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
  "nav_date": "2026-06-19",
  "nav": 2000.152
}`}</pre>
            <div className="mt-5 whitespace-nowrap">
              <span className="select-none text-slate-600">$ </span>
              <span className="text-emerald-400">curl</span>
              <span className="text-slate-300"> "{BASE}/schemes/101762/sip?amount=5000&from=2021-07-01"</span>
              <span className="select-none text-slate-600">  # what a 5k monthly SIP became</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {[
            { node: <CountUp to={14583} />, label: 'schemes tracked' },
            { node: <CountUp to={5} suffix=" yrs" />, label: 'daily NAV history' },
            { node: <CountUp to={5} suffix="x" />, label: 'AMFI syncs per day' },
            { node: <CountUp to={0} />, label: 'API keys needed' },
          ].map(({ node, label }) => (
            <div key={label}>
              <div className="text-4xl font-bold tabular-nums text-white">{node}</div>
              <div className="mt-1 text-sm text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Endpoints, grouped by what you are trying to do */}
      <section className="border-t border-slate-800/80">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="text-2xl font-bold tracking-tight text-white">The API surface</h2>
          <p className="mt-2 text-sm text-slate-500">
            Base URL: <code className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-300">{BASE}</code>
          </p>
          <div className="mt-10 grid gap-10 md:grid-cols-3">
            {ENDPOINT_GROUPS.map(({ title, blurb, endpoints }) => (
              <div key={title}>
                <h3 className="text-sm font-semibold uppercase tracking-widest text-emerald-400">{title}</h3>
                <p className="mt-1 text-sm text-slate-500">{blurb}</p>
                <ul className="mt-4 space-y-3">
                  {endpoints.map(([path, desc]) => (
                    <li key={path}>
                      <code className="text-[13px] text-slate-200">{path}</code>
                      <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <a href="#docs" className="mt-10 inline-block text-sm text-emerald-400 transition-colors hover:text-emerald-300">
            Full reference with live try-it panels →
          </a>
        </div>
      </section>

      {/* The two things nobody else gives you */}
      <section className="border-t border-slate-800/80">
        <div className="mx-auto grid max-w-5xl gap-6 px-6 py-16 md:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-7">
            <h3 className="text-lg font-semibold text-white">Works in Google Sheets</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Paste one Apps Script file and your spreadsheet gets real formulas: live NAVs,
              daily change, NAV on any past date. No add-on store, no OAuth dance.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-300">{`=MF_NAV(101762)          → 2000.152
=MF_DAILY_CHANGE(101762) → +0.42%
=MF_NAV_ON(101762, "2024-01-15")`}</pre>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-7">
            <h3 className="text-lg font-semibold text-white">Built for AI agents (MCP)</h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              A remote MCP server exposes all of it as 11 tools. Point Claude, or any MCP
              client, at one URL and it can search funds, pull NAV history, and run SIP math
              in a conversation.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 font-mono text-[13px] leading-relaxed text-slate-300">{`{ "mcpServers": { "market-data-api": {
    "url": "${BASE}/mcp" } } }`}</pre>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800/80">
        <div className="mx-auto max-w-5xl space-y-4 px-6 py-10 text-xs leading-relaxed text-slate-500">
          <p>
            Data sourced from AMFI (Association of Mutual Funds in India), synced five times a
            day. This is not investment advice, and past returns do not guarantee future ones.
            Verify NAVs with your fund house before acting on them.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>Apache 2.0 licensed</span>
            <a href={GITHUB} target="_blank" rel="noreferrer" className="transition-colors hover:text-slate-300">Source on GitHub</a>
            <a href="#docs" className="transition-colors hover:text-slate-300">API Reference</a>
            <span className="text-slate-600">Fastify + CockroachDB + Vercel</span>
          </div>
        </div>
      </footer>

    </div>
  )
}
