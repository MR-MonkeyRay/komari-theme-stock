import { useCallback, useEffect, useMemo, useRef } from 'react'
import { monthStart, useLatestStatus, useMetricDefinitions, useMonthlyTraffic, useNodes, usePublicSettings, useSparklines } from './lib/api'
import { useAppearance } from './lib/appearance'
import { buildRows, useNow, type Row } from './lib/model'
import { CONTINENTS } from './lib/region'
import { readSettings } from './lib/settings'
import { IndexStrip, StatusBar, TopBar } from './components/Chrome'
import { bulletins, summarize } from './lib/market'
import { QuoteBoard, type BoardExtras } from './components/QuoteBoard'
import { NodeDetail } from './components/detail/NodeDetail'

export default function App() {
  const [appearance, setAppearance] = useAppearance()
  const pub = usePublicSettings()
  const settings = useMemo(() => readSettings(pub.data), [pub.data])
  const nodes = useNodes()
  const status = useLatestStatus(settings.refreshSeconds)
  const defs = useMetricDefinitions()
  const now = useNow(1000)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    document.documentElement.dataset.convention = settings.redUp ? 'red-up' : 'green-up'
  }, [settings.redUp])

  const rows = useMemo(() => buildRows(nodes.data, status.data), [nodes.data, status.data])
  // Same order as the grouped board, so [ / ] in the drawer pages through what is on screen.
  const navRows = useMemo(() => {
    if (settings.groupBy === 'none') return rows
    const key = (r: Row) => (settings.groupBy === 'continent' ? r.region.continent : r.node.group?.trim() || '未分组')
    const order = settings.groupBy === 'continent' ? CONTINENTS.map((c) => c.code as string) : [...new Set(rows.map(key))]
    return [...rows].sort((a, b) => order.indexOf(key(a)) - order.indexOf(key(b)))
  }, [rows, settings.groupBy])
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

  const extras: BoardExtras = useMemo(() => ({ sparks: sparks.data, traffic, trafficMonthly: useMonthly, now }), [sparks.data, traffic, useMonthly, now])

  const market = useMemo(() => {
    const totals = rows.map(traffic).filter((t): t is { up: number; down: number } => !!t)
    const sum = totals.length ? { up: totals.reduce((a, t) => a + t.up, 0), down: totals.reduce((a, t) => a + t.down, 0), monthly: useMonthly } : null
    return summarize(rows, sparks.data, sum)
  }, [rows, sparks.data, traffic, useMonthly])

  // "/" focuses search from anywhere outside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (document.querySelector('.drawer')) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const live = status.isSuccess && !status.isError
  const siteName = pub.data?.sitename || 'Komari'

  return (
    <>
      <TopBar siteName={siteName} live={live} refreshSeconds={settings.refreshSeconds} now={now} appearance={appearance} onAppearance={setAppearance} />
      <IndexStrip m={market} loading={nodes.isLoading} />
      <main className="page">
        {nodes.isError ? (
          <section className="panel error-panel">
            <h1>无法加载节点</h1>
            <p className="dim">{(nodes.error as Error)?.message || '请检查 Komari 后端是否可访问，或站点是否开启了私有模式。'}</p>
          </section>
        ) : (
          <QuoteBoard rows={rows} settings={settings} x={extras} loading={nodes.isLoading} searchRef={searchRef} />
        )}
      </main>
      <StatusBar live={live} items={bulletins(rows)} />
      <NodeDetail rows={navRows} settings={settings} traffic={traffic} monthly={useMonthly} now={now} ready={nodes.isSuccess} />
    </>
  )
}
