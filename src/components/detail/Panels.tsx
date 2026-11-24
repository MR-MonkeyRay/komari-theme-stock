import clsx from 'clsx'
import { lazy, Suspense, type ReactNode } from 'react'
import type { NodeEvent, RangeStats, Volume } from '../../lib/candles'
import { clock, dateText, duration, finite, parseTime, size } from '../../lib/format'
import type { Row } from '../../lib/model'
import { continentName } from '../../lib/region'
import { QUOTA } from '../../lib/thresholds'
import { Tags } from '../QuoteBoard'
import { Pair, Tick } from '../primitives'

const WorldMap = lazy(() => import('./WorldMap'))

/** `grow` shares spare column height between panels (roughly their row counts), so rows stay even. */
export function Panel({ title, extra, children, className, grow }: { title: ReactNode; extra?: ReactNode; children: ReactNode; className?: string; grow?: number }) {
  return (
    <section className={clsx('panel side-panel', className)} style={grow ? { flexGrow: grow } : undefined}>
      <div className="panel-head compact">
        <h3>{title}</h3>
        {extra && <span className="panel-extra">{extra}</span>}
      </div>
      {children}
    </section>
  )
}

function Fact({ k, children, className }: { k: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('fact', className)}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function LocationPanel({ r }: { r: Row }) {
  return (
    <Panel title="节点位置" extra={`${r.region.name} · ${continentName(r.region.continent)}`} className="map-panel">
      <Suspense fallback={<div className="world-map skeleton" />}>
        <WorldMap lat={r.region.lat} lng={r.region.lng} online={r.online} />
      </Suspense>
    </Panel>
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
  return (
    <Panel title="网络" grow={5} extra={<span className="legend-keys"><i className="k-up" />上行 <i className="k-down" />下行</span>}>
      <div className="net-now">
        <div>
          <span className="dim">当前上行</span>
          <b className="num net-up">
            <Tick value={st?.net_out} threshold={Math.max((st?.net_out ?? 0) * 0.1, 8192)}>{size(st?.net_out, true)}</Tick>
          </b>
        </div>
        <div>
          <span className="dim">当前下行</span>
          <b className="num net-down">
            <Tick value={st?.net_in} threshold={Math.max((st?.net_in ?? 0) * 0.1, 8192)}>{size(st?.net_in, true)}</Tick>
          </b>
        </div>
      </div>
      <dl className="facts">
        <Fact k="区间均值 ↑ / ↓">
          <span className="num">{size(avg(ups), true)} / {size(avg(downs), true)}</span>
        </Fact>
        <Fact k="区间峰值 ↑ / ↓">
          <span className="num">{size(ups.length ? Math.max(...ups) : null, true)} / {size(downs.length ? Math.max(...downs) : null, true)}</span>
        </Fact>
        <Fact k={monthly ? '本月 ↑ / ↓' : '累计 ↑ / ↓'}>
          <Pair up={traffic?.up} down={traffic?.down} />
        </Fact>
        {usedPct !== null && (
          <Fact k="流量配额" className="fact-quota">
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
        <Fact k="连接 TCP / UDP">
          <span className="num">{st ? `${st.connections} / ${st.connections_udp}` : '—'}</span>
        </Fact>
      </dl>
    </Panel>
  )
}

const CYCLES: Record<number, string> = { 30: '月付', 31: '月付', 90: '季付', 92: '季付', 180: '半年付', 182: '半年付', 365: '年付', 366: '年付', 730: '两年付', 1095: '三年付' }

export function BillingPanel({ r, now }: { r: Row; now: number }) {
  const n = r.node
  const cycle = Number.isInteger(n.billing_cycle) ? n.billing_cycle : 0
  const expiry = parseTime(n.expired_at)
  const left = expiry !== null ? Math.ceil((expiry - now) / 86400_000) : null
  const amount = finite(n.price) && n.price > 0 ? `${n.currency ? n.currency + ' ' : ''}${n.price.toLocaleString('zh-CN', { maximumFractionDigits: 4 })}` : n.price === -1 ? '免费' : '—'
  if (amount === '—' && expiry === null && cycle === 0) return null
  return (
    <Panel title="续费信息">
      <dl className="facts">
        <Fact k="续费周期">{cycle === -1 ? '一次性' : cycle > 0 ? <span className="num">{CYCLES[cycle] ? `${CYCLES[cycle]} · ` : ''}{cycle} 天</span> : '—'}</Fact>
        <Fact k="到期日">
          {expiry !== null ? (
            <span className="num">
              {dateText(expiry)}
              {left !== null && <em className={clsx('left', left < 0 ? 'bad' : left <= 7 ? 'warn' : 'dim')}>{left < 0 ? ` 已过期 ${-left} 天` : ` 剩 ${left} 天`}</em>}
            </span>
          ) : (
            '—'
          )}
        </Fact>
        <Fact k="续费金额">
          <span className="num">{amount}</span>
        </Fact>
        <Fact k="自动续期标记">{n.auto_renewal ? '已标记' : '未标记'}</Fact>
      </dl>
    </Panel>
  )
}

export function SystemPanel({ r }: { r: Row }) {
  const n = r.node
  const st = r.online ? r.status : undefined
  return (
    <Panel title="系统信息" extra="F10" grow={12}>
      <dl className="facts">
        <Fact k="处理器">
          <span className="clip" title={n.cpu_name}>{n.cpu_name || '—'}</span>
        </Fact>
        <Fact k="核心">
          <span className="num">{n.cpu_cores ? `${n.cpu_cores} 逻辑${n.cpu_physical_cores ? ` / ${n.cpu_physical_cores} 物理` : ''}` : '—'}</span>
        </Fact>
        <Fact k="操作系统">
          <span className="clip" title={n.os}>{n.os || '—'}</span>
        </Fact>
        {n.kernel_version && (
          <Fact k="内核">
            <span className="num clip">{n.kernel_version}</span>
          </Fact>
        )}
        <Fact k="架构 / 虚拟化">
          <span className="num">
            {n.arch || '—'} / {n.virtualization || '—'}
          </span>
        </Fact>
        {n.gpu_name && (
          <Fact k="GPU">
            <span className="clip" title={n.gpu_name}>{n.gpu_name}</span>
          </Fact>
        )}
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
        <Fact k="标签">
          <Tags tags={n.tags} />
        </Fact>
        {n.group && <Fact k="分组">{n.group}</Fact>}
      </dl>
      {n.public_remark && <p className="remark">{n.public_remark}</p>}
    </Panel>
  )
}

export function EventsPanel({ events }: { events: NodeEvent[] }) {
  return (
    <Panel title="节点事件" extra="样本推断" className="events-panel">
      <div className="events-body">
        {events.length ? (
          <ol className="events">
            {events.map((e, i) => (
              <li key={`${e.time}-${i}`} className={clsx('event', `ev-${e.kind}`)}>
                <time className="num">{clock(e.time, false)}</time>
                <b>{e.label}</b>
                <span title={e.text}>{e.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="events-empty">所选范围内无异动</p>
        )}
      </div>
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
