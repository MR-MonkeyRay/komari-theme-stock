import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { AreaSeries, CandlestickSeries, createChart, createSeriesMarkers, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type MouseEventParams, type SeriesMarker, type Time } from 'lightweight-charts'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConnPoint } from '../../lib/api'
import { cssVar, usePaletteVersion } from '../../lib/appearance'
import { isCandle, movingAverage, volumeBars, type Candle, type Slot, type Volume } from '../../lib/candles'
import { size } from '../../lib/format'
import { isPhone } from '../../lib/media'
import type { ChartStyle } from '../../lib/settings'
import { asTs, baseChartOptions, breakAtGaps, chartPalette, crosshairLabel, HIDE_AREA, HIDE_LINE, localLabel, onGrid, revealTime } from './chartBase'
import { bucketAt, releaseTime, shareRange, sharedRangeFor, shareTime, stepTime, togglePin, useChartSync, userGesture, type SharedRange } from './chartSync'
import { PinMark } from './pinLine'

// On phones the axis drops the "/s" (the legend above it keeps it), so it is as narrow as the others.
const VOL_FORMAT = { type: 'custom' as const, formatter: (v: number) => (v > 0 ? size(v, !isPhone()) : '0'), minMove: 1 }
const COUNT_FORMAT = { type: 'custom' as const, formatter: (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(0)}k` : String(Math.round(v))), minMove: 1 }

/** Applies a shared window; one that ends before this chart's first sample is skipped (else
 * lightweight-charts would squeeze it to a sliver), one it cannot place keeps the current one. */
function showRange(c: IChartApi, r: SharedRange, first: number | undefined) {
  if (first === undefined || r.to <= first) return
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
  /** Keep the scale's floor at zero. */
  zero?: boolean
  /** A level drawn across the chart as a dashed line, which the scale always reaches (the load
   *  chart's core count). Pass null for none on a chart that may have one. */
  level?: { value: number; title: string } | null
  /** A second line over the price pane on a scale of its own, from 0 to `max`, with no axis; its
   *  reading joins the legend. `color` names a CSS variable. Pass null for none on a chart that may
   *  have one. */
  overlay?: { points: { time: number; value: number }[]; max: number; label: string; color: string; format: (v: number) => string } | null
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

export default function KLineChart({ slots, volume, sub = 'vol', onSub, conn, look = 'candle', marks, format, percent, zero, level, overlay, ma, loading, stale, offline, label, rangeKey }: KLineProps) {
  const { t, i18n } = useTranslation()
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
    overlay?: ISeriesApi<'Line'>
  } | null>(null)
  const lastLine = useRef<IPriceLine | null>(null)
  // The level's line on each price series (only the visible one draws), and the figures the
  // autoscale reads, kept current for its callbacks.
  const levelLines = useRef<[ISeriesApi<'Candlestick'> | ISeriesApi<'Area'>, IPriceLine][]>([])
  const levelAt = useRef<number | null>(null)
  const overlayMax = useRef(1)
  const markers = useRef<{ candle: ISeriesMarkersPluginApi<Time>; area: ISeriesMarkersPluginApi<Time> } | null>(null)
  // The pinned time: drawn on every pane and the time axis, read by the legend when nothing is hovered.
  const pinMarks = useRef<PinMark[]>([])
  const showPin = useRef<(t: number | null, reveal?: boolean) => void>(() => {})
  const id = useId()
  const gesture = useMemo(() => userGesture(), [])
  const palette = usePaletteVersion()
  const [hover, setHover] = useState<Hover | null>(null)
  const [pinned, setPinned] = useState<Hover | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  // New data (another range or node): ←/→ starts again from the latest bucket.
  const [cursorData, setCursorData] = useState(rangeKey)
  if (cursorData !== rangeKey) {
    setCursorData(rangeKey)
    setCursor(null)
  }
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
    // A percentage axis stays within 0–100 even where the event marks add headroom, and one from
    // zero labels nothing below it.
    const valueFormat = { type: 'custom' as const, formatter: (v: number) => ((percent && v > 100.001) || ((percent || zero) && v < -0.001) ? '' : fmt.current(v)), minMove: 0.01 }
    const fit = (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
      const r = original()
      if (!r) return r
      let { minValue, maxValue } = r.priceRange
      if (percent) [minValue, maxValue] = [Math.max(0, minValue), Math.min(100, maxValue)]
      if (zero) minValue = 0
      if (levelAt.current !== null) maxValue = Math.max(maxValue, levelAt.current)
      return { ...r, priceRange: { minValue, maxValue } }
    }
    const candle = c.addSeries(CandlestickSeries, {
      priceFormat: valueFormat,
      // The built-in last-value label takes the (transparent) hollow body color; a custom line replaces it.
      lastValueVisible: false,
      priceLineVisible: false,
      autoscaleInfoProvider: percent || zero || level !== undefined ? fit : undefined,
    })
    // 分时: the bucket averages as a line over a fading fill.
    const area = c.addSeries(AreaSeries, { priceFormat: valueFormat, lineWidth: 2, visible: false, priceLineVisible: false, lastValueVisible: true, crosshairMarkerRadius: 3, autoscaleInfoProvider: candle.options().autoscaleInfoProvider })
    const s: NonNullable<typeof series.current> = { candle, area }
    if (ma) {
      const line = { lineWidth: 1 as const, priceFormat: valueFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
      // MA5 turns into noise on phone charts (their legend leaves it out too); keep MA20 there.
      s.ma5 = c.addSeries(LineSeries, { ...line, visible: !isPhone() })
      s.ma20 = c.addSeries(LineSeries, line)
    }
    if (volume) {
      // VOL: throughput bars from zero, hollow under a rising candle and solid under a falling one,
      // drawn with the candle series itself (open 0 → close v rises, v → 0 falls) so they match the
      // candles above exactly.
      const volFormat = VOL_FORMAT
      s.vol = c.addSeries(CandlestickSeries, { priceFormat: volFormat, wickVisible: false, priceLineVisible: false, lastValueVisible: false }, 1)
      const avgLine = { lineWidth: 1 as const, priceFormat: volFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
      s.volMa5 = c.addSeries(LineSeries, { ...avgLine, visible: !isPhone() }, 1)
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
    if (overlay !== undefined) {
      // Over the candles, on a scale of its own whose zero sits on the price scale's floor.
      s.overlay = c.addSeries(LineSeries, {
        priceScaleId: 'overlay',
        lineWidth: 1,
        visible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: overlayMax.current } }),
      })
      c.priceScale('overlay').applyOptions({ scaleMargins: { top: 0.14, bottom: 0.12 } })
    }
    chart.current = c
    series.current = s

    markers.current = { candle: createSeriesMarkers(candle, []), area: createSeriesMarkers(area, []) }

    // The pin: a line down each pane (whichever series it shows) and the time on the axis.
    const pins = [new PinMark('line', true), new PinMark('label')]
    c.panes()[0].attachPrimitive(pins[0])
    candle.attachPrimitive(pins[1])
    if (volume) {
      pins.push(new PinMark('line'))
      c.panes()[1].attachPrimitive(pins[2])
    }
    pinMarks.current = pins
    // On this chart's own bucket; a time outside its data marks nothing and reads as a gap.
    showPin.current = (t, reveal = false) => {
      const ss = latest.current.slots
      const k = t === null ? undefined : ss[bucketAt(ss.map((x) => x.time), t)]
      for (const m of pins) m.set(k ? k.time : null)
      setPinned(t === null ? null : { time: k?.time ?? t, candle: k && isCandle(k) ? k : null })
      // A pin moved out of the window (stepped past a phone's shorter one) brings the window along.
      if (reveal && k) revealTime(c, k.time)
    }

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
    // A click (not a drag: the library drops the click once the pointer moves) pins its bucket.
    const onClick = (p: MouseEventParams) => {
      if (p.time === undefined) return
      togglePin(latest.current.slots.map((x) => x.time), p.time as number)
      // A tap leaves the crosshair on the bucket it pinned; the pin marks it now.
      if (gesture.touch()) {
        c.clearCrosshairPosition()
        setHover(null)
        releaseTime(id)
      }
    }
    c.subscribeClick(onClick)
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
        if (r) showRange(c, r, latest.current.slots[0]?.time)
      }
      if (st.pin !== prev.pin) showPin.current(st.pin, true)
    })
    return () => {
      unfollow()
      c.timeScale().unsubscribeVisibleTimeRangeChange(onWindow)
      c.unsubscribeClick(onClick)
      c.unsubscribeCrosshairMove(onMove)
      markers.current = null
      levelLines.current = []
      pinMarks.current = []
      showPin.current = () => {}
      c.remove()
      chart.current = null
      series.current = null
      lastLine.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Axis dates and labels follow the page language; re-applying the formatters redraws them.
  useEffect(() => {
    chart.current?.applyOptions({ timeScale: { tickMarkFormatter: localLabel }, localization: { timeFormatter: crosshairLabel } })
  }, [i18n.language])

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
    for (const m of pinMarks.current) m.palette()
  }, [palette])

  // The pin on new data (a refresh, or a chart that mounts after the pin was set): its bucket here.
  useEffect(() => {
    showPin.current(useChartSync.getState().pin)
  }, [slots])

  // K 线 or 分时.
  useEffect(() => {
    const s = series.current
    if (!s) return
    s.candle.applyOptions({ visible: !line })
    s.area.applyOptions({ visible: line })
    // In the line look the gold MA20 is the average line; MA5 would only crowd it.
    s.ma5?.applyOptions({ visible: !line && !isPhone() })
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
    for (const x of [s.vol, s.volMa5, s.volMa10]) x?.applyOptions({ visible: vol && (x !== s.volMa5 || !isPhone()), priceFormat: vol ? VOL_FORMAT : COUNT_FORMAT })
    s.tcp?.applyOptions({ visible: !vol })
    s.udp?.applyOptions({ visible: !vol })
  }, [sub])

  useEffect(() => {
    const s = series.current
    if (!s?.tcp || !s.udp) return
    // On the candles' bucket grid: the connection history skips buckets without samples.
    const grid = slots.map((x) => x.time)
    const line = (k: 'tcp' | 'udp') => breakAtGaps(onGrid(grid, new Map((conn ?? []).map((c) => [c.time, c[k]]))), HIDE_LINE)
    s.tcp.setData(line('tcp'))
    s.udp.setData(line('udp'))
  }, [conn, slots])

  // The level, before the data below so the scale takes it in with them.
  const levelValue = level?.value ?? null
  const levelTitle = level?.title ?? ''
  useEffect(() => {
    const s = series.current
    if (!s) return
    levelAt.current = levelValue
    for (const [x, l] of levelLines.current) x.removePriceLine(l)
    levelLines.current =
      levelValue === null
        ? []
        : // Its name (8 核) beside its figure on the axis; the library draws the name only with the figure.
          [s.candle, s.area].map((x) => [x, x.createPriceLine({ price: levelValue, color: cssVar('--warn'), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: levelTitle })])
  }, [levelValue, levelTitle, palette])

  const overlayByTime = useMemo(() => new Map(overlay?.points.map((p) => [p.time, p.value])), [overlay])
  useEffect(() => {
    const s = series.current
    if (!s?.overlay) return
    overlayMax.current = overlay?.max || 1
    s.overlay.applyOptions({ visible: !!overlay, color: overlay ? cssVar(overlay.color) : 'transparent' })
    // On the candles' bucket grid, broken where a bucket has no sample.
    s.overlay.setData(overlay ? breakAtGaps(onGrid(slots.map((x) => x.time), overlayByTime), HIDE_LINE) : [])
  }, [overlay, overlayByTime, slots, palette])

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
    s.area.setData(breakAtGaps(slots.map((x) => (isCandle(x) ? { time: asTs(x.time), value: x.avg } : { time: asTs(x.time) })), HIDE_AREA))
    if (s.ma5 && s.ma20) {
      const conv = (arr: { time: number; value?: number }[]) => breakAtGaps(arr.map((p) => (p.value === undefined ? { time: asTs(p.time) } : { time: asTs(p.time), value: p.value })), HIDE_LINE)
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
      const grid = slots.map((x) => x.time)
      s.volMa5.setData(breakAtGaps(onGrid(grid, new Map(bars.map((b) => [b.time, b.ma5]))), HIDE_LINE))
      s.volMa10.setData(breakAtGaps(onGrid(grid, new Map(bars.map((b) => [b.time, b.ma10]))), HIDE_LINE))
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
    if (shared) showRange(c, shared, slots[0]?.time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, slots.length > 0])

  // Keyboard: ←/→ steps the crosshair across buckets (from the pinned one, if any); Enter pins the
  // bucket under it, or unpins it.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && cursor !== null && candles[cursor]) {
      e.preventDefault()
      togglePin(slots.map((x) => x.time), candles[cursor].time)
      return
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    if (!candles.length || !chart.current || !series.current) return
    e.preventDefault()
    const d = e.key === 'ArrowLeft' ? -1 : 1
    let i = candles.length - 1
    if (cursor !== null) i = Math.max(0, Math.min(candles.length - 1, cursor + d))
    else if (pinned) {
      // The first step leaves the pin for the sample beside it (either side of a pin on a gap).
      const ts = candles.map((c) => c.time)
      i = ts.indexOf(stepTime(ts, pinned.time, d) ?? (d < 0 ? ts[0] : ts[ts.length - 1]))
    }
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

  // The legend reads the hovered bucket, else the pinned one, else the latest. A bucket without
  // samples says so, instead of showing the latest candle.
  const read = hover ?? pinned
  // Marked as the pin's reading also when the crosshair rests on it (a tap on a phone puts both there).
  const onPin = pinned !== null && (hover === null || hover.time === pinned.time)
  const gap = read !== null && read.candle === null
  const shown = gap ? null : (read?.candle ?? candles[candles.length - 1] ?? null)
  const shownTime = read?.time ?? shown?.time
  const bar = shownTime !== undefined ? barByTime.get(shownTime) : undefined
  const cn = read ? connByTime.get(read.time) : lastConn
  const chg = shown ? shown.close - shown.open : 0
  const dir = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat'
  const ov = overlay && shownTime !== undefined ? overlayByTime.get(shownTime) : undefined
  const overlayRead = overlay && ov !== undefined && (
    <span className="lg-overlay">
      <i style={{ background: `var(${overlay.color})` }} />
      {overlay.label} <b>{overlay.format(ov)}</b>
    </span>
  )

  return (
    <div className={clsx('kline', offline && 'is-offline', loading && !candles.length && 'is-loading', stale && 'is-stale')}>
      <div className={clsx('kline-legend num', onPin && 'is-pinned')} aria-hidden="true" ref={legend}>
        {gap ? (
          <>
            <span className="lg-time">{crosshairLabel(read.time as Time)}</span>
            <span className="dim">{t('chart.noSamples')}</span>
          </>
        ) : shown && line ? (
          <>
            <span className="lg-time">{crosshairLabel(shown.time as Time)}</span>
            <span>
              {t('chart.avg')} <b>{format(shown.avg)}</b>
            </span>
            <span>
              {t('chart.high')} <b>{format(shown.high)}</b>
            </span>
            <span>
              {t('chart.low')} <b>{format(shown.low)}</b>
            </span>
            {overlayRead}
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
            <span className="lg-open">
              {t('chart.open')} <b className={dir}>{format(shown.open)}</b>
            </span>
            <span>
              {t('chart.high')} <b className={dir}>{format(shown.high)}</b>
            </span>
            <span>
              {t('chart.low')} <b className={dir}>{format(shown.low)}</b>
            </span>
            <span>
              {t('chart.close')} <b className={dir}>{format(shown.close)}</b>
            </span>
            {shown.open > 0 && (
              <span className="lg-chg">
                {t('chart.change')} <b className={dir}>{((chg / shown.open) * 100).toFixed(2)}%</b>
              </span>
            )}
            {overlayRead}
            {ma && (
              <span className="lg-ma">
                <i className="ma5" />
                MA5 <i className="ma20" />
                MA20
              </span>
            )}
          </>
        ) : (
          <span className="dim">{loading ? t('common.loading') : t('chart.noneInRange')}</span>
        )}
      </div>
      <div
        ref={host}
        className="kline-canvas"
        tabIndex={0}
        role="img"
        aria-label={line ? t('chart.lineLabel', { label }) : t('chart.candleLabel', { label })}
        onKeyDown={onKey}
        onBlur={onBlur}
        // Capture: these must be known before the chart handles the same event.
        onPointerDownCapture={gesture.onPointerDown}
        onPointerMoveCapture={gesture.onPointerMove}
        onWheel={gesture.onWheel}
        onPointerLeave={() => {
          gesture.onPointerLeave()
          releaseTime(id)
          // A lifted finger leaves the crosshair behind (a mouse takes it along): drop it, so the
          // legend goes back to the pin or the latest bucket.
          if (gesture.touch()) {
            chart.current?.clearCrosshairPosition()
            setHover(null)
          }
        }}
      />
      {volume && subTop !== null && candles.length > 0 && (
        <div className="kline-sublegend num" style={{ top: subTop }}>
          {onSub && (
            <RadioGroup.Root className="sub-switch" value={sub} onValueChange={(v) => onSub(v as SubPane)} orientation="horizontal" loop aria-label={t('chart.sub')}>
              <RadioGroup.Item value="vol">{t('chart.subVol')}</RadioGroup.Item>
              <RadioGroup.Item value="conn">{t('chart.subConn')}</RadioGroup.Item>
            </RadioGroup.Root>
          )}
          {sub === 'conn' ? (
            <span className="sub-read" aria-hidden="true">
              {cn && (cn.tcp !== null || cn.udp !== null) ? (
                <>
                  <span className="lg-tag">{t('panel.total')}</span>
                  <b>{Math.round((cn.tcp ?? 0) + (cn.udp ?? 0))}</b>
                  <span className="lg-tcp">
                    TCP <b>{cn.tcp === null ? '—' : Math.round(cn.tcp)}</b>
                  </span>
                  <span className="lg-udp">
                    UDP <b>{cn.udp === null ? '—' : Math.round(cn.udp)}</b>
                  </span>
                </>
              ) : (
                <span className="dim">{conn ? t('chart.noConn') : conn === null ? t('chart.connFailed') : t('common.loading')}</span>
              )}
            </span>
          ) : (
          <span className="sub-read" aria-hidden="true">
          <span className="lg-tag">{t('panel.total')}</span>
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
            <span className="dim">{t('chart.noTraffic')}</span>
          )}
          </span>
          )}
        </div>
      )}
      {loading && !candles.length && <div className="kline-skeleton skeleton" aria-hidden="true" />}
      {offline && <span className="kline-watermark">{t('chart.offline')}</span>}
    </div>
  )
}
