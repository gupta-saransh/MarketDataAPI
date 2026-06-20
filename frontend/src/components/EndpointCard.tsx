import { useState } from 'react'
import type { Endpoint } from '../types'
import TryItPanel from './TryItPanel'

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-sky-100 text-sky-700',
  post: 'bg-emerald-100 text-emerald-700',
  put: 'bg-amber-100 text-amber-700',
  patch: 'bg-amber-100 text-amber-700',
  delete: 'bg-red-100 text-red-700',
}

function exampleResponse(endpoint: Endpoint): string | null {
  const responses = endpoint.op.responses ?? {}
  const ok = responses['200'] ?? responses['201']
  const example = ok?.content?.['application/json']?.example
  return example != null ? JSON.stringify(example, null, 2) : null
}

export default function EndpointCard({ endpoint }: { endpoint: Endpoint }) {
  const [open, setOpen] = useState(false)
  const example = exampleResponse(endpoint)

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold uppercase ${METHOD_COLORS[endpoint.method] ?? 'bg-slate-100 text-slate-600'}`}>
          {endpoint.method}
        </span>
        <code className="font-mono text-sm text-slate-800">{endpoint.path}</code>
        <span className="truncate text-sm text-slate-400">{endpoint.op.summary}</span>
        <span className={`ml-auto text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div>
          {endpoint.op.description && (
            <p className="px-4 pb-3 text-sm text-slate-600">{endpoint.op.description}</p>
          )}
          <TryItPanel endpoint={endpoint} />
          {example && (
            <div className="border-t border-slate-200 px-4 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Example response
              </p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-100 p-3 font-mono text-xs leading-relaxed text-slate-700">
                {example}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
