/**
 * fetch-amc-logos.mjs — one-time download of AMC logos for the Fund Visualizer.
 *
 * Saves one image per fund-house domain to frontend/public/amc/<domain>.png so
 * the explorer serves logos locally instead of hitting a logo CDN at runtime.
 * The Avatar component (frontend/src/FundsPage.tsx) reads /amc/<domain>.png and
 * falls back to the favicon CDN, then a coloured initial, for anything missing.
 *
 * Run from the repo root:  node scripts/fetch-amc-logos.mjs
 *
 * Note: these are AMC trademarks, shown to identify a fund (as MF aggregators
 * do). Prefer official logo files where the usage terms are clear.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const OUT = join(process.cwd(), 'frontend', 'public', 'amc')

// Keep in sync with AMC_DOMAINS in frontend/src/FundsPage.tsx.
const DOMAINS = [
  'adityabirlacapital.com', 'sbimf.com', 'hdfcfund.com', 'icicipruamc.com', 'axismf.com',
  'nipponindiamf.com', 'kotakmf.com', 'utimf.com', 'dspim.com', 'miraeassetmf.co.in',
  'tatamutualfund.com', 'franklintempletonindia.com', 'edelweissmf.com', 'bandhanmutual.com',
  'amc.ppfas.com', 'motilaloswalmf.com', 'quantumamc.com', 'quantmutual.com', 'invescomutualfund.com',
  'canararobeco.com', 'sundarammutual.com', 'barodabnpparibasmf.in', 'assetmanagement.hsbc.co.in',
  'licmf.com', 'pgimindiamf.com', 'unionmf.com', 'jmfinancialmf.com', 'mahindramanulife.com',
  'navimutualfund.com', 'whiteoakamc.com', 'bajajamc.com', '360.one', 'samcomf.com', 'trustmf.com',
  'helioscapital.in', 'zerodhafundhouse.com', 'growwmf.in', 'taurusmutualfund.com', 'shriramamc.com',
  'njmutualfund.com', 'itimf.com',
]

// Sources tried in order; first real image wins. unavatar aggregates several
// providers (usually the best logo); the others are favicon fallbacks.
const sources = (d) => [
  `https://unavatar.io/${d}?fallback=false`,
  `https://www.google.com/s2/favicons?domain=${d}&sz=128`,
  `https://icons.duckduckgo.com/ip3/${d}.ico`,
]

async function fetchImage(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null
  const type = res.headers.get('content-type') || ''
  if (!type.startsWith('image/')) return null
  const buf = Buffer.from(await res.arrayBuffer())
  return buf.length >= 200 ? buf : null // skip tiny/placeholder responses
}

await mkdir(OUT, { recursive: true })

let ok = 0
for (const d of DOMAINS) {
  let saved = false
  for (const src of sources(d)) {
    try {
      const buf = await fetchImage(src)
      if (buf) {
        await writeFile(join(OUT, `${d}.png`), buf)
        console.log(`  ok  ${d.padEnd(34)} ${new URL(src).host}  ${buf.length}b`)
        ok++; saved = true; break
      }
    } catch { /* try next source */ }
  }
  if (!saved) console.log(`  --  ${d.padEnd(34)} no logo found`)
}

console.log(`\n${ok}/${DOMAINS.length} logos saved to frontend/public/amc/`)
