// Minimal OpenAPI 3.x shapes — only the parts this explorer reads.

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
