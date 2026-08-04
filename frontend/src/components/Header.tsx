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
    <header>
      {/* Nav bar — same structure as the landing page for a consistent feel */}
      <nav className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <a href="#" className="font-semibold tracking-tight text-white">Market Data API</a>
          <div className="flex items-center gap-5 text-sm">
            <a href="#" className="text-slate-400 transition-colors hover:text-white">Home</a>
            <a href="#funds" className="text-slate-400 transition-colors hover:text-white">Fund Visualizer</a>
            <span className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs">
              <span className={`h-2 w-2 rounded-full ${dot}`} />
              <span className="text-slate-300">{label}</span>
            </span>
          </div>
        </div>
      </nav>

      {/* Page heading */}
      <div className="mx-auto max-w-5xl px-6 pb-8 pt-12">
        <h1 className="text-4xl font-bold tracking-tight text-white">API Reference</h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-400">
          Every endpoint, with live try-it panels and example responses.
        </p>
        <div className="mt-5 inline-flex items-center gap-2 text-sm">
          <span className="text-slate-500">Base URL</span>
          <code className="rounded-md bg-slate-900 px-2.5 py-1 font-mono text-slate-300 ring-1 ring-slate-800">{API_BASE}</code>
        </div>
      </div>
    </header>
  )
}
