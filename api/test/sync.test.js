/**
 * sync.test.js — AMFI NAVAll.txt parsing.
 *
 * Regression cover for the Aug-2026 outage: AMFI inserted two columns (Plan,
 * Option) into NAVAll.txt, moving NAV and date from fields 5-6 to 7-8. The old
 * fixed-index parser then read Plan as the NAV and Option as the date. For rows
 * where both were empty, Number('') === 0 slipped past the isNaN() guard and the
 * lenient date parser produced 'undefined-NaN-00' without throwing, so garbage
 * reached `nav_date date NOT NULL` and failed the whole batch -> POST /sync-nav
 * returned 500 on every call.
 *
 * Pure functions, no DB and no network.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseDate, parseNavAll } from '../routes/sync.js'

// ── parseDate ─────────────────────────────────────────────────

test('parseDate converts DD-Mon-YYYY to YYYY-MM-DD', () => {
  assert.equal(parseDate('20-Aug-2026'), '2026-08-20')
  assert.equal(parseDate('01-Jan-2021'), '2021-01-01')
  assert.equal(parseDate('9-Feb-2024'), '2024-02-09')   // single-digit day
  assert.equal(parseDate(' 31-Dec-2025 '), '2025-12-31') // surrounding space
})

test('parseDate returns null for anything that is not a date', () => {
  // The exact inputs that caused the outage: empty Option/Plan fields.
  assert.equal(parseDate(''), null)
  assert.equal(parseDate('   '), null)
  assert.equal(parseDate('MONTHLY DCW Payout'), null)
  assert.equal(parseDate('Direct Plan'), null)
  assert.equal(parseDate('Date'), null)                  // header cell
  assert.equal(parseDate('20-Xxx-2026'), null)           // bad month name
  assert.equal(parseDate('2026-08-20'), null)            // already converted
})

test('parseDate never emits a malformed string instead of null', () => {
  for (const bad of ['', '-', '--', 'a-b-c', '20-Aug', 'Aug-2026']) {
    const out = parseDate(bad)
    assert.equal(out, null, `expected null for ${JSON.stringify(bad)}, got ${out}`)
  }
})

// ── parseNavAll: both AMFI layouts ────────────────────────────

const OLD_FORMAT = [
  'Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date',
  'Aditya Birla Sun Life Mutual Fund',
  '',
  '119551;INF209KA12Z1;INF209KA13Z9;ABSL Banking & PSU Debt - DIRECT - IDCW;106.8377;31-Jul-2026',
  '119552;INF209K01YM2;-;ABSL Banking & PSU Debt - MONTHLY IDCW;117.1095;31-Jul-2026',
].join('\n')

const NEW_FORMAT = [
  'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
  'Aditya Birla Sun Life Mutual Fund',
  '',
  '119551;INF209KA12Z1;INF209KA13Z9;ABSL Banking & PSU Debt Fund;Direct Plan;IDCW-Re-investment;106.9996;20-Aug-2026',
  '119552;INF209K01YM2;-;ABSL Banking & PSU Debt Fund;Direct Plan;MONTHLY DCW Payout;117.3095;20-Aug-2026',
].join('\n')

test('parseNavAll reads the current 8-field layout', () => {
  assert.deepEqual(parseNavAll(NEW_FORMAT), [
    [119551, '2026-08-20', 106.9996],
    [119552, '2026-08-20', 117.3095],
  ])
})

test('parseNavAll still reads the legacy 6-field layout (nav-archive files)', () => {
  assert.deepEqual(parseNavAll(OLD_FORMAT), [
    [119551, '2026-07-31', 106.8377],
    [119552, '2026-07-31', 117.1095],
  ])
})

test('parseNavAll skips headers, blank lines and AMC name lines', () => {
  const rows = parseNavAll(NEW_FORMAT)
  assert.equal(rows.length, 2)
  assert.ok(rows.every(r => Number.isFinite(r[0])), 'header row leaked in')
})

// ── the exact rows that produced the 500 ──────────────────────

test('parseNavAll drops rows with empty Plan/Option rather than emitting garbage', () => {
  // Real line from NAVAll.txt: Plan and Option are both empty. Under the old
  // parser this became [130897, 'undefined-NaN-00', 0].
  const line = '130897;INF109KA1B57;-;ICICI Prudential Banking & PSU Debt Fund;;;15.8889;24-Apr-2020'
  assert.deepEqual(parseNavAll(line), [[130897, '2020-04-24', 15.8889]])
})

test('parseNavAll never returns a non-ISO date or a non-positive NAV', () => {
  const messy = [
    '100001;A;B;Fund One;;;12.5;15-Jun-2026',       // empty plan/option
    '100002;A;B;Fund Two;Direct Plan;Growth;;20-Aug-2026',   // empty NAV
    '100003;A;B;Fund Three;Direct Plan;Growth;0;20-Aug-2026', // zero NAV
    '100004;A;B;Fund Four;Direct Plan;Growth;-5;20-Aug-2026', // negative NAV
    '100005;A;B;Fund Five;Direct Plan;Growth;N.A.;20-Aug-2026', // non-numeric
    '100006;A;B;Fund Six;Direct Plan;Growth;33.3;',           // empty date
    '100007;A;B;Fund Seven;Direct Plan;Growth;44.4;20-Aug-2026', // good
  ].join('\n')

  const rows = parseNavAll(messy)
  assert.deepEqual(rows.map(r => r[0]), [100001, 100007])
  for (const [, date, nav] of rows) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(nav > 0)
  }
})

test('parseNavAll honours the knownCodes filter', () => {
  const rows = parseNavAll(NEW_FORMAT, new Set([119552]))
  assert.deepEqual(rows, [[119552, '2026-08-20', 117.3095]])
})

test('parseNavAll tolerates CRLF line endings', () => {
  const rows = parseNavAll(NEW_FORMAT.split('\n').join('\r\n'))
  assert.equal(rows.length, 2)
  assert.equal(rows[0][1], '2026-08-20')
})
