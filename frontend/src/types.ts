// Minimal OpenAPI 3.x shapes (only the parts this explorer reads).

export interface OpenApiParam {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  description?: string
  example?: unknown
  schema?: { type?: string; default?: unknown; format?: string }
}

export interface OpenApiResponse {
  description?: string
  content?: Record<string, { example?: unknown }>
}

export interface OpenApiOperation {
  tags?: string[]
  summary?: string
  description?: string
  parameters?: OpenApiParam[]
  responses?: Record<string, OpenApiResponse>
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export type OpenApiPathItem = Partial<Record<HttpMethod, OpenApiOperation>>

export interface OpenApiSpec {
  openapi: string
  info: { title: string; version: string; description?: string }
  servers?: { url: string; description?: string }[]
  tags?: { name: string; description?: string }[]
  paths: Record<string, OpenApiPathItem>
}

// A flattened endpoint (one method + path), grouped under a tag for rendering.
export interface Endpoint {
  method: HttpMethod
  path: string
  op: OpenApiOperation
}

export interface ApiResult {
  status: number
  statusText: string
  ok: boolean
  durationMs: number
  body: unknown
  rawText: string
  error?: string
}

// ── Fund / NAV domain types (used by the Fund Visualizer) ─────
// Only the fields the UI reads. scheme_code is string | number because
// CockroachDB returns integers as strings while SQLite returns numbers.

export interface NavPoint {
  nav_date: string
  nav: number
}

export interface SchemeDetail {
  scheme_code: string | number
  scheme_name: string
  isin_growth: string | null
  fund_house: string | null
  category: string | null
  broad_category: string | null
  nav: number | null
  nav_date: string | null
}

export interface Period {
  return_pct: number
  annualized: boolean
}

export interface ReturnsResp {
  as_of: string
  latest_nav: number
  returns: Record<string, Period | null>
}

// Risk metrics computed client-side from a NAV slice.
export interface Risk {
  vol: number
  maxDD: number
  cagr: number
  sharpe: number | null
}

export interface SearchRow {
  scheme_code: string | number
  scheme_name: string
  fund_house: string | null
  category: string | null
}

// GET /schemes/:code/sip response.
export interface SipResp {
  scheme_code: string | number
  scheme_name: string
  frequency: string
  sip: {
    amount: number
    day: number
    from: string
    to: string
    installments: number
    total_invested: number
    units: number
    current_value: number
    absolute_return_pct: number
    xirr_pct: number | null
  }
}

// GET /schemes/:code/holdings response (allocation proxied from finapi).
export interface HoldingRow {
  name: string | null
  sector: string | null
  weightage: number | null
  market_value_cr: number | null
  change_1m: number | null
}

export interface SectorRow {
  sector: string | null
  weightage: number | null
  market_value_cr: number | null
  change_1m: number | null
}

export interface HoldingsResp {
  scheme_code: string | number
  scheme_name: string
  fund_house: string | null
  category: string | null
  broad_category: string | null
  as_of: string | null
  asset_allocation: { equity: number | null; debt: number | null; cash: number | null; other: number | null } | null
  market_cap: { large: number | null; mid: number | null; small: number | null; others: number | null } | null
  concentration: {
    number_of_holdings: number | null
    top3_sector_weight: number | null
    top5_stocks_weight: number | null
    top10_stocks_weight: number | null
    average_market_cap_cr: number | null
  } | null
  holdings: HoldingRow[] | null
  sectors: SectorRow[] | null
  cached: boolean
  stale?: boolean
  note?: string
}

// GET /schemes/:code/rolling response.
export interface RollingResp {
  scheme_code: string | number
  scheme_name: string
  window: string
  observations: number
  annualized: boolean
  avg: number
  min: number
  max: number
  median: number
  beat_pct: number
  pct_beating: number
  best: { from: string; to: string; return_pct: number }
  worst: { from: string; to: string; return_pct: number }
}
