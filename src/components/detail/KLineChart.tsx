import clsx from 'clsx'
import {
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cssVar, usePaletteVersion } from '../../lib/appearance'
import { isCandle, movingAverage, type Candle, type Slot, type Volume } from '../../lib/candles'
import { size } from '../../lib/format'

const two = (n: number) => String(n).padStart(2, '0')
const asTs = (t: number) => t as UTCTimestamp

function localLabel(time: Time, type?: TickMarkType) {
  const d = new Date((time as number) * 1000)
  if (type === TickMarkType.Year) return String(d.getFullYear())
  if (type === TickMarkType.Month || type === TickMarkType.DayOfMonth) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

function crosshairLabel(time: Time) {
  const d = new Date((time as number) * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`
}

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
    const c = createChart(host.current, {
      autoSize: true,
      layout: { attributionLogo: false, fontFamily: cssVar('--font-mono'), fontSize: 11, panes: { enableResize: false } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { minimumWidth: 64, scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true, tickMarkFormatter: localLabel },
      localization: { timeFormatter: crosshairLabel },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false },
    })
    // Per-series formatters: the chart-wide localization formatter would also hit the volume pane.
    const valueFormat = { type: 'custom' as const, formatter: (v: number) => fmt.current(v), minMove: 0.01 }
    const candle = c.addSeries(CandlestickSeries, {
      priceFormat: valueFormat,
      priceLineStyle: LineStyle.Dotted,
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
      const opts = { priceFormat: { type: 'custom' as const, formatter: (v: number) => size(Math.abs(v), true), minMove: 1 }, priceLineVisible: false, lastValueVisible: false }
      s.up = c.addSeries(HistogramSeries, opts, 1)
      s.down = c.addSeries(HistogramSeries, opts, 1)
      c.panes()[0].setStretchFactor(0.76)
      c.panes()[1].setStretchFactor(0.24)
    }
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
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: cssVar('--bg-chart') }, textColor: cssVar('--chart-axis'), panes: { separatorColor: cssVar('--chart-grid-strong'), separatorHoverColor: cssVar('--chart-grid-strong') } },
      grid: { vertLines: { color: cssVar('--chart-grid') }, horzLines: { color: cssVar('--chart-grid') } },
      crosshair: {
        vertLine: { color: cssVar('--chart-cross'), labelBackgroundColor: cssVar('--chart-cross-bg'), style: LineStyle.Dashed, width: 1 },
        horzLine: { color: cssVar('--chart-cross'), labelBackgroundColor: cssVar('--chart-cross-bg'), style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: { borderColor: cssVar('--chart-grid-strong') },
      timeScale: { borderColor: cssVar('--chart-grid-strong') },
    })
    // Rising candles are hollow (outline only), falling candles are solid.
    s.candle.applyOptions({ upColor: 'rgba(0,0,0,0)', borderUpColor: up, wickUpColor: up, downColor: down, borderDownColor: down, wickDownColor: down })
    s.ma5?.applyOptions({ color: cssVar('--ma5') })
    s.ma20?.applyOptions({ color: cssVar('--ma20') })
    s.up?.applyOptions({ color: cssVar('--net-up-bar') })
    s.down?.applyOptions({ color: cssVar('--net-down-bar') })
  }, [palette])

  // Data.
  useEffect(() => {
    const s = series.current
    if (!s) return
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
  }, [slots, volume])

  // Fit when the range changes (not on every refresh, so a zoomed view stays put).
  useEffect(() => {
    if (slots.length) chart.current?.timeScale().fitContent()
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
