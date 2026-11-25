import type { HistoryKey, HistoryResult } from './api'
import { CPU_EVENT, HOT } from './thresholds'

export interface Candle {
  time: number // seconds (UTC)
  open: number
  high: number
  low: number
  close: number
  avg: number
}

/** A bucket on the time axis; `null` keeps the gap visible (缺测留空). */
export type Slot = Candle | { time: number; empty: true }

export const isCandle = (s: Slot): s is Candle => !('empty' in s)

/**
 * Builds OHLC buckets from the server's per-bucket aggregations:
 * high = max, low = min, close = last, open = previous close (clamped into
 * the bucket's range) or the bucket average after a gap.
 */
export function buildCandles(h: HistoryResult, key: HistoryKey, uuid: string, scale = 1): Slot[] {
  const id = `${key}|${uuid}`
  const max = h.agg.max.get(id)
  const min = h.agg.min.get(id)
  const last = h.agg.last.get(id)
  const avg = h.agg.avg.get(id)
  if (!avg) return []
  const step = h.interval * 1000
  const first = Math.floor(h.start / step) * step
  const out: Slot[] = []
  let prevClose: number | null = null
  for (let t = first; t <= h.end; t += step) {
    const a = avg.get(t)
    if (a === undefined) {
      out.push({ time: t / 1000, empty: true })
      prevClose = null
      continue
    }
    const hi = (max?.get(t) ?? a) / scale
    const lo = (min?.get(t) ?? a) / scale
    const close = (last?.get(t) ?? a) / scale
    const open = Math.min(hi, Math.max(lo, prevClose ?? a / scale))
    out.push({ time: t / 1000, open, high: Math.max(hi, open, close), low: Math.min(lo, open, close), close, avg: a / scale })
    prevClose = close
  }
  // Trim leading gaps so the chart starts at the first real sample.
  const firstReal = out.findIndex(isCandle)
  return firstReal < 0 ? [] : out.slice(firstReal)
}

export interface Volume {
  time: number
  up: number
  down: number
}

export function buildVolume(h: HistoryResult, uuid: string): Volume[] {
  const up = h.agg.avg.get(`net.out.rate|${uuid}`)
  const down = h.agg.avg.get(`net.in.rate|${uuid}`)
  const times = new Set([...(up?.keys() ?? []), ...(down?.keys() ?? [])])
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => ({ time: t / 1000, up: up?.get(t) ?? 0, down: down?.get(t) ?? 0 }))
}

/** One bar of the VOL pane: total throughput, its split, and the direction of the CPU candle above. */
export interface VolBar extends Volume {
  total: number
  dir: 'up' | 'down' | 'flat'
  ma5?: number
  ma10?: number
}

/**
 * The traffic pane drawn like a stock chart's volume: bars of up + down, each taking the direction
 * of the candle in the same bucket (as volume follows price there), with 5- and 10-bucket averages.
 */
export function volumeBars(volume: Volume[], candles: Candle[], line = false): VolBar[] {
  const byTime = new Map(candles.map((c) => [c.time, c]))
  const prevAvg = new Map(candles.map((c, i) => [c.time, i > 0 ? candles[i - 1].avg : null]))
  const totals: number[] = []
  const avg = (n: number) => (totals.length >= n ? totals.slice(-n).reduce((a, b) => a + b, 0) / n : undefined)
  // As candles: the candle's own rise or fall. As a line (分时): the average against the bucket
  // before, as a stock's intraday volume follows the price tick.
  const direction = (c: Candle | undefined): VolBar['dir'] => {
    if (!c) return 'flat'
    const from = line ? prevAvg.get(c.time) : c.open
    const to = line ? c.avg : c.close
    return from === null || from === undefined || to === from ? 'flat' : to > from ? 'up' : 'down'
  }
  // The averages start over after a gap, like the price MAs: a bucket hours apart is no neighbor.
  const step = Math.min(...volume.slice(1).map((v, i) => v.time - volume[i].time))
  return volume.map((v, i) => {
    if (i > 0 && v.time - volume[i - 1].time > step * 1.5) totals.length = 0
    const total = v.up + v.down
    totals.push(total)
    return { ...v, total, dir: direction(byTime.get(v.time)), ma5: avg(5), ma10: avg(10) }
  })
}

export function movingAverage(slots: Slot[], n: number) {
  const out: { time: number; value?: number }[] = []
  const win: number[] = []
  for (const s of slots) {
    if (!isCandle(s)) {
      win.length = 0
      out.push({ time: s.time })
      continue
    }
    win.push(s.close)
    if (win.length > n) win.shift()
    out.push(win.length === n ? { time: s.time, value: win.reduce((a, b) => a + b, 0) / n } : { time: s.time })
  }
  return out
}

export interface RangeStats {
  low: number
  high: number
  avg: number
  p95: number
  open: number
  close: number
  change: number
  changePct: number | null
  coverage: number
}

export function rangeStats(slots: Slot[]): RangeStats | null {
  const candles = slots.filter(isCandle)
  if (!candles.length) return null
  const avgs = candles.map((c) => c.avg).sort((a, b) => a - b)
  const open = candles[0].open
  const close = candles[candles.length - 1].close
  return {
    low: Math.min(...candles.map((c) => c.low)),
    high: Math.max(...candles.map((c) => c.high)),
    avg: avgs.reduce((a, b) => a + b, 0) / avgs.length,
    // nearest-rank P95 over bucket averages
    p95: avgs[Math.max(0, Math.ceil(avgs.length * 0.95) - 1)],
    open,
    close,
    change: close - open,
    changePct: open > 0 ? ((close - open) / open) * 100 : null,
    coverage: candles.length / slots.length,
  }
}

/** An event inferred from the samples; the events panel puts it into words. */
export type NodeEvent = { time: number /* ms */ } & (
  /** `value`: the closing CPU percent, or memory's peak percent. */
  | { kind: 'rise' | 'fall' | 'high-mem'; value: number }
  /** A run of empty buckets inside the range. */
  | { kind: 'gap'; buckets: number; minutes: number }
  /** No live samples since the last report. */
  | { kind: 'offline' }
)

/** Events inferred from samples (not alerts): sustained high CPU, its recovery, memory reaching HOT.ram, report gaps. */
export function inferEvents(cpu: Slot[], mem: Slot[], memTotalGiB: number | null, online: boolean, lastSeen: number | null): NodeEvent[] {
  const events: NodeEvent[] = []
  let run = 0
  let hot = false
  let cool = 0
  for (const s of cpu) {
    if (!isCandle(s)) {
      run = 0
      cool = 0
      continue
    }
    if (s.close >= CPU_EVENT.rise) {
      run++
      cool = 0
      if (run === 3 && !hot) {
        hot = true
        events.push({ time: s.time * 1000, kind: 'rise', value: s.close })
      }
    } else {
      run = 0
      if (hot && s.close < CPU_EVENT.fall) {
        cool++
        if (cool === 2) {
          hot = false
          events.push({ time: s.time * 1000, kind: 'fall', value: s.close })
        }
      }
    }
  }
  if (memTotalGiB) {
    const peak = mem.filter(isCandle).find((s) => (s.high / memTotalGiB) * 100 >= HOT.ram)
    if (peak) events.push({ time: peak.time * 1000, kind: 'high-mem', value: (peak.high / memTotalGiB) * 100 })
  }
  // One event per run of empty buckets; a run reaching the end of the range is the offline case below.
  for (let i = 1; i < cpu.length; i++) {
    if (isCandle(cpu[i]) || !isCandle(cpu[i - 1])) continue
    let j = i
    while (j < cpu.length && !isCandle(cpu[j])) j++
    if (j === cpu.length) break
    const minutes = Math.max(1, Math.round((cpu[j].time - cpu[i].time) / 60))
    events.push({ time: cpu[i].time * 1000, kind: 'gap', buckets: j - i, minutes })
    i = j
  }
  if (!online) events.push({ time: lastSeen ?? Date.now(), kind: 'offline' })
  return events.sort((a, b) => b.time - a.time).slice(0, 8)
}
