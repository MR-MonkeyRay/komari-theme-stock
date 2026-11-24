import clsx from 'clsx'
import copy from 'copy-to-clipboard'
import { Check, Copy, Eye, EyeOff, Lock } from 'lucide-react'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { ClientOps } from '../../lib/api'
import type { NodeEvent, RangeStats, Volume } from '../../lib/candles'
import { daysLeft, expiryNote } from '../../lib/market'
import { clock, dateText, duration, finite, monthDayTime, parseTags, parseTime, sameDay, size } from '../../lib/format'
import type { Row } from '../../lib/model'
import { continentName } from '../../lib/region'
import { QUOTA } from '../../lib/thresholds'
import { Tags } from '../QuoteBoard'
import { Pair, Tick } from '../primitives'
import { shareTime } from './chartSync'

const WorldMap = lazy(() => import('./WorldMap'))

export function Panel({ title, extra, children, className }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('panel side-panel', className)}>
      <div className="panel-head compact">
        <h3>{title}</h3>
        {extra && <span className="panel-extra">{extra}</span>}
      </div>
      {children}
    </section>
  )
}

/** In a two-column list (`.facts-2`) a fact is a cell, label over value; `wide` takes a whole row. */
function Fact({ k, children, className, wide }: { k: ReactNode; children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={clsx('fact', wide && 'fact-wide', className)}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** Where the node is and how it is filed: region, group, tags and the public note, beside the map. */
export function LocationPanel({ r }: { r: Row }) {
  const n = r.node
  const tagged = parseTags(n.tags).length > 0
  return (
    <section className="panel side-panel geo-card" aria-label="节点位置">
      <div className="geo-meta">
        <b>
          {r.region.name} <span className="dim">· {continentName(r.region.continent)}</span>
        </b>
        {(n.group || tagged) && (
          <span className="geo-tags">
            {n.group && (
              <span className="tag tag-group" title="分组">
                {n.group}
              </span>
            )}
            {tagged && <Tags tags={n.tags} max={3} />}
          </span>
        )}
        {n.public_remark && (
          <p className="geo-remark" title={n.public_remark}>
            {n.public_remark}
          </p>
        )}
      </div>
      <Suspense fallback={<div className="world-map skeleton" />}>
        <WorldMap lat={r.region.lat} lng={r.region.lng} online={r.online} />
      </Suspense>
    </section>
  )
}

function trafficUsed(type: string, up: number, down: number) {
  switch (type) {
    case 'max':
      return Math.max(up, down)
    case 'min':
      return Math.min(up, down)
    case 'up':
      return up
    case 'down':
      return down
    default:
      return up + down
  }
}

export function NetworkPanel({ r, volume, traffic, monthly }: { r: Row; volume: Volume[]; traffic: { up: number; down: number } | null; monthly: boolean }) {
  const st = r.online ? r.status : undefined
  const ups = volume.map((v) => v.up)
  const downs = volume.map((v) => v.down)
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  const limit = r.node.traffic_limit
  const used = traffic && limit > 0 ? trafficUsed(r.node.traffic_limit_type, traffic.up, traffic.down) : null
  const usedPct = used !== null ? Math.min(100, (used / limit) * 100) : null
  const total = st ? st.net_out + st.net_in : null
  // Share of upload in the current throughput, like the bid/ask ratio bar of a quote panel.
  const upShare = total ? (st!.net_out / total) * 100 : null
  return (
    <Panel
      title="网络"
      className="net-panel"
      extra={
        <span className="num net-extra">
          <span>
            合计 <b>{size(total, true)}</b>
          </span>
          <span className="has-hint" title="TCP / UDP 连接数">
            连接 <b>{st ? `${st.connections} / ${st.connections_udp}` : '—'}</b>
          </span>
        </span>
      }
    >
      <div className="net-now">
        <div>
          <span className="dim">当前上行</span>
          <b className="num">
            <i className="net-up" aria-hidden="true">↑</i>
            <Tick value={st?.net_out} threshold={Math.max((st?.net_out ?? 0) * 0.1, 8192)}>{size(st?.net_out, true)}</Tick>
          </b>
        </div>
        <div>
          <span className="dim">当前下行</span>
          <b className="num">
            <i className="net-down" aria-hidden="true">↓</i>
            <Tick value={st?.net_in} threshold={Math.max((st?.net_in ?? 0) * 0.1, 8192)}>{size(st?.net_in, true)}</Tick>
          </b>
        </div>
        {upShare !== null && (
          <span className="net-ratio" role="img" aria-label={`上行占 ${Math.round(upShare)}%，下行占 ${Math.round(100 - upShare)}%`} title={`上行 ${Math.round(upShare)}% · 下行 ${Math.round(100 - upShare)}%`}>
            <i style={{ width: `${upShare}%` }} />
          </span>
        )}
      </div>
      <dl className="facts facts-2">
        <Fact k="区间均值 ↑ / ↓">
          <span className="num">{size(avg(ups), true)} / {size(avg(downs), true)}</span>
        </Fact>
        <Fact k="区间峰值 ↑ / ↓">
          <span className="num">{size(ups.length ? Math.max(...ups) : null, true)} / {size(downs.length ? Math.max(...downs) : null, true)}</span>
        </Fact>
        <Fact k={monthly ? '本月 ↑ / ↓' : '累计 ↑ / ↓'} wide>
          <Pair up={traffic?.up} down={traffic?.down} />
        </Fact>
        {usedPct !== null && (
          <Fact k="流量配额" className="fact-quota" wide>
            <span className="quota">
              <span className="num">
                {size(used)} / {size(limit)}
              </span>
              <span className={clsx('meter', usedPct >= QUOTA.danger ? 'is-danger' : usedPct >= QUOTA.warn ? 'is-warn' : '')}>
                <i style={{ transform: `scaleX(${Math.max(0.01, usedPct / 100)})` }} />
              </span>
            </span>
          </Fact>
        )}
      </dl>
    </Panel>
  )
}

const CYCLES: Record<number, string> = { 30: '月付', 31: '月付', 90: '季付', 92: '季付', 180: '半年付', 182: '半年付', 365: '年付', 366: '年付', 730: '两年付', 1095: '三年付' }

// Addresses start masked so a screenshot of the page is safe to share; the choice holds while
// paging between nodes and resets on reload.
const useReveal = create<{ shown: boolean }>(() => ({ shown: false }))

/** Keeps the network part: 203.0.•.• and 2001:db8:…. */
function maskAddress(ip: string) {
  if (ip.includes(':')) return `${ip.split(':').slice(0, 2).join(':')}:…`
  const p = ip.split('.')
  return p.length === 4 ? `${p[0]}.${p[1]}.•.•` : '•••'
}

function Address({ ip, label, shown }: { ip: string; label: string; shown: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  useEffect(() => {
    if (copied === null) return
    const t = window.setTimeout(() => setCopied(null), 1600)
    return () => window.clearTimeout(t)
  }, [copied])
  return (
    <span className="addr">
      <span className="num clip" title={shown ? ip : undefined}>
        {shown ? ip : maskAddress(ip)}
      </span>
      <button type="button" className="copy-btn" onClick={() => copy(ip).then(setCopied)} aria-label={`复制完整 ${label} 地址`} title={copied === false ? '复制失败' : '复制完整地址'}>
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">
        {copied === true ? '已复制' : copied === false ? '复制失败' : ''}
      </span>
    </span>
  )
}

/**
 * What only a logged-in viewer sees, in one panel: the agent's addresses and version from Komari's
 * admin list (`ops`), and the billing fields. `leadDays`: how close to expiry counts as due soon
 * (Komari's expiry notice setting).
 */
export function AdminPanel({ r, now, leadDays, ops }: { r: Row; now: number; leadDays: number; ops?: ClientOps }) {
  const shown = useReveal((s) => s.shown)
  const n = r.node
  const cycle = Number.isInteger(n.billing_cycle) ? n.billing_cycle : 0
  const expiry = parseTime(n.expired_at)
  const left = daysLeft(n, now)
  const amount = finite(n.price) && n.price > 0 ? `${n.currency ? n.currency + ' ' : ''}${n.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : n.price === -1 ? '免费' : '—'
  const billing = amount !== '—' || expiry !== null || cycle !== 0
  if (!billing && !ops) return null
  return (
    <Panel
      className="admin-panel"
      title={ops && billing ? '运维 · 续费' : ops ? '运维信息' : '续费信息'}
      extra={
        <span className="admin-extra">
          <span className="panel-lock has-hint" title="Komari 的公开接口仍会把续费字段下发给访客，主题只是不显示；要真正保密，请在后台开启私有站点，或不填写金额">
            <Lock size={11} aria-hidden="true" />
            仅登录可见
          </span>
          {ops && (ops.ipv4 || ops.ipv6) && (
            <button type="button" className="copy-btn" aria-pressed={shown} onClick={() => useReveal.setState({ shown: !shown })} aria-label="显示完整地址" title={shown ? '地址打码（便于截图）' : '显示完整地址'}>
              {shown ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            </button>
          )}
        </span>
      }
    >
      <dl className="facts facts-2">
        {ops && (
          <>
            <Fact k="IPv4">{ops.ipv4 ? <Address key={ops.ipv4} ip={ops.ipv4} label="IPv4" shown={shown} /> : '—'}</Fact>
            <Fact k="Agent 版本">
              <span className="num">{ops.version || '—'}</span>
            </Fact>
            <Fact k="IPv6" wide>
              {ops.ipv6 ? <Address key={ops.ipv6} ip={ops.ipv6} label="IPv6" shown={shown} /> : '—'}
            </Fact>
          </>
        )}
        {billing && (
          <>
            <Fact k="续费周期">{cycle === -1 ? '一次性' : cycle > 0 ? <span className="num">{CYCLES[cycle] ? `${CYCLES[cycle]} · ` : ''}{cycle} 天</span> : '—'}</Fact>
            <Fact k="续费金额">
              <span className="num">{amount}</span>
            </Fact>
            <Fact k="到期日">
              {expiry !== null ? (
                <span className="num">
                  {dateText(expiry)}
                  {left !== null && <em className={clsx('left', left <= 0 ? 'bad' : left <= leadDays ? 'warn' : 'dim')}> {expiryNote(left)}</em>}
                </span>
              ) : (
                '—'
              )}
            </Fact>
            <Fact k="自动续费">{n.auto_renewal ? '已开启' : '未开启'}</Fact>
          </>
        )}
      </dl>
    </Panel>
  )
}

export function SystemPanel({ r }: { r: Row }) {
  const n = r.node
  const st = r.online ? r.status : undefined
  return (
    <Panel title="系统信息" className="f10-panel" extra={<span className="has-hint" title="行情软件中查看个股资料的 F10 键；这里是节点的基本资料">F10</span>}>
      {/* Cells pair up; a long value without a partner (GPU, an OS without a kernel version) takes the row. */}
      <dl className="facts facts-2">
        <Fact k="处理器">
          <span className="clip" title={n.cpu_name}>{n.cpu_name || '—'}</span>
        </Fact>
        <Fact k="核心">
          <span className="num">{n.cpu_cores ? `${n.cpu_cores} 逻辑${n.cpu_physical_cores ? ` / ${n.cpu_physical_cores} 物理` : ''}` : '—'}</span>
        </Fact>
        {n.gpu_name && (
          <Fact k="GPU" wide>
            <span className="clip" title={n.gpu_name}>{n.gpu_name}</span>
          </Fact>
        )}
        <Fact k="操作系统" wide={!n.kernel_version}>
          <span className="clip" title={n.os}>{n.os || '—'}</span>
        </Fact>
        {n.kernel_version && (
          <Fact k="内核">
            <span className="num clip" title={n.kernel_version}>{n.kernel_version}</span>
          </Fact>
        )}
        <Fact k="架构 / 虚拟化">
          <span className="num">
            {n.arch || '—'} / {n.virtualization || '—'}
          </span>
        </Fact>
        <Fact k="内存 / 交换">
          <span className="num">
            {size(st?.ram_total || n.mem_total)} / {size(st?.swap_total || n.swap_total)}
          </span>
        </Fact>
        <Fact k="磁盘总量">
          <span className="num">{size(st?.disk_total || n.disk_total)}</span>
        </Fact>
        <Fact k="运行时长">
          <span className="num">{duration(st?.uptime)}</span>
        </Fact>
        <Fact k="负载 1m / 5m / 15m">
          <span className="num">{st ? [st.load, st.load5, st.load15].map((x) => (finite(x) ? x.toFixed(2) : '—')).join(' / ') : '—'}</span>
        </Fact>
        <Fact k="进程数">
          <span className="num">{st?.process ?? '—'}</span>
        </Fact>
      </dl>
    </Panel>
  )
}

export function EventsPanel({ events, now }: { events: NodeEvent[]; now: number }) {
  // Dates are shown for every row as soon as one event is not from today, so the columns line up.
  const withDate = events.some((e) => !sameDay(e.time, now))
  return (
    <Panel title="节点事件" extra={events.length ? '样本推断' : '所选范围内无异动'} className={clsx('events-panel', !events.length && 'is-empty')}>
      {events.length > 0 && (
        <div className="events-body">
          <ol className={clsx('events', withDate && 'with-date')}>
            {events.map((e, i) => (
              // Pointing at an event puts every chart's crosshair on its time.
              <li key={`${e.time}-${i}`} className={clsx('event', `ev-${e.kind}`)} onPointerEnter={() => shareTime('events', e.time / 1000)} onPointerLeave={() => shareTime('events', null)}>
                <time className="num" dateTime={new Date(e.time).toISOString()}>
                  {withDate ? monthDayTime(e.time) : clock(e.time, false)}
                </time>
                <b>{e.label}</b>
                <span title={e.text}>{e.text}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  )
}

export function StatBook({ stats, format, items }: { stats: RangeStats | null; format: (v: number) => string; items: ('low' | 'avg' | 'high' | 'p95')[] }) {
  const label = { low: '区间最低', avg: '区间均值', high: '区间最高', p95: 'P95' }
  return (
    <dl className="statbook">
      {items.map((k) => (
        <div key={k}>
          <dt>{label[k]}</dt>
          <dd className="num">{stats ? format(stats[k]) : '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
