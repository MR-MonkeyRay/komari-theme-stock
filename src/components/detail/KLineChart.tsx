import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { AreaSeries, CandlestickSeries, createChart, createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type MouseEventParams, type SeriesMarker, type Time } from 'lightweight-charts'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ConnPoint } from '../../lib/api'
import { cssVar, usePaletteVersion } from '../../lib/appearance'
import { isCandle, movingAverage, volumeBars, type Candle, type Slot, type Volume } from '../../lib/candles'
import { size } from '../../lib/format'
import type { ChartStyle } from '../../lib/settings'
import { asTs, baseChartOptions, chartPalette, crosshairLabel } from './chartBase'
import { bucketAt, releaseTime, shareRange, sharedRangeFor, shareTime, useChartSync, userGesture, type SharedRange } from './chartSync'

const VOL_FORMAT = { type: 'custom' as const, formatter: (v: number) => (v > 0 ? size(v, true) : '0'), minMove: 1 }
const COUNT_FORMAT = { type: 'custom' as const, formatter: (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v))), minMove: 1 }

/** Applies a shared window; one outside this chart's data (before its first sample) is skipped. */
function showRange(c: IChartApi, r: SharedRange) {
  try {
    c.timeScale().setVisibleRange({ from: asTs(r.from), to: asTs(r.to) })
  } catch {
    // keep the current window
  }
}

/** An inferred event drawn on its bucket: CPU rises and falls, memory highs. `time` in seconds. */
export interface ChartMark {
  time: number
  kind: 'rise' | 'fall' | 'high-mem'
}

/** What the CPU chart's sub-pane shows: traffic as volume bars, or TCP/UDP connections. */
export type SubPane = 'vol' | 'conn'

export interface KLineProps {
  slots: Slot[]
  volume?: Volume[]
  /** With `volume`: the sub-pane view, its switch, and connection data for the 连接 view (undefined
   *  while it loads, null when it could not be fetched). */
  sub?: SubPane
  onSub?: (s: SubPane) => void
  conn?: ConnPoint[] | null
  /** Candles (K 线) or a line of bucket averages (分时). */
  look?: ChartStyle
  marks?: ChartMark[]
  /** axis/legend formatter for candle values */
  format: (v: number) => string
  /** clamp autoscale to [0, 100] for percentages */
  percent?: boolean
  ma?: boolean
  loading?: boolean
  /** Showing the previous range of this node while the new one loads: dimmed, with a progress bar. */
  stale?: boolean
  offline?: boolean
  label: string
  rangeKey: string
}

interface Hover {
  candle: Candle | null
  time: number
  volume?: Volume
}

export default function KLineChart({ slots, volume, sub = 'vol', onSub, conn, look = 'candle', marks, format, percent, ma, loading, stale, offline, label, rangeKey }: KLineProps) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<{
    candle: ISeriesApi<'Candlestick'>
    area: ISeriesApi<'Area'>
    ma5?: ISeriesApi<'Line'>
    ma20?: ISeriesApi<'Line'>
    vol?: ISeriesApi<'Candlestick'>
    volMa5?: ISeriesApi<'Line'>
    volMa10?: ISeriesApi<'Line'>
    tcp?: ISeriesApi<'Line'>
    udp?: ISeriesApi<'Line'>
  } | null>(null)
  const lastLine = useRef<IPriceLine | null>(null)
  const markers = useRef<{ candle: ISeriesMarkersPluginApi<Time>; area: ISeriesMarkersPluginApi<Time> } | null>(null)
  const id = useId()
  const gesture = useMemo(() => userGesture(), [])
  const palette = usePaletteVersion()
  const [hover, setHover] = useState<Hover | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  }, [format])

  const candles = useMemo(() => slots.filter(isCandle), [slots])
  const line = look === 'line'
  const bars = useMemo(() => (volume ? volumeBars(volume, candles, line) : []), [volume, candles, line])
  // The crosshair reports a time; the legend reads that bucket from here, in either view.
  const byTime = useRef(new Map<number, Candle>())
  useEffect(() => {
    byTime.current = new Map(candles.map((c) => [c.time, c]))
  }, [candles])
  const barByTime = useMemo(() => new Map(bars.map((b) => [b.time, b])), [bars])
  const connByTime = useMemo(() => new Map(conn?.map((c) => [c.time, c])), [conn])
  // Not hovering: the latest bucket with connection samples (its history refreshes on its own clock).
  const lastConn = useMemo(() => conn?.findLast((c) => c.tcp !== null || c.udp !== null), [conn])
  // What following another chart's crosshair needs, kept current for the store subscription.
  const latest = useRef({ slots, line, rangeKey })
  useEffect(() => {
    latest.current = { slots, line, rangeKey }
  }, [slots, line, rangeKey])
  // The VOL pane's own legend sits at the top of that pane, which moves as the chart resizes.
  const legend = useRef<HTMLDivElement>(null)
  const [subTop, setSubTop] = useState<number | null>(null)

  // Create once; series are added according to the props that never change per instance.
  useEffect(() => {
    if (!host.current) return
    const c = createChart(host.current, baseChartOptions())
    // Per-series formatters: the chart-wide localization formatter would also hit the volume pane.
    // A percentage axis stays within 0–100 even where the event marks add headroom.
    const valueFormat = { type: 'custom' as const, formatter: (v: number) => (percent && (v > 100.001 || v < -0.001) ? '' : fmt.current(v)), minMove: 0.01 }
    const candle = c.addSeries(CandlestickSeries, {
      priceFormat: valueFormat,
      // The built-in last-value label takes the (transparent) hollow body color; a custom line replaces it.
      lastValueVisible: false,
      priceLineVisible: false,
      autoscaleInfoProvider: percent
        ? (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
            const r = original()
            if (!r) return r
            return { ...r, priceRange: { minValue: Math.max(0, r.priceRange.minValue), maxValue: Math.min(100, r.priceRange.maxValue) } }
          }
        : undefined,
    })
    // 分时: the bucket averages as a line over a fading fill.
    const area = c.addSeries(AreaSeries, { priceFormat: valueFormat, lineWidth: 2, visible: false, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3, autoscaleInfoProvider: candle.options().autoscaleInfoProvider })
    const s: NonNullable<typeof series.current> = { candle, area }
    if (ma) {
      const line = { lineWidth: 1 as const, priceFormat: valueFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
      // MA5 turns into noise on phone-width charts; keep MA20 there.
      s.ma5 = c.addSeries(LineSeries, { ...line, visible: !window.matchMedia('(max-width: 640px)').matches })
      s.ma20 = c.addSeries(LineSeries, line)
    }
    if (volume) {
      // VOL: throughput bars from zero, hollow under a rising candle and solid under a falling one,
      // drawn with the candle series itself (open 0 → close v rises, v → 0 falls) so they match the
      // candles above exactly.
      const volFormat = VOL_FORMAT
      s.vol = c.addSeries(CandlestickSeries, { priceFormat: volFormat, wickVisible: false, priceLineVisible: false, lastValueVisible: false }, 1)
      const avgLine = { lineWidth: 1 as const, priceFormat: volFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
      s.volMa5 = c.addSeries(LineSeries, { ...avgLine, visible: !window.matchMedia('(max-width: 640px)').matches }, 1)
      s.volMa10 = c.addSeries(LineSeries, avgLine, 1)
      // 连接 view: TCP and UDP counts as two indicator lines on a scale from zero.
      const connLine = { lineWidth: 1 as const, priceFormat: COUNT_FORMAT, priceLineVisible: false, lastValueVisible: false, visible: false, autoscaleInfoProvider: (base: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = base()
        return r && { ...r, priceRange: { minValue: 0, maxValue: r.priceRange.maxValue } }
      } }
      s.tcp = c.addSeries(LineSeries, { ...connLine, lineWidth: 2 }, 1)
      s.udp = c.addSeries(LineSeries, connLine, 1)
      // Headroom at the top of the pane for its legend.
      s.vol.priceScale().applyOptions({ scaleMargins: { top: 0.3, bottom: 0 } })
      c.panes()[0].setStretchFactor(0.73)
      c.panes()[1].setStretchFactor(0.27)
    }
    if (!volume) c.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.12 } } })
    chart.current = c
    series.current = s

    markers.current = { candle: createSeriesMarkers(candle, []), area: createSeriesMarkers(area, []) }

    // Show a time another chart points at: the crosshair on its bucket and the legend reading it.
    const followTime = (t: number | null) => {
      const sr = series.current
      if (!sr) return
      const { slots: ss, line: ln } = latest.current
      const k = t === null ? undefined : ss[bucketAt(ss.map((x) => x.time), t)]
      if (t === null) {
        c.clearCrosshairPosition()
        setHover(null)
      } else if (k && isCandle(k)) {
        if (ln) c.setCrosshairPosition(k.avg, asTs(k.time), sr.area)
        else c.setCrosshairPosition(k.close, asTs(k.time), sr.candle)
        setHover({ time: k.time, candle: k })
      } else {
        // No sample here (a gap, or before this chart's data): the legend says so at that time.
        c.clearCrosshairPosition()
        setHover({ time: k?.time ?? t, candle: null })
      }
    }

    // Only the user's moves arrive here (moves from code fire nothing), and they are shared.
    const onMove = (p: MouseEventParams) => {
      // A pointer that only entered (the chart slid under it) points at nothing: show the shared
      // time as before, and leave it to whoever set it.
      if (!gesture.pointed()) return followTime(useChartSync.getState().time)
      if (p.time === undefined) {
        setHover(null)
        releaseTime(id)
        return
      }
      const t = p.time as number
      setHover({ time: t, candle: byTime.current.get(t) ?? null })
      shareTime(id, t)
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
      markers.current = null
      c.remove()
      chart.current = null
      series.current = null
      lastLine.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Palette (theme or up/down convention changed).
  useEffect(() => {
    const c = chart.current
    const s = series.current
    if (!c || !s) return
    const up = cssVar('--up')
    const down = cssVar('--down')
    c.applyOptions(chartPalette())
    // Rising candles are hollow (outline only), falling candles are solid.
    s.candle.applyOptions({ upColor: cssVar('--bg-chart'), borderUpColor: up, wickUpColor: up, downColor: down, borderDownColor: down, wickDownColor: down })
    s.area.applyOptions({ lineColor: cssVar('--chart-line'), topColor: cssVar('--chart-area-top'), bottomColor: cssVar('--chart-area-bottom') })
    s.ma5?.applyOptions({ color: cssVar('--ma5') })
    s.ma20?.applyOptions({ color: cssVar('--ma20') })
    const volDown = cssVar('--vol-down')
    s.vol?.applyOptions({ upColor: cssVar('--vol-up-fill'), borderUpColor: cssVar('--vol-up-stroke'), downColor: volDown, borderDownColor: volDown })
    s.volMa5?.applyOptions({ color: cssVar('--ma5') })
    s.volMa10?.applyOptions({ color: cssVar('--ma20') })
    s.tcp?.applyOptions({ color: cssVar('--conn-tcp') })
    s.udp?.applyOptions({ color: cssVar('--conn-udp') })
  }, [palette])

  // K 线 or 分时.
  useEffect(() => {
    const s = series.current
    if (!s) return
    s.candle.applyOptions({ visible: !line })
    s.area.applyOptions({ visible: line })
    // In 分时 the gold MA20 plays the stock chart's average line; MA5 would only crowd it.
    s.ma5?.applyOptions({ visible: !line && !window.matchMedia('(max-width: 640px)').matches })
  }, [line])

  // Event marks on the visible series: ▲ over a rise, ▼ under a fall, a dot over a memory high.
  useEffect(() => {
    const m = markers.current
    if (!m) return
    const known = new Set(candles.map((c) => c.time))
    const list: SeriesMarker<Time>[] = (marks ?? [])
      .filter((e) => known.has(e.time))
      .sort((a, b) => a.time - b.time)
      .map((e) =>
        e.kind === 'rise'
          ? { time: asTs(e.time), position: 'aboveBar', shape: 'arrowUp', color: cssVar('--up'), size: 0.7 }
          : e.kind === 'fall'
            ? { time: asTs(e.time), position: 'belowBar', shape: 'arrowDown', color: cssVar('--down'), size: 0.7 }
            : { time: asTs(e.time), position: 'aboveBar', shape: 'circle', color: cssVar('--warn'), size: 0.6 },
      )
    m.candle.setMarkers(line ? [] : list)
    m.area.setMarkers(line ? list : [])
  }, [marks, candles, line, palette])

  // Sub-pane view.
  useEffect(() => {
    const s = series.current
    if (!s?.vol) return
    const vol = sub === 'vol'
    // The pane's axis labels take the first series' format, which is the (hidden) volume bars.
    for (const x of [s.vol, s.volMa5, s.volMa10]) x?.applyOptions({ visible: vol && (x !== s.volMa5 || !window.matchMedia('(max-width: 640px)').matches), priceFormat: vol ? VOL_FORMAT : COUNT_FORMAT })
    s.tcp?.applyOptions({ visible: !vol })
    s.udp?.applyOptions({ visible: !vol })
  }, [sub])

  useEffect(() => {
    const s = series.current
    if (!s?.tcp || !s.udp) return
    const line = (k: 'tcp' | 'udp') => (conn ?? []).map((c) => (c[k] === null ? { time: asTs(c.time) } : { time: asTs(c.time), value: c[k]! }))
    s.tcp.setData(line('tcp'))
    s.udp.setData(line('udp'))
  }, [conn])

  // Data.
  useEffect(() => {
    const s = series.current
    if (!s) return
    const last = candles[candles.length - 1]
    if (lastLine.current) s.candle.removePriceLine(lastLine.current)
    lastLine.current = last
      ? s.candle.createPriceLine({
          price: last.close,
          color: cssVar(last.close > last.open ? '--up' : last.close < last.open ? '--down' : '--flat'),
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          axisLabelVisible: true,
        })
      : null
    s.candle.setData(slots.map((x) => (isCandle(x) ? { time: asTs(x.time), open: x.open, high: x.high, low: x.low, close: x.close } : { time: asTs(x.time) })))
    s.area.setData(slots.map((x) => (isCandle(x) ? { time: asTs(x.time), value: x.avg } : { time: asTs(x.time) })))
    if (s.ma5 && s.ma20) {
      const conv = (arr: { time: number; value?: number }[]) => arr.map((p) => (p.value === undefined ? { time: asTs(p.time) } : { time: asTs(p.time), value: p.value }))
      s.ma5.setData(conv(movingAverage(slots, 5)))
      s.ma20.setData(conv(movingAverage(slots, 20)))
    }
    if (s.vol && s.volMa5 && s.volMa10) {
      const flat = cssVar('--vol-flat')
      // 分时 volume is all solid, like a stock's intraday volume.
      const upSolid = line ? cssVar('--vol-up-solid') : null
      s.vol.setData(
        bars.map((b) => {
          const time = asTs(b.time)
          if (b.dir === 'down') return { time, open: b.total, high: b.total, low: 0, close: 0 }
          const bar = { time, open: 0, high: b.total, low: 0, close: b.total }
          if (b.dir === 'flat') return { ...bar, color: flat, borderColor: flat }
          return upSolid ? { ...bar, color: upSolid, borderColor: upSolid } : bar
        }),
      )
      s.volMa5.setData(bars.map((b) => (b.ma5 === undefined ? { time: asTs(b.time) } : { time: asTs(b.time), value: b.ma5 })))
      s.volMa10.setData(bars.map((b) => (b.ma10 === undefined ? { time: asTs(b.time) } : { time: asTs(b.time), value: b.ma10 })))
    }
  }, [slots, candles, bars, palette, line])

  // Keep the VOL legend at the top of its pane.
  useLayoutEffect(() => {
    if (!volume || !host.current) return
    const place = () => {
      const panes = chart.current?.panes()
      if (!panes || panes.length < 2 || !legend.current) return
      setSubTop(legend.current.offsetHeight + panes[0].getHeight() + 1)
      // Headroom for the pane's legend line in pixels, so short panes don't draw under it.
      const h = panes[1].getHeight()
      // Labels that the pane's top edge would cut in half are left out.
      if (h > 0) series.current?.vol?.priceScale().applyOptions({ scaleMargins: { top: Math.min(0.55, Math.max(0.2, 30 / h)), bottom: 0 }, entireTextOnly: true })
    }
    const ro = new ResizeObserver(() => requestAnimationFrame(place))
    ro.observe(host.current)
    place()
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fit when the range changes (not on every refresh, so a zoomed view stays put).
  useEffect(() => {
    const c = chart.current
    if (!c || !slots.length) return
    // On phones, charts open on the latest ~48 buckets so candle bodies stay readable. This keys off
    // the viewport, not the chart width: the narrower side-by-side desktop charts keep the full range.
    if (window.matchMedia('(max-width: 640px)').matches && slots.length > 48) c.timeScale().setVisibleLogicalRange({ from: slots.length - 48, to: slots.length + 1 })
    else c.timeScale().fitContent()
    // Another chart was zoomed on this data before it arrived here: join it.
    const shared = sharedRangeFor(id, rangeKey)
    if (shared) showRange(c, shared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, slots.length > 0])

  // Keyboard: ←/→ steps the crosshair across buckets.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (!candles.length || !chart.current || !series.current) return
    e.preventDefault()
    const i = cursor === null ? candles.length - 1 : Math.max(0, Math.min(candles.length - 1, cursor + (e.key === 'ArrowLeft' ? -1 : 1)))
    setCursor(i)
    const c = candles[i]
    if (line) chart.current.setCrosshairPosition(c.avg, asTs(c.time), series.current.area)
    else chart.current.setCrosshairPosition(c.close, asTs(c.time), series.current.candle)
    // Moving the crosshair from code fires no crosshair event: update the legend here.
    setHover({ time: c.time, candle: c })
    shareTime(id, c.time)
  }
  const onBlur = () => {
    setCursor(null)
    setHover(null)
    chart.current?.clearCrosshairPosition()
    releaseTime(id)
  }

  // Hovering a bucket without samples says so, instead of showing the latest candle.
  const gap = hover !== null && hover.candle === null
  const shown = gap ? null : (hover?.candle ?? candles[candles.length - 1] ?? null)
  const shownTime = hover?.time ?? shown?.time
  const bar = shownTime !== undefined ? barByTime.get(shownTime) : undefined
  const cn = hover ? connByTime.get(hover.time) : lastConn
  const chg = shown ? shown.close - shown.open : 0
  const dir = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat'

  return (
    <div className={clsx('kline', offline && 'is-offline', loading && !candles.length && 'is-loading', stale && 'is-stale')}>
      <div className="kline-legend num" aria-hidden="true" ref={legend}>
        {gap ? (
          <>
            <span className="lg-time">{crosshairLabel(hover.time as Time)}</span>
            <span className="dim">无上报样本</span>
          </>
        ) : shown && line ? (
          <>
            <span className="lg-time">{crosshairLabel(shown.time as Time)}</span>
            <span>
              均 <b>{format(shown.avg)}</b>
            </span>
            <span>
              高 <b>{format(shown.high)}</b>
            </span>
            <span>
              低 <b>{format(shown.low)}</b>
            </span>
            {ma && (
              <span className="lg-ma">
                <i className="ma20" />
                MA20
              </span>
            )}
          </>
        ) : shown ? (
          <>
            <span className="lg-time">{crosshairLabel(shown.time as Time)}</span>
            <span>
              开 <b className={dir}>{format(shown.open)}</b>
            </span>
            <span>
              高 <b className={dir}>{format(shown.high)}</b>
            </span>
            <span>
              低 <b className={dir}>{format(shown.low)}</b>
            </span>
            <span>
              收 <b className={dir}>{format(shown.close)}</b>
            </span>
            {shown.open > 0 && (
              <span>
                幅 <b className={dir}>{((chg / shown.open) * 100).toFixed(2)}%</b>
              </span>
            )}
            {ma && (
              <span className="lg-ma">
                <i className="ma5" />
                MA5 <i className="ma20" />
                MA20
              </span>
            )}
          </>
        ) : (
          <span className="dim">{loading ? '加载中…' : '所选范围内没有样本'}</span>
        )}
      </div>
      <div
        ref={host}
        className="kline-canvas"
        tabIndex={0}
        role="img"
        aria-label={line ? `${label}分时图，每个时段的均值连成折线；按左右方向键逐个查看时段` : `${label} K 线图，空心为区间上升、实心为区间下降；按左右方向键逐个查看区间`}
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
      {volume && subTop !== null && candles.length > 0 && (
        <div className="kline-sublegend num" style={{ top: subTop }}>
          {onSub && (
            <RadioGroup.Root className="sub-switch" value={sub} onValueChange={(v) => onSub(v as SubPane)} orientation="horizontal" loop aria-label="副图">
              <RadioGroup.Item value="vol">网速</RadioGroup.Item>
              <RadioGroup.Item value="conn">连接</RadioGroup.Item>
            </RadioGroup.Root>
          )}
          {sub === 'conn' ? (
            <span className="sub-read" aria-hidden="true">
              {cn && (cn.tcp !== null || cn.udp !== null) ? (
                <>
                  <span className="lg-tag">CONN</span>
                  <b>{Math.round((cn.tcp ?? 0) + (cn.udp ?? 0))}</b>
                  <span className="lg-tcp">
                    TCP <b>{cn.tcp === null ? '—' : Math.round(cn.tcp)}</b>
                  </span>
                  <span className="lg-udp">
                    UDP <b>{cn.udp === null ? '—' : Math.round(cn.udp)}</b>
                  </span>
                </>
              ) : (
                <span className="dim">{conn ? '无连接数样本' : conn === null ? '连接数获取失败' : '加载中…'}</span>
              )}
            </span>
          ) : (
          <span className="sub-read" aria-hidden="true">
          <span className="lg-tag">VOL</span>
          {bar ? (
            <>
              <b className={bar.dir}>{size(bar.total, true)}</b>
              <span className="lg-split">
                (<i className="net-up">↑</i>
                {size(bar.up)} <i className="net-down">↓</i>
                {size(bar.down)})
              </span>
              {bar.ma5 !== undefined && (
                <span className="lg-ma5">
                  MA5 <b>{size(bar.ma5)}</b>
                </span>
              )}
              {bar.ma10 !== undefined && (
                <span className="lg-ma10">
                  MA10 <b>{size(bar.ma10)}</b>
                </span>
              )}
            </>
          ) : (
            <span className="dim">无流量样本</span>
          )}
          </span>
          )}
        </div>
      )}
      {loading && !candles.length && <div className="kline-skeleton skeleton" aria-hidden="true" />}
      {offline && <span className="kline-watermark">离线 · 历史快照</span>}
    </div>
  )
}
