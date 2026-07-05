import { useState } from 'react'
import type { Endpoint } from '../types'
import TryItPanel from './TryItPanel'

const METHOD_COLORS: Record<string, string> = {
  get: 'bg-sky-950 text-sky-300',
  post: 'bg-emerald-950 text-emerald-300',
  put: 'bg-amber-950 text-amber-300',
  patch: 'bg-amber-950 text-amber-300',
  delete: 'bg-red-950 text-red-300',
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
    <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/50">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-800/50"
      >
        <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold uppercase ${METHOD_COLORS[endpoint.method] ?? 'bg-slate-800 text-slate-300'}`}>
          {endpoint.method}
        </span>
        <code className="font-mono text-sm text-slate-100">{endpoint.path}</code>
        <span className="truncate text-sm text-slate-500">{endpoint.op.summary}</span>
        <span className={`ml-auto text-slate-500 transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open && (
        <div>
          {endpoint.op.description && (
            <p className="px-4 pb-3 text-sm text-slate-400">{endpoint.op.description}</p>
          )}
          <TryItPanel endpoint={endpoint} />
          {example && (
            <div className="border-t border-slate-800 px-4 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Example response
              </p>
              <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300">
                {example}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
