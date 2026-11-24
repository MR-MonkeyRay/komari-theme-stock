import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { finite, levelOf, sizeParts } from '../lib/format'
import type { MetricTrail } from '../lib/model'

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
    const p = sizeParts(v, rate, true)
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

const SPARK_W = 100
const SPARK_H = 24

/**
 * Intraday-style trail on a fixed 1h axis: fading area + line + dashed mean over the sampled span + last-value dot,
 * colored by Δ direction. Stretches to its box (size it with CSS); strokes and the dot keep their pixel size.
 * `minSpan` (pp) keeps steady metrics flat instead of amplifying noise; `stopped` draws a hollow end for offline nodes.
 */
export function Sparkline({ trail, minSpan = 6, stopped = false }: { trail: MetricTrail; minSpan?: number; stopped?: boolean }) {
  const gid = 'spk' + useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { points, avg, dir } = trail
  if (points.length < 2 || avg === null) return <span className="spark spark-empty" title="近 1 小时无上报数据" />
  const vs = points.map((p) => p.v)
  const lo = Math.min(...vs, avg)
  const hi = Math.max(...vs, avg)
  const span = Math.max(minSpan, hi - lo) * 1.25
  const min = Math.max(0, Math.min((lo + hi) / 2 - span / 2, 100 - span))
  const [t0, t1] = trail.window
  const x = (t: number) => Math.max(0, Math.min(1, (t - t0) / Math.max(1, t1 - t0))) * (SPARK_W - 5)
  const y = (v: number) => 2 + (1 - (v - min) / span) * (SPARK_H - 4)
  const first = points[0]
  const last = points[points.length - 1]
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`).join('')
  const ya = y(avg).toFixed(2)
  return (
    <span className={clsx('spark', `spark-${dir ?? 'flat'}`, hi - lo < 1.5 && 'is-steady', stopped && 'is-stopped')} aria-hidden="true">
      <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={SPARK_H}>
            <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path className="spark-axis" d={`M0 ${SPARK_H - 0.5}H${SPARK_W}`} />
        <path className="spark-area" fill={`url(#${gid})`} d={`${line}L${x(last.t).toFixed(2)} ${SPARK_H}L${x(first.t).toFixed(2)} ${SPARK_H}Z`} />
        <path className="spark-avg" d={`M${x(first.t).toFixed(2)} ${ya}H${x(last.t).toFixed(2)}`} />
        <path className="spark-line" d={line} />
      </svg>
      <i className="spark-dot" style={{ left: `${(x(last.t) / SPARK_W) * 100}%`, top: `${(y(last.v) / SPARK_H) * 100}%` }} />
    </span>
  )
}

/**
 * Single-choice segmented control (Radix radio group: arrow keys move and select); the active
 * pill slides between options.
 */
export function Segmented<T extends string>({ value, options, onChange, label, labelledBy, format, className }: { value: T; options: readonly T[]; onChange: (v: T) => void; label?: string; labelledBy?: string; format?: (v: T) => ReactNode; className?: string }) {
  const pill = useId()
  return (
    <RadioGroup.Root className={clsx('seg', className)} value={value} onValueChange={(v) => onChange(v as T)} orientation="horizontal" loop aria-label={label} aria-labelledby={labelledBy}>
      {options.map((o) => (
        <RadioGroup.Item key={o} value={o}>
          {value === o && <motion.span layoutId={pill} className="seg-pill" transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }} />}
          <span className="seg-label num">{format ? format(o) : o}</span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}
