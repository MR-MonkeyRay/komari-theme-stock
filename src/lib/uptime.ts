/**
 * Daily availability over up to 30 days, inferred from how many samples a node reported.
 *
 * Komari keeps no history of online and offline; like Komari itself, the theme counts a node as
 * offline whenever it does not report. Each `queryMetrics` bucket carries its sample count, so a
 * bucket short of the node's usual count had that much time without reports, and a missing bucket
 * had none at all.
 */

/** The most days the strip shows. */
export const UPTIME_DAYS = 30

/** A bucket within 5% of the node's usual count is a full one: counts jitter by about 1% from
 * hour to hour, while a gap of three minutes already takes 5% of an hour. */
const FULL = 0.95

/** The usual count is the median of the full buckets within a day either side, so a change of the
 * agent's report interval shifts it within a day instead of reading as weeks of downtime. */
const BASELINE_REACH = 86_400_000

export type UptimeLevel = 'ok' | 'brief' | 'partial' | 'severe'

/** Lowest share of the day online for each level; below `partial` is severe. In minutes off a
 * whole day: under 3, under 29, under 2.4 hours. */
export const UPTIME_LEVELS: [Exclude<UptimeLevel, 'severe'>, number][] = [
  ['ok', 0.998],
  ['brief', 0.98],
  ['partial', 0.9],
]

export function uptimeLevel(ratio: number): UptimeLevel {
  return UPTIME_LEVELS.find(([, min]) => ratio >= min)?.[0] ?? 'severe'
}

/** A bucket of `queryMetrics`: its start (ms) and how many samples it holds. */
export interface CountBucket {
  time: number
  count: number
}

/** What the server answered, as `useUptime` caches it. */
export interface UptimeSource {
  /** Where counting starts (ms): when the node was added, 30 days back, or where Komari's data starts. */
  from: number
  /** Up to when the answer covers (ms). */
  asOf: number
  /** Bucket length in seconds. */
  step: number
  buckets: CountBucket[]
}

export interface UptimeDay {
  /** Local midnight (ms). */
  day: number
  /** Seconds counted: from the start of counting or of the day, to the day's end or to now. */
  tracked: number
  /** Seconds with reports. */
  online: number
  ratio: number
  level: UptimeLevel
  /** Buckets (ms windows, adjacent ones merged) that hold the time without reports. */
  gaps: [number, number][]
}

export interface Uptime {
  days: UptimeDay[]
  /** Share online over every day shown. */
  ratio: number
  level: UptimeLevel
}

/** Local midnight before `ms`. */
export function dayStart(ms: number) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight that opens the 30-day window ending today. */
export function uptimeWindowStart(now: number) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (UPTIME_DAYS - 1))
  return d.getTime()
}

function median(sorted: number[]) {
  const m = sorted.length >> 1
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2
}

/**
 * Per local day, how much of the counted time had reports. The bucket that holds `asOf` is still
 * filling, so it follows the node's live state: online is a full bucket, offline counts up to the
 * last report.
 */
export function buildUptime(src: UptimeSource, live: { online: boolean; lastSeen: number | null }): Uptime | null {
  const { from, asOf } = src
  const stepMs = src.step * 1000
  if (!(asOf > from) || !(stepMs > 0)) return null
  // Keyed by the bucket grid this loop walks, whatever offset the server's times carry.
  const counts = new Map<number, number>()
  for (const b of src.buckets) {
    const t = Math.floor(b.time / stepMs) * stepMs
    counts.set(t, (counts.get(t) ?? 0) + b.count)
  }
  const first = Math.floor(from / stepMs) * stepMs

  // Buckets wholly inside the counted time, for the usual count.
  const full = [...counts]
    .filter(([t, c]) => c > 0 && t >= from && t + stepMs <= asOf)
    .map(([time, count]) => ({ time, count }))
    .sort((a, b) => a.time - b.time)
  let lo = 0
  let hi = 0
  const usual = (t: number) => {
    while (lo < full.length && full[lo].time < t - BASELINE_REACH) lo++
    while (hi < full.length && full[hi].time <= t + BASELINE_REACH) hi++
    return hi > lo ? median(full.slice(lo, hi).map((b) => b.count).sort((a, b) => a - b)) : null
  }

  const days: UptimeDay[] = []
  for (let t = first; t < asOf; t += stepMs) {
    const s = Math.max(t, from)
    const e = Math.min(t + stepMs, asOf)
    if (e <= s) continue
    const tracked = (e - s) / 1000
    let online: number
    let gapFrom = s
    if (t + stepMs > asOf) {
      const reach = live.online ? e : Math.min(e, live.lastSeen ?? s)
      online = Math.max(0, reach - s) / 1000
      gapFrom = Math.max(s, reach)
    } else {
      const c = counts.get(t) ?? 0
      const base = usual(t)
      const share = c === 0 ? 0 : base === null ? 1 : c / ((base * tracked) / src.step)
      online = share >= FULL ? tracked : tracked * share
    }
    const key = dayStart(s)
    let day = days[days.length - 1]
    if (!day || day.day !== key) days.push((day = { day: key, tracked: 0, online: 0, ratio: 1, level: 'ok', gaps: [] }))
    day.tracked += tracked
    day.online += online
    if (tracked - online >= 1) {
      const last = day.gaps[day.gaps.length - 1]
      if (last && last[1] === gapFrom) last[1] = e
      else day.gaps.push([gapFrom, e])
    }
  }

  let tracked = 0
  let online = 0
  for (const d of days) {
    d.ratio = d.online / d.tracked
    d.level = uptimeLevel(d.ratio)
    tracked += d.tracked
    online += d.online
  }
  if (!tracked) return null
  const ratio = online / tracked
  return { days: days.slice(-UPTIME_DAYS), ratio, level: uptimeLevel(ratio) }
}
