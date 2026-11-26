import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, LocateFixed, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { fitRange, RANGE_SPEC, useAvailableRanges, useClientOps, useConnHistory, useExpiryLeadDays, useHistory, useIsAdmin, useOfflineNotices, type NodeTraffic, type TrafficSum } from '../../lib/api'
import { buildCandles, buildVolume, inferEvents, isCandle, rangeStats } from '../../lib/candles'
import { ago, clock, finite, pct, ratio, signed, utcOffset } from '../../lib/format'
import { useIsPhone } from '../../lib/media'
import type { Row } from '../../lib/model'
import { usePrefs, type ChartStyle, type Range, type ThemeSettings } from '../../lib/settings'
import { Flag, Segmented, Tick, Tip } from '../primitives'
import { EventsPanel, InfoPanel, LocationPanel, NetworkPanel, StatBook } from './Panels'
import { UptimeStrip } from './Uptime'
import { closeUptimeDay } from './uptimeDay'
import type { Time } from 'lightweight-charts'
import { crosshairLabel } from './chartBase'
import { bucketAt, resetSync, setPin, shareRange, stepTime, useChartSync } from './chartSync'
import { KLineChart } from './lazyChart'
import { LoadPanel } from './LoadPanel'
import { PingPanel, type PingPick } from './PingPanel'

/** Clears the pin. Focus on the chip or bar that goes with it moves to the CPU chart, not the page. */
function clearPin() {
  const from = document.activeElement
  const held = from instanceof HTMLElement && from.closest('.pin-chip, .pin-bar') !== null
  setPin(null)
  if (held) document.querySelector<HTMLElement>('.chart-main .kline-canvas')?.focus({ preventScroll: true })
}
type SubPane = import('./KLineChart').SubPane
type ChartMark = import('./KLineChart').ChartMark

const GIB = 1024 ** 3
const LOOKS: ChartStyle[] = ['candle', 'line']
const setLook = (chartStyle: ChartStyle) => usePrefs.getState().update({ chartStyle })
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtGiB = (v: number) => v.toFixed(v >= 100 ? 1 : 2)

/** Range average and high, beside the current value in a small chart's head. */
function RangeNote({ stats }: { stats: ReturnType<typeof rangeStats> }) {
  const { t } = useTranslation()
  if (!stats) return null
  return (
    <span className="range-note">
      {t('chart.avg')} <b>{fmtGiB(stats.avg)}</b> {t('chart.high')} <b>{fmtGiB(stats.high)}</b>
    </span>
  )
}

function DetailBody({ r, rows, settings, traffic, now, picked, onRange, ping, onPing, sub, onSub, onStep }: { r: Row; rows: Row[]; settings: ThemeSettings; traffic: { month?: TrafficSum; total?: TrafficSum }; now: number; picked: Range; onRange: (r: Range) => void; ping: PingPick | null; onPing: (p: PingPick | null) => void; sub: SubPane; onSub: (s: SubPane) => void; onStep: (d: number) => void }) {
  const { t } = useTranslation()
  const phone = useIsPhone()
  const admin = useIsAdmin()
  const ops = useClientOps(admin).data?.[r.node.uuid]
  const notice = useOfflineNotices(admin).data?.[r.node.uuid]
  const leadDays = useExpiryLeadDays(admin)
  const available = useAvailableRanges()
  const range = fitRange(picked, available)
  const history = useHistory(r.node.uuid, range, settings.refreshSeconds)
  // Placeholder data is only ever this node's previous range: it stays on screen, dimmed, until the
  // new range arrives, instead of the charts dropping back to a skeleton.
  const h = history.data
  const uuid = r.node.uuid
  const stale = history.isPlaceholderData

  const cpu = useMemo(() => (h ? buildCandles(h, 'cpu.usage', uuid) : []), [h, uuid])
  const mem = useMemo(() => (h ? buildCandles(h, 'memory.used', uuid, GIB) : []), [h, uuid])
  const disk = useMemo(() => (h ? buildCandles(h, 'disk.used', uuid, GIB) : []), [h, uuid])
  const volume = useMemo(() => (h ? buildVolume(h, uuid) : []), [h, uuid])
  // Connection history only while the sub-pane shows it, and only for the range the candles show:
  // the previous range's points (kept while the new one loads) would stretch the time axis.
  const connQuery = useConnHistory(uuid, range, settings.refreshSeconds, sub === 'conn')
  const conn = connQuery.data && connQuery.data.range === h?.range ? connQuery.data.points : connQuery.isError ? null : undefined
  const cpuStats = useMemo(() => rangeStats(cpu), [cpu])
  const memStats = useMemo(() => rangeStats(mem), [mem])
  const diskStats = useMemo(() => rangeStats(disk), [disk])

  const st = r.online ? r.status : undefined
  const memTotal = (st?.ram_total || r.node.mem_total) / GIB || null
  const diskTotal = (st?.disk_total || r.node.disk_total) / GIB || null
  const events = useMemo(() => inferEvents(cpu, mem, memTotal, r.online, r.lastSeen), [cpu, mem, memTotal, r.online, r.lastSeen])
  // The events also mark their buckets: CPU rises and falls on the CPU chart, highs on memory.
  const marks = useMemo(() => {
    const on = settings.showEvents ? events : []
    const of = (kinds: ChartMark['kind'][]) => on.flatMap((e) => (kinds.includes(e.kind as ChartMark['kind']) ? [{ time: e.time / 1000, kind: e.kind as ChartMark['kind'] }] : []))
    return { cpu: of(['rise', 'fall']), mem: of(['high-mem']) }
  }, [events, settings.showEvents])

  const price = r.cpu ?? cpuStats?.close ?? null
  const open = cpuStats?.open ?? null
  const change = finite(price) && finite(open) ? price - open : null
  // Relative change is noise when the range opens near zero.
  const changePct = finite(change) && finite(open) && open >= 5 ? (change / open) * 100 : null
  const dir = !r.online ? 'off' : finite(change) ? (change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat') : 'flat'
  const idx = rows.findIndex((x) => x.node.uuid === uuid)
  const loading = history.isFetching && !h
  // Charts refit when data for a new range (or node) arrives, not when the range is clicked.
  const dataKey = `${uuid}-${h?.range}`
  // A shared crosshair, zoom or pin belongs to the data it was made on.
  useEffect(() => resetSync(), [dataKey])

  // A day of the availability strip shown in the charts: the shortest range that reaches back to
  // its start (the current one if it already does, else the longest there is), zoomed to the day
  // and pinned where its first offline stretch begins. A range still loading takes the day along
  // and gets it once its data is here; set any earlier, the reset above would clear it.
  const reach = now - RANGE_SPEC[available.ranges[available.ranges.length - 1] ?? range].hours * 3_600_000
  const pendingDay = useRef<{ from: number; to: number; pin: number | null; range: Range } | null>(null)
  // Pin first: a pin out of view slides each chart's window to it, and lightweight-charts applies a
  // new window late, so the slide would land after the day's window and undo it.
  const applyDay = (d: { from: number; to: number; pin: number | null }) => {
    setPin(d.pin === null ? null : d.pin / 1000)
    shareRange('uptime', { from: d.from / 1000, to: d.to / 1000, key: dataKey })
  }
  const showDay = (from: number, to: number, pin: number | null) => {
    const hours = (k: Range) => RANGE_SPEC[k].hours
    const fits = available.ranges.find((k) => now - hours(k) * 3_600_000 <= from) ?? available.ranges[available.ranges.length - 1] ?? range
    const day = { from, to: Math.min(to, now), pin, range: hours(range) >= hours(fits) ? range : fits }
    if (day.range === range && h?.range === range) applyDay(day)
    else {
      pendingDay.current = day
      if (day.range !== range) onRange(day.range)
    }
    // On a phone the charts are up the page.
    document.querySelector('.detail-main .chart-panel')?.scrollIntoView({ block: 'nearest' })
  }
  useEffect(() => {
    const day = pendingDay.current
    if (!day || h?.range !== day.range) return
    pendingDay.current = null
    // The charts take in the new range's data over the next frame; a window set in the same tick
    // finds no bars to place it on and is lost to their fit.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => applyDay(day))))
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h?.range, dataKey])

  // The pinned time, shown once for all charts: a chip in the CPU chart's head, and on phones a bar
  // held at the foot of the screen while the page scrolls (last in the page, so it pushes nothing
  // down under the finger that pinned). The chip fades while another time is hovered.
  const pin = useChartSync((st) => st.pin)
  const pinText = pin === null ? '' : crosshairLabel(pin as Time)
  const cpuTimes = useMemo(() => cpu.map((x) => x.time), [cpu])
  // Compared by CPU bucket: a chart of another span may name the same bucket by another time.
  const away = useChartSync((st) => {
    if (st.time === null || st.pin === null || st.time === st.pin) return false
    const at = bucketAt(cpuTimes, st.time)
    return at < 0 || at !== bucketAt(cpuTimes, st.pin)
  })
  // Phones: thin candles are hard to tap exactly, so the bar steps the pin to the next bucket with
  // samples each way (as ←/→ on a chart do), and stops at the ends.
  const samples = useMemo(() => cpu.filter(isCandle).map((x) => x.time), [cpu])
  const prevPin = pin === null ? null : stepTime(samples, pin, -1)
  const nextPin = pin === null ? null : stepTime(samples, pin, 1)
  // A pin the window has moved past (a refresh slides it forward) goes too, instead of every chart
  // reading a time it no longer has.
  const passed = pin !== null && !stale && cpuTimes.length > 0 && pin < cpuTimes[0]
  useEffect(() => {
    if (passed) clearPin()
  }, [passed])
  // Said to screen readers: the pin as it moves, and its clearing.
  const [hadPin, setHadPin] = useState(false)
  if (pin !== null && !hadPin) setHadPin(true)

  // Paging to another node keeps the banner, the panels and the chart instances; only the content
  // under the banner gives a short fade so the change of node registers.
  const grid = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  const shownUuid = useRef(uuid)
  useEffect(() => {
    if (shownUuid.current === uuid) return
    shownUuid.current = uuid
    // A long page (phones) starts over at the top for the next node.
    grid.current?.closest('.drawer')?.scrollTo({ top: 0 })
    if (!reduce) grid.current?.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' })
  }, [uuid, reduce])

  const name = (
    <div className="qb-name">
      <Tip content={r.node.name}>
        <Dialog.Title asChild>
          <h2 className="num">
            {r.node.name}
          </h2>
        </Dialog.Title>
      </Tip>
      <span className="node-code num">
        {r.code.area}·<em>{r.code.hash}</em>
      </span>
    </div>
  )
  const badges = (
    <>
      <span className={clsx('badge', r.online ? 'badge-on' : 'badge-off')}>
        <i aria-hidden="true" />
        {r.online ? t('common.online') : t('common.offline')}
      </span>
      {r.node.hidden && (
        <Tip content={t('common.hiddenHint')}>
          <span className="badge badge-hidden">
            {t('common.hidden')}
          </span>
        </Tip>
      )}
    </>
  )
  const quote = (
    <div className={clsx('qb-price', dir)}>
      <span className="qb-label">{r.online ? 'CPU' : t('detail.cpuLast')}</span>
      <b className="num">
        <Tick value={price} threshold={0.5}>{pct(price)}</Tick>
      </b>
      <span className="qb-change num">
        <span>{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {finite(change) ? signed(change, 1) : '—'}
          {finite(change) && <small>pp</small>}
        </span>
        <span>{finite(changePct) ? `${signed(changePct, 2)}%` : ''}</span>
      </span>
    </div>
  )
  const book = <StatBook stats={cpuStats} format={fmtPct} items={['high', 'low', 'avg', 'p95']} />
  const nav = (
    <div className="qb-nav">
      <Tip content={t('detail.prevHint')}>
        <button type="button" className="icon-btn" onClick={() => rows.length > 1 && onStep(-1)} aria-disabled={rows.length < 2} aria-label={t('detail.prev')}>
          <ChevronLeft size={phone ? 18 : 15} />
        </button>
      </Tip>
      <span className="num dim">
        {idx + 1}/{rows.length}
      </span>
      <Tip content={t('detail.nextHint')}>
        <button type="button" className="icon-btn" onClick={() => rows.length > 1 && onStep(1)} aria-disabled={rows.length < 2} aria-label={t('detail.next')}>
          <ChevronRight size={phone ? 18 : 15} />
        </button>
      </Tip>
    </div>
  )

  return (
    <div className="detail">
      {phone ? (
        // Phones: a bar held at the top while the page scrolls, so closing and paging are always at
        // hand; the reading and its range stats scroll with the page under it.
        <>
          <div className="qb-bar">
            <Dialog.Close asChild>
              <button type="button" className="icon-btn qb-close" aria-label={t('detail.closeLabel')}>
                <X size={20} />
              </button>
            </Dialog.Close>
            <Flag code={r.region.code} title={r.region.name} />
            {name}
            {nav}
          </div>
          <header className="quote-banner">
            {quote}
            <div className="qb-badges">{badges}</div>
            {book}
          </header>
        </>
      ) : (
        <header className="quote-banner">
          <div className="qb-id">
            <Flag code={r.region.code} title={r.region.name} />
            {name}
            {badges}
          </div>
          {quote}
          {book}
          <div className="qb-tools">
            <span className="qb-seen">
              <span>{t('common.lastSeen')} <b className="num">{ago(r.lastSeen, now)}</b></span>
              <small className="num">{r.lastSeen ? `${clock(r.lastSeen)} ${utcOffset(r.lastSeen)}` : '—'}</small>
            </span>
            {nav}
            <Dialog.Close asChild>
              <button type="button" className="close-btn" aria-label={t('detail.closeLabel')}>
                {t('common.close')} <X size={14} />
              </button>
            </Dialog.Close>
          </div>
        </header>
      )}

      <Suspense fallback={<div className="detail-grid" aria-busy="true" />}>
      <div className="detail-grid" ref={grid}>
        <div className="detail-main">
          <section className="panel chart-panel chart-main">
            <div className="panel-head compact">
              <h3>
                {t('detail.cpuTitle')} <small>{settings.chartStyle === 'line' ? t('common.line') : t('common.candle')} · {t('detail.subPane', { name: sub === 'vol' ? t('detail.subVol') : t('detail.subConn') })}</small>
              </h3>
              <div className="chart-tools">
                {pin !== null && (
                  <Tip content={t('chart.pinClear', { time: pinText })}>
                    <button type="button" className={clsx('chip pin-chip', away && 'is-away')} onClick={clearPin} aria-label={t('chart.pinClear', { time: pinText })}>
                      <LocateFixed size={12} aria-hidden="true" />
                      <span className="num">{pinText}</span>
                      <X size={12} aria-hidden="true" />
                    </button>
                  </Tip>
                )}
                <span className="chart-now num">
                  {t('detail.coverage')} <b>{cpuStats ? `${Math.round(cpuStats.coverage * 100)}%` : '—'}</b>
                </span>
                {/* A reading preference: kept in this browser, and the memory and disk charts follow it. */}
                <Segmented className="range-tabs look-tabs" value={settings.chartStyle} options={LOOKS} format={(v) => (v === 'line' ? t('common.line') : t('common.candle'))} onChange={setLook} label={t('detail.chartStyle')} />
                <Segmented className="range-tabs" value={range} options={available.ranges} onChange={onRange} label={t('detail.range')} />
              </div>
            </div>
            <KLineChart look={settings.chartStyle} marks={marks.cpu} slots={cpu} volume={volume} sub={sub} onSub={onSub} conn={conn} format={fmtPct} percent ma loading={loading} stale={stale} offline={!r.online} label={t('detail.cpuTitle')} rangeKey={dataKey} />
          </section>

          <PingPanel uuid={uuid} range={range} refreshSeconds={settings.refreshSeconds} offline={!r.online} pick={ping} onPick={onPing} />

          <div className="detail-minis">
            <section className="panel chart-panel chart-mini">
              <div className="panel-head compact">
                <h3>
                  {t('detail.memUsed')} <small>GiB</small>
                </h3>
                <span className="chart-now num">
                  {t('detail.current')} <b>{st ? `${fmtGiB(st.ram / GIB)} / ${fmtGiB(memTotal ?? 0)}` : '—'}</b>
                  {st && <em className="dim"> {pct(ratio(st.ram, st.ram_total || r.node.mem_total))}</em>}
                  <RangeNote stats={memStats} />
                </span>
              </div>
              <KLineChart look={settings.chartStyle} marks={marks.mem} slots={mem} format={fmtGiB} loading={loading} stale={stale} offline={!r.online} label={t('detail.memUsed')} rangeKey={dataKey} />
            </section>
            <section className="panel chart-panel chart-mini">
              <div className="panel-head compact">
                <h3>
                  {t('detail.diskUsed')} <small>GiB</small>
                </h3>
                <span className="chart-now num">
                  {t('detail.current')} <b>{st ? `${fmtGiB(st.disk / GIB)} / ${fmtGiB(diskTotal ?? 0)}` : '—'}</b>
                  {st && <em className="dim"> {pct(ratio(st.disk, st.disk_total || r.node.disk_total))}</em>}
                  <RangeNote stats={diskStats} />
                </span>
              </div>
              <KLineChart look={settings.chartStyle} slots={disk} format={fmtGiB} loading={loading} stale={stale} offline={!r.online} label={t('detail.diskUsed')} rangeKey={dataKey} />
            </section>
          </div>

        </div>

        <aside className="detail-side" aria-label={t('detail.facts')}>
          {/* On a desktop the facts share the CPU and ping rows, the events taking what is left;
              elsewhere this wrapper is no box and the panels lay out as the column's own. */}
          <div className="side-stack">
            <LocationPanel r={r} />
            <NetworkPanel r={r} volume={volume} month={traffic.month} total={traffic.total} />
            <InfoPanel r={r} admin={admin} now={now} leadDays={leadDays ?? 7} ops={ops} notice={notice} />
            <EventsPanel events={settings.showEvents ? events : null} now={now} top={<UptimeStrip key={r.node.uuid} r={r} now={now} reach={reach} onShow={showDay} />} />
          </div>
          {/* Last; on a desktop it sits level with the memory and disk charts. */}
          <LoadPanel r={r} h={h} look={settings.chartStyle} loading={loading} stale={stale} rangeKey={dataKey} />
        </aside>
      </div>
      </Suspense>

      {pin !== null && (
        <div className="pin-bar" role="group" aria-label={t('chart.pinned', { time: pinText })}>
          <LocateFixed size={14} aria-hidden="true" />
          <b className="num">{pinText}</b>
          {/* aria-disabled, not disabled: an end reached keeps the focus on its button. */}
          <button type="button" className="icon-btn" onClick={() => prevPin !== null && setPin(prevPin)} aria-disabled={prevPin === null} aria-label={t('chart.pinPrev')}>
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" onClick={() => nextPin !== null && setPin(nextPin)} aria-disabled={nextPin === null} aria-label={t('chart.pinNext')}>
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn" onClick={clearPin} aria-label={t('chart.pinClear', { time: pinText })}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}
      <span className="sr-only" role="status">
        {pin !== null ? t('chart.pinned', { time: pinText }) : hadPin ? t('chart.unpinned') : ''}
      </span>
    </div>
  )
}

export function NodeDetail({ rows, order, settings, traffic, now, ready }: { rows: Row[]; order: Row[]; settings: ThemeSettings; traffic: NodeTraffic | undefined; now: number; ready: boolean }) {
  const { t } = useTranslation()
  const match = useMatch('/instance/:uuid')
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  const uuid = match?.params.uuid
  const open = !!uuid
  // A pin, zoom or crosshair goes with the drawer, also while it is still closing (reopened then,
  // the same node's charts would keep them).
  useEffect(() => {
    if (!open) resetSync()
  }, [open])
  // Keep the last node during the exit animation.
  const [lastUuid, setLastUuid] = useState(uuid)
  if (uuid && uuid !== lastUuid) setLastUuid(uuid)
  const r = rows.find((x) => x.node.uuid === (uuid ?? lastUuid))
  // The picked range and ping carrier hold while paging between nodes and reset when the drawer closes.
  const [picked, setPicked] = useState<Range | null>(null)
  const [ping, setPing] = useState<PingPick | null>(null)
  const [sub, setSub] = useState<SubPane>('vol')
  if (!open && picked !== null) setPicked(null)
  if (!open && ping !== null) setPing(null)
  if (!open && sub !== 'vol') setSub('vol')

  const close = useCallback(() => {
    if ((location.state as { fromBoard?: boolean } | null)?.fromBoard) navigate(-1)
    else navigate({ pathname: '/', search: location.search }, { replace: true })
  }, [location.state, location.search, navigate])

  // [ / ] page through the board in its on-screen order, as it was when the drawer opened: a board
  // sorted by a live value reshuffles every refresh, and paging must not revisit nodes because of it.
  // A node that was not on screen (filtered out, or opened from a link) pages through every node for
  // the whole visit, so stepping onto a node that is on screen does not shrink the range midway.
  const [snapshot, setSnapshot] = useState<string[] | 'all' | null>(null)
  if (open && !snapshot && r) setSnapshot(order.some((x) => x.node.uuid === r.node.uuid) ? order.map((x) => x.node.uuid) : 'all')
  if (!open && snapshot) setSnapshot(null)
  const nav = useMemo(() => {
    if (!snapshot || snapshot === 'all') return rows
    const byId = new Map(rows.map((x) => [x.node.uuid, x]))
    const list = snapshot.flatMap((id) => byId.get(id) ?? [])
    return r && list.some((x) => x.node.uuid === r.node.uuid) ? list : rows
  }, [snapshot, rows, r])
  const step = useCallback(
    (d: number) => {
      if (!nav.length || !r) return
      // Read the node from the live URL: a quick second press can arrive before the re-render.
      let current = r.node.uuid
      try {
        current = decodeURIComponent(window.location.pathname.match(/\/instance\/([^/]+)/)?.[1] ?? current)
      } catch {
        // malformed escape in a hand-typed URL: keep the rendered node
      }
      const i = nav.findIndex((x) => x.node.uuid === current)
      const next = i < 0 ? nav[0] : nav[(((i + d) % nav.length) + nav.length) % nav.length]
      navigate({ pathname: `/instance/${next.node.uuid}`, search: location.search }, { replace: true, state: location.state })
    },
    [nav, r, navigate, location.state, location.search],
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === '[') step(-1)
      if (e.key === ']') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, step])

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <motion.div className="drawer-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              forceMount
              aria-describedby={undefined}
              // Esc closes an opened day of the availability strip, then clears a pinned time; the
              // next one closes the drawer.
              onEscapeKeyDown={(e) => {
                if (closeUptimeDay()) return e.preventDefault()
                if (useChartSync.getState().pin === null) return
                e.preventDefault()
                clearPin()
              }}
              // Focus the drawer itself (announced by its title), not its first button.
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                ;(e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
              }}
              // Back on the board, focus the row of the node viewed last; paging may have left the
              // row that opened the drawer far behind. A node not on the board (filtered out, or
              // opened from a link) hands focus to the board's first row, not to the page body.
              onCloseAutoFocus={(e) => {
                const row = (lastUuid ? document.querySelector<HTMLElement>(`.qrow[data-uuid="${CSS.escape(lastUuid)}"]`) : null) ?? document.querySelector<HTMLElement>('.qrow')
                if (!row) return
                e.preventDefault()
                row.focus({ preventScroll: true })
                row.scrollIntoView({ block: 'nearest' })
              }}
            >
              <motion.div
                className="drawer"
                initial={{ x: reduce ? 0 : '100%', opacity: reduce ? 0 : 1 }}
                animate={{ x: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ x: reduce ? 0 : '100%', opacity: reduce ? 0 : 1, transition: { duration: reduce ? 0 : 0.2, ease: [0.4, 0, 1, 1] } }}
              >
                {r ? (
                  <div className="drawer-page">
                    <DetailBody r={r} rows={nav} settings={settings} traffic={{ month: traffic?.month.get(r.node.uuid), total: traffic?.total.get(r.node.uuid) }} now={now} picked={picked ?? settings.defaultRange} onRange={setPicked} ping={ping} onPing={setPing} sub={sub} onSub={setSub} onStep={step} />
                  </div>
                ) : (
                  <div className="detail-missing">
                    <Dialog.Title>{ready ? t('detail.missing') : t('common.loading')}</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="close-btn">
                        {t('detail.back')} <X size={14} />
                      </button>
                    </Dialog.Close>
                  </div>
                )}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  )
}
