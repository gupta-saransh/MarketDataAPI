# Market Data API — MCP Server

> **Status: live in production** at `https://market-data-api-psi.vercel.app/api/mcp`.
> Exposes the Market Data API REST data to AI agents over the Model Context Protocol (MCP) as a
> remote, stateless Streamable HTTP server at `POST /api/mcp`. Built with the four
> recommended decisions (see [Decisions](#decisions-locked)). Verified against
> CockroachDB both locally and in production with a real MCP client and raw JSON-RPC:
> all 11 tools list + call, structured output validates, error paths work, `GET /api/mcp`
> → 405, and the existing REST routes are unchanged.

The goal: let AI agents (Claude's MCP connector, Claude Desktop/web custom connectors,
and any other MCP client) consume the mutual-fund data the same way the web explorer
and Google Sheets functions already do — by pointing at a URL, with zero install.

This is **not** Anthropic-SDK work. Exposing data to agents means building an MCP
**server** with `@modelcontextprotocol/sdk` (the protocol agents speak as clients).
The Anthropic SDK is the other direction (calling Claude) and is not a dependency here.

---

## The one mental model

```
        AI agent (Claude API connector, Claude Desktop, etc.)
                 │  MCP / JSON-RPC over Streamable HTTP
                 ▼
        your-app.vercel.app/api/mcp   ← new Fastify route (POST), inside api/vercel.js
                 │
                 └─► api/lib/queries.js  ← shared query layer
                         │
                         └─► sql adapter → CockroachDB (prod) / SQLite (dev)
```

The MCP server is a thin protocol adapter over the data access you already have. Tools
call the **DB adapter directly** through a shared query layer — never an HTTP round-trip
back into your own REST API.

---

## Transport & runtime model

**Remote, stateless Streamable HTTP**, served at `POST /api/mcp`, using
`@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`.

| Setting | Value | Why |
|---|---|---|
| `sessionIdGenerator` | `undefined` | Stateless. Each POST builds a fresh `McpServer` + transport, handles one request, tears down. No session state to lose between warm Vercel invocations. |
| `enableJsonResponse` | `true` | Respond with a single JSON body, not an SSE stream. Tools are pure request/response — no server-initiated messages (notifications/sampling) needed, and SSE wouldn't survive the serverless function lifecycle anyway. |
| `GET` / `DELETE /api/mcp` | `405` | Those verbs are for stateful sessions, which we don't have. |

This is the same constraint that already makes the rate-limit store per-warm-container —
embrace it rather than fight it.

---

## Where it lives (and the function-count trap)

**Do not add `api/mcp.js` as a Vercel function** — that pushes toward the 12-function
Hobby ceiling the `builds` array in `vercel.json` already works around.

Instead:

- New Fastify route module **`api/routes/mcp.js`**, registered in `api/app.js` like every
  other route. It rides inside the existing single serverless function via `api/vercel.js`.
  Function count unchanged.
- **`vercel.json` needs no change** — `/api/(.*)` already routes to `api/vercel.js`, and the
  `/api` prefix is stripped before Fastify, so Fastify sees `POST /mcp`.

### Fastify ↔ raw-res integration (the one fiddly bit)

The SDK's `transport.handleRequest(req, res, parsedBody)` expects Node
`IncomingMessage` / `ServerResponse`. In the Fastify route handler:

1. `reply.hijack()` — take Fastify out of the reply lifecycle.
2. Pass `request.raw` (req), `reply.raw` (res), and the already-parsed `request.body`
   to `transport.handleRequest(...)`.

That's the clean seam. Fastify already parses the JSON body; the SDK accepts the parsed
body as the third argument so it isn't read twice.

---

## Tool surface

Read-only, **11 tools** mapping to existing endpoints. The `/sync-nav` **write path is
deliberately excluded** — the MCP surface is read-only.

| Tool | Input | Backed by (REST equivalent) |
|---|---|---|
| `search_schemes` | `q?`, `fund_house_id?`, `category_id?`, `broad_category?`, `page?`, `limit?` | `GET /schemes` |
| `get_scheme` | `scheme_code` | `GET /schemes/:code` |
| `get_scheme_by_isin` | `isin` | `GET /schemes/isin/:isin` |
| `get_nav_history` | `scheme_code`, `startDate?`, `endDate?` | `GET /:code/nav` |
| `get_latest_nav` | `scheme_code` | `GET /:code/nav/latest` |
| `get_returns` | `scheme_code` | `GET /:code/returns` |
| `get_rolling` | `scheme_code`, `window?`, `beat?` | `GET /:code/rolling` |
| `get_risk` | `scheme_code`, `rf?` | `GET /:code/risk` |
| `get_sip` | `scheme_code`, `amount?`, `from?`, `to?`, `day?` | `GET /:code/sip` |
| `list_fund_houses` / `list_categories` | — | `GET /fund-houses`, `GET /categories` |

(`get_rolling` was added beyond the original 10-tool sketch, for full parity with the
REST analytics surface.)

Design rules:

- **Tool descriptions are load-bearing.** They're how an agent decides *when* to call a
  tool. Write them prescriptively ("Use this when the user asks about a fund's past
  performance / volatility / SIP returns"), not just descriptively. Recent Claude models
  under-reach for tools, so an explicit trigger condition in the description measurably
  raises call rate.
- **`scheme_code` is a string in every schema.** CockroachDB returns integer columns as
  strings (`"101762"`), and the codebase already treats it as an opaque identifier.
- **The text block must carry the full data**, not just a summary. Each tool returns
  `structuredContent` (validated against its `outputSchema`) **and** a `content` text
  block containing a one-line summary followed by the serialized JSON. Most MCP clients
  feed the `content` text to the model and only secondarily use `structuredContent` — a
  summary-only text block hides the actual rows from the agent (observed in the wild: a
  search returning "Found 10 schemes" with no codes, leaving the agent unable to proceed).

---

## Data resolution — share the query layer

Tools must **not** HTTP back into the REST API. Two options:

1. **(Recommended) Extract a shared query layer.** Pull the core SQL + row-shaping out of
   `api/routes/schemes.js` and `api/routes/analytics.js` into `api/lib/queries.js`. Both
   the Fastify routes *and* the MCP tools import it. One source of truth, no self-call
   latency, no drift. This is a net improvement to the codebase regardless of MCP.
2. (Lower effort) Tools call the `sql` adapter directly with copies of the queries. Faster
   to write, but the same SQL now lives in two places.

Recommendation: **option 1.**

---

## Cross-cutting concerns

| Concern | Plan |
|---|---|
| **Rate limiting** | Reuse `@fastify/rate-limit`; consider a tighter dedicated limit on `/mcp` (agents fan out aggressively). Same per-warm-container caveat as the REST API. |
| **Auth** | Open (matching the public read-only REST API) is simplest and probably right. Optional API-key header gate if per-consumer usage tracking is wanted — not required for launch. |
| **Analytics (Axiom)** | The `onResponse` hook in `api/app.js` will log MCP calls as a single `/mcp` route, losing per-tool granularity. Either enrich the hook to read the JSON-RPC `method` / tool name, or emit a per-tool Axiom event from inside each tool handler. |
| **OpenAPI drift** | `api/openapi.js` is hand-maintained. Ideally generate MCP tool input schemas from the same spec so REST / OpenAPI / MCP can't diverge. Manual to start is acceptable; tracked as tech debt. |
| **Cold start** | Building a fresh server + registering ~9 tools per request is cheap. No concern. |

---

## Local dev & verification

- The route works on `localhost:3001/mcp` under `npm run dev`.
- Add an optional `npm run mcp:inspect` that points `npx @modelcontextprotocol/inspector`
  at the local route for interactive tool testing.
- Smoke-test as a real consumer via Claude's API MCP connector:

  ```js
  client.beta.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    betas: ['mcp-client-2025-11-20'],
    mcp_servers: [{ type: 'url', url: 'https://<app>.vercel.app/api/mcp', name: 'market-data-api' }],
    tools: [{ type: 'mcp_toolset', mcp_server_name: 'market-data-api' }],
    messages: [{ role: 'user', content: 'What is the latest NAV of scheme 101762?' }],
  })
  ```

---

## Decisions (locked)

All four shipped on the recommended option:

1. **Shared query layer** — extracted to [api/lib/queries.js](api/lib/queries.js); REST routes
   and MCP tools both import it. No self-call, no SQL duplication.
2. **Auth: open** — no key, matching the public read-only REST API. Reuses the global
   `@fastify/rate-limit` (per-warm-container). `/sync-nav` stays excluded.
3. **Structured output** — every tool has an `outputSchema` (zod) and returns
   `structuredContent` plus a one-line text summary.
4. **Analytics: deferred** — `/mcp` is excluded from the Axiom `onResponse` hook in
   [api/app.js](api/app.js). Revisit with per-tool events if MCP traffic proves material.

---

## Rollout status

- [x] `npm i @modelcontextprotocol/sdk zod` in `api/`.
- [x] Extract [api/lib/queries.js](api/lib/queries.js); repoint REST routes to it
      ([schemes.js](api/routes/schemes.js), [analytics.js](api/routes/analytics.js),
      [fund-houses.js](api/routes/fund-houses.js), [categories.js](api/routes/categories.js)).
- [x] [api/routes/mcp.js](api/routes/mcp.js): stateless server-per-request, tools off the
      query layer, raw req/res to the transport via `reply.hijack()`.
- [x] Register the route in [api/app.js](api/app.js); add `mcp:inspect` npm script.
- [x] Local smoke test (real MCP client: 11 tools list + call, structured output validates,
      error paths) + REST routes confirmed unchanged + 26 unit tests pass.
- [x] **Deploy** — live at `https://market-data-api-psi.vercel.app/api/mcp`; verified in
      production (tools/list + tools/call, structured output, isError path, GET → 405).
- [ ] Document the public MCP URL in the explorer / README alongside the Google Sheets functions.

No `vercel.json` change, no new serverless function, no Anthropic dependency.

> **Pre-existing note:** `npm audit` reports 5 high-severity advisories in `fast-uri`, a
> transitive dependency of the existing **Fastify 4** tree — not introduced by the MCP SDK
> or zod (both clean). The only fix is `fastify@5` (breaking); out of scope for this work.

## Local testing

```bash
cd api && npm run dev          # serves /mcp on :3001 (uses DATABASE_URL from .env)
npm run mcp:inspect            # launch MCP Inspector UI, point it at http://localhost:3001/mcp
```

The Streamable HTTP transport requires clients to send
`Accept: application/json, text/event-stream`; the SDK client, MCP Inspector, and the
Claude connector all do this automatically.
