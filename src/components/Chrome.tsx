import NumberFlowBase from '@number-flow/react'
import clsx from 'clsx'
import { Monitor, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import type { Appearance } from '../lib/appearance'
import { clock, dateText, finite, signed, sizeParts, utcOffset } from '../lib/format'
import type { Bulletin, MarketSummary } from '../lib/market'
import { lastLatency } from '../lib/rpc'

// Quote-board digits roll quickly so 2 s ticks never overlap.
const FLOW_TIMING = { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
function NumberFlow(props: ComponentProps<typeof NumberFlowBase>) {
  return <NumberFlowBase transformTiming={FLOW_TIMING} spinTiming={FLOW_TIMING} opacityTiming={{ duration: 200, easing: 'ease-out' }} {...props} />
}

export function ThemeSwitch({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  const items: { key: Appearance; label: string; icon: typeof Sun }[] = [
    { key: 'light', label: '浅色', icon: Sun },
    { key: 'dark', label: '深色', icon: Moon },
    { key: 'system', label: '自动', icon: Monitor },
  ]
  return (
    <div className="seg theme-switch" role="radiogroup" aria-label="页面配色">
      {items.map(({ key, label, icon: Icon }) => (
        <button key={key} type="button" role="radio" aria-checked={value === key} title={label} onClick={() => onChange(key)}>
          {value === key && <motion.span layoutId="theme-pill" className="seg-pill" transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} />}
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
          <span className="seg-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

export function TopBar({ siteName, live, refreshSeconds, now, appearance, onAppearance }: { siteName: string; live: boolean; refreshSeconds: number; now: number; appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  return (
    <header className="topbar">
      <a className="brand" href={import.meta.env.BASE_URL} aria-label={`${siteName} 首页`}>
        <span className="logomark" aria-hidden="true">
          K<i />
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
        <ThemeSwitch value={appearance} onChange={onAppearance} />
      </div>
    </header>
  )
}

function Flow({ value, digits = 1, suffix }: { value: number | null; digits?: number; suffix?: string }) {
  if (!finite(value)) return <span className="dash">—</span>
  return <NumberFlow value={value} format={{ minimumFractionDigits: digits, maximumFractionDigits: digits }} suffix={suffix} willChange />
}

function FlowSize({ bytes, rate }: { bytes: number | null; rate?: boolean }) {
  const p = sizeParts(bytes, rate)
  if (!p || p[0] === '<1') return <span>{p ? p.join('') : '—'}</span>
  return (
    <>
      <NumberFlow value={Number(p[0])} format={{ minimumFractionDigits: Number(p[0]) >= 100 ? 1 : 2, maximumFractionDigits: Number(p[0]) >= 100 ? 1 : 2 }} willChange />
      <small className="unit">{p[1]}</small>
    </>
  )
}

export function IndexStrip({ m, loading }: { m: MarketSummary; loading: boolean }) {
  const normal = Math.max(0, m.online - m.hot)
  const dir = finite(m.cpuDelta) ? (m.cpuDelta > 0.05 ? 'up' : m.cpuDelta < -0.05 ? 'down' : 'flat') : 'flat'
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
          <Flow value={m.cpuMedian} suffix="%" />
          {finite(m.cpuDelta) && (
            <span className={clsx('ix-delta', dir)} title="较 15 分钟前">
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} {signed(m.cpuDelta, 1)}
            </span>
          )}
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">内存占用</span>
        <span className="ix-value num">
          <Flow value={m.memRatio} suffix="%" />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">总上行</span>
        <span className="ix-value num net-up">
          <FlowSize bytes={m.up} rate />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">总下行</span>
        <span className="ix-value num net-down">
          <FlowSize bytes={m.down} rate />
        </span>
      </div>
      <div className="ix ix-traffic">
        <span className="ix-label">{m.traffic?.monthly ? '本月流量 ↑ / ↓' : '累计流量 ↑ / ↓'}</span>
        <span className="ix-value num ix-small">
          {m.traffic ? (
            <>
              <FlowSize bytes={m.traffic.up} />
              <span className="ix-sep">/</span>
              <FlowSize bytes={m.traffic.down} />
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
