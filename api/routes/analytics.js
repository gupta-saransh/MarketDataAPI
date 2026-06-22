/**
 * analytics.js — derived analytics over a scheme's NAV history.
 *
 *   GET /schemes/:code/returns                     trailing + inception returns
 *   GET /schemes/:code/rolling?window=3Y&beat=12   rolling-return distribution
 *   GET /schemes/:code/risk?rf=6                    volatility / drawdown / Sharpe
 *   GET /schemes/:code/sip?amount=5000&from=&to=    monthly SIP + XIRR
 *
 * Registered under the /schemes prefix (alongside routes/schemes.js). The math
 * lives in lib/finance.js; the queries + result shaping live in lib/queries.js
 * (shared with the MCP server). Handlers just map the discriminated result.
 */

import { getReturns, getRolling, getRisk, getSip } from '../lib/queries.js'

// Map a { ok, data } | { ok, status, error } result to an HTTP reply.
function send(reply, result) {
  if (!result.ok) return reply.code(result.status).send({ error: result.error })
  return result.data
}

export default async function analyticsRoutes(fastify) {

  // GET /schemes/:code/returns
  fastify.get('/:code/returns', async (req, reply) =>
    send(reply, await getReturns(req.params.code)))

  // GET /schemes/:code/rolling?window=3Y&beat=12
  fastify.get('/:code/rolling', async (req, reply) =>
    send(reply, await getRolling(req.params.code, { window: req.query.window, beat: req.query.beat })))

  // GET /schemes/:code/risk?rf=6
  fastify.get('/:code/risk', async (req, reply) =>
    send(reply, await getRisk(req.params.code, { rf: req.query.rf })))

  // GET /schemes/:code/sip?amount=5000&from=YYYY-MM-DD&to=YYYY-MM-DD&day=1
  fastify.get('/:code/sip', async (req, reply) =>
    send(reply, await getSip(req.params.code, {
      amount: req.query.amount, from: req.query.from, to: req.query.to, day: req.query.day,
    })))
}
