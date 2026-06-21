/**
 * finance.test.js — unit tests for the pure financial math (no DB).
 * Run with the rest of the suite:  node --experimental-sqlite --test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  navAsOf, shiftDate, yearsBetween, pointToPoint,
  trailingReturns, rollingReturns, riskMetrics, xirr, simulateSip,
} from '../lib/finance.js'

const approx = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`)

// Build a series that grows at a fixed daily rate from a start date.
function makeSeries(startDate, days, dailyRate, startNav = 100) {
  const out = []
  let nav = startNav
  for (let i = 0; i < days; i++) {
    out.push({ nav_date: shiftDate(startDate, { days: i }), nav })
    nav *= 1 + dailyRate
  }
  return out
}

test('navAsOf returns nearest trading day on/before target', () => {
  const s = [
    { nav_date: '2024-01-01', nav: 10 },
    { nav_date: '2024-01-05', nav: 11 },
    { nav_date: '2024-01-10', nav: 12 },
  ]
  assert.equal(navAsOf(s, '2024-01-07').nav, 11) // weekend/gap → falls back
  assert.equal(navAsOf(s, '2024-01-10').nav, 12) // exact
  assert.equal(navAsOf(s, '2023-12-31'), null)   // before history
})

test('pointToPoint: absolute under 1y, CAGR beyond', () => {
  // doubling in 1 year → +100% absolute
  approx(pointToPoint(100, 200, 1).return_pct, 100, 1e-9)
  assert.equal(pointToPoint(100, 200, 1).annualized, false)
  // 4x over 2 years → CAGR 100%
  approx(pointToPoint(100, 400, 2).return_pct, 100, 1e-9)
  assert.equal(pointToPoint(100, 400, 2).annualized, true)
})

test('trailingReturns: 1Y absolute matches point-to-point', () => {
  // ~3 years of daily ~constant growth
  const s = makeSeries('2022-06-01', 365 * 3 + 2, 0.0002)
  const r = trailingReturns(s)
  assert.ok(r.returns['1Y'] && r.returns['1Y'].annualized === false)
  assert.ok(r.returns['1Y'].return_pct > 0)
  // 3Y should be annualized (CAGR)
  assert.ok(r.returns['3Y'] && r.returns['3Y'].annualized === true)
  assert.equal(typeof r.latest_nav, 'number')
})

test('rollingReturns: constant-growth series → all windows beat a low bar', () => {
  const s = makeSeries('2020-01-01', 365 * 4, 0.0003) // ~ steady climb
  const roll = rollingReturns(s, { years: 1 }, 5)
  assert.ok(roll.observations > 0)
  assert.equal(roll.pct_beating, 100) // every 1y window positive & > 5%
  assert.ok(roll.min <= roll.avg && roll.avg <= roll.max)
})

test('riskMetrics: zero-volatility series has ~0 vol and ~0 drawdown', () => {
  const flat = makeSeries('2021-01-01', 800, 0.0001) // monotonic up
  const risk = riskMetrics(flat, 6)
  approx(risk.max_drawdown_pct, 0, 1e-6)        // never drops
  assert.ok(risk.annualized_volatility_pct < 0.5) // tiny, constant steps
  assert.ok(risk.cagr_pct > 0)
})

test('riskMetrics: a drop produces a positive max drawdown', () => {
  const s = [
    { nav_date: '2024-01-01', nav: 100 },
    { nav_date: '2024-01-02', nav: 120 },
    { nav_date: '2024-01-03', nav: 90 },  // -25% from peak 120
    { nav_date: '2024-01-04', nav: 110 },
  ]
  const risk = riskMetrics(s, 6)
  approx(risk.max_drawdown_pct, 25, 1e-6)
})

test('xirr: single year, double money → ~100%', () => {
  const rate = xirr([
    { date: '2023-01-01', amount: -1000 },
    { date: '2024-01-01', amount: 2000 },
  ])
  approx(rate, 1.0, 1e-3) // 100%
})

test('xirr: flat (no gain) → ~0%', () => {
  const rate = xirr([
    { date: '2023-01-01', amount: -1000 },
    { date: '2024-01-01', amount: 1000 },
  ])
  approx(rate, 0, 1e-4)
})

test('simulateSip: invested/units/value are consistent', () => {
  const s = makeSeries('2022-01-01', 365 * 2, 0.0003)
  const sip = simulateSip(s, { amount: 5000, from: null, to: null, day: 1 })
  assert.ok(sip.installments >= 23 && sip.installments <= 25) // ~24 months
  approx(sip.total_invested, sip.amount * sip.installments, 1e-6)
  assert.ok(sip.current_value > sip.total_invested) // rising market
  assert.ok(sip.xirr_pct > 0)
})
