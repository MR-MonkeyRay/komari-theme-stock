import { useEffect, useState } from 'react'
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

export function median(values: number[]) {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
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
