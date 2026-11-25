import i18n from '../i18n'
import { finite, parseTime } from './format'
import type { Row } from './model'
import type { NodeInfo } from './types'
import { ALERT, HOT } from './thresholds'

export interface MarketSummary {
  total: number
  online: number
  offline: number
  hot: number | null
  memRatio: number | null
  up: number
  down: number
  /** This month's traffic over all nodes; `since` when the oldest part is past retention. */
  traffic: { up: number; down: number; since: number | null } | null
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

/** Local calendar day of a moment, as a UTC midnight so that day differences ignore DST shifts. */
function localDay(ms: number) {
  const d = new Date(ms)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Calendar days from today to the expiry date as the page shows it (local time): 0 on that day,
 * negative after. Null without a date.
 */
export function daysLeft(n: NodeInfo, now: number) {
  const t = parseTime(n.expired_at)
  return t === null ? null : Math.round((localDay(t) - localDay(now)) / 86400_000)
}

/** Short note on a plan's state, from `daysLeft`. */
export function expiryNote(left: number) {
  return left < 0 ? i18n.t('expiry.expired', { count: -left }) : left === 0 ? i18n.t('expiry.today') : i18n.t('expiry.left', { count: left })
}

/**
 * Live alerts for everyone; with `expiry` (logged-in viewers only), also plans that run out within
 * the lead days or already have.
 */
export function bulletins(rows: Row[], expiry?: { now: number; leadDays: number } | null): Bulletin[] {
  const out: Bulletin[] = []
  for (const r of rows) {
    const name = r.node.name
    const uuid = r.node.uuid
    if (!r.online) out.push({ id: `off-${uuid}`, level: 'bad', text: i18n.t('bulletin.offline', { name }), uuid })
    else {
      if ((r.cpu ?? 0) >= ALERT.cpu) out.push({ id: `cpu-${uuid}`, level: 'warn', text: i18n.t('bulletin.cpu', { name, value: r.cpu!.toFixed(1) }), uuid })
      if ((r.ram ?? 0) >= ALERT.ram) out.push({ id: `ram-${uuid}`, level: 'warn', text: i18n.t('bulletin.memory', { name, value: r.ram!.toFixed(1) }), uuid })
      if ((r.disk ?? 0) >= ALERT.disk) out.push({ id: `disk-${uuid}`, level: 'warn', text: i18n.t('bulletin.disk', { name, value: r.disk!.toFixed(1) }), uuid })
    }
  }
  if (expiry) {
    for (const r of rows) {
      const left = daysLeft(r.node, expiry.now)
      if (left === null || left > expiry.leadDays) continue
      const uuid = r.node.uuid
      // An auto-renewing plan only needs a heads-up; one that has run out is the urgent case.
      const level = left <= 0 ? 'bad' : r.node.auto_renewal ? 'info' : 'warn'
      const note = left <= 0 ? expiryNote(left) : r.node.auto_renewal ? i18n.t('bulletin.renewIn', { count: left }) : i18n.t('bulletin.expireIn', { count: left })
      out.push({ id: `exp-${uuid}`, level, text: i18n.t('bulletin.expiry', { name: r.node.name, note }), uuid })
    }
  }
  return out
}
