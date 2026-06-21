/**
 * filter-nav.mjs — slim down AMFI's NAVAll.txt before archiving.
 *
 * NAVAll.txt lists every scheme AMFI knows about, including long-dead ones
 * whose last NAV is from 2015–2022. For disaster-recovery archives we only
 * care about schemes that are still being priced, so this drops any data row
 * whose NAV date is older than the cutoff year (default: 2024 — keep NAV dated
 * 2024 or later, drop everything before).
 *
 * Non-data lines (the column header, blank lines, fund-house / category
 * section titles) are passed through untouched, so the file keeps its shape.
 *
 * Usage:
 *   node scripts/filter-nav.mjs <input> <output> [cutoffYear]
 *
 * A data line looks like:
 *   119551;INF209KA12Z1;INF209KA13Z9;<name>;105.9219;19-Jun-2026
 *   ^ numeric scheme code                                ^ DD-Mon-YYYY
 */

import { readFileSync, writeFileSync, statSync } from 'node:fs'

const [, , inputPath, outputPath, cutoffArg] = process.argv

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/filter-nav.mjs <input> <output> [cutoffYear]')
  process.exit(1)
}

// Fixed cutoff: keep NAV dated 2024 or later; drop everything before.
// Override by passing a year as the 3rd argument.
const cutoffYear = Number(cutoffArg) || 2024

const raw   = readFileSync(inputPath, 'utf8')
const lines = raw.split(/\r?\n/)

let dataKept = 0
let dataDropped = 0

const out = lines.filter((line) => {
  const parts = line.split(';')

  // Structural line (header, blank, fund-house/category title) — always keep.
  // Data lines have ≥6 fields and a numeric scheme code in field 0.
  if (parts.length < 6 || !/^\d+$/.test(parts[0].trim())) return true

  // Year is the trailing 4 digits of the last field (DD-Mon-YYYY).
  const match = parts[parts.length - 1].trim().match(/(\d{4})\s*$/)
  const year  = match ? Number(match[1]) : NaN

  // Unparseable date → keep (don't silently lose data).
  const keep = Number.isNaN(year) || year >= cutoffYear
  if (keep) dataKept++; else dataDropped++
  return keep
})

writeFileSync(outputPath, out.join('\n'))

const before = statSync(inputPath).size
const after  = statSync(outputPath).size
const pct    = before ? ((1 - after / before) * 100).toFixed(1) : '0.0'

console.log(`Cutoff year:   >= ${cutoffYear}`)
console.log(`Schemes kept:  ${dataKept}`)
console.log(`Schemes dropped: ${dataDropped}`)
console.log(`Size: ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB (${pct}% smaller)`)
