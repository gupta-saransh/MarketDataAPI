/**
 * prune.js — post-seed cleanup.
 *
 * After a seed, the DB contains every scheme code mfapi.in knows about
 * (~37k), most of them long-dead with no NAV in our window. This keeps only
 * schemes that have at least one NAV row (i.e. any NAV in the seeded 6-year
 * window) and removes lookup rows that no longer have any scheme behind them,
 * so /fund-houses and /categories don't list dead filter options.
 *
 * Order matters (schemes.fund_house_id / scheme_category_id have no cascade):
 *   1. delete schemes with no nav_history  (their NAV rows cascade — none anyway)
 *   2. delete orphaned fund_houses
 *   3. delete orphaned scheme_categories
 *   4. foreign_key_check + VACUUM
 *
 * Usage:
 *   DB_PATH=./market-data-api.db node --experimental-sqlite pipeline/prune.js
 */

import 'dotenv/config'
import { db } from '../db/client.js'

const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c

const before = {
  schemes:    count('schemes'),
  nav:        count('nav_history'),
  houses:     count('fund_houses'),
  categories: count('scheme_categories'),
}

console.log('Before:')
console.log(`  schemes: ${before.schemes}  nav_history: ${before.nav}`)
console.log(`  fund_houses: ${before.houses}  scheme_categories: ${before.categories}`)

db.exec('BEGIN')
try {
  // 1. Schemes with no NAV in the window (zombies).
  const prunedSchemes = db.prepare(
    `DELETE FROM schemes
     WHERE scheme_code NOT IN (SELECT scheme_code FROM nav_history)`
  ).run().changes

  // 2. Fund houses no longer referenced by any surviving scheme.
  const prunedHouses = db.prepare(
    `DELETE FROM fund_houses
     WHERE id NOT IN (SELECT fund_house_id FROM schemes WHERE fund_house_id IS NOT NULL)`
  ).run().changes

  // 3. Categories no longer referenced by any surviving scheme.
  const prunedCats = db.prepare(
    `DELETE FROM scheme_categories
     WHERE id NOT IN (SELECT scheme_category_id FROM schemes WHERE scheme_category_id IS NOT NULL)`
  ).run().changes

  db.exec('COMMIT')
  console.log('\nPruned:')
  console.log(`  schemes: ${prunedSchemes}  fund_houses: ${prunedHouses}  scheme_categories: ${prunedCats}`)
} catch (e) {
  db.exec('ROLLBACK')
  console.error('Prune failed, rolled back:', e.message)
  process.exit(1)
}

// 4. Integrity check — should print nothing if all FKs are valid.
const violations = db.prepare('PRAGMA foreign_key_check').all()
if (violations.length) {
  console.error(`\nFK violations found: ${violations.length}`, violations.slice(0, 5))
  process.exit(1)
}
console.log('\nFK integrity: OK')

// Reclaim freed pages.
db.exec('VACUUM')

const after = {
  schemes:    count('schemes'),
  nav:        count('nav_history'),
  houses:     count('fund_houses'),
  categories: count('scheme_categories'),
}

console.log('\nAfter:')
console.log(`  schemes: ${after.schemes}  nav_history: ${after.nav}`)
console.log(`  fund_houses: ${after.houses}  scheme_categories: ${after.categories}`)
console.log('\nDone.')
