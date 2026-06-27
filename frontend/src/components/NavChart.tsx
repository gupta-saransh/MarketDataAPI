import { useId, useState } from 'react'

export interface NavPoint {
  nav_date: string
  nav: number
}

/**
 * Dependency-free NAV line chart.
 *
 * Renders the series as an SVG path in a 0–100 viewBox (stretched to the
 * container via preserveAspectRatio="none" + non-scaling strokes), with a
 * gradient area fill and a hover crosshair/tooltip. Line is green when the
 * range closes up, red when down — same convention as the fund trackers.
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
  const y = (v: number) => 5 + (1 - (v - min) / span) * 90 // 5–95, leave vertical padding

  const up = points[n - 1].nav >= points[0].nav
  const color = up ? '#10b981' : '#ef4444' // emerald-500 / red-500

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p.nav).toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const r = (e.clientX - rect.left) / rect.width
    setHover(Math.max(0, Math.min(n - 1, Math.round(r * (n - 1)))))
  }

  const hp = hover != null ? points[hover] : null

  return (
    <div className="relative" style={{ height }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
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
  )
}
