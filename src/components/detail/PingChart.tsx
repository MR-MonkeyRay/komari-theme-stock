import clsx from 'clsx'
import {
  createChart,
  customSeriesDefaultOptions,
  HistogramSeries,
  LineSeries,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesWhitespaceData,
  type IChartApi,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type ISeriesApi,
  type MouseEventParams,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cssVar, usePaletteVersion } from '../../lib/appearance'
import { lossText, ms, type PingLineData } from '../../lib/ping'
import { asTs, baseChartOptions, breakAtGaps, chartPalette, crosshairLabel, HIDE_LINE } from './chartBase'
import { bucketAt, releaseTime, shareRange, sharedRangeFor, shareTime, useChartSync, userGesture, type SharedRange } from './chartSync'

// --- min–max band -------------------------------------------------------------------------------
// The spread of latency inside each bucket, drawn as one translucent shape per unbroken run so a
// lost stretch leaves a clean gap. Built on the library's custom series API.

interface BandData extends CustomData {
  lo: number
  hi: number
}

type DrawTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0]

class BandRenderer implements ICustomSeriesPaneRenderer {
  data: PaneRendererCustomData<Time, BandData> | null = null
  color = '#888'

  draw(target: DrawTarget, toY: PriceToCoordinateConverter) {
    const d = this.data
    if (!d?.visibleRange) return
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save()
      ctx.fillStyle = this.color
      ctx.globalAlpha = 0.2
      let run: { x: number; top: number; bottom: number }[] = []
      const flush = () => {
        if (run.length > 1) {
          ctx.beginPath()
          ctx.moveTo(run[0].x, run[0].top)
          for (const p of run) ctx.lineTo(p.x, p.top)
          for (let i = run.length - 1; i >= 0; i--) ctx.lineTo(run[i].x, run[i].bottom)
          ctx.closePath()
          ctx.fill()
        } else if (run.length === 1) {
          // A lone bucket between gaps: a short bar so it does not vanish.
          const w = Math.max(2, d.barSpacing * hr * 0.5)
          ctx.fillRect(run[0].x - w / 2, run[0].top, w, Math.max(1, run[0].bottom - run[0].top))
        }
        run = []
      }
      // One bucket past each edge, so the shape runs off the plot instead of stopping short.
      const from = Math.max(0, d.visibleRange!.from - 1)
      const to = Math.min(d.bars.length, d.visibleRange!.to + 1)
      for (let i = from; i < to; i++) {
        const bar = d.bars[i]
        const v = bar.originalData
        const top = 'hi' in v ? toY(v.hi) : null
        const bottom = 'lo' in v ? toY(v.lo) : null
        if (top === null || bottom === null) {
          flush()
          continue
        }
        run.push({ x: bar.x * hr, top: top * vr, bottom: bottom * vr })
      }
      flush()
      ctx.restore()
    })
  }
}

class BandView implements ICustomSeriesPaneView<Time, BandData, CustomSeriesOptions> {
  private r = new BandRenderer()
  renderer() {
    return this.r
  }
  update(data: PaneRendererCustomData<Time, BandData>, options: CustomSeriesOptions) {
    this.r.data = data
    this.r.color = options.color
  }
  priceValueBuilder(row: BandData) {
    return [row.lo, row.hi, row.hi]
  }
  isWhitespace(row: BandData | CustomSeriesWhitespaceData<Time>): row is CustomSeriesWhitespaceData<Time> {
    return (row as BandData).hi === undefined
  }
  defaultOptions() {
    return { ...customSeriesDefaultOptions, lastValueVisible: false, priceLineVisible: false }
  }
}

// --- chart --------------------------------------------------------------------------------------

const slotColor = (slot: number) => cssVar(`--ping-${slot + 1}`)

/**
 * The crosshair on bucket `i`: on the shown line with a value there (the chosen one, else the first),
 * or, where every probe was lost, on the loss bar, so the time is still marked.
 */
function crosshairAt(c: IChartApi, lineMap: Map<string, ISeriesApi<'Line'>>, lossBars: ISeriesApi<'Histogram'> | null, lines: PingLineData[], selected: string | null, i: number) {
  const t = lines[0]?.points[i]?.time
  if (t === undefined) return c.clearCrosshairPosition()
  const shown = selected !== null ? lines.filter((l) => l.id === selected) : lines
  const withValue = shown.find((l) => l.points[i]?.avg != null)
  const s = withValue && lineMap.get(withValue.id)
  if (withValue && s) return c.setCrosshairPosition(withValue.points[i].avg!, asTs(t), s)
  const worst = Math.max(0, ...shown.map((l) => l.points[i]?.loss ?? 0))
  if (worst > 0 && lossBars) return c.setCrosshairPosition(worst * 100, asTs(t), lossBars)
  c.clearCrosshairPosition()
}

/** Applies a shared window; one outside this chart's data (before ping retention) is skipped. */
function showRange(c: IChartApi, r: SharedRange) {
  try {
    c.timeScale().setVisibleRange({ from: asTs(r.from), to: asTs(r.to) })
  } catch {
    // keep the current window
  }
}
// Milliseconds on the axis: whole steps as whole numbers, tenths only where a flat, fast line gets
// ticks that close (54.2, 54.4). The margin kept for the loss bars reaches down to zero and below,
// where a label would read as a loss figure.
const axisFormat = {
  type: 'custom' as const,
  formatter: (v: number) => {
    if (v <= 0) return ''
    const r = Math.round(v * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
  },
  minMove: 0.1,
}

export interface PingChartProps {
  lines: PingLineData[]
  /** Task shown alone, or null for every line. */
  selected: string | null
  loading?: boolean
  /** Showing the previous range of this node while the new one loads. */
  stale?: boolean
  offline?: boolean
  rangeKey: string
  /** Shown when nothing is hovered; replaced by the bucket's reading while one is. */
  summary?: ReactNode
  /** Bucket time (s) under the crosshair, or null; the panel shows each line's value there. */
  onHover?: (time: number | null) => void
}

export default function PingChart({ lines, selected, loading, stale, offline, rangeKey, summary, onHover }: PingChartProps) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const band = useRef<ISeriesApi<'Custom', Time, BandData | WhitespaceData<Time>> | null>(null)
  const loss = useRef<ISeriesApi<'Histogram'> | null>(null)
  const series = useRef(new Map<string, ISeriesApi<'Line'>>())
  const palette = usePaletteVersion()
  const [hover, setHover] = useState<number | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  // New data (another range or node): ←/→ starts again from the latest bucket.
  const [cursorData, setCursorData] = useState(rangeKey)
  if (cursorData !== rangeKey) {
    setCursorData(rangeKey)
    setCursor(null)
  }
  const report = useRef(onHover)
  useEffect(() => {
    report.current = onHover
  }, [onHover])
  const id = useId()
  const gesture = useMemo(() => userGesture(), [])

  const times = useMemo(() => lines[0]?.points.map((p) => p.time) ?? [], [lines])
  // What following another chart's crosshair needs, kept current for the store subscription.
  const latest = useRef({ lines, times, selected, rangeKey })
  useEffect(() => {
    latest.current = { lines, times, selected, rangeKey }
  }, [lines, times, selected, rangeKey])
  const hasData = useMemo(() => lines.some((l) => l.points.some((p) => p.avg !== null || p.loss !== null)), [lines])
  const ids = lines.map((l) => l.id).join(',')

  // Create the chart, the band and the loss bars once.
  useEffect(() => {
    if (!host.current) return
    const c = createChart(host.current, baseChartOptions())
    band.current = c.addCustomSeries(new BandView(), { lastValueVisible: false, priceLineVisible: false, priceFormat: axisFormat })
    // Loss sits at the foot of the same pane on its own hidden 0–100 scale, so a healthy node
    // (no loss) gives the whole height to latency.
    loss.current = c.addSeries(HistogramSeries, {
      priceScaleId: 'loss',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${lossText(v)} 丢包`, minMove: 0.1 },
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    })
    c.priceScale('loss').applyOptions({ visible: false, scaleMargins: { top: 0.8, bottom: 0 } })
    chart.current = c
    const lineMap = series.current
    // Show a time another chart points at: the crosshair on its bucket, the readings at it.
    const followTime = (time: number | null) => {
      const { lines: ls, times: ts, selected: sel } = latest.current
      const i = time === null ? -1 : bucketAt(ts, time)
      // Outside this chart's buckets (ping keeps less history) the legend still shows the time.
      const t = i < 0 ? time : ts[i]
      setHover(t)
      report.current?.(t)
      if (i < 0) c.clearCrosshairPosition()
      else crosshairAt(c, lineMap, loss.current, ls, sel, i)
    }

    // Only the user's moves arrive here (moves from code fire nothing), and they are shared.
    const onMove = (p: MouseEventParams) => {
      // A pointer that only entered (the chart slid under it) points at nothing: show the shared
      // time as before, and leave it to whoever set it.
      if (!gesture.pointed()) return followTime(useChartSync.getState().time)
      const t = p.time === undefined ? null : (p.time as number)
      setHover(t)
      report.current?.(t)
      if (t === null) releaseTime(id)
      else shareTime(id, t)
    }
    c.subscribeCrosshairMove(onMove)
    const onWindow = () => {
      const r = c.timeScale().getVisibleRange()
      if (gesture.active() && r) shareRange(id, { from: r.from as number, to: r.to as number, key: latest.current.rangeKey })
    }
    c.timeScale().subscribeVisibleTimeRangeChange(onWindow)

    // Follow the other charts: the crosshair on the same bucket, and the same time window on the
    // same data.
    const unfollow = useChartSync.subscribe((st, prev) => {
      if (st.time !== prev.time && st.timeFrom !== id) followTime(st.time)
      if (st.range !== prev.range && st.range) {
        const r = sharedRangeFor(id, latest.current.rangeKey)
        if (r) showRange(c, r)
      }
    })
    return () => {
      unfollow()
      c.timeScale().unsubscribeVisibleTimeRangeChange(onWindow)
      c.unsubscribeCrosshairMove(onMove)
      c.remove()
      chart.current = null
      band.current = null
      loss.current = null
      lineMap.clear()
    }
  }, [id, gesture])

  // One line per task; a node with other tasks gets its own set.
  useEffect(() => {
    const c = chart.current
    if (!c) return
    const want = new Set(ids ? ids.split(',') : [])
    for (const [id, s] of series.current) {
      if (!want.has(id)) {
        c.removeSeries(s)
        series.current.delete(id)
      }
    }
    for (const id of want) {
      if (!series.current.has(id)) series.current.set(id, c.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false, priceFormat: axisFormat, crosshairMarkerRadius: 3 }))
    }
  }, [ids])

  useEffect(() => {
    chart.current?.applyOptions(chartPalette())
    loss.current?.applyOptions({ color: cssVar('--ping-loss') })
  }, [palette])

  // Data and what is shown for the current selection.
  useEffect(() => {
    const c = chart.current
    if (!c || !band.current || !loss.current) return
    for (const l of lines) {
      const s = series.current.get(l.id)
      if (!s) continue
      const on = selected === null || selected === l.id
      s.applyOptions({ visible: on, color: slotColor(l.slot), lastValueVisible: on && selected !== null })
      s.setData(breakAtGaps(l.points.map((p) => (p.avg === null ? { time: asTs(p.time) } : { time: asTs(p.time), value: p.avg })), HIDE_LINE))
    }
    const one = selected !== null ? lines.find((l) => l.id === selected) : undefined
    band.current.applyOptions({ visible: !!one, color: one ? slotColor(one.slot) : '#888' })
    band.current.setData(one ? one.points.map((p) => (p.min === null || p.max === null ? { time: asTs(p.time) } : { time: asTs(p.time), lo: p.min, hi: p.max })) : [])
    // The worst line's loss when showing them all; the chosen line's otherwise.
    const shown = one ? [one] : lines
    const lossData = times.map((t, i) => {
      const worst = Math.max(...shown.map((l) => l.points[i]?.loss ?? 0))
      return worst > 0 ? { time: asTs(t), value: worst * 100 } : { time: asTs(t) }
    })
    loss.current.setData(lossData)
    const anyLoss = lossData.some((d) => 'value' in d)
    c.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: anyLoss ? 0.26 : 0.08 } })
  }, [lines, times, selected, palette])

  // Fit when the range or node changes, not on every refresh.
  useEffect(() => {
    const c = chart.current
    if (!c || !times.length) return
    // On phones, the latest ~48 buckets, as the CPU chart opens (the ranges share their buckets).
    if (window.matchMedia('(max-width: 640px)').matches && times.length > 48) c.timeScale().setVisibleLogicalRange({ from: times.length - 48, to: times.length + 1 })
    else c.timeScale().fitContent()
    // Another chart was zoomed on this data before it arrived here: join it.
    const shared = sharedRangeFor(id, rangeKey)
    if (shared) showRange(c, shared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, times.length > 0])

  // Keyboard: ←/→ steps the crosshair across buckets and updates the readings directly (moving the
  // crosshair from code does not fire the crosshair event).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (!times.length || !chart.current) return
    e.preventDefault()
    const i = cursor === null ? times.length - 1 : Math.max(0, Math.min(times.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(i)
    setHover(times[i])
    report.current?.(times[i])
    shareTime(id, times[i])
    crosshairAt(chart.current, series.current, loss.current, lines, selected, i)
  }
  const onBlur = () => {
    setCursor(null)
    setHover(null)
    report.current?.(null)
    chart.current?.clearCrosshairPosition()
    releaseTime(id)
  }

  const one = selected !== null ? lines.find((l) => l.id === selected) : undefined
  const at = hover !== null ? times.indexOf(hover) : -1
  const p = one && at >= 0 ? one.points[at] : undefined

  return (
    <div className={clsx('kline ping-chart', offline && 'is-offline', stale && 'is-stale')}>
      <div className="kline-legend num" aria-hidden="true">
        {!hasData ? (
          <span className="dim">{loading ? '加载中…' : '所选范围内无延迟样本'}</span>
        ) : hover !== null ? (
          <>
            <span className="lg-time">{crosshairLabel(hover as Time)}</span>
            {one &&
              (p?.avg !== null && p?.avg !== undefined ? (
                <>
                  <span>
                    均 <b>{ms(p.avg)}</b>ms
                  </span>
                  {p.min !== null && p.max !== null && (
                    <span>
                      范围 <b>{ms(p.min)}–{ms(p.max)}</b>
                    </span>
                  )}
                  {!!p.loss && (
                    <span className="warn">
                      丢包 <b>{lossText(p.loss * 100)}</b>
                    </span>
                  )}
                </>
              ) : (
                <span className="warn">{p?.loss ? '全部丢包' : '无上报样本'}</span>
              ))}
            {/* Every line: the chips carry the latency; the loss of this bucket is read here. */}
            {!one &&
              at >= 0 &&
              lines.map((l) => {
                const q = l.points[at]
                if (!q?.loss) return null
                return (
                  <span key={l.id} className="warn">
                    {l.name} 丢包 <b>{q.avg === null ? '全部' : lossText(q.loss * 100)}</b>
                  </span>
                )
              })}
          </>
        ) : (
          summary
        )}
      </div>
      <div
        ref={host}
        className="kline-canvas"
        tabIndex={0}
        role="img"
        aria-label={`网络延迟折线图${one ? `，${one.name}` : `，${lines.map((l) => l.name).join('、')}`}；按左右方向键逐个查看时段`}
        onKeyDown={onKey}
        onBlur={onBlur}
        // Capture: these must be known before the chart handles the same event.
        onPointerDownCapture={gesture.onPointerDown}
        onPointerMoveCapture={gesture.onPointerMove}
        onWheel={gesture.onWheel}
        onPointerLeave={() => {
          gesture.onPointerLeave()
          releaseTime(id)
        }}
      />
      {loading && !hasData && <div className="kline-skeleton skeleton" aria-hidden="true" />}
      {offline && <span className="kline-watermark">离线 · 历史快照</span>}
    </div>
  )
}
