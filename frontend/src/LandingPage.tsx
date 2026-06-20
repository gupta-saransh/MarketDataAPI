const BASE = 'https://market-data-api-psi.vercel.app/api'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">

      {/* Nav */}
      <nav className="border-b border-slate-800">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="font-semibold tracking-tight text-white">Market Data API</span>
          <a
            href="#docs"
            className="text-sm text-slate-400 transition-colors hover:text-white"
          >
            API Reference →
          </a>
        </div>
      </nav>

      {/* Hero */}
      <div className="mx-auto max-w-5xl px-6 py-24">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Free · No API key needed
        </div>
        <h1 className="max-w-2xl text-5xl font-bold leading-tight tracking-tight text-white">
          Indian mutual fund data,<br />without the hassle.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-400">
          NAV history, scheme details, and fund metadata for every SEBI-registered
          mutual fund in India. Pulled from AMFI 5 times a day. Just call the endpoint.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#docs"
            className="rounded-lg bg-white px-5 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100"
          >
            Explore the API
          </a>
          <a
            href="https://github.com/gupta-saransh/MarketDataAPI"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            GitHub
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="border-y border-slate-800">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 px-6 py-10 sm:grid-cols-4">
          {[
            { value: '9,183', label: 'Active schemes' },
            { value: '2 yrs',  label: 'NAV history'   },
            { value: '5×',    label: 'Daily updates'  },
            { value: '0',     label: 'Auth required'  },
          ].map(({ value, label }) => (
            <div key={label}>
              <div className="text-3xl font-bold text-white">{value}</div>
              <div className="mt-1 text-sm text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Code example */}
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <p className="mb-4 text-xs font-medium uppercase tracking-widest text-slate-500">
          Example
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-800">
          <div className="flex items-center gap-1.5 border-b border-slate-700 px-4 py-3">
            <div className="h-3 w-3 rounded-full bg-red-500/50" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/50" />
            <div className="h-3 w-3 rounded-full bg-green-500/50" />
          </div>
          <div className="space-y-4 p-5 font-mono text-sm">
            <div>
              <span className="select-none text-slate-500">$ </span>
              <span className="text-emerald-400">curl</span>
              <span className="text-slate-300"> {BASE}/schemes/101762/nav/latest</span>
            </div>
            <pre className="text-xs leading-relaxed text-slate-300">{`{
  "scheme_code": 101762,
  "scheme_name": "HDFC Flexi Cap Fund - Growth Plan",
  "nav_date": "2026-06-19",
  "nav": 2000.152
}`}</pre>
          </div>
        </div>

        {/* Endpoint list */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          {[
            { method: 'GET', path: '/fund-houses',             desc: 'All AMCs'                     },
            { method: 'GET', path: '/categories',              desc: 'Scheme categories'            },
            { method: 'GET', path: '/schemes?q=hdfc',          desc: 'Search & filter schemes'      },
            { method: 'GET', path: '/schemes/:code',           desc: 'Scheme details + latest NAV'  },
            { method: 'GET', path: '/schemes/isin/:isin',      desc: 'Lookup by ISIN'               },
            { method: 'GET', path: '/schemes/:code/nav',       desc: 'Full NAV history'             },
            { method: 'GET', path: '/schemes/:code/nav/latest','desc': 'Latest NAV only'            },
            { method: 'GET', path: '/health',                  desc: 'Service status'               },
          ].map(({ method, path, desc }) => (
            <div key={path} className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-800/50 px-4 py-3">
              <span className="mt-0.5 shrink-0 rounded bg-emerald-900/60 px-1.5 py-0.5 text-xs font-semibold text-emerald-400">
                {method}
              </span>
              <div>
                <code className="text-xs text-slate-300">{path}</code>
                <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <a
            href="#docs"
            className="inline-block rounded-lg border border-slate-700 px-6 py-2.5 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            View full API reference →
          </a>
        </div>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 px-6 py-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between text-xs text-slate-600">
          <span>Market Data API</span>
          <span>Data from AMFI · Fastify + Supabase + Vercel</span>
        </div>
      </footer>

    </div>
  )
}
