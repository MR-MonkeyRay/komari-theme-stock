import * as Tabs from '@radix-ui/react-tabs'
import clsx from 'clsx'
import copy from 'copy-to-clipboard'
import { Check, Copy, Eye, EyeOff, Lock } from 'lucide-react'
import type { TFunction } from 'i18next'
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { create } from 'zustand'
import type { ClientOps, OfflineNotice, TrafficSum } from '../../lib/api'
import type { NodeEvent, RangeStats, Volume } from '../../lib/candles'
import { daysLeft, expiryNote } from '../../lib/market'
import { clock, cpuModel, dateText, duration, finite, monthDay, monthDayTime, parseTags, parseTime, sameDay, size } from '../../lib/format'
import type { Row } from '../../lib/model'
import { continentName } from '../../lib/region'
import { CPU_EVENT, QUOTA } from '../../lib/thresholds'
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

/** Where the node is and how it is filed: region, group and tags on one line, the public note under
 * them, and the map below at the card's full width, so neither crowds the other. */
export function LocationPanel({ r }: { r: Row }) {
  const { t } = useTranslation()
  const n = r.node
  const tagged = parseTags(n.tags).length > 0
  return (
    <section className="panel side-panel geo-card" aria-label={t('panel.location')}>
      <div className="geo-meta">
        <div className="geo-head">
          <b>
            {r.region.name} <span className="dim">· {continentName(r.region.continent)}</span>
          </b>
          {(n.group || tagged) && (
            <span className="geo-tags">
              {n.group && (
                <span className="tag tag-group" title={t('panel.group')}>
                  {n.group}
                </span>
              )}
              {tagged && <Tags tags={n.tags} max={3} />}
            </span>
          )}
        </div>
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

/** A traffic sum; one that only covers part of its period is marked, and its tooltip says from when it counts. */
function TrafficFact({ k, v }: { k: string; v: TrafficSum | undefined }) {
  const { t } = useTranslation()
  const partial = v?.since != null
  return (
    <Fact k={k} wide className={clsx(partial && 'is-partial')}>
      <span className={clsx('traffic-fact', partial && 'has-hint')} title={partial ? t('board.partialSince', { date: monthDay(v.since!) }) : undefined}>
        <Pair up={v?.up} down={v?.down} />
      </span>
    </Fact>
  )
}

export function NetworkPanel({ r, volume, month, total: allTime }: { r: Row; volume: Volume[]; month: TrafficSum | undefined; total: TrafficSum | undefined }) {
  const { t } = useTranslation()
  const st = r.online ? r.status : undefined
  const ups = volume.map((v) => v.up)
  const downs = volume.map((v) => v.down)
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  const limit = r.node.traffic_limit
  const used = month && limit > 0 ? trafficUsed(r.node.traffic_limit_type, month.up, month.down) : null
  const usedPct = used !== null ? Math.min(100, (used / limit) * 100) : null
  const total = st ? st.net_out + st.net_in : null
  // Share of upload in the current throughput, like the bid/ask ratio bar of a quote panel.
  const upShare = total ? (st!.net_out / total) * 100 : null
  return (
    <Panel
      title={t('panel.network')}
      className="net-panel"
      extra={
        <span className="num net-extra">
          <span>
            {t('panel.total')} <b>{size(total, true)}</b>
          </span>
          <span className="has-hint" title={t('panel.connHint')}>
            {t('panel.conn')} <b>{st ? `${st.connections} / ${st.connections_udp}` : '—'}</b>
          </span>
        </span>
      }
    >
      <div className="net-now">
        <div>
          <span className="dim">{t('panel.upNow')}</span>
          <b className="num">
            <i className="net-up" aria-hidden="true">↑</i>
            <Tick value={st?.net_out} threshold={Math.max((st?.net_out ?? 0) * 0.1, 8192)}>{size(st?.net_out, true)}</Tick>
          </b>
        </div>
        <div>
          <span className="dim">{t('panel.downNow')}</span>
          <b className="num">
            <i className="net-down" aria-hidden="true">↓</i>
            <Tick value={st?.net_in} threshold={Math.max((st?.net_in ?? 0) * 0.1, 8192)}>{size(st?.net_in, true)}</Tick>
          </b>
        </div>
        {upShare !== null && (
          <span className="net-ratio" role="img" aria-label={t('panel.ratioLabel', { up: Math.round(upShare), down: Math.round(100 - upShare) })} title={t('panel.ratioHint', { up: Math.round(upShare), down: Math.round(100 - upShare) })}>
            <i style={{ width: `${upShare}%` }} />
          </span>
        )}
      </div>
      <dl className="facts facts-2">
        <Fact k={t('panel.rangeAvg')}>
          <span className="num">{size(avg(ups), true)} / {size(avg(downs), true)}</span>
        </Fact>
        <Fact k={t('panel.rangePeak')}>
          <span className="num">{size(ups.length ? Math.max(...ups) : null, true)} / {size(downs.length ? Math.max(...downs) : null, true)}</span>
        </Fact>
        <TrafficFact k={t('panel.month')} v={month} />
        <TrafficFact k={t('panel.cumulative')} v={allTime} />
        {usedPct !== null && (
          <Fact k={t('panel.quota')} className="fact-quota" wide>
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

const CYCLES: Record<number, 'month' | 'quarter' | 'half' | 'year' | 'twoYears' | 'threeYears'> = { 30: 'month', 31: 'month', 90: 'quarter', 92: 'quarter', 180: 'half', 182: 'half', 365: 'year', 366: 'year', 730: 'twoYears', 1095: 'threeYears' }

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
  const { t } = useTranslation()
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
      <button type="button" className="copy-btn" onClick={() => copy(ip).then(setCopied)} aria-label={t('panel.copyFull', { label })} title={copied === false ? t('panel.copyFailed') : t('panel.copyHint')}>
        {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
      </button>
      <span className="sr-only" role="status">
        {copied === true ? t('panel.copied') : copied === false ? t('panel.copyFailed') : ''}
      </span>
    </span>
  )
}

type InfoTab = 'system' | 'billing' | 'machine'
// The picked tab holds while paging between nodes (where the node has it) and resets on reload.
const useInfoTab = create<{ tab: InfoTab }>(() => ({ tab: 'system' }))

/** How long Komari waits before an offline notice: whole minutes, else seconds. */
function graceText(seconds: number, t: TFunction) {
  return seconds >= 60 && seconds % 60 === 0 ? t('format.minutes', { count: seconds / 60 }) : `${seconds}s`
}

/**
 * The node's facts in one panel: its system, and for a logged-in viewer two more tabs, billing and
 * the machine (the agent's addresses and version from Komari's admin list, `ops`, and its offline
 * notice, `notice`). A visitor gets the system facts under a plain title. Every tab is laid in the
 * same cell, so the panel keeps the height of the tallest and nothing below it moves on a switch.
 * `leadDays`: how close to expiry counts as due soon (Komari's expiry notice setting).
 */
export function InfoPanel({ r, admin, now, leadDays, ops, notice }: { r: Row; admin: boolean; now: number; leadDays: number; ops?: ClientOps; notice?: OfflineNotice }) {
  const { t, i18n } = useTranslation()
  const shown = useReveal((s) => s.shown)
  const picked = useInfoTab((s) => s.tab)
  const n = r.node
  const st = r.online ? r.status : undefined
  const cycle = Number.isInteger(n.billing_cycle) ? n.billing_cycle : 0
  const expiry = parseTime(n.expired_at)
  const left = daysLeft(n, now)
  const amount = finite(n.price) && n.price > 0 ? `${n.currency ? n.currency + ' ' : ''}${n.price.toLocaleString(i18n.language, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : n.price === -1 ? t('panel.free') : '—'
  const billing = admin && (amount !== '—' || expiry !== null || cycle !== 0)
  const machine = admin && (!!ops || !!notice)
  const swapTotal = st?.swap_total || n.swap_total || 0
  const tab: InfoTab = (picked === 'billing' && billing) || (picked === 'machine' && machine) ? picked : 'system'
  const tabbed = billing || machine

  const system = (
    /* Cells pair up; a long value without a partner (GPU, an OS without a kernel version) takes the row. */
    <dl className="facts facts-2">
      <Fact k={t('panel.cpu')}>
        <span className="clip" title={n.cpu_name}>{n.cpu_name ? cpuModel(n.cpu_name) : '—'}</span>
      </Fact>
      <Fact k={t('panel.cores')}>
        <span className="num">{n.cpu_cores ? (n.cpu_physical_cores ? t('panel.coresBoth', { logical: n.cpu_cores, physical: n.cpu_physical_cores }) : t('panel.coresLogical', { logical: n.cpu_cores })) : '—'}</span>
      </Fact>
      {n.gpu_name && (
        <Fact k="GPU" wide>
          <span className="clip" title={n.gpu_name}>{n.gpu_name}</span>
        </Fact>
      )}
      <Fact k={t('panel.os')} wide={!n.kernel_version}>
        <span className="clip" title={n.os}>{n.os || '—'}</span>
      </Fact>
      {n.kernel_version && (
        <Fact k={t('panel.kernel')}>
          <span className="num clip" title={n.kernel_version}>{n.kernel_version}</span>
        </Fact>
      )}
      <Fact k={t('panel.arch')}>
        <span className="num">
          {n.arch || '—'} / {n.virtualization || '—'}
        </span>
      </Fact>
      <Fact k={t('panel.uptime')}>
        <span className="num">{duration(st?.uptime)}</span>
      </Fact>
      <Fact k={t('panel.memDisk')}>
        <span className="num">
          {size(st?.ram_total || n.mem_total)} / {size(st?.disk_total || n.disk_total)}
        </span>
      </Fact>
      <Fact k={t('panel.swap')}>
        {swapTotal > 0 ? (
          <span className="num">
            {st ? size(st.swap) : '—'} / {size(swapTotal)}
          </span>
        ) : (
          <span className="dim">{t('panel.noSwap')}</span>
        )}
      </Fact>
      <Fact k={t('panel.load')}>
        <span className="num">{st ? [st.load, st.load5, st.load15].map((x) => (finite(x) ? x.toFixed(2) : '—')).join(' / ') : '—'}</span>
      </Fact>
      <Fact k={t('panel.processes')}>
        <span className="num">{st?.process ?? '—'}</span>
      </Fact>
    </dl>
  )

  if (!tabbed)
    return (
      <Panel title={t('panel.system')} className="info-panel">
        <div className="info-system">{system}</div>
      </Panel>
    )

  const lock = <Lock size={10} strokeWidth={2.2} aria-hidden="true" />
  // Radix focuses a tab from script on mousedown, and Chrome shows a focus ring for that (after the
  // drawer opened from a link, say). A click switches the tab here instead, without the script
  // focus; the keyboard (Tab, then the arrow keys) still goes through Radix, ring and all.
  const click = (value: InfoTab) => ({
    onMouseDown: (e: React.MouseEvent) => e.button === 0 && !e.ctrlKey && e.preventDefault(),
    onClick: () => useInfoTab.setState({ tab: value }),
  })
  return (
    <section className="panel side-panel info-panel">
      <Tabs.Root value={tab} onValueChange={(v) => useInfoTab.setState({ tab: v as InfoTab })}>
        <div className="panel-head compact info-head">
          <Tabs.List className="info-tabs" aria-label={t('panel.info')}>
            <Tabs.Trigger value="system" className="info-tab" {...click('system')}>
              {t('panel.system')}
            </Tabs.Trigger>
            {billing && (
              <Tabs.Trigger value="billing" className="info-tab" title={t('panel.lockHint')} {...click('billing')}>
                {lock}
                {t('panel.billing')}
              </Tabs.Trigger>
            )}
            {machine && (
              <Tabs.Trigger value="machine" className="info-tab" title={t('panel.loginOnly')} {...click('machine')}>
                {lock}
                {t('panel.ops')}
              </Tabs.Trigger>
            )}
          </Tabs.List>
          {tab === 'machine' && (ops?.ipv4 || ops?.ipv6) && (
            <button type="button" className="copy-btn" aria-pressed={shown} onClick={() => useReveal.setState({ shown: !shown })} aria-label={t('panel.reveal')} title={shown ? t('panel.mask') : t('panel.reveal')}>
              {shown ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            </button>
          )}
        </div>
        <div className="info-stack">
          <Tabs.Content value="system" className="info-system" forceMount>
            {system}
          </Tabs.Content>
          {billing && (
            <Tabs.Content value="billing" className="info-billing" forceMount>
              <dl className="facts facts-2">
                <Fact k={t('panel.cycleLabel')}>{cycle === -1 ? t('panel.oneTime') : cycle > 0 ? <span className="num">{CYCLES[cycle] ? `${t(`panel.cycle.${CYCLES[cycle]}`)} · ` : ''}{t('format.days', { count: cycle })}</span> : '—'}</Fact>
                <Fact k={t('panel.price')}>
                  <span className="num">{amount}</span>
                </Fact>
                <Fact k={t('panel.expiry')}>
                  {expiry !== null ? (
                    <span className="num">
                      {dateText(expiry)}
                      {left !== null && <em className={clsx('left', left <= 0 ? 'bad' : left <= leadDays ? 'warn' : 'dim')}> {expiryNote(left)}</em>}
                    </span>
                  ) : (
                    '—'
                  )}
                </Fact>
                <Fact k={t('panel.autoRenew')}>{n.auto_renewal ? t('panel.on') : t('panel.off')}</Fact>
              </dl>
            </Tabs.Content>
          )}
          {machine && (
            <Tabs.Content value="machine" className="info-machine" forceMount>
              <dl className="facts facts-2">
                <Fact k="IPv4">{ops?.ipv4 ? <Address key={ops.ipv4} ip={ops.ipv4} label="IPv4" shown={shown} /> : '—'}</Fact>
                <Fact k={t('panel.agent')}>
                  <span className="num">{ops?.version || '—'}</span>
                </Fact>
                <Fact k="IPv6" wide>
                  {ops?.ipv6 ? <Address key={ops.ipv6} ip={ops.ipv6} label="IPv6" shown={shown} /> : '—'}
                </Fact>
                {notice && (
                  <>
                    <Fact k={t('panel.offlineNotice')}>
                      {notice.enable ? <span className="num">{t('panel.noticeOn', { span: graceText(notice.grace, t) })}</span> : <span className="dim">{t('panel.noticeOff')}</span>}
                    </Fact>
                    <Fact k={t('panel.lastNotice')}>
                      <span className="num">{notice.last !== null ? monthDayTime(notice.last) : '—'}</span>
                    </Fact>
                  </>
                )}
              </dl>
            </Tabs.Content>
          )}
        </div>
      </Tabs.Root>
    </section>
  )
}

const EVENT_KINDS: NodeEvent['kind'][] = ['rise', 'fall', 'high-mem', 'gap', 'offline']

/** An event in words: the sentence of its kind with its numbers. */
function eventText(e: NodeEvent, t: TFunction) {
  switch (e.kind) {
    case 'rise':
      return t('event.rise', { limit: CPU_EVENT.rise, value: e.value.toFixed(1) })
    case 'fall':
      return t('event.fall', { limit: CPU_EVENT.fall, value: e.value.toFixed(1) })
    case 'high-mem':
      return t('event.highMem', { value: e.value.toFixed(1) })
    case 'gap': {
      const span = e.minutes >= 120 ? t('format.hours', { count: Math.round(e.minutes / 60) }) : t('format.minutes', { count: e.minutes })
      return e.buckets === 1 ? t('event.gapOne', { span }) : t('event.gapMany', { count: e.buckets, span })
    }
    case 'offline':
      return t('event.offline')
  }
}

/**
 * The availability strip (`top`) over the node's events, newest first. The list keeps one height
 * whatever the number of events and scrolls inside; with none only its head shows. `events` is null
 * when the events are turned off in the settings: the card then holds the strip alone.
 */
export function EventsPanel({ events, now, top }: { events: NodeEvent[] | null; now: number; top: ReactNode }) {
  const { t } = useTranslation()
  // Dates are shown for every row as soon as one event is not from today, so the columns line up.
  const withDate = !!events?.some((e) => !sameDay(e.time, now))
  return (
    <section className={clsx('panel side-panel events-panel', !events?.length && 'is-empty')}>
      {top}
      {events && (
        <div className="panel-head compact events-head">
          <h3>{t('panel.events')}</h3>
          <span className="panel-extra">{events.length ? t('panel.inferred') : t('panel.noEvents')}</span>
        </div>
      )}
      {events && events.length > 0 && (
        <div className="events-body">
          <ol className={clsx('events', withDate && 'with-date')}>
            {events.map((e, i) => {
              const text = eventText(e, t)
              // Pointing at an event puts every chart's crosshair on its time.
              return (
              <li key={`${e.time}-${i}`} className={clsx('event', `ev-${e.kind}`)} onPointerEnter={() => shareTime('events', e.time / 1000)} onPointerLeave={() => shareTime('events', null)}>
                <time className="num" dateTime={new Date(e.time).toISOString()}>
                  {withDate ? monthDayTime(e.time) : clock(e.time, false)}
                </time>
                <b className="ev-label">
                  {EVENT_KINDS.map((k) => (
                    <span key={k} className={k === e.kind ? undefined : 'ev-ghost'} aria-hidden={k === e.kind ? undefined : true}>
                      {t(`event.label.${k}`)}
                    </span>
                  ))}
                </b>
                <span className="ev-text" title={text}>
                  {text}
                </span>
              </li>
              )
            })}
          </ol>
        </div>
      )}
    </section>
  )
}

export function StatBook({ stats, format, items }: { stats: RangeStats | null; format: (v: number) => string; items: ('low' | 'avg' | 'high' | 'p95')[] }) {
  const { t } = useTranslation()
  const label = { low: t('panel.low'), avg: t('panel.avg'), high: t('panel.high'), p95: 'P95' }
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
