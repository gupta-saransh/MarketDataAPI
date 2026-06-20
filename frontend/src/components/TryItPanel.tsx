import { useMemo, useState } from 'react'
import type { Endpoint, ApiResult } from '../types'
import { buildUrl, sendRequest } from '../lib/api'
import ResponseView from './ResponseView'

export default function TryItPanel({ endpoint }: { endpoint: Endpoint }) {
  const params = endpoint.op.parameters ?? []
  const pathParams  = params.filter((p) => p.in === 'path')
  const queryParams = params.filter((p) => p.in === 'query')

  // Seed initial values from spec example / default.
  const initial = useMemo(() => {
    const v: Record<string, string> = {}
    for (const p of params) {
      const seed = p.example ?? p.schema?.default
      v[p.name] = seed != null ? String(seed) : ''
    }
    return v
  }, [endpoint.path, endpoint.method])

  const [values, setValues] = useState<Record<string, string>>(initial)
  const [result, setResult] = useState<ApiResult | null>(null)
  const [loading, setLoading] = useState(false)

  const set = (name: string, value: string) =>
    setValues((prev) => ({ ...prev, [name]: value }))

  const previewUrl = buildUrl(
    endpoint.path,
    Object.fromEntries(pathParams.map((p) => [p.name, values[p.name] ?? ''])),
    Object.fromEntries(queryParams.map((p) => [p.name, values[p.name] ?? ''])),
  )

  const missingRequired = pathParams.some((p) => !values[p.name])

  const run = async () => {
    setLoading(true)
    const res = await sendRequest(endpoint.method, previewUrl)
    setResult(res)
    setLoading(false)
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
      {(pathParams.length > 0 || queryParams.length > 0) && (
        <div className="space-y-4">
          {pathParams.length > 0 && (
            <ParamGroup title="Path parameters" params={pathParams} values={values} onChange={set} />
          )}
          {queryParams.length > 0 && (
            <ParamGroup title="Query parameters" params={queryParams} values={values} onChange={set} />
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={loading || missingRequired}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? 'Running…' : 'Run ▶'}
        </button>
        <code className="min-w-0 flex-1 truncate rounded bg-white px-3 py-2 font-mono text-xs text-slate-500 ring-1 ring-slate-200">
          {previewUrl}
        </code>
      </div>

      {missingRequired && (
        <p className="mt-2 text-xs text-amber-600">Fill in required path parameters to run.</p>
      )}

      {result && <ResponseView result={result} />}
    </div>
  )
}

function ParamGroup({
  title, params, values, onChange,
}: {
  title: string
  params: NonNullable<Endpoint['op']['parameters']>
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {params.map((p) => (
          <label key={p.name} className="block text-sm">
            <span className="font-mono text-slate-700">
              {p.name}
              {p.required && <span className="text-red-500">*</span>}
              <span className="ml-1 font-sans text-xs text-slate-400">{p.schema?.type}</span>
            </span>
            <input
              value={values[p.name] ?? ''}
              onChange={(e) => onChange(p.name, e.target.value)}
              placeholder={p.description ?? ''}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-slate-400 focus:ring-1 focus:ring-slate-300"
            />
            {p.description && <span className="mt-1 block text-xs text-slate-400">{p.description}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}
