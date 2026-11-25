import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { fitRange, useAvailableRanges, useClientOps, useConnHistory, useExpiryLeadDays, useHistory, useIsAdmin } from '../../lib/api'
import { buildCandles, buildVolume, inferEvents, rangeStats } from '../../lib/candles'
import { ago, clock, finite, pct, ratio, signed, utcOffset } from '../../lib/format'
import type { Row } from '../../lib/model'
import { usePrefs, type ChartStyle, type Range, type ThemeSettings } from '../../lib/settings'
import { Flag, Segmented, Tick } from '../primitives'
import { AdminPanel, EventsPanel, LocationPanel, NetworkPanel, StatBook, SystemPanel } from './Panels'
import { resetSync } from './chartSync'
import { PingPanel, type PingPick } from './PingPanel'

// lightweight-charts is only needed once a detail drawer opens.
const KLineChart = lazy(() => import('./KLineChart'))
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

function DetailBody({ r, rows, settings, traffic, monthly, now, picked, onRange, ping, onPing, sub, onSub, onStep }: { r: Row; rows: Row[]; settings: ThemeSettings; traffic: { up: number; down: number } | null; monthly: boolean; now: number; picked: Range; onRange: (r: Range) => void; ping: PingPick | null; onPing: (p: PingPick | null) => void; sub: SubPane; onSub: (s: SubPane) => void; onStep: (d: number) => void }) {
  const { t } = useTranslation()
  const admin = useIsAdmin()
  const ops = useClientOps(admin).data?.[r.node.uuid]
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
  // A shared crosshair or zoom belongs to the data it was made on.
  useEffect(() => resetSync(), [dataKey])

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

  return (
    <div className="detail">
      <header className="quote-banner">
        <div className="qb-id">
          <Flag code={r.region.code} title={r.region.name} />
          <div className="qb-name">
            <Dialog.Title asChild>
              <h2 className="num" title={r.node.name}>
                {r.node.name}
              </h2>
            </Dialog.Title>
            <span className="node-code num">
              {r.code.area}·<em>{r.code.hash}</em>
            </span>
          </div>
          <span className={clsx('badge', r.online ? 'badge-on' : 'badge-off')}>
            <i aria-hidden="true" />
            {r.online ? t('common.online') : t('common.offline')}
          </span>
          {r.node.hidden && (
            <span className="badge badge-hidden" title={t('common.hiddenHint')}>
              {t('common.hidden')}
            </span>
          )}
        </div>

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

        <StatBook stats={cpuStats} format={fmtPct} items={['high', 'low', 'avg', 'p95']} />

        <div className="qb-tools">
          <span className="qb-seen">
            <span>{t('common.lastSeen')} <b className="num">{ago(r.lastSeen, now)}</b></span>
            <small className="num">{r.lastSeen ? `${clock(r.lastSeen)} ${utcOffset(r.lastSeen)}` : '—'}</small>
          </span>
          <div className="qb-nav">
            <button type="button" className="icon-btn" onClick={() => onStep(-1)} disabled={rows.length < 2} aria-label={t('detail.prev')} title={t('detail.prevHint')}>
              <ChevronLeft size={15} />
            </button>
            <span className="num dim">
              {idx + 1}/{rows.length}
            </span>
            <button type="button" className="icon-btn" onClick={() => onStep(1)} disabled={rows.length < 2} aria-label={t('detail.next')} title={t('detail.nextHint')}>
              <ChevronRight size={15} />
            </button>
          </div>
          <Dialog.Close asChild>
            <button type="button" className="close-btn" aria-label={t('detail.closeLabel')}>
              {t('common.close')} <X size={14} />
            </button>
          </Dialog.Close>
        </div>
      </header>

      <Suspense fallback={<div className="detail-grid" aria-busy="true" />}>
      <div className="detail-grid" ref={grid}>
        <div className="detail-main">
          <section className="panel chart-panel chart-main">
            <div className="panel-head compact">
              <h3>
                {t('detail.cpuTitle')} <small>{settings.chartStyle === 'line' ? t('common.line') : t('common.candle')} · {t('detail.subPane', { name: sub === 'vol' ? t('detail.subVol') : t('detail.subConn') })}</small>
              </h3>
              <div className="chart-tools">
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
          <LocationPanel r={r} />
          <NetworkPanel r={r} volume={volume} traffic={traffic} monthly={monthly} />
          <SystemPanel r={r} />
          {admin && <AdminPanel r={r} now={now} leadDays={leadDays ?? 7} ops={ops} />}
          {/* Last, so on a desktop it takes whatever height the column has left. */}
          {settings.showEvents && <EventsPanel events={events} now={now} />}
        </aside>
      </div>
      </Suspense>
    </div>
  )
}

export function NodeDetail({ rows, order, settings, traffic, monthly, now, ready }: { rows: Row[]; order: Row[]; settings: ThemeSettings; traffic: (r: Row) => { up: number; down: number } | null; monthly: boolean; now: number; ready: boolean }) {
  const { t } = useTranslation()
  const match = useMatch('/instance/:uuid')
  const navigate = useNavigate()
  const location = useLocation()
  const reduce = useReducedMotion()
  const uuid = match?.params.uuid
  const open = !!uuid
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
              // Focus the drawer itself (announced by its title), not its first button.
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                ;(e.currentTarget as HTMLElement | null)?.focus({ preventScroll: true })
              }}
              // Back on the board, focus the row of the node viewed last; paging may have left the
              // row that opened the drawer far behind. A node not on the board (filtered out, or
              // opened from a link) hands focus to the board's first row, not to the page body.
              onCloseAutoFocus={(e) => {
                const row = (lastUuid ? document.querySelector<HTMLElement>(`a.qrow[data-uuid="${CSS.escape(lastUuid)}"]`) : null) ?? document.querySelector<HTMLElement>('a.qrow')
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
                    <DetailBody r={r} rows={nav} settings={settings} traffic={traffic(r)} monthly={monthly} now={now} picked={picked ?? settings.defaultRange} onRange={setPicked} ping={ping} onPing={setPing} sub={sub} onSub={setSub} onStep={step} />
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
