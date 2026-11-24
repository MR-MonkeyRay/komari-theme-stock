import { finite } from './format'
import type { Row } from './model'
import { ALERT, HOT } from './thresholds'

export interface MarketSummary {
  total: number
  online: number
  offline: number
  hot: number | null
  memRatio: number | null
  up: number
  down: number
  traffic: { up: number; down: number; monthly: boolean } | null
}

/** High load (高负载): an online node whose CPU or memory reached HOT. */
export const isHot = (r: Row) => r.online && ((r.cpu ?? 0) >= HOT.cpu || (r.ram ?? 0) >= HOT.ram)

export function summarize(rows: Row[], traffic: MarketSummary['traffic']): MarketSummary {
  const live = rows.filter((r) => r.online && r.status)
  let hot: number | null = null
  for (const r of live) {
    if (!finite(r.cpu) && !finite(r.ram)) continue
    hot ??= 0
    if (isHot(r)) hot++
  }
  const memUsed = live.reduce((a, r) => a + (r.status!.ram ?? 0), 0)
  const memTotal = live.reduce((a, r) => a + (r.status!.ram_total || r.node.mem_total || 0), 0)
  return {
    total: rows.length,
    online: live.length,
    offline: rows.length - live.length,
    hot,
    memRatio: memTotal > 0 ? (memUsed / memTotal) * 100 : null,
    up: live.reduce((a, r) => a + (r.status!.net_out ?? 0), 0),
    down: live.reduce((a, r) => a + (r.status!.net_in ?? 0), 0),
    traffic,
  }
}

export interface Bulletin {
  id: string
  level: 'warn' | 'bad' | 'info'
  text: string
  /** The node it is about; the ticker links to its detail. */
  uuid?: string
}

export function bulletins(rows: Row[]): Bulletin[] {
  const out: Bulletin[] = []
  for (const r of rows) {
    const n = r.node.name
    const uuid = r.node.uuid
    if (!r.online) out.push({ id: `off-${uuid}`, level: 'bad', text: `${n} 离线`, uuid })
    else {
      if ((r.cpu ?? 0) >= ALERT.cpu) out.push({ id: `cpu-${uuid}`, level: 'warn', text: `${n} CPU ${r.cpu!.toFixed(1)}%`, uuid })
      if ((r.ram ?? 0) >= ALERT.ram) out.push({ id: `ram-${uuid}`, level: 'warn', text: `${n} 内存 ${r.ram!.toFixed(1)}%`, uuid })
      if ((r.disk ?? 0) >= ALERT.disk) out.push({ id: `disk-${uuid}`, level: 'warn', text: `${n} 磁盘 ${r.disk!.toFixed(1)}%`, uuid })
    }
  }
  return out
}
