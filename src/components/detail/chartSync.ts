import { create } from 'zustand'

/**
 * What the detail charts share: the hovered time and the zoomed time window, in seconds. Each chart
 * publishes what the user does on it (tagged with its id) and follows what the others publish.
 * Moving a crosshair or a window from code fires no chart event, so following never echoes back.
 */
interface ChartSync {
  time: number | null
  timeFrom: string | null
  /** `key` names the data the window was chosen on (node and range); other data ignores it. */
  range: SharedRange | null
  rangeFrom: string | null
  /** The time the user pinned with a click: one for every chart, kept until cleared or new data. */
  pin: number | null
}
export interface SharedRange {
  from: number
  to: number
  key: string
}

export const useChartSync = create<ChartSync>(() => ({ time: null, timeFrom: null, range: null, rangeFrom: null, pin: null }))

export const shareTime = (from: string, time: number | null) => {
  if (useChartSync.getState().time !== time) useChartSync.setState({ time, timeFrom: from })
}
/** Clears the shared time, if this chart is the one that set it. */
export const releaseTime = (from: string) => {
  if (useChartSync.getState().timeFrom === from) shareTime(from, null)
}
export const shareRange = (from: string, range: SharedRange) => useChartSync.setState({ range, rangeFrom: from })
/** The window another chart chose on the same data, to apply on top of this chart's own fit. */
export const sharedRangeFor = (id: string, key: string) => {
  const { range, rangeFrom } = useChartSync.getState()
  return range && rangeFrom !== id && range.key === key ? range : null
}
export const resetSync = () => useChartSync.setState({ time: null, timeFrom: null, range: null, rangeFrom: null, pin: null })
export const setPin = (pin: number | null) => useChartSync.setState({ pin })
/** A click on the bucket of `t` (in a chart's `times`): pins it, or unpins it when it is the pinned one. */
export const togglePin = (times: number[], t: number) => {
  const pin = useChartSync.getState().pin
  const at = bucketAt(times, t)
  setPin(pin !== null && at >= 0 && bucketAt(times, pin) === at ? null : t)
}

/**
 * The next of the ascending `times` after `from` (`d` 1), or before it (`d` -1); null past either
 * end. `from` need not be one of them: from a time between two, each way goes to its neighbour.
 */
export function stepTime(times: number[], from: number, d: 1 | -1) {
  const j = lastAtOrBefore(times, from)
  const i = d > 0 ? j + 1 : times[j] === from ? j - 1 : j
  return i >= 0 && i < times.length ? times[i] : null
}

/**
 * Index of the bucket of the ascending, evenly spaced `times` that holds `t`; -1 when `t` is outside
 * them (charts can cover different spans: ping keeps less history, a node may report late).
 */
export function bucketAt(times: number[], t: number) {
  const i = lastAtOrBefore(times, t)
  const step = times.length > 1 ? times[1] - times[0] : 0
  return i >= 0 && (t === times[i] || t - times[i] < step) ? i : -1
}

function lastAtOrBefore(times: number[], t: number) {
  let lo = 0
  let hi = times.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (times[mid] <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/**
 * What the user is doing over a chart, for the handlers on its host element. `active`: a drag,
 * wheel or pinch is changing the window (the chart's own fitting is not shared). `pointed`: the
 * pointer has moved or pressed since it entered; a chart that slides in under a resting mouse
 * reports a crosshair from the enter alone, which nobody pointed at. `touch`: the last press was a
 * finger, which leaves the chart's crosshair behind when it lifts (a mouse takes it along).
 */
export function userGesture() {
  let pressed = false
  let moved = false
  let touch = false
  let wheelUntil = 0
  const release = () => {
    pressed = false
  }
  return {
    active: () => pressed || performance.now() < wheelUntil,
    pointed: () => moved,
    touch: () => touch,
    onPointerMove: () => {
      moved = true
    },
    onPointerLeave: () => {
      moved = false
    },
    onPointerDown: (e: { pointerType: string }) => {
      moved = true
      pressed = true
      touch = e.pointerType === 'touch'
      window.addEventListener('pointerup', release, { once: true })
      window.addEventListener('pointercancel', release, { once: true })
    },
    onWheel: () => {
      wheelUntil = performance.now() + 300
    },
  }
}
