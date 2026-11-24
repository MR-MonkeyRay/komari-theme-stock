import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { monthStart, useExpiryLeadDays, useIsAdmin, useLatestStatus, useMe, useMetricDefinitions, useMonthlyTraffic, useNodes, usePublicSettings, useSparklines } from './lib/api'
import { useAppearance } from './lib/appearance'
import { buildRows, connState, useNow, type Row } from './lib/model'
import { useShallow } from 'zustand/react/shallow'
import { readSiteSettings, usePrefs, type ThemeSettings } from './lib/settings'
import { IndexStrip, StatusBar, TopBar } from './components/Chrome'
import { bulletins, summarize } from './lib/market'
import { boardView, useBoardQuery, useHeldOrder, type Quick } from './lib/board'
import { QuoteBoard, type BoardExtras } from './components/QuoteBoard'
import { NodeDetail } from './components/detail/NodeDetail'

export default function App() {
  const [appearance, setAppearance] = useAppearance()
  const pub = usePublicSettings()
  const site = useMemo(() => readSiteSettings(pub.data), [pub.data])
  const prefs = usePrefs(useShallow(({ redUp, showSparkline, refreshSeconds, defaultRange, showEvents }) => ({ redUp, showSparkline, refreshSeconds, defaultRange, showEvents })))
  const settings: ThemeSettings = useMemo(() => ({ ...site, ...prefs }), [site, prefs])
  const nodes = useNodes()
  const status = useLatestStatus(settings.refreshSeconds)
  const defs = useMetricDefinitions()
  const now = useNow(1000)
  const me = useMe()
  const leadDays = useExpiryLeadDays(useIsAdmin())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.convention = settings.redUp ? 'red-up' : 'green-up'
  }, [settings.redUp])

  // Hidden nodes only reach a logged-in session. The admin can leave them out for a while (say, for
  // a screenshot to share) without changing anything in Komari; a reload brings them back.
  const [showHidden, setShowHidden] = useState(true)
  const toggleHidden = useCallback(() => setShowHidden((v) => !v), [])
  // Gated on the login too: after logging out in another tab, the node list may still hold hidden
  // nodes until its next refresh.
  const admin = me.data?.logged_in === true
  const hiddenCount = useMemo(() => (admin ? (nodes.data ?? []).filter((n) => n.hidden).length : 0), [nodes.data, admin])
  const shownNodes = useMemo(() => (admin && showHidden ? nodes.data : nodes.data?.filter((n) => !n.hidden)), [nodes.data, admin, showHidden])
  const rows = useMemo(() => buildRows(shownNodes, status.data), [shownNodes, status.data])
  const uuids = useMemo(() => (nodes.data ?? []).map((n) => n.uuid), [nodes.data])
  const sparks = useSparklines(uuids, settings.showSparkline)

  // Natural-month traffic needs metric retention covering the month so far.
  const trafficRetention = defs.data?.find((d) => d.name === 'traffic.up')?.retention_days ?? 0
  const monthCovered = trafficRetention * 86400_000 >= now - monthStart(new Date(now)).getTime()
  const monthly = useMonthlyTraffic(uuids, monthCovered)
  const useMonthly = monthCovered && !!monthly.data

  const traffic = useCallback(
    (r: Row) => {
      if (useMonthly) return monthly.data?.get(r.node.uuid) ?? null
      const st = r.status
      return st && (st.net_total_up || st.net_total_down) ? { up: st.net_total_up, down: st.net_total_down } : null
    },
    [useMonthly, monthly.data],
  )

  // Grouping, tab, search and sort are applied once here: the board renders this view and the
  // drawer's [ / ] steps through the same on-screen order.
  const [query, setBoard] = useBoardQuery()
  const liveView = useMemo(() => boardView(rows, settings.groupBy, query, traffic), [rows, settings.groupBy, query, traffic])
  const onQuick = useCallback((quick: Quick) => setBoard({ quick }), [setBoard])
  const [holdOrder, setHoldOrder] = useState(false)
  const view = useHeldOrder(liveView, query, holdOrder)

  const minute = useNow(60_000)
  const extras: BoardExtras = useMemo(() => ({ sparks: sparks.data, traffic, trafficMonthly: useMonthly, minute }), [sparks.data, traffic, useMonthly, minute])

  const market = useMemo(() => {
    const totals = rows.map(traffic).filter((t): t is { up: number; down: number } => !!t)
    const sum = totals.length ? { up: totals.reduce((a, t) => a + t.up, 0), down: totals.reduce((a, t) => a + t.down, 0), monthly: useMonthly } : null
    return summarize(rows, sum)
  }, [rows, traffic, useMonthly])

  // "/" focuses search from anywhere outside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (document.querySelector('.drawer, .settings-panel, .sort-menu')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const conn = connState(status, settings.refreshSeconds, now)
  const retrying = conn === 'down' && status.isFetching
  const refetchStatus = status.refetch
  const retry = useCallback(() => void refetchStatus(), [refetchStatus])
  const siteName = pub.data?.sitename || 'Komari'
  const base = import.meta.env.BASE_URL
  const loginHref = `${base}admin/login?redirect=${encodeURIComponent(base)}`

  return (
    <>
      <TopBar siteName={siteName} conn={conn} retrying={retrying} updatedAt={status.dataUpdatedAt} onRetry={retry} refreshSeconds={settings.refreshSeconds} me={me.data} mePending={me.isPending} appearance={appearance} onAppearance={setAppearance} />
      <IndexStrip m={market} loading={nodes.isLoading} quick={query.quick} onQuick={onQuick} />
      <main className="page">
        {nodes.isError ? (
          <section className="panel error-panel">
            <h1>无法加载节点</h1>
            <p className="dim">{(nodes.error as Error)?.message || '请检查 Komari 后端是否可访问，或站点是否开启了私有模式。'}</p>
            <div className="error-actions">
              <button type="button" className="tool-btn" onClick={() => void nodes.refetch()} disabled={nodes.isFetching}>
                {nodes.isFetching ? '正在重试…' : '重试'}
              </button>
              {pub.data?.private_site && !me.data?.logged_in && (
                <a className="tool-btn is-primary" href={loginHref}>
                  登录后查看
                </a>
              )}
            </div>
          </section>
        ) : (
          <QuoteBoard rows={rows} view={view} onHold={setHoldOrder} hiddenCount={hiddenCount} showHidden={showHidden} onToggleHidden={toggleHidden} settings={settings} x={extras} loading={nodes.isLoading} searchRef={searchRef} />
        )}
        {/* Phones have no room in the status bar for the credit Komari requires. */}
        <p className="page-credit">
          <a href="https://github.com/komari-monitor/komari" target="_blank" rel="noreferrer">
            Powered by Komari Monitor.
          </a>
        </p>
      </main>
      <StatusBar conn={conn} retrying={retrying} onRetry={retry} items={bulletins(rows, leadDays !== null ? { now, leadDays } : null)} now={now} />
      <NodeDetail rows={rows} order={view.order} settings={settings} traffic={traffic} monthly={useMonthly} now={now} ready={nodes.isSuccess} />
    </>
  )
}
