/**
 * mcp.js — Model Context Protocol server (remote, Streamable HTTP).
 *
 * Exposes the read-only mutual-fund data to AI agents as MCP tools. Mounted at
 * POST /mcp (public path /api/mcp via vercel.js). The tools call lib/queries.js
 * directly — the same data-access layer the REST routes use — so there is no
 * HTTP self-call and the two surfaces can't drift.
 *
 * Stateless: a fresh server + transport is built per request (sessionIdGenerator
 * undefined), and enableJsonResponse returns a single JSON body instead of an
 * SSE stream — both required to run on Vercel's serverless functions, where no
 * connection or in-memory session survives between invocations.
 *
 * Read-only by design: the /sync-nav write path is NOT exposed here.
 */

import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

import {
  listFundHouses, listCategories,
  searchSchemes, getSchemeByCode, getSchemeByIsin, getNavHistory, getLatestNav,
  getReturns, getRolling, getRisk, getSip,
} from '../lib/queries.js'

// CockroachDB returns integer columns (scheme_code, ids) as strings; SQLite as
// numbers. Accept/emit either so the same schemas validate on both backends.
const id = z.union([z.string(), z.number()])

// ── result helpers ────────────────────────────────────────────

// Success: a text summary for humans + structuredContent for agents.
const ok = (structured, summary) => ({
  content: [{ type: 'text', text: summary ?? JSON.stringify(structured) }],
  structuredContent: structured,
})

// Failure: text-only, flagged so the agent sees it as an error (no structured
// content — outputSchema validation is skipped when isError is true).
const fail = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
})

const schemeCode = id.describe('Scheme code, e.g. "101762" (from search_schemes)')

// ── output shapes (mirror the REST response payloads) ─────────

const schemeShape = {
  scheme_code: id,
  scheme_name: z.string(),
  isin_growth: z.string().nullable(),
  isin_div_reinvestment: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  fund_house: z.string().nullable(),
  category: z.string().nullable(),
  broad_category: z.string().nullable(),
  nav: z.number().nullable(),
  nav_date: z.string().nullable(),
}

const period = z.object({
  return_pct: z.number(),
  annualized: z.boolean(),
  from_date: z.string(),
  from_nav: z.number(),
}).nullable()

const window = z.object({ from: z.string(), to: z.string(), return_pct: z.number() })

// ── tool registration ─────────────────────────────────────────

function buildServer() {
  const server = new McpServer({ name: 'mfapi', version: '1.0.0' })

  server.registerTool('search_schemes', {
    title: 'Search mutual fund schemes',
    description:
      'Search Indian mutual fund schemes by name and optional filters. Use this ' +
      'first to find a scheme_code when the user names a fund, AMC, or category. ' +
      'Returns a paginated list of matching schemes.',
    inputSchema: {
      q: z.string().optional().describe('Case-insensitive substring matched against the scheme name'),
      fund_house_id: z.number().int().optional().describe('Filter by fund house id (from list_fund_houses)'),
      category_id: z.number().int().optional().describe('Filter by category id (from list_categories)'),
      broad_category: z.string().optional().describe('Filter by broad category, e.g. "Equity", "Debt"'),
      page: z.number().int().min(1).optional().describe('1-based page number (default 1)'),
      limit: z.number().int().min(1).max(100).optional().describe('Results per page, 1–100 (default 20)'),
    },
    outputSchema: {
      total: z.number(),
      page: z.number(),
      limit: z.number(),
      data: z.array(z.object({
        scheme_code: id,
        scheme_name: z.string(),
        fund_house: z.string().nullable(),
        category: z.string().nullable(),
        broad_category: z.string().nullable(),
      })),
    },
  }, async (args) => {
    const res = await searchSchemes(args)
    return ok(res, `Found ${res.total} scheme(s); showing page ${res.page} (${res.data.length} rows).`)
  })

  server.registerTool('get_scheme', {
    title: 'Get scheme detail',
    description:
      'Get full detail for one scheme by its scheme_code: name, fund house, ' +
      'category, ISINs, and the latest NAV. Use when you already have a scheme_code.',
    inputSchema: { scheme_code: schemeCode },
    outputSchema: schemeShape,
  }, async ({ scheme_code }) => {
    const scheme = await getSchemeByCode(scheme_code)
    if (!scheme) return fail(`No scheme found for code ${scheme_code}.`)
    return ok(scheme, `${scheme.scheme_name} — latest NAV ${scheme.nav} on ${scheme.nav_date}.`)
  })

  server.registerTool('get_scheme_by_isin', {
    title: 'Get scheme by ISIN',
    description:
      'Look up a scheme by its ISIN (growth or dividend-reinvestment). Use when ' +
      'the user provides an ISIN like "INF179K01YV8" instead of a scheme name.',
    inputSchema: { isin: z.string().describe('12-character ISIN, e.g. "INF179K01YV8"') },
    outputSchema: schemeShape,
  }, async ({ isin }) => {
    const scheme = await getSchemeByIsin(isin)
    if (!scheme) return fail(`No scheme found for ISIN ${isin}.`)
    return ok(scheme, `${scheme.scheme_name} — latest NAV ${scheme.nav} on ${scheme.nav_date}.`)
  })

  server.registerTool('get_latest_nav', {
    title: 'Get latest NAV',
    description:
      "Get a scheme's most recent NAV and the date it is for. Use when the user " +
      'asks for the current / latest price of a fund.',
    inputSchema: { scheme_code: schemeCode },
    outputSchema: { scheme_code: id, scheme_name: z.string(), nav_date: z.string(), nav: z.number() },
  }, async ({ scheme_code }) => {
    const res = await getLatestNav(scheme_code)
    if (!res) return fail(`No NAV data found for code ${scheme_code}.`)
    return ok(res, `${res.scheme_name}: NAV ${res.nav} as of ${res.nav_date}.`)
  })

  server.registerTool('get_nav_history', {
    title: 'Get NAV history',
    description:
      'Get the daily NAV time series for a scheme, newest first, optionally bounded ' +
      'by a date range. Use for charts, historical lookups, or "NAV on <date>" questions.',
    inputSchema: {
      scheme_code: schemeCode,
      startDate: z.string().optional().describe('Inclusive lower bound, YYYY-MM-DD'),
      endDate: z.string().optional().describe('Inclusive upper bound, YYYY-MM-DD'),
    },
    outputSchema: {
      scheme_code: id,
      scheme_name: z.string(),
      data: z.array(z.object({ nav_date: z.string(), nav: z.number() })),
    },
  }, async ({ scheme_code, startDate, endDate }) => {
    const res = await getNavHistory(scheme_code, startDate ?? null, endDate ?? null)
    if (!res) return fail(`No NAV data found for code ${scheme_code}.`)
    return ok(res, `${res.scheme_name}: ${res.data.length} NAV point(s).`)
  })

  server.registerTool('get_returns', {
    title: 'Get trailing returns',
    description:
      'Get trailing point-to-point returns (1M, 3M, 6M, 1Y, 3Y, 5Y) plus since-inception ' +
      'for a scheme. Periods over 1 year are annualised (CAGR). Use when the user asks ' +
      "how a fund has performed. Null periods mean history doesn't reach that far back.",
    inputSchema: { scheme_code: schemeCode },
    outputSchema: {
      scheme_code: id,
      scheme_name: z.string(),
      as_of: z.string(),
      latest_nav: z.number(),
      returns: z.object({
        '1M': period, '3M': period, '6M': period,
        '1Y': period, '3Y': period, '5Y': period,
        inception: period,
      }),
    },
  }, async ({ scheme_code }) => {
    const res = await getReturns(scheme_code)
    if (!res.ok) return fail(res.error)
    return ok(res.data, `${res.data.scheme_name}: trailing returns as of ${res.data.as_of}.`)
  })

  server.registerTool('get_rolling', {
    title: 'Get rolling returns',
    description:
      'Get the distribution of rolling-window returns (avg/min/max/median and the % of ' +
      'windows beating a threshold) for a scheme. Use to judge consistency rather than a ' +
      'single point-to-point number.',
    inputSchema: {
      scheme_code: schemeCode,
      window: z.string().optional().describe('Rolling window, e.g. "1Y", "3Y", "6M" (default "3Y")'),
      beat: z.number().optional().describe('Annualised %% threshold to measure "beat" rate against (default 12)'),
    },
    outputSchema: {
      scheme_code: id,
      scheme_name: z.string(),
      window: z.string(),
      observations: z.number(),
      annualized: z.boolean(),
      avg: z.number(),
      min: z.number(),
      max: z.number(),
      median: z.number(),
      beat_pct: z.number(),
      pct_beating: z.number(),
      best: window,
      worst: window,
    },
  }, async ({ scheme_code, window: w, beat }) => {
    const res = await getRolling(scheme_code, { window: w, beat })
    if (!res.ok) return fail(res.error)
    return ok(res.data, `${res.data.scheme_name}: ${res.data.observations} rolling ${res.data.window} windows, median ${res.data.median.toFixed(2)}%.`)
  })

  server.registerTool('get_risk', {
    title: 'Get risk metrics',
    description:
      'Get annualised volatility, maximum drawdown, CAGR, and Sharpe ratio for a scheme. ' +
      'Use when the user asks about risk, volatility, or risk-adjusted returns.',
    inputSchema: {
      scheme_code: schemeCode,
      rf: z.number().optional().describe('Risk-free rate in %% for the Sharpe ratio (default 6)'),
    },
    outputSchema: {
      scheme_code: id,
      scheme_name: z.string(),
      annualized_volatility_pct: z.number(),
      max_drawdown_pct: z.number(),
      cagr_pct: z.number(),
      sharpe: z.number().nullable(),
      risk_free_pct: z.number(),
      observations: z.number(),
      from_date: z.string(),
      to_date: z.string(),
    },
  }, async ({ scheme_code, rf }) => {
    const res = await getRisk(scheme_code, { rf })
    if (!res.ok) return fail(res.error)
    return ok(res.data, `${res.data.scheme_name}: vol ${res.data.annualized_volatility_pct.toFixed(2)}%, max drawdown ${res.data.max_drawdown_pct.toFixed(2)}%, Sharpe ${res.data.sharpe?.toFixed(2) ?? 'n/a'}.`)
  })

  server.registerTool('get_sip', {
    title: 'Simulate a SIP',
    description:
      'Simulate a monthly Systematic Investment Plan: invest a fixed amount each month ' +
      'over a date range and compute total invested, current value, absolute return, and ' +
      'XIRR. Use for "what if I had invested ₹X/month" questions.',
    inputSchema: {
      scheme_code: schemeCode,
      amount: z.number().positive().optional().describe('Monthly investment amount (default 5000)'),
      from: z.string().optional().describe('Start date YYYY-MM-DD (default = inception)'),
      to: z.string().optional().describe('End date YYYY-MM-DD (default = latest NAV)'),
      day: z.number().int().min(1).max(28).optional().describe('Day of month to invest, 1–28 (default = start day)'),
    },
    outputSchema: {
      scheme_code: id,
      scheme_name: z.string(),
      frequency: z.literal('monthly'),
      sip: z.object({
        amount: z.number(),
        day: z.number(),
        from: z.string(),
        to: z.string(),
        installments: z.number(),
        total_invested: z.number(),
        units: z.number(),
        current_value: z.number(),
        absolute_return_pct: z.number(),
        xirr_pct: z.number().nullable(),
      }),
    },
  }, async ({ scheme_code, amount, from, to, day }) => {
    const res = await getSip(scheme_code, { amount, from, to, day })
    if (!res.ok) return fail(res.error)
    const s = res.data.sip
    return ok(res.data, `${res.data.scheme_name}: invested ${s.total_invested}, now worth ${s.current_value.toFixed(0)} (XIRR ${s.xirr_pct?.toFixed(2) ?? 'n/a'}%).`)
  })

  server.registerTool('list_fund_houses', {
    title: 'List fund houses',
    description: 'List all fund houses (AMCs) with their ids. Use the id to filter search_schemes.',
    outputSchema: { data: z.array(z.object({ fund_house_id: id, name: z.string() })) },
  }, async () => {
    const data = await listFundHouses()
    return ok({ data }, `${data.length} fund houses.`)
  })

  server.registerTool('list_categories', {
    title: 'List scheme categories',
    description: 'List all scheme categories with ids and broad category. Use the id to filter search_schemes.',
    outputSchema: {
      data: z.array(z.object({ id, name: z.string(), broad_category: z.string().nullable() })),
    },
  }, async () => {
    const data = await listCategories()
    return ok({ data }, `${data.length} categories.`)
  })

  return server
}

// ── Fastify route plugin ──────────────────────────────────────

export default async function mcpRoutes(fastify) {

  // POST /mcp — JSON-RPC request → JSON-RPC response (stateless Streamable HTTP).
  fastify.post('/mcp', async (req, reply) => {
    // Take Fastify out of the reply lifecycle; the MCP transport writes the
    // raw Node response directly.
    reply.hijack()

    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,   // stateless
      enableJsonResponse: true,        // single JSON body, no SSE
    })

    reply.raw.on('close', () => {
      transport.close()
      server.close()
    })

    try {
      await server.connect(transport)
      // Fastify already parsed the JSON body — pass it so the stream isn't read twice.
      await transport.handleRequest(req.raw, reply.raw, req.body)
    } catch (err) {
      req.log.error(err)
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' })
        reply.raw.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        }))
      } else {
        reply.raw.end()
      }
    }
  })

  // Stateless server has no SSE stream to open or session to delete.
  const methodNotAllowed = async (req, reply) =>
    reply.code(405).send({ jsonrpc: '2.0', error: { code: -32000, message: 'Method Not Allowed' }, id: null })

  fastify.get('/mcp', methodNotAllowed)
  fastify.delete('/mcp', methodNotAllowed)
}
