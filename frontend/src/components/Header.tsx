import { useEffect, useState } from 'react'
import { API_BASE, checkHealth } from '../lib/api'

export default function Header() {
  const [health, setHealth] = useState<{ ok: boolean; driver?: string } | null>(null)

  useEffect(() => {
    let active = true
    const run = () => checkHealth().then((h) => { if (active) setHealth(h) })
    run()
    const id = setInterval(run, 15000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const dot = health == null ? 'bg-slate-600'
    : health.ok ? 'bg-emerald-400' : 'bg-red-500'
  const label = health == null ? 'checking…'
    : health.ok ? `online${health.driver ? ` · ${health.driver}` : ''}` : 'offline'

  return (
    <header className="border-b border-slate-800/80 bg-slate-950">
      <div className="mx-auto max-w-5xl px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              ← Home
            </a>
            <a
              href="#funds"
              className="text-sm text-slate-400 transition-colors hover:text-white"
            >
              Visualizer
            </a>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-white">
                Market Data API
              </h1>
              <p className="text-xs text-slate-500">
                API Reference
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm">
            <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
            <span className="text-slate-300">{label}</span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-slate-500">Base URL</span>
          <code className="rounded bg-slate-900 px-2 py-1 font-mono text-slate-300">{API_BASE}</code>
        </div>
      </div>
    </header>
  )
}
