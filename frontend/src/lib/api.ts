import type { ApiResult } from '../types'

// Base URL for all API calls. Defaults to same-origin `/api`, which works
// both in dev (Vite proxy → localhost:3001) and prod (Vercel routes /api/*).
// Override with VITE_API_URL only when the API lives on another origin.
export const API_BASE = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/$/, '')

/** Build a full request URL from an OpenAPI path template + filled params. */
export function buildUrl(
  pathTemplate: string,
  pathParams: Record<string, string>,
  queryParams: Record<string, string>,
): string {
  let path = pathTemplate
  for (const [key, value] of Object.entries(pathParams)) {
    path = path.replace(`{${key}}`, encodeURIComponent(value))
  }

  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== '') qs.append(key, value)
  }
  const query = qs.toString()
  return `${API_BASE}${path}${query ? `?${query}` : ''}`
}

/** Fire a request and return a structured, display-ready result. */
export async function sendRequest(method: string, url: string): Promise<ApiResult> {
  const start = performance.now()
  try {
    const res = await fetch(url, { method: method.toUpperCase() })
    const rawText = await res.text()
    const durationMs = Math.round(performance.now() - start)

    let body: unknown = rawText
    try { body = JSON.parse(rawText) } catch { /* keep raw text */ }

    return {
      status: res.status,
      statusText: res.statusText,
      ok: res.ok,
      durationMs,
      body,
      rawText,
    }
  } catch (err) {
    return {
      status: 0,
      statusText: 'Network error',
      ok: false,
      durationMs: Math.round(performance.now() - start),
      body: null,
      rawText: '',
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Quick health probe for the header indicator. */
export async function checkHealth(): Promise<{ ok: boolean; driver?: string }> {
  try {
    const res = await fetch(`${API_BASE}/health`)
    if (!res.ok) return { ok: false }
    const data = await res.json()
    return { ok: data?.status === 'ok', driver: data?.driver }
  } catch {
    return { ok: false }
  }
}
