import { finite } from './format'
import { median, type Row } from './model'

export interface MarketSummary {
  total: number
  online: number
  offline: number
  hot: number
  cpuMedian: number | null
  cpuDelta: number | null
  memRatio: number | null
  up: number
  down: number
  traffic: { up: number; down: number; monthly: boolean } | null
}

export function summarize(rows: Row[], sparks: Map<string, { t: number; v: number }[]> | undefined, traffic: MarketSummary['traffic']): MarketSummary {
  const live = rows.filter((r) => r.online && r.status)
  const cpus = live.map((r) => r.cpu).filter(finite)
  const cpuMedian = median(cpus)
  // Δ: current median vs. the median of each node's value about 15 minutes ago.
  let cpuDelta: number | null = null
  if (sparks && cpuMedian !== null) {
    const past = live
      .map((r) => {
        const s = sparks.get(r.node.uuid)
        if (!s?.length) return null
        const target = s[s.length - 1].t - 15 * 60_000
        return s.reduce((best, p) => (Math.abs(p.t - target) < Math.abs(best.t - target) ? p : best)).v
      })
      .filter(finite)
    const m = median(past)
    if (m !== null) cpuDelta = cpuMedian - m
  }
  const memUsed = live.reduce((a, r) => a + (r.status!.ram ?? 0), 0)
  const memTotal = live.reduce((a, r) => a + (r.status!.ram_total || r.node.mem_total || 0), 0)
  return {
    total: rows.length,
    online: live.length,
    offline: rows.length - live.length,
    hot: live.filter((r) => (r.cpu ?? 0) >= 80 || (r.ram ?? 0) >= 90).length,
    cpuMedian,
    cpuDelta,
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
}

export function bulletins(rows: Row[]): Bulletin[] {
  const out: Bulletin[] = []
  for (const r of rows) {
    const n = r.node.name
    if (!r.online) out.push({ id: `off-${r.node.uuid}`, level: 'bad', text: `${n} 离线` })
    else {
      if ((r.cpu ?? 0) >= 80) out.push({ id: `cpu-${r.node.uuid}`, level: 'warn', text: `${n} CPU ${r.cpu!.toFixed(1)}%` })
      if ((r.ram ?? 0) >= 90) out.push({ id: `ram-${r.node.uuid}`, level: 'warn', text: `${n} 内存 ${r.ram!.toFixed(1)}%` })
      if ((r.disk ?? 0) >= 90) out.push({ id: `disk-${r.node.uuid}`, level: 'warn', text: `${n} 磁盘 ${r.disk!.toFixed(1)}%` })
    }
  }
  return out
}
