import clsx from 'clsx'
import { CandlestickSeries, createChart, HistogramSeries, LineSeries, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type Time } from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cssVar, usePaletteVersion } from '../../lib/appearance'
import { isCandle, movingAverage, type Candle, type Slot, type Volume } from '../../lib/candles'
import { size } from '../../lib/format'
import { asTs, baseChartOptions, chartPalette, crosshairLabel } from './chartBase'

export interface KLineProps {
  slots: Slot[]
  volume?: Volume[]
  /** axis/legend formatter for candle values */
  format: (v: number) => string
  /** clamp autoscale to [0, 100] for percentages */
  percent?: boolean
  ma?: boolean
  loading?: boolean
  offline?: boolean
  label: string
  rangeKey: string
}

interface Hover {
  candle: Candle | null
  time: number
  volume?: Volume
}

export default function KLineChart({ slots, volume, format, percent, ma, loading, offline, label, rangeKey }: KLineProps) {
  const host = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<{
    candle: ISeriesApi<'Candlestick'>
    ma5?: ISeriesApi<'Line'>
    ma20?: ISeriesApi<'Line'>
    up?: ISeriesApi<'Histogram'>
    down?: ISeriesApi<'Histogram'>
  } | null>(null)
  const lastLine = useRef<IPriceLine | null>(null)
  const palette = usePaletteVersion()
  const [hover, setHover] = useState<Hover | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const fmt = useRef(format)
  useEffect(() => {
    fmt.current = format
  }, [format])

  const candles = useMemo(() => slots.filter(isCandle), [slots])
  const volByTime = useMemo(() => new Map(volume?.map((v) => [v.time, v])), [volume])

  // Create once; series are added according to the props that never change per instance.
  useEffect(() => {
    if (!host.current) return
    const c = createChart(host.current, baseChartOptions())
    // Per-series formatters: the chart-wide localization formatter would also hit the volume pane.
    const valueFormat = { type: 'custom' as const, formatter: (v: number) => fmt.current(v), minMove: 0.01 }
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
    const s: NonNullable<typeof series.current> = { candle }
    if (ma) {
      const line = { lineWidth: 1 as const, priceFormat: valueFormat, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }
      // MA5 turns into noise on phone-width charts; keep MA20 there.
      s.ma5 = c.addSeries(LineSeries, { ...line, visible: !window.matchMedia('(max-width: 640px)').matches })
      s.ma20 = c.addSeries(LineSeries, line)
    }
    if (volume) {
      // Mirrored volume: upload above zero, download below.
      const volFormat = (v: number) => (v > 0 ? '↑' + size(v, true) : v < 0 ? '↓' + size(-v, true) : '0')
      const opts = { priceFormat: { type: 'custom' as const, formatter: volFormat, minMove: 1 }, priceLineVisible: false, lastValueVisible: false }
      s.up = c.addSeries(HistogramSeries, opts, 1)
      s.down = c.addSeries(HistogramSeries, opts, 1)
      s.up.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } })
      c.panes()[0].setStretchFactor(0.8)
      c.panes()[1].setStretchFactor(0.2)
    }
    if (!volume) c.applyOptions({ rightPriceScale: { scaleMargins: { top: 0.14, bottom: 0.12 } } })
    chart.current = c
    series.current = s

    const onMove = (p: MouseEventParams) => {
      if (p.time === undefined) {
        setHover(null)
        return
      }
      const t = p.time as number
      const bar = p.seriesData.get(candle) as Candle | undefined
      setHover({ time: t, candle: bar && 'open' in bar ? bar : null })
    }
    c.subscribeCrosshairMove(onMove)
    return () => {
      c.unsubscribeCrosshairMove(onMove)
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
    s.ma5?.applyOptions({ color: cssVar('--ma5') })
    s.ma20?.applyOptions({ color: cssVar('--ma20') })
    s.up?.applyOptions({ color: cssVar('--net-up-bar') })
    s.down?.applyOptions({ color: cssVar('--net-down-bar') })
  }, [palette])

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
    if (s.ma5 && s.ma20) {
      const conv = (arr: { time: number; value?: number }[]) => arr.map((p) => (p.value === undefined ? { time: asTs(p.time) } : { time: asTs(p.time), value: p.value }))
      s.ma5.setData(conv(movingAverage(slots, 5)))
      s.ma20.setData(conv(movingAverage(slots, 20)))
    }
    if (s.up && s.down && volume) {
      s.up.setData(volume.map((v) => ({ time: asTs(v.time), value: v.up })))
      s.down.setData(volume.map((v) => ({ time: asTs(v.time), value: -v.down })))
    }
  }, [slots, candles, volume, palette])

  // Fit when the range changes (not on every refresh, so a zoomed view stays put).
  useEffect(() => {
    const c = chart.current
    if (!c || !slots.length) return
    // On phones, charts open on the latest ~48 buckets so candle bodies stay readable. This keys off
    // the viewport, not the chart width: the narrower side-by-side desktop charts keep the full range.
    if (window.matchMedia('(max-width: 640px)').matches && slots.length > 48) c.timeScale().setVisibleLogicalRange({ from: slots.length - 48, to: slots.length + 1 })
    else c.timeScale().fitContent()
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
    chart.current.setCrosshairPosition(c.close, asTs(c.time), series.current.candle)
  }
  const onBlur = () => {
    setCursor(null)
    chart.current?.clearCrosshairPosition()
  }

  const shown = hover?.candle ?? candles[candles.length - 1] ?? null
  const shownTime = hover?.time ?? shown?.time
  const vol = shownTime !== undefined ? volByTime.get(shownTime) : undefined
  const chg = shown ? shown.close - shown.open : 0
  const dir = chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat'

  return (
    <div className={clsx('kline', offline && 'is-offline', loading && !candles.length && 'is-loading')}>
      <div className="kline-legend num" aria-hidden="true">
        {shown ? (
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
            {vol && (
              <span className="lg-vol">
                <b className="net-up">↑{size(vol.up, true)}</b> <b className="net-down">↓{size(vol.down, true)}</b>
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
        aria-label={`${label} K 线图，空心为区间上升、实心为区间下降；按左右方向键逐个查看区间`}
        onKeyDown={onKey}
        onBlur={onBlur}
      />
      {loading && !candles.length && <div className="kline-skeleton skeleton" aria-hidden="true" />}
      {offline && <span className="kline-watermark">离线 · 历史快照</span>}
    </div>
  )
}
