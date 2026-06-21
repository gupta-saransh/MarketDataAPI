// Fires sample requests to populate Axiom with enough data to build dashboards.
// Run once: node scripts/seed-axiom.js
// Requires the API to be deployed and live.

const BASE = 'https://market-data-api-psi.vercel.app/api'

const ENDPOINTS = [
  '/fund-houses',
  '/categories',
  '/schemes?q=hdfc',
  '/schemes?q=sbi',
  '/schemes?q=axis',
  '/schemes?q=parag parikh',
  '/schemes?q=mirae',
  '/schemes?q=icici',
  '/schemes?q=kotak',
  '/schemes?fund_house_id=9',
  '/schemes?broad_category=Equity Scheme',
  '/schemes?broad_category=Debt Scheme',
  '/schemes/101762',
  '/schemes/118989',
  '/schemes/120503',
  '/schemes/122639',
  '/schemes/118955',
  '/schemes/152135',
  '/schemes/119598',
  '/schemes/125494',
  '/schemes/101762/nav/latest',
  '/schemes/118989/nav/latest',
  '/schemes/120503/nav/latest',
  '/schemes/122639/nav/latest',
  '/schemes/118955/nav/latest',
  '/schemes/101762/nav?startDate=2026-01-01&endDate=2026-06-20',
  '/schemes/118955/nav?startDate=2026-01-01&endDate=2026-06-20',
  '/schemes/122639/nav?startDate=2025-06-01&endDate=2026-06-20',
  '/schemes/isin/INF179K01608',
  '/schemes/isin/INF879O01027',
  '/schemes/isin/INF174K01LS2',
]

async function run() {
  console.log(`Firing ${ENDPOINTS.length} requests to ${BASE} ...\n`)

  for (const path of ENDPOINTS) {
    const url = BASE + path
    const t   = Date.now()
    try {
      const res = await fetch(url)
      console.log(`${res.status}  ${Date.now() - t}ms  ${path}`)
    } catch (e) {
      console.log(`ERR        ${path}  —  ${e.message}`)
    }
    // Small delay to avoid hammering
    await new Promise(r => setTimeout(r, 300))
  }

  console.log('\nDone. Wait ~10s then check Axiom Stream.')
}

run()
