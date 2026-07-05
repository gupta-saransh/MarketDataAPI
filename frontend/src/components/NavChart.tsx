import { useEffect, useId, useRef, useState } from 'react'
import type { NavPoint } from '../types'

const Y_TICKS = 5
const X_TICKS = 5

const fmtSigned = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`

/**
 * Dependency-free NAV line chart with axis scales, hover readout, and
 * click-drag range selection.
 *
 * The line + gridlines live in an SVG (0–100 viewBox, stretched via
 * preserveAspectRatio="none" + non-scaling strokes). Axis labels are HTML
 * (y-values in a left gutter, dates in a bottom row) so text stays crisp.
 *
 * Interactions:
 *   • hover  → crosshair + single-point NAV tooltip
 *   • drag   → shades the swept band and shows the absolute + % change between
 *              the two endpoints. Persists until you move again; clears on leave.
 */
export default function NavChart({ points, points2, rebased = false, height = 288 }: {
  points: NavPoint[]
  // Optional second series for fund comparison. Must be index-aligned with
  // `points` (same dates); FundsPage intersects the two by date before passing.
  points2?: NavPoint[]
  // Rebased-to-100 mode: values are index levels, not rupees.
  rebased?: boolean
  height?: number
}) {
  const gradId = useId()
  const [hover, setHover] = useState<number | null>(null)
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null)
  const dragging = useRef(false)
  const anchor = useRef(0)

  const n = points.length
  const firstDate = points[0]?.nav_date
  const comparing = points2 != null && points2.length === n

  // Reset interaction state when the underlying slice changes (e.g. range toggle).
  useEffect(() => { setSel(null); setHover(null) }, [n, firstDate, comparing])

  if (n < 2) {
    return (
      <div style={{ height }} className="flex items-center justify-center text-sm text-slate-400">
        Not enough data to chart this range.
      </div>
    )
  }

  const navs = points.map((p) => p.nav)
  const allVals = comparing ? navs.concat(points2!.map((p) => p.nav)) : navs
  const min = Math.min(...allVals)
  const max = Math.max(...allVals)
  const span = max - min || 1

  const x = (i: number) => (i / (n - 1)) * 100
  const y = (v: number) => 5 + (1 - (v - min) / span) * 90 // 5–95, vertical padding

  const up = points[n - 1].nav >= points[0].nav
  // Two-line mode uses fixed colors so each fund keeps a stable identity.
  const color = comparing ? '#10b981' : up ? '#10b981' : '#ef4444' // emerald-500 / red-500
  const color2 = '#6366f1' // indigo-500

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p.nav).toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`
  const line2 = comparing
    ? points2!.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)} ${y(p.nav).toFixed(2)}`).join(' ')
    : null

  // Axis ticks
  const yTicks = Array.from({ length: Y_TICKS }, (_, k) => min + (span * k) / (Y_TICKS - 1))
  const xIdx = Array.from({ length: X_TICKS }, (_, k) => Math.round(((n - 1) * k) / (X_TICKS - 1)))

  const rupee = rebased ? '' : '₹'
  const fmtY = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1))
  const fmtNav = (v: number) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const spanDays = (Date.parse(points[n - 1].nav_date) - Date.parse(points[0].nav_date)) / 864e5
  const fmtX = (d: string) => {
    const dt = new Date(d + 'T00:00:00Z')
    const mon = dt.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
    return spanDays <= 120 ? `${dt.getUTCDate()} ${mon}` : `${mon} '${String(dt.getUTCFullYear()).slice(2)}`
  }

  // ── pointer interaction ──────────────────────────────────────
  const idxAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const r = (e.clientX - rect.left) / rect.width
    return Math.max(0, Math.min(n - 1, Math.round(r * (n - 1))))
  }
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (comparing) return // drag deltas are single-fund; hover covers compare mode
    const i = idxAt(e)
    anchor.current = i
    dragging.current = true
    setSel({ a: i, b: i })
    setHover(null)
  }
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const i = idxAt(e)
    if (dragging.current) {
      setSel({ a: Math.min(anchor.current, i), b: Math.max(anchor.current, i) })
    } else {
      if (sel) setSel(null)
      setHover(i)
    }
  }
  const onUp = () => {
    dragging.current = false
    setSel((s) => (s && s.a === s.b ? null : s)) // a plain click (no drag) clears
  }
  const onLeave = () => {
    dragging.current = false
    setHover(null)
    setSel(null)
  }

  const selActive = sel != null && sel.b > sel.a && sel.b < n
  const lo = sel?.a ?? 0
  const hi = sel?.b ?? 0
  const startNav = points[lo]?.nav ?? 0
  const endNav = points[hi]?.nav ?? 0
  const selChg = endNav - startNav
  const selPct = startNav ? (endNav / startNav - 1) * 100 : 0
  const selColor = selPct >= 0 ? '#10b981' : '#ef4444'

  const hp = !selActive && hover != null ? points[hover] : null

  return (
    <div style={{ height }} className="flex select-none flex-col">
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
              {rupee}{fmtY(v)}
            </div>
          ))}
        </div>

        {/* plot */}
        <div
          className="relative min-h-0 flex-1 cursor-crosshair"
          onMouseMove={onMove}
          onMouseLeave={onLeave}
          onMouseDown={onDown}
          onMouseUp={onUp}
        >
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* horizontal gridlines */}
            {yTicks.map((v, k) => (
              <line key={k} x1={0} y1={y(v)} x2={100} y2={y(v)} stroke="#1e293b" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}

            {!comparing && <path d={area} fill={`url(#${gradId})`} />}
            <path
              d={line}
              fill="none"
              stroke={color}
              strokeWidth={1.75}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {line2 && (
              <path
                d={line2}
                fill="none"
                stroke={color2}
                strokeWidth={1.75}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}

            {/* drag selection band */}
            {selActive && (
              <>
                <rect x={x(lo)} y={0} width={x(hi) - x(lo)} height={100} fill={selColor} fillOpacity={0.12} />
                <line x1={x(lo)} y1={0} x2={x(lo)} y2={100} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                <line x1={x(hi)} y1={0} x2={x(hi)} y2={100} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              </>
            )}

            {/* hover crosshair */}
            {hp && (
              <line x1={x(hover as number)} y1={0} x2={x(hover as number)} y2={100} stroke="#94a3b8" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>

          {/* drag selection: endpoint dots + delta readout */}
          {selActive && (
            <>
              <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow" style={{ left: `${x(lo)}%`, top: `${y(startNav)}%`, background: selColor }} />
              <div className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow" style={{ left: `${x(hi)}%`, top: `${y(endNav)}%`, background: selColor }} />
              <div
                className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2.5 py-1 text-xs shadow-lg ring-1 ring-slate-700"
                style={{ left: `${Math.min(82, Math.max(18, (x(lo) + x(hi)) / 2))}%` }}
              >
                <span className="font-semibold" style={{ color: selColor }}>
                  {rupee}{fmtSigned(selChg)} ({fmtSigned(selPct)}%)
                </span>
                <span className="ml-1.5 text-slate-300">{points[lo].nav_date} → {points[hi].nav_date}</span>
              </div>
            </>
          )}

          {/* hover: point dot(s) + tooltip */}
          {hp && (
            <>
              <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow" style={{ left: `${x(hover as number)}%`, top: `${y(hp.nav)}%`, background: color }} />
              {comparing && (
                <div className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 shadow" style={{ left: `${x(hover as number)}%`, top: `${y(points2![hover as number].nav)}%`, background: color2 }} />
              )}
              <div
                className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-white shadow-lg ring-1 ring-slate-700"
                style={{ left: `${Math.min(90, Math.max(10, x(hover as number)))}%`, top: `${Math.max(10, y(hp.nav) - 4)}%` }}
              >
                <div className="font-semibold" style={comparing ? { color } : undefined}>{rupee}{fmtNav(hp.nav)}</div>
                {comparing && (
                  <div className="font-semibold" style={{ color: color2 }}>{rupee}{fmtNav(points2![hover as number].nav)}</div>
                )}
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
