import { ColorType, CrosshairMode, LineStyle, TickMarkType, type ChartOptions, type DeepPartial, type Time, type UTCTimestamp } from 'lightweight-charts'
import { cssVar } from '../../lib/appearance'

// Shared by the detail charts (K line and ping) so they read and behave as one set.

const two = (n: number) => String(n).padStart(2, '0')
export const asTs = (t: number) => t as UTCTimestamp

export function localLabel(time: Time, type?: TickMarkType) {
  const d = new Date((time as number) * 1000)
  if (type === TickMarkType.Year) return String(d.getFullYear())
  if (type === TickMarkType.Month || type === TickMarkType.DayOfMonth) return `${d.getMonth() + 1}/${d.getDate()}`
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

export function crosshairLabel(time: Time) {
  const d = new Date((time as number) * 1000)
  return `${d.getMonth() + 1}/${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Options every detail chart is created with; colors come from `chartPalette`. */
export function baseChartOptions(): DeepPartial<ChartOptions> {
  return {
    autoSize: true,
    layout: { attributionLogo: false, fontFamily: cssVar('--font-mono'), fontSize: 11, panes: { enableResize: false } },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { minimumWidth: 68, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true, tickMarkFormatter: localLabel },
    localization: { timeFormatter: crosshairLabel },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: false },
  }
}

/** Theme colors for the chart frame; re-applied when the theme changes. */
export function chartPalette(): DeepPartial<ChartOptions> {
  return {
    layout: { background: { type: ColorType.Solid, color: cssVar('--bg-chart') }, textColor: cssVar('--chart-axis'), panes: { separatorColor: cssVar('--chart-grid-strong'), separatorHoverColor: cssVar('--chart-grid-strong') } },
    grid: { vertLines: { color: cssVar('--chart-grid') }, horzLines: { color: cssVar('--chart-grid') } },
    crosshair: {
      vertLine: { color: cssVar('--chart-cross'), labelBackgroundColor: cssVar('--chart-cross-bg'), style: LineStyle.Dashed, width: 1 },
      horzLine: { color: cssVar('--chart-cross'), labelBackgroundColor: cssVar('--chart-cross-bg'), style: LineStyle.Dashed, width: 1 },
    },
    rightPriceScale: { borderColor: cssVar('--chart-grid-strong') },
    timeScale: { borderColor: cssVar('--chart-grid-strong') },
  }
}
