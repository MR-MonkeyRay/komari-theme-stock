import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { finite, levelOf, sizeParts } from '../lib/format'

// flag-icons SVGs as plain asset URLs (not inlined), fetched only when shown.
const flagUrls = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
const flagByCode = new Map(
  Object.entries(flagUrls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1, -4).toUpperCase(), url]),
)

export function Flag({ code, title }: { code: string | null; title?: string }) {
  const url = code ? flagByCode.get(code) : undefined
  if (!url) return <span className="flag-none" title={title} aria-label={title}>{code ?? '—'}</span>
  return <span className="flag" role="img" aria-label={title} title={title} style={{ backgroundImage: `url("${url}")` }} />
}

/**
 * Flashes a value's background red/green when it moves by at least `threshold`.
 * The span is re-keyed per tick so the CSS animation restarts.
 */
export function Tick({ value, threshold = 0, children, className }: { value: number | null | undefined; threshold?: number; children: ReactNode; className?: string }) {
  const prev = useRef(value)
  const [tick, setTick] = useState<{ dir: 'up' | 'down' | null; n: number }>({ dir: null, n: 0 })
  useEffect(() => {
    const p = prev.current
    prev.current = value
    if (!finite(p) || !finite(value) || p === value) return
    if (Math.abs(value - p) < threshold) return
    setTick((t) => ({ dir: value > p ? 'up' : 'down', n: t.n + 1 }))
  }, [value, threshold])
  return (
    <span key={tick.n} className={clsx('tick', tick.dir && `tick-${tick.dir}`, className)}>
      {children}
    </span>
  )
}

export function Meter({ value }: { value: number | null }) {
  return (
    <span className={clsx('meter', levelOf(value))} aria-hidden="true">
      <i style={{ transform: `scaleX(${finite(value) ? Math.max(0.01, value / 100) : 0})` }} />
    </span>
  )
}

/** Up/down pair: ↑1.62M/s ↓2.41M/s, units muted. */
export function Pair({ up, down, rate = false, tickUp, tickDown }: { up: number | null | undefined; down: number | null | undefined; rate?: boolean; tickUp?: boolean; tickDown?: boolean }) {
  if (!finite(up) && !finite(down)) return <span className="pair dash">—</span>
  const one = (v: number | null | undefined, arrow: string, cls: string, flash?: boolean) => {
    const p = sizeParts(v, rate)
    const body = p ? (
      <>
        <i className="arrow">{arrow}</i>
        {p[0]}
        <small>{p[1]}</small>
      </>
    ) : (
      <>
        <i className="arrow">{arrow}</i>—
      </>
    )
    return (
      <b className={clsx('pair-line', cls)}>
        {flash && finite(v) ? (
          <Tick value={v} threshold={Math.max(v * 0.1, 8 * 1024)}>
            {body}
          </Tick>
        ) : (
          body
        )}
      </b>
    )
  }
  return (
    <span className="pair num">
      {one(up, '↑', 'pair-up', tickUp)}
      {one(down, '↓', 'pair-down', tickDown)}
    </span>
  )
}

/** Intraday-style CPU trail: line + soft area + dashed average, colored by direction. */
export function Sparkline({ points, width = 84, height = 26 }: { points: { t: number; v: number }[] | undefined; width?: number; height?: number }) {
  if (!points || points.length < 2) return <span className="spark spark-empty" style={{ width, height }} />
  const vs = points.map((p) => p.v)
  const lo = Math.min(...vs)
  const hi = Math.max(...vs)
  const pad = Math.max(1.5, (hi - lo) * 0.15)
  const min = Math.max(0, lo - pad)
  const max = Math.min(100, hi + pad)
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  const x = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * (width - 2) + 1
  const y = (v: number) => height - 2 - ((v - min) / Math.max(0.001, max - min)) * (height - 4)
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join('')
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length
  const dir = vs[vs.length - 1] > avg ? 'up' : vs[vs.length - 1] < avg ? 'down' : 'flat'
  const last = points[points.length - 1]
  return (
    <svg className={clsx('spark', `spark-${dir}`)} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path className="spark-area" d={`${line}L${x(t1).toFixed(1)} ${height}L${x(t0).toFixed(1)} ${height}Z`} />
      <path className="spark-avg" d={`M0 ${y(avg).toFixed(1)}H${width}`} />
      <path className="spark-line" d={line} />
      <circle className="spark-dot" cx={x(last.t)} cy={y(last.v)} r="1.8" />
    </svg>
  )
}
