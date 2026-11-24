import { useEffect, useState } from 'react'
import type { SparkSet, Trail } from './api'
import { finite, parseTime, ratio } from './format'
import { regionInfo, type RegionInfo } from './region'
import type { NodeInfo, NodeStatus } from './types'

export interface Row {
  node: NodeInfo
  status: NodeStatus | undefined
  online: boolean
  region: RegionInfo
  /** Ticker-like code: continent · country · uuid head, e.g. EU·DE·7C74 */
  code: { area: string; hash: string }
  cpu: number | null
  ram: number | null
  disk: number | null
  lastSeen: number | null
}

export function buildRows(nodes: NodeInfo[] | undefined, statuses: Record<string, NodeStatus> | undefined): Row[] {
  if (!nodes) return []
  return nodes.map((node) => {
    const status = statuses?.[node.uuid]
    const online = status?.online === true
    const region = regionInfo(node.region)
    const live = online ? status : undefined
    return {
      node,
      status,
      online,
      region,
      code: {
        area: [region.continent === 'OT' ? '--' : region.continent, region.code ?? '--'].join('·'),
        hash: node.uuid.replace(/-/g, '').slice(0, 4).toUpperCase(),
      },
      cpu: finite(live?.cpu) ? live!.cpu : null,
      ram: live ? ratio(live.ram, live.ram_total || node.mem_total) : null,
      disk: live ? ratio(live.disk, live.disk_total || node.disk_total) : null,
      lastSeen: parseTime(status?.time),
    }
  })
}

export type BoardMetric = 'cpu' | 'ram' | 'disk'
export type Dir = 'up' | 'down' | 'flat'

export interface MetricTrail {
  /** Percent samples for the last hour, ending at the live value when online. */
  points: Trail
  /** Fixed time axis [now − 1h, now], so a node that went quiet shows where its line stopped. */
  window: [number, number]
  /** Mean of the stored samples: the dashed reference line. */
  avg: number | null
  /** Live value minus the 1h mean, in percentage points. */
  delta: number | null
  dir: Dir | null
}

const HOUR = 3600_000

/** Moves smaller than `threshold` percentage points read as flat. */
export function dirOf(delta: number | null | undefined, threshold = 0.5): Dir | null {
  return finite(delta) ? (delta >= threshold ? 'up' : delta <= -threshold ? 'down' : 'flat') : null
}

/** Per-metric noise floor: memory and disk drift slowly, so small moves are not called out. */
const FLAT_BELOW: Record<BoardMetric, number> = { cpu: 0.5, ram: 0.8, disk: 1 }

/** 1h trail for one board metric, in percent, with the live value appended and Δ against the 1h mean. */
export function metricTrail(r: Row, set: SparkSet | undefined, key: BoardMetric, now: number): MetricTrail {
  const window: [number, number] = [now - HOUR, now]
  const empty: MetricTrail = { points: [], window, avg: null, delta: null, dir: null }
  if (!set) return empty
  const raw = (key === 'cpu' ? set.cpu : key === 'ram' ? set.mem : set.disk).filter((p) => p.t >= window[0] - 60_000)
  const total = key === 'cpu' ? 100 : key === 'ram' ? r.status?.ram_total || r.node.mem_total : r.status?.disk_total || r.node.disk_total
  if (!total || raw.length < 2) return empty
  const base = key === 'cpu' ? raw : raw.map((p) => ({ t: p.t, v: Math.min(100, (p.v / total) * 100) }))
  const avg = base.reduce((a, p) => a + p.v, 0) / base.length
  const live = r[key]
  const last = base[base.length - 1]
  const points = finite(live) && r.lastSeen !== null && r.lastSeen > last.t ? [...base, { t: r.lastSeen, v: live }] : base
  const delta = finite(live) && base.length >= 4 ? live - avg : null
  return { points, window, avg, delta, dir: dirOf(delta, FLAT_BELOW[key]) }
}

/** Re-renders every `ms` milliseconds; used for clocks and "x s ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}
