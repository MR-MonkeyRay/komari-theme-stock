import NumberFlowBase from '@number-flow/react'
import clsx from 'clsx'
import { Monitor, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { resolveTheme, type Appearance } from '../lib/appearance'
import { clock, dateText, finite, signed, sizeParts, utcOffset } from '../lib/format'
import type { Bulletin, MarketSummary } from '../lib/market'
import { dirOf } from '../lib/model'
import { lastLatency } from '../lib/rpc'
import { Tick } from './primitives'

// Quote-board digits roll quickly so 2 s ticks never overlap.
const FLOW_TIMING = { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
function NumberFlow(props: ComponentProps<typeof NumberFlowBase>) {
  return <NumberFlowBase transformTiming={FLOW_TIMING} spinTiming={FLOW_TIMING} opacityTiming={{ duration: 200, easing: 'ease-out' }} {...props} />
}

const MODES: Record<Appearance, { label: string; icon: typeof Sun }> = {
  system: { label: '自动', icon: Monitor },
  light: { label: '浅色', icon: Sun },
  dark: { label: '深色', icon: Moon },
}

/**
 * Cycle: auto → the opposite of the system theme → the system theme → auto,
 * so each explicit step visibly changes the page.
 */
function nextAppearance(a: Appearance): Appearance {
  const os = resolveTheme('system')
  const other = os === 'dark' ? 'light' : 'dark'
  return a === 'system' ? other : a === other ? os : 'system'
}

/** One button for page colors; shows the current mode (default: auto, following the system). */
export function ThemeToggle({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  const { label, icon: Icon } = MODES[value]
  const next = nextAppearance(value)
  const hint = `配色：${label}${value === 'system' ? '（跟随系统）' : ''}，点击切换为${MODES[next].label}`
  return (
    <button type="button" className="theme-toggle" onClick={() => onChange(nextAppearance(value))} title={hint} aria-label={hint}>
      <span className="theme-toggle-icon" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.span
            key={value}
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <Icon size={14} strokeWidth={2} />
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="theme-toggle-label">{label}</span>
    </button>
  )
}

export function TopBar({ siteName, live, refreshSeconds, now, appearance, onAppearance }: { siteName: string; live: boolean; refreshSeconds: number; now: number; appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  return (
    <header className="topbar">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label={`${siteName} 首页`}>
        <span className="logomark" aria-hidden="true">
          K
        </span>
        <strong>{siteName}</strong>
        <span className="crumb">/ 节点行情</span>
      </a>
      <div className="topbar-tools">
        <span className={clsx('market', live ? 'is-live' : 'is-stale')} title={live ? `每 ${refreshSeconds} 秒刷新` : '实时数据暂不可用'}>
          <i aria-hidden="true" />
          <span className="market-text">{live ? '实时' : '中断'}</span>
          <small className="num">{refreshSeconds}s</small>
        </span>
        <span className="clock num" aria-label="当前时间">
          <span className="clock-date">{dateText(now)} </span>
          <b>{clock(now)}</b> <small>{utcOffset(now)}</small>
        </span>
        <ThemeToggle value={appearance} onChange={onAppearance} />
      </div>
    </header>
  )
}

// Values that change every refresh switch digits in place and flash, like quote cells; only the
// low-frequency node counts roll.
function Live({ value, digits = 1, suffix }: { value: number | null; digits?: number; suffix?: string }) {
  if (!finite(value)) return <span className="dash">—</span>
  return (
    <Tick value={value} threshold={0.5}>
      {value.toFixed(digits)}
      {suffix}
    </Tick>
  )
}

function LiveSize({ bytes, rate }: { bytes: number | null; rate?: boolean }) {
  const p = sizeParts(bytes, rate, true)
  if (!p) return <span className="dash">—</span>
  return (
    <>
      <Tick value={bytes} threshold={Math.max((bytes ?? 0) * 0.08, 16 * 1024)}>{p[0]}</Tick>
      <small className="unit">{p[1]}</small>
    </>
  )
}

export function IndexStrip({ m, loading }: { m: MarketSummary; loading: boolean }) {
  const normal = Math.max(0, m.online - m.hot)
  const dir = dirOf(m.cpuDelta) ?? 'flat'
  return (
    <section className="index-strip" aria-label="全网概览">
      <div className="ix ix-breadth">
        <span className="ix-label">节点 · 在线 / 离线</span>
        <span className="ix-value num">
          {loading ? <span className="skeleton" style={{ width: 90, height: 18 }} /> : (
            <>
              <NumberFlow value={m.total} />
              <span className="ix-sep">·</span>
              <span className="good">
                <NumberFlow value={m.online} />
              </span>
              <span className="ix-sep">/</span>
              <span className={m.offline ? 'bad' : 'dim'}>
                <NumberFlow value={m.offline} />
              </span>
            </>
          )}
        </span>
        <span className="breadth" aria-hidden="true">
          <i className="b-normal" style={{ flexGrow: normal }} />
          <i className="b-hot" style={{ flexGrow: m.hot }} />
          <i className="b-off" style={{ flexGrow: m.offline }} />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">CPU 中位数</span>
        <span className="ix-value num">
          <Live value={m.cpuMedian} suffix="%" />
          {finite(m.cpuDelta) && (
            <span className={clsx('ix-delta', dir)} title="较近 1 小时全网中位数均值，单位为百分点">
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {signed(m.cpuDelta, 1)}
              <small>pp</small>
            </span>
          )}
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">内存占用</span>
        <span className="ix-value num">
          <Live value={m.memRatio} suffix="%" />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">总上行</span>
        <span className="ix-value num net-up">
          <LiveSize bytes={m.up} rate />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">总下行</span>
        <span className="ix-value num net-down">
          <LiveSize bytes={m.down} rate />
        </span>
      </div>
      <div className="ix ix-traffic">
        <span className="ix-label">{m.traffic?.monthly ? '本月流量 ↑ / ↓' : '累计流量 ↑ / ↓'}</span>
        <span className="ix-value num ix-small">
          {m.traffic ? (
            <>
              <LiveSize bytes={m.traffic.up} />
              <span className="ix-sep">/</span>
              <LiveSize bytes={m.traffic.down} />
            </>
          ) : (
            <span className="dash">—</span>
          )}
        </span>
      </div>
    </section>
  )
}

export function StatusBar({ live, items, version }: { live: boolean; items: Bulletin[]; version?: string }) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const list = useMemo(() => (items.length ? items : [{ id: 'calm', level: 'info' as const, text: '全部节点运行平稳' }]), [items])
  useEffect(() => {
    if (paused || list.length < 2) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % list.length), 5000)
    return () => window.clearInterval(id)
  }, [paused, list.length])
  const current = list[index % list.length]
  return (
    <footer className="statusbar">
      <span className={clsx('sb-conn', live ? 'is-live' : 'is-stale')}>
        <i aria-hidden="true" />
        {live ? '已连接' : '连接中断'}
        {live && finite(lastLatency) && <span className="num dim"> · {Math.round(lastLatency)}ms</span>}
      </span>
      <span className="sb-news" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} aria-live="polite">
        <span className="sb-news-tag">异动</span>
        <span className="sb-news-track">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={current.id}
              className={clsx('sb-news-item', `is-${current.level}`)}
              initial={{ y: 8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {current.text}
            </motion.span>
          </AnimatePresence>
        </span>
        {list.length > 1 && <span className="num dim sb-news-count">{(index % list.length) + 1}/{list.length}</span>}
      </span>
      <span className="sb-powered">
        <span className="sb-hints">
          <kbd>↑↓</kbd> 选行 · <kbd>Enter</kbd> 详情 · <kbd>/</kbd> 搜索 · <kbd>[ ]</kbd> 翻节点
        </span>
        <a href="https://github.com/komari-monitor/komari" target="_blank" rel="noreferrer">
          Powered by Komari Monitor.
        </a>
        {version && <span className="num dim"> v{version}</span>}
      </span>
    </footer>
  )
}
