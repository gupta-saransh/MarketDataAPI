import { useState } from 'react'
import type { ApiResult } from '../types'

function statusColor(status: number, ok: boolean): string {
  if (status === 0) return 'bg-slate-800 text-slate-300'
  if (ok) return 'bg-emerald-950 text-emerald-300'
  if (status >= 400 && status < 500) return 'bg-amber-950 text-amber-300'
  return 'bg-red-950 text-red-300'
}

export default function ResponseView({ result }: { result: ApiResult }) {
  const [copied, setCopied] = useState(false)

  const pretty = typeof result.body === 'string'
    ? result.rawText
    : JSON.stringify(result.body, null, 2)

  const copy = async () => {
    await navigator.clipboard.writeText(pretty)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className={`rounded px-2 py-0.5 font-mono font-semibold ${statusColor(result.status, result.ok)}`}>
          {result.status === 0 ? 'ERR' : result.status} {result.statusText}
        </span>
        <span className="text-slate-500">{result.durationMs} ms</span>
        <button
          onClick={copy}
          className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {result.error && (
        <p className="mb-2 text-sm text-red-400">{result.error}</p>
      )}
      <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-300 ring-1 ring-slate-800">
        {pretty}
      </pre>
    </div>
  )
}
