import { useEffect, useState } from 'react'
import type { Endpoint, HttpMethod, OpenApiSpec } from '../types'
import { API_BASE } from '../lib/api'

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

interface State {
  spec: OpenApiSpec | null
  groups: { tag: string; description?: string; endpoints: Endpoint[] }[]
  loading: boolean
  error: string | null
}

/** Loads /openapi.json once and flattens it into tag-grouped endpoints. */
export function useOpenApi(): State {
  const [state, setState] = useState<State>({
    spec: null, groups: [], loading: true, error: null,
  })

  useEffect(() => {
    let cancelled = false

    fetch(`${API_BASE}/openapi.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load spec (HTTP ${res.status})`)
        return res.json() as Promise<OpenApiSpec>
      })
      .then((spec) => {
        if (cancelled) return
        setState({ spec, groups: groupByTag(spec), loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          spec: null, groups: [], loading: false,
          error: err instanceof Error ? err.message : String(err),
        })
      })

    return () => { cancelled = true }
  }, [])

  return state
}

function groupByTag(spec: OpenApiSpec) {
  const byTag = new Map<string, Endpoint[]>()

  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const op = item[method]
      if (!op) continue
      const tag = op.tags?.[0] ?? 'Other'
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag)!.push({ method, path, op })
    }
  }

  // Preserve the tag order declared in the spec, then any extras.
  const order = spec.tags?.map((t) => t.name) ?? []
  const tagNames = [...byTag.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b)
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib)
  })

  return tagNames.map((tag) => ({
    tag,
    description: spec.tags?.find((t) => t.name === tag)?.description,
    endpoints: byTag.get(tag)!,
  }))
}
