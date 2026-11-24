import * as Dialog from '@radix-ui/react-dialog'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router'
import { fitRange, useAvailableRanges, useClientOps, useExpiryLeadDays, useHistory, useIsAdmin } from '../../lib/api'
import { buildCandles, buildVolume, inferEvents, rangeStats } from '../../lib/candles'
import { ago, clock, finite, pct, ratio, signed, utcOffset } from '../../lib/format'
import type { Row } from '../../lib/model'
import type { Range, ThemeSettings } from '../../lib/settings'
import { Flag, Segmented, Tick } from '../primitives'
import { BillingPanel, EventsPanel, LocationPanel, NetworkPanel, StatBook, SystemPanel } from './Panels'

// lightweight-charts is only needed once a detail drawer opens.
const KLineChart = lazy(() => import('./KLineChart'))

const GIB = 1024 ** 3
const fmtPct = (v: number) => `${v.toFixed(1)}%`
const fmtGiB = (v: number) => v.toFixed(v >= 100 ? 1 : 2)

function DetailBody({ r, rows, settings, traffic, monthly, now, onStep }: { r: Row; rows: Row[]; settings: ThemeSettings; traffic: { up: number; down: number } | null; monthly: boolean; now: number; onStep: (d: number) => void }) {
  const admin = useIsAdmin()
  const ops = useClientOps(admin).data?.[r.node.uuid]
  const leadDays = useExpiryLeadDays(admin)
  const [picked, setRange] = useState<Range>(settings.defaultRange)
  const available = useAvailableRanges()
  const range = fitRange(picked, available)
  const history = useHistory(r.node.uuid, range, settings.refreshSeconds)
  const h = history.data
  const uuid = r.node.uuid
  const fresh = !!h && !history.isPlaceholderData

  const cpu = useMemo(() => (h && fresh ? buildCandles(h, 'cpu.usage', uuid) : []), [h, fresh, uuid])
  const mem = useMemo(() => (h && fresh ? buildCandles(h, 'memory.used', uuid, GIB) : []), [h, fresh, uuid])
  const disk = useMemo(() => (h && fresh ? buildCandles(h, 'disk.used', uuid, GIB) : []), [h, fresh, uuid])
  const volume = useMemo(() => (h && fresh ? buildVolume(h, uuid) : []), [h, fresh, uuid])
  const cpuStats = useMemo(() => rangeStats(cpu), [cpu])
  const memStats = useMemo(() => rangeStats(mem), [mem])
  const diskStats = useMemo(() => rangeStats(disk), [disk])

  const st = r.online ? r.status : undefined
  const memTotal = (st?.ram_total || r.node.mem_total) / GIB || null
  const diskTotal = (st?.disk_total || r.node.disk_total) / GIB || null
  const events = useMemo(() => inferEvents(cpu, mem, memTotal, r.online, r.lastSeen), [cpu, mem, memTotal, r.online, r.lastSeen])

  const price = r.cpu ?? cpuStats?.close ?? null
  const open = cpuStats?.open ?? null
  const change = finite(price) && finite(open) ? price - open : null
  // Relative change is noise when the range opens near zero.
  const changePct = finite(change) && finite(open) && open >= 5 ? (change / open) * 100 : null
  const dir = !r.online ? 'off' : finite(change) ? (change > 0.05 ? 'up' : change < -0.05 ? 'down' : 'flat') : 'flat'
  const idx = rows.findIndex((x) => x.node.uuid === uuid)
  const loading = history.isFetching && !fresh

  return (
    <div className="detail">
      <header className="quote-banner">
        <div className="qb-id">
          <Flag code={r.region.code} title={r.region.name} />
          <div className="qb-name">
            <Dialog.Title asChild>
              <h2 className="num">{r.node.name}</h2>
            </Dialog.Title>
            <span className="node-code num">
              {r.code.area}·<em>{r.code.hash}</em>
            </span>
          </div>
          <span className={clsx('badge', r.online ? 'badge-on' : 'badge-off')}>
            <i aria-hidden="true" />
            {r.online ? '在线' : '离线'}
          </span>
          {r.node.hidden && (
            <span className="badge badge-hidden" title="后台设为隐藏：只有登录后才看得到">
              隐藏
            </span>
          )}
        </div>

        <div className={clsx('qb-price', dir)}>
          <span className="qb-label">{r.online ? 'CPU' : 'CPU 末值'}</span>
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
            <span>最后上报 <b className="num">{ago(r.lastSeen, now)}</b></span>
            <small className="num">{r.lastSeen ? `${clock(r.lastSeen)} ${utcOffset(r.lastSeen)}` : '—'}</small>
          </span>
          <div className="qb-nav">
            <button type="button" className="icon-btn" onClick={() => onStep(-1)} disabled={rows.length < 2} aria-label="上一个节点" title="上一个节点 [">
              <ChevronLeft size={15} />
            </button>
            <span className="num dim">
              {idx + 1}/{rows.length}
            </span>
            <button type="button" className="icon-btn" onClick={() => onStep(1)} disabled={rows.length < 2} aria-label="下一个节点" title="下一个节点 ]">
              <ChevronRight size={15} />
            </button>
          </div>
          <Dialog.Close asChild>
            <button type="button" className="close-btn" aria-label="关闭详情">
              关闭 <X size={14} />
            </button>
          </Dialog.Close>
        </div>
      </header>

      {!r.online && <div className="offline-notice">节点离线 · 以下仅显示已留存的历史样本</div>}

      <Suspense fallback={<div className="detail-grid" aria-busy="true" />}>
      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel chart-panel chart-main">
            <div className="panel-head compact">
              <h3>
                CPU 使用率 <small>K 线 · 网络副图</small>
              </h3>
              <div className="chart-tools">
                <span className="chart-now num">
                  覆盖 <b>{cpuStats ? `${Math.round(cpuStats.coverage * 100)}%` : '—'}</b>
                </span>
                <Segmented className="range-tabs" value={range} options={available.ranges} onChange={setRange} label="时间范围" />
              </div>
            </div>
            <KLineChart slots={cpu} volume={volume} format={fmtPct} percent ma loading={loading} offline={!r.online} label="CPU 使用率" rangeKey={`${uuid}-${range}`} />
          </section>

          <div className="detail-minis">
            <section className="panel chart-panel chart-mini">
              <div className="panel-head compact">
                <h3>
                  内存已用 <small>GiB</small>
                </h3>
                <span className="chart-now num">
                  当前 <b>{st ? `${fmtGiB(st.ram / GIB)} / ${fmtGiB(memTotal ?? 0)}` : '—'}</b>
                  {st && <em className="dim"> {pct(ratio(st.ram, st.ram_total || r.node.mem_total))}</em>}
                </span>
              </div>
              <KLineChart slots={mem} format={fmtGiB} loading={loading} offline={!r.online} label="内存已用" rangeKey={`${uuid}-${range}`} />
              <StatBook stats={memStats} format={fmtGiB} items={['avg', 'high']} />
            </section>
            <section className="panel chart-panel chart-mini">
              <div className="panel-head compact">
                <h3>
                  磁盘已用 <small>GiB</small>
                </h3>
                <span className="chart-now num">
                  当前 <b>{st ? `${fmtGiB(st.disk / GIB)} / ${fmtGiB(diskTotal ?? 0)}` : '—'}</b>
                  {st && <em className="dim"> {pct(ratio(st.disk, st.disk_total || r.node.disk_total))}</em>}
                </span>
              </div>
              <KLineChart slots={disk} format={fmtGiB} loading={loading} offline={!r.online} label="磁盘已用" rangeKey={`${uuid}-${range}`} />
              <StatBook stats={diskStats} format={fmtGiB} items={['avg', 'high']} />
            </section>
          </div>

          {/* Bottom row under the charts; either panel may be absent (events off, no billing data). */}
          <div className="detail-bottom">
            {settings.showEvents && <EventsPanel events={events} now={now} />}
            {admin && <BillingPanel r={r} now={now} leadDays={leadDays ?? 7} />}
          </div>
        </div>

        <aside className="detail-side" aria-label="节点资料">
          <LocationPanel r={r} />
          <NetworkPanel r={r} volume={volume} traffic={traffic} monthly={monthly} />
          <SystemPanel r={r} ops={admin ? ops : undefined} />
        </aside>
      </div>
      </Suspense>
    </div>
  )
}

export function NodeDetail({ rows, order, settings, traffic, monthly, now, ready }: { rows: Row[]; order: Row[]; settings: ThemeSettings; traffic: (r: Row) => { up: number; down: number } | null; monthly: boolean; now: number; ready: boolean }) {
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
            <Dialog.Content asChild forceMount aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
              <motion.div
                className="drawer"
                initial={{ x: reduce ? 0 : '100%', opacity: reduce ? 0 : 1 }}
                animate={{ x: 0, opacity: 1, transition: { duration: reduce ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] } }}
                exit={{ x: reduce ? 0 : '100%', opacity: reduce ? 0 : 1, transition: { duration: reduce ? 0 : 0.2, ease: [0.4, 0, 1, 1] } }}
              >
                {r ? (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div key={r.node.uuid} className="drawer-page" initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.16 }}>
                      <DetailBody r={r} rows={nav} settings={settings} traffic={traffic(r)} monthly={monthly} now={now} onStep={step} />
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <div className="detail-missing">
                    <Dialog.Title>{ready ? '节点不存在或未公开' : '加载中…'}</Dialog.Title>
                    <Dialog.Close asChild>
                      <button type="button" className="close-btn">
                        返回列表 <X size={14} />
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
