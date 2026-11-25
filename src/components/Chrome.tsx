import NumberFlowBase from '@number-flow/react'
import clsx from 'clsx'
import { LogIn, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { SettingsButton } from './Settings'
import type { Me } from '../lib/api'
import type { Quick } from '../lib/board'
import { resolveTheme, type Appearance } from '../lib/appearance'
import { clock, dateText, finite, sizeParts, utcOffset } from '../lib/format'
import type { Conn } from '../lib/model'
import type { Bulletin, MarketSummary } from '../lib/market'
import { lastLatency } from '../lib/rpc'
import { HOT } from '../lib/thresholds'
import { Tick } from './primitives'

// Quote-board digits roll quickly so 2 s ticks never overlap.
const FLOW_TIMING = { duration: 360, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
function NumberFlow(props: ComponentProps<typeof NumberFlowBase>) {
  return <NumberFlowBase transformTiming={FLOW_TIMING} spinTiming={FLOW_TIMING} opacityTiming={{ duration: 200, easing: 'ease-out' }} {...props} />
}

const ICONS: Record<Appearance, typeof Sun> = { system: Monitor, light: Sun, dark: Moon }

/**
 * Cycle: auto → the opposite of the system theme → the system theme → auto,
 * so each explicit step visibly changes the page.
 */
function nextAppearance(a: Appearance): Appearance {
  const os = resolveTheme('system')
  const other = os === 'dark' ? 'light' : 'dark'
  return a === 'system' ? other : a === other ? os : 'system'
}

/**
 * Site mark: an amber tile with a K whose stem is a hollow (rising) candle with wicks, drawn on
 * a 32-unit grid so every edge lands on whole pixels at 16 and 32px. public/favicon.svg matches.
 */
function Logomark() {
  return (
    <span className="logomark" aria-hidden="true">
      <svg viewBox="0 0 32 32" focusable="false">
        <rect width="32" height="32" rx="5" fill="currentColor" />
        <g className="logomark-k">
          <path fillRule="evenodd" d="M8 4h2v4h2v16h-2v4H8v-4H6V8h2V4Zm0 6v12h2V10H8Z" />
          <path d="M21 6h5L16 16l10 10h-5l-9-9v-2l9-9Z" />
        </g>
      </svg>
    </span>
  )
}

/** One button for page colors; shows the current mode (default: auto, following the system). */
export function ThemeToggle({ value, onChange }: { value: Appearance; onChange: (a: Appearance) => void }) {
  const { t } = useTranslation()
  const Icon = ICONS[value]
  const label = t(`theme.${value}`)
  const hint = t('theme.hint', { mode: value === 'system' ? t('theme.systemLong') : label, next: t(`theme.${nextAppearance(value)}`) })
  return (
    <button type="button" className="tool-btn theme-toggle" onClick={() => onChange(nextAppearance(value))} title={hint} aria-label={hint}>
      <span className="theme-toggle-icon" aria-hidden="true">
        <AnimatePresence initial={false}>
          <motion.span
            key={value}
            initial={{ opacity: 0, rotate: -45, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 45, scale: 0.8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <Icon size={14} strokeWidth={2} />
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="tool-btn-label">{label}</span>
    </button>
  )
}

/**
 * Admin entry, as in Komari's default theme: logged out, it opens the login page and returns here
 * afterwards; logged in, it shows the username and opens the dashboard.
 */
function AdminLink({ me, pending }: { me: Me | undefined; pending: boolean }) {
  const { t } = useTranslation()
  const location = useLocation()
  const base = import.meta.env.BASE_URL
  const here = `${base.replace(/\/$/, '')}${location.pathname}${location.search}`
  const loggedIn = me?.logged_in === true
  const href = loggedIn ? `${base}admin/dashboard` : `${base}admin/login?redirect=${encodeURIComponent(here)}`
  const hint = loggedIn ? t('top.loggedInHint', { name: me.username }) : t('top.loginHint')
  const Icon = loggedIn ? ShieldCheck : LogIn
  return (
    <a className={clsx('tool-btn admin-link', loggedIn && 'is-in', pending && 'is-pending')} href={href} title={hint} aria-label={hint}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      <span className="tool-btn-label">{loggedIn ? me.username : t('top.login')}</span>
    </a>
  )
}

/** Live-data badge; when the connection is down it becomes a retry button. */
function LiveBadge({ conn, updatedAt, refreshSeconds, onRetry, retrying }: { conn: Conn; updatedAt: number; refreshSeconds: number; onRetry: () => void; retrying: boolean }) {
  const { t } = useTranslation()
  const body = (
    <>
      <i aria-hidden="true" />
      <span className="market-text">{conn === 'down' && retrying ? t('conn.retryingShort') : t(`conn.badge.${conn}`)}</span>
      {conn === 'live' && <small className="num">{refreshSeconds}s</small>}
    </>
  )
  // One live region that outlasts the badge's span/button swap, so 中断 is announced too.
  const announce = (
    <span className="sr-only" role="status">
      {t(`conn.bar.${conn}`)}
    </span>
  )
  if (conn === 'down')
    return (
      <>
        <button type="button" className="market is-down" onClick={onRetry} disabled={retrying} title={retrying ? t('common.retrying') : t('conn.liveFailed')} aria-label={retrying ? t('conn.liveDownRetrying') : t('conn.liveDownRetry')}>
          {body}
        </button>
        {announce}
      </>
    )
  const title = conn === 'live' ? t('conn.every', { count: refreshSeconds }) : conn === 'stale' ? t('conn.staleSince', { time: clock(updatedAt) }) : t('conn.fetching')
  return (
    <>
      <span className={clsx('market', `is-${conn}`)} title={title}>
        {body}
      </span>
      {announce}
    </>
  )
}

export function TopBar({ siteName, conn, retrying, updatedAt, onRetry, refreshSeconds, me, mePending, appearance, onAppearance }: { siteName: string; conn: Conn; retrying: boolean; updatedAt: number; onRetry: () => void; refreshSeconds: number; me: Me | undefined; mePending: boolean; appearance: Appearance; onAppearance: (a: Appearance) => void }) {
  const { t } = useTranslation()
  // On a plain board already, clicking the mark must not stack another identical history entry.
  const { pathname, search } = useLocation()
  const atHome = pathname === '/' && !search
  return (
    <header className="topbar">
      {/* In-app link: back to a plain board (search, tab and sort cleared) without reloading. */}
      <Link className="brand" to="/" replace={atHome} onClick={() => window.scrollTo({ top: 0 })} aria-label={t('top.home', { site: siteName })}>
        <Logomark />
        <strong>{siteName}</strong>
        <span className="crumb">/ {t('top.crumb')}</span>
      </Link>
      <div className="topbar-tools">
        <LiveBadge conn={conn} updatedAt={updatedAt} refreshSeconds={refreshSeconds} onRetry={onRetry} retrying={retrying} />
        <SettingsButton />
        <ThemeToggle value={appearance} onChange={onAppearance} />
        <AdminLink me={me} pending={mePending} />
      </div>
    </header>
  )
}

/** Local date and time in the browser's own time zone (nothing is fixed in the page). */
function Clock({ now }: { now: number }) {
  const { t } = useTranslation()
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const offset = utcOffset(now)
  return (
    <span className="clock num" title={zone ? t('clock.zone', { zone, offset }) : t('clock.zoneUnknown', { offset })}>
      <span className="clock-date">{dateText(now)} </span>
      <b>{clock(now)}</b> <small>{offset}</small>
    </span>
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

export const IndexStrip = memo(function IndexStrip({ m, loading, quick, onQuick }: { m: MarketSummary; loading: boolean; quick: Quick; onQuick: (q: Quick) => void }) {
  const { t } = useTranslation()
  const hot = m.hot ?? 0
  const toggle = (q: Exclude<Quick, null>) => onQuick(quick === q ? null : q)
  const normal = Math.max(0, m.online - hot)
  const hotRule = t('index.hotRule', { cpu: HOT.cpu, ram: HOT.ram })
  return (
    <section className="index-strip" aria-label={t('index.label')}>
      <div className="ix ix-breadth">
        <span className="ix-label">{t('index.nodes')}</span>
        <span className="ix-value num">
          {loading ? <span className="skeleton" style={{ width: 90, height: 18 }} /> : (
            <>
              <NumberFlow value={m.total} />
              <span className="ix-sep">·</span>
              <span className="good">
                <NumberFlow value={m.online} />
              </span>
              <span className="ix-sep">/</span>
              {/* The offline count and the high-load cell filter the board to those nodes. */}
              <button
                type="button"
                className={clsx('ix-pick', m.offline ? 'bad' : 'dim', quick === 'offline' && 'is-on')}
                aria-pressed={quick === 'offline'}
                aria-label={t('index.offlineOnly', { count: m.offline })}
                disabled={!m.offline && quick !== 'offline'}
                onClick={() => toggle('offline')}
                title={quick === 'offline' ? t('index.showAll') : m.offline ? t('index.offlineClick') : undefined}
              >
                <NumberFlow value={m.offline} />
              </button>
            </>
          )}
        </span>
        <span className="breadth" aria-hidden="true">
          <i className="b-normal" style={{ flexGrow: normal }} />
          <i className="b-hot" style={{ flexGrow: hot }} />
          <i className="b-off" style={{ flexGrow: m.offline }} />
        </span>
      </div>
      <button
        type="button"
        className={clsx('ix ix-button', quick === 'hot' && 'is-on')}
        aria-pressed={quick === 'hot'}
        disabled={!hot && quick !== 'hot'}
        onClick={() => toggle('hot')}
        title={hot || quick === 'hot' ? t('index.withAction', { text: hotRule, action: quick === 'hot' ? t('index.showAll') : t('index.hotClick') }) : hotRule}
      >
        <span className="ix-label">{t('index.hot')}</span>
        <span className="ix-value num">
          {m.hot === null ? <span className="dash">—</span> : (
            <>
              <span className={clsx(hot > 0 && 'warn')}><NumberFlow value={hot} /></span>
              {t('index.hotUnit') && <small className="unit">{t('index.hotUnit')}</small>}
            </>
          )}
        </span>
      </button>
      <div className="ix">
        <span className="ix-label">{t('index.memory')}</span>
        <span className="ix-value num">
          <Live value={m.memRatio} suffix="%" />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">{t('index.up')}</span>
        <span className="ix-value num net-up">
          <span aria-hidden="true">↑</span>
          <LiveSize bytes={m.up} rate />
        </span>
      </div>
      <div className="ix">
        <span className="ix-label">{t('index.down')}</span>
        <span className="ix-value num net-down">
          <span aria-hidden="true">↓</span>
          <LiveSize bytes={m.down} rate />
        </span>
      </div>
      <div className="ix ix-traffic">
        <span className="ix-label">{m.traffic?.monthly ? t('index.trafficMonth') : t('index.trafficTotal')}</span>
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
})

export function StatusBar({ conn, retrying, onRetry, items, now, version }: { conn: Conn; retrying: boolean; onRetry: () => void; items: Bulletin[]; now: number; version?: string }) {
  const { t } = useTranslation()
  const [index, setIndex] = useState(0)
  // The ticker pauses while the mouse is on it or its link has focus. Focus is kept as the item's
  // id: when that item resolves, its link leaves without a blur event, and the pause ends with it.
  const [hovered, setHovered] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const calm = t('status.calm')
  const list = useMemo(() => (items.length ? items : [{ id: 'calm', level: 'info' as const, text: calm }]), [items, calm])
  const current = list[index % list.length]
  const paused = hovered || focusedId === current.id
  useEffect(() => {
    if (paused || list.length < 2) return
    const id = window.setInterval(() => setIndex((i) => (i + 1) % list.length), 5000)
    return () => window.clearInterval(id)
  }, [paused, list.length])
  const location = useLocation()
  return (
    <footer className="statusbar">
      <span className="sb-status">
        {conn === 'down' ? (
          <button type="button" className="sb-conn is-down" onClick={onRetry} disabled={retrying} title={retrying ? t('common.retrying') : t('conn.retryNow')} aria-label={retrying ? t('conn.downRetrying') : t('conn.downRetry')}>
            <i aria-hidden="true" />
            <span className="sb-conn-text">{t('conn.bar.down')} · {retrying ? t('conn.retryingBar') : t('common.retry')}</span>
          </button>
        ) : (
          <span className={clsx('sb-conn', `is-${conn}`)} title={t(`conn.bar.${conn}`)}>
            <i aria-hidden="true" />
            <span className="sb-conn-text">{t(`conn.bar.${conn}`)}</span>
            {conn === 'live' && finite(lastLatency) && <span className="num dim"> · {Math.round(lastLatency)}ms</span>}
          </span>
        )}
        <Clock now={now} />
      </span>
      <span className="sb-news" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocusedId(current.id)} onBlur={() => setFocusedId(null)} aria-live="polite">
        <span className="sb-news-tag">{t('status.news')}</span>
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
              {current.uuid ? (
                <Link to={{ pathname: `/instance/${current.uuid}`, search: location.search }} state={{ fromBoard: true }} title={t('status.viewNode')}>
                  {current.text}
                </Link>
              ) : (
                current.text
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        {list.length > 1 && <span className="num dim sb-news-count">{(index % list.length) + 1}/{list.length}</span>}
      </span>
      <span className="sb-powered">
        <span className="sb-hints">
          <kbd>/</kbd> {t('status.keySearch')} · <kbd>↓</kbd> {t('status.keyList')} · <kbd>↑↓</kbd> {t('status.keyRow')} · <kbd>Enter</kbd> {t('status.keyOpen')} · <kbd>[ ]</kbd> {t('status.keyPage')}
        </span>
        <a href="https://github.com/komari-monitor/komari" target="_blank" rel="noreferrer">
          Powered by Komari Monitor.
        </a>
        {version && <span className="num dim"> v{version}</span>}
      </span>
    </footer>
  )
}
