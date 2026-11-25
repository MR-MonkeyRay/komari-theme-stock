import type { IChartApi, IPanePrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, ISeriesPrimitiveAxisView, PaneAttachedParameter, SeriesAttachedParameter, Time } from 'lightweight-charts'
import { cssVar } from '../../lib/appearance'
import { crosshairLabel } from './chartBase'

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0]

/**
 * The pinned time on a chart, drawn apart from the crosshair (dashed, grey, both ways): a solid
 * accent line, vertical only. Built on the library's primitives, in two kinds:
 * - `line`, attached to a pane (`chart.panes()[i].attachPrimitive`): the line down that pane, with a
 *   small marker at the top when `marker` is set. A pane draws it whichever series it shows.
 * - `label`, attached to any one series: the time on the time axis (axis labels of hidden series
 *   are drawn too, under the crosshair's own label).
 * The chart sets the time in its own buckets (seconds), or null for no pin.
 */
export class PinMark implements IPanePrimitive<Time>, ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private request: (() => void) | null = null
  private time: number | null = null
  private x: number | null = null
  private color = '#888'
  private text = '#fff'
  private readonly kind: 'line' | 'label'
  private readonly marker: boolean

  constructor(kind: 'line' | 'label', marker = false) {
    this.kind = kind
    this.marker = marker
    this.palette()
  }

  attached({ chart, requestUpdate }: PaneAttachedParameter<Time> | SeriesAttachedParameter<Time>) {
    this.chart = chart as IChartApi
    this.request = requestUpdate
  }

  detached() {
    this.chart = null
    this.request = null
  }

  set(time: number | null) {
    if (time === this.time) return
    this.time = time
    this.request?.()
  }

  /** Colors from the theme; call again when it changes. */
  palette() {
    this.color = cssVar('--chart-pin')
    this.text = cssVar('--chart-pin-text')
    this.request?.()
  }

  updateAllViews() {
    // A time scrolled out of view has a coordinate off the chart, and the library would hold its
    // axis label at the edge: none then.
    const ts = this.chart?.timeScale()
    const x = this.time === null || !ts ? null : ts.timeToCoordinate(this.time as Time)
    this.x = x !== null && ts && x >= 0 && x <= ts.width() ? x : null
  }

  private readonly pane: IPrimitivePaneView = {
    zOrder: () => 'top',
    renderer: () => ({
      draw: (target: DrawTarget) => {
        const x = this.x
        if (x === null) return
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
          const cx = Math.round(x * hr)
          const w = Math.max(1, Math.round(1.5 * hr))
          ctx.save()
          ctx.fillStyle = this.color
          // A little lighter than the marker, so the candles under it still read.
          ctx.globalAlpha = 0.85
          ctx.fillRect(cx - Math.floor(w / 2), 0, w, bitmapSize.height)
          if (this.marker) {
            const s = Math.round(4 * hr)
            ctx.globalAlpha = 1
            ctx.beginPath()
            ctx.moveTo(cx - s, 0)
            ctx.lineTo(cx + s, 0)
            ctx.lineTo(cx, Math.round(5 * vr))
            ctx.closePath()
            ctx.fill()
          }
          ctx.restore()
        })
      },
    }),
  }

  private readonly label: ISeriesPrimitiveAxisView = {
    coordinate: () => this.x ?? -1000,
    text: () => (this.time === null ? '' : crosshairLabel(this.time as Time)),
    textColor: () => this.text,
    backColor: () => this.color,
    visible: () => this.x !== null,
    tickVisible: () => false,
  }

  paneViews() {
    return this.kind === 'line' ? [this.pane] : []
  }

  timeAxisViews() {
    return this.kind === 'label' ? [this.label] : []
  }
}
