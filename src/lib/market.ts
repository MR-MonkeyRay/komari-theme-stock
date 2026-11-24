import { finite } from './format'
import type { Row } from './model'

const CPU_WARN = 80
const RAM_WARN = 90

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

export function summarize(rows: Row[], traffic: MarketSummary['traffic']): MarketSummary {
  const live = rows.filter((r) => r.online && r.status)
  let hot: number | null = null
  for (const { cpu, ram } of live) {
    if (!finite(cpu) && !finite(ram)) continue
    hot ??= 0
    if ((cpu ?? 0) >= CPU_WARN || (ram ?? 0) >= RAM_WARN) hot++
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
}

export function bulletins(rows: Row[]): Bulletin[] {
  const out: Bulletin[] = []
  for (const r of rows) {
    const n = r.node.name
    if (!r.online) out.push({ id: `off-${r.node.uuid}`, level: 'bad', text: `${n} 离线` })
    else {
      if ((r.cpu ?? 0) >= CPU_WARN) out.push({ id: `cpu-${r.node.uuid}`, level: 'warn', text: `${n} CPU ${r.cpu!.toFixed(1)}%` })
      if ((r.ram ?? 0) >= RAM_WARN) out.push({ id: `ram-${r.node.uuid}`, level: 'warn', text: `${n} 内存 ${r.ram!.toFixed(1)}%` })
      if ((r.disk ?? 0) >= 90) out.push({ id: `disk-${r.node.uuid}`, level: 'warn', text: `${n} 磁盘 ${r.disk!.toFixed(1)}%` })
    }
  }
  return out
}
