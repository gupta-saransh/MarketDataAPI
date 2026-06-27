import { useId, useState } from 'react'

export interface NavPoint {
  nav_date: string
  nav: number
}

const Y_TICKS = 5
const X_TICKS = 5

/**
 * Dependency-free NAV line chart with axis scales.
 *
 * The line + gridlines live in an SVG (0–100 viewBox, stretched via
 * preserveAspectRatio="none" + non-scaling strokes). Axis labels are HTML —
 * y-values in a left gutter, dates in a bottom row — so text stays crisp and
 * undistorted, and the gutter/plot share a flex row so gridlines line up with
 * their labels. Line is green when the range closes up, red when down.
 */
export default function NavChart({ points, height = 288 }: { points: NavPoint[]; height?: number }) {
  const gradId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-slate-400">
        Not enough data to chart this range.
      </div>
    )
  }

  const n = points.length
  const navs = points.map((p) => p.nav)
  const min = Math.min(...navs)
  const max = Math.max(...navs)
  const span = max - min || 1

  const x = (i: number) => (i / (n - 1)) * 100
  const y = (v: number) => 5 + (1 - (v - min) / span) * 90 // 5–95, vertical padding

  const up = points[n - 1].nav >= points[0].nav
  const color = up ? '#10b981' : '#ef4444' // emerald-500 / red-500

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p.nav).toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`

  // Axis ticks
  const yTicks = Array.from({ length: Y_TICKS }, (_, k) => min + (span * k) / (Y_TICKS - 1))
  const xIdx = Array.from({ length: X_TICKS }, (_, k) => Math.round(((n - 1) * k) / (X_TICKS - 1)))

  const fmtY = (v: number) =>
    v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)

  const spanDays = (Date.parse(points[n - 1].nav_date) - Date.parse(points[0].nav_date)) / 864e5
  const fmtX = (d: string) => {
    const dt = new Date(d + 'T00:00:00Z')
    const mon = dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    return spanDays <= 120 ? `${dt.getUTCDate()} ${mon}` : `${mon} '${String(dt.getUTCFullYear()).slice(2)}`
  }

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const r = (e.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(r * (n - 1)))))
  }

  const hp = hover != null ? points[hover] : null

  return (
    <div style={{ height }} className="flex flex-col">
      {/* chart row: y-axis gutter + plot */}
      <div className="flex min-h-0 flex-1">
        {/* y-axis labels */}
        <div className="relative w-12 shrink-0">
          {yTicks.map((v, k) => (
            <div
              key={k}
              className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-slate-400"
              style={{ top: `${y(v)}%` }}
            >
              ₹{fmtY(v)}
            </div>
          ))}
        </div>

        {/* plot */}
        <div className="relative min-h-0 flex-1" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* horizontal gridlines */}
            {yTicks.map((v, k) => (
              <line
                key={k}
                x1={0}
                y1={y(v)}
                x2={100}
                y2={y(v)}
                stroke="#e2e8f0"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}

            <path d={area} fill={`url(#${gradId})`} />
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {hp && (
              <line
                x1={x(hover as number)}
                y1={0}
                x2={x(hover as number)}
                y2={100}
                stroke="#94a3b8"
                strokeWidth={1}
                strokeDasharray="3 3"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {hp && (
            <>
              <div
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                style={{ left: `${x(hover as number)}%`, top: `${y(hp.nav)}%`, background: color }}
              />
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
                style={{ left: `${Math.min(90, Math.max(10, x(hover as number)))}%`, top: `${Math.max(10, y(hp.nav) - 4)}%` }}
              >
                <div className="font-semibold">
                  ₹{hp.nav.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="text-slate-300">{hp.nav_date}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* x-axis labels (mirror the y-gutter width so dates align under the plot) */}
      <div className="flex">
        <div className="w-12 shrink-0" />
        <div className="relative h-4 flex-1">
          {xIdx.map((i, k) => (
            <div
              key={i}
              className="absolute top-0 whitespace-nowrap text-[10px] tabular-nums text-slate-400"
              style={{
                left: `${x(i)}%`,
                transform: k === 0 ? 'translateX(0)' : k === xIdx.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
              }}
            >
              {fmtX(points[i].nav_date)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
