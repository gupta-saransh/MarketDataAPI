/**
 * analytics.js — derived analytics over a scheme's NAV history.
 *
 *   GET /schemes/:code/returns                     trailing + inception returns
 *   GET /schemes/:code/rolling?window=3Y&beat=12   rolling-return distribution
 *   GET /schemes/:code/risk?rf=6                    volatility / drawdown / Sharpe
 *   GET /schemes/:code/sip?amount=5000&from=&to=    monthly SIP + XIRR
 *
 * Registered under the /schemes prefix (alongside routes/schemes.js). Pure
 * math lives in lib/finance.js; these handlers just load the series and shape
 * the response.
 */

import { sql } from '../db/index.js'
import {
  trailingReturns, rollingReturns, riskMetrics, simulateSip, parseWindow,
} from '../lib/finance.js'

const SERIES = `
  SELECT s.scheme_name, n.nav_date, n.nav
  FROM nav_history n
  JOIN schemes s ON s.scheme_code = n.scheme_code
  WHERE n.scheme_code = ?
  ORDER BY n.nav_date ASC
`

async function loadSeries(code) {
  const rows = await sql.all(SERIES, [code])
  if (!rows.length) return null
  return {
    scheme_name: rows[0].scheme_name,
    series: rows.map((r) => ({ nav_date: r.nav_date, nav: r.nav })),
  }
}

export default async function analyticsRoutes(fastify) {

  // GET /schemes/:code/returns
  fastify.get('/:code/returns', async (req, reply) => {
    const code = Number(req.params.code)
    const loaded = await loadSeries(code)
    if (!loaded) return reply.code(404).send({ error: 'No NAV data found' })

    const result = trailingReturns(loaded.series)
    if (!result) return reply.code(404).send({ error: 'Insufficient NAV history' })
    return { scheme_code: code, scheme_name: loaded.scheme_name, ...result }
  })

  // GET /schemes/:code/rolling?window=3Y&beat=12
  fastify.get('/:code/rolling', async (req, reply) => {
    const code = Number(req.params.code)
    const win = parseWindow(req.query.window ?? '3Y')
    if (!win) return reply.code(400).send({ error: 'Invalid window — use e.g. 1Y, 3Y, 6M' })
    const beat = Number.isFinite(Number(req.query.beat)) ? Number(req.query.beat) : 12

    const loaded = await loadSeries(code)
    if (!loaded) return reply.code(404).send({ error: 'No NAV data found' })

    const rolling = rollingReturns(loaded.series, win, beat)
    if (!rolling) return reply.code(404).send({ error: 'Insufficient history for this window' })
    return {
      scheme_code: code, scheme_name: loaded.scheme_name,
      window: req.query.window ?? '3Y', ...rolling,
    }
  })

  // GET /schemes/:code/risk?rf=6
  fastify.get('/:code/risk', async (req, reply) => {
    const code = Number(req.params.code)
    const rf = Number.isFinite(Number(req.query.rf)) ? Number(req.query.rf) : 6

    const loaded = await loadSeries(code)
    if (!loaded) return reply.code(404).send({ error: 'No NAV data found' })

    const risk = riskMetrics(loaded.series, rf)
    if (!risk) return reply.code(404).send({ error: 'Insufficient NAV history' })
    return { scheme_code: code, scheme_name: loaded.scheme_name, ...risk }
  })

  // GET /schemes/:code/sip?amount=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&day=1
  fastify.get('/:code/sip', async (req, reply) => {
    const code = Number(req.params.code)
    const amount = Number(req.query.amount) > 0 ? Number(req.query.amount) : 5000
    const day = Number(req.query.day) >= 1 && Number(req.query.day) <= 28
      ? Math.floor(Number(req.query.day)) : undefined

    const loaded = await loadSeries(code)
    if (!loaded) return reply.code(404).send({ error: 'No NAV data found' })

    const sip = simulateSip(loaded.series, {
      amount, day, from: req.query.from ?? null, to: req.query.to ?? null,
    })
    if (!sip) return reply.code(400).send({ error: 'No SIP installments fall within the available data range' })
    return { scheme_code: code, scheme_name: loaded.scheme_name, frequency: 'monthly', sip }
  })
}
