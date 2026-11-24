import clsx from 'clsx'
import { ChevronRight, Search, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useRef, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router'
import type { Sparks } from '../lib/api'
import { firstDir, useBoardQuery, type BoardView, type SortKey } from '../lib/board'
import { ago, duration, finite, levelOf, parseTags, pct, signed, size } from '../lib/format'
import { metricTrail, type BoardMetric, type Row } from '../lib/model'
import type { ThemeSettings } from '../lib/settings'
import { Flag, Meter, Pair, Sparkline, Tick } from './primitives'

export interface BoardExtras {
  sparks: Sparks | undefined
  traffic: (r: Row) => { up: number; down: number } | null
  trafficMonthly: boolean
  now: number
}

const TAG_COLORS: Record<string, string> = {
  gray: '#8d8d8d', gold: '#978365', bronze: '#a18072', brown: '#ad7f58', yellow: '#d5ae39', amber: '#f5a623', orange: '#f76b15',
  tomato: '#e54d2e', red: '#e5484d', ruby: '#e54666', crimson: '#e93d82', pink: '#d6409f', plum: '#ab4aba', purple: '#8e4ec6',
  violet: '#6e56cf', iris: '#5b5bd6', indigo: '#3e63dd', blue: '#0090ff', cyan: '#00a2c7', teal: '#12a594', jade: '#29a383',
  green: '#30a46c', grass: '#46a758', lime: '#8db600', mint: '#2fb39a', sky: '#38a3d1',
}

export function Tags({ tags, max }: { tags: string; max?: number }) {
  const list = parseTags(tags)
  if (!list.length) return <span className="dash">—</span>
  const shown = max ? list.slice(0, max) : list
  return (
    <span className="tags" title={list.map((t) => t.text).join(' · ')}>
      {shown.map((t) => (
        <span key={t.text} className={clsx('tag', t.color && 'tag-colored')} style={t.color && TAG_COLORS[t.color] ? ({ '--tag': TAG_COLORS[t.color] } as React.CSSProperties) : undefined}>
          {t.text}
        </span>
      ))}
      {max && list.length > max && <span className="tag tag-more">+{list.length - max}</span>}
    </span>
  )
}

const HEAD: { key: SortKey | null; label: string; cls: string; trail?: boolean }[] = [
  { key: 'name', label: '节点', cls: 'c-name' },
  { key: 'uptime', label: '状态', cls: 'c-state' },
  { key: 'cpu', label: 'CPU', cls: 'c-cpu', trail: true },
  { key: 'ram', label: '内存', cls: 'c-ram', trail: true },
  { key: 'disk', label: '磁盘', cls: 'c-disk', trail: true },
  { key: 'load', label: '负载 1/5/15', cls: 'c-load' },
  { key: 'traffic', label: '流量 ↑/↓', cls: 'c-traffic' },
  { key: 'net', label: '网络 ↑/↓', cls: 'c-net' },
  { key: null, label: '标签', cls: 'c-tags' },
  { key: 'seen', label: '最后上报', cls: 'c-seen' },
]

const METRIC_LABEL: Record<BoardMetric, string> = { cpu: 'CPU', ram: '内存', disk: '磁盘' }
/** Disk barely moves within an hour; a wider minimum range keeps its trail visibly flat. */
const MIN_SPAN: Record<BoardMetric, number> = { cpu: 6, ram: 6, disk: 10 }

/** Value, Δ vs. the 1h mean and the 1h trail (or a usage bar when trails are off). */
function MetricCell({ r, k, x, showSpark, title }: { r: Row; k: BoardMetric; x: BoardExtras; showSpark: boolean; title?: string }) {
  const value = r[k]
  const trail = showSpark ? metricTrail(r, x.sparks?.get(r.node.uuid), k, x.now) : null
  return (
    <span className={clsx(`c-${k}`, 'metric', trail ? 'has-spark' : 'has-meter', levelOf(value))} title={title}>
      <span className="m-label">{METRIC_LABEL[k]}</span>
      <span className="m-nums">
        <b className="m-value num">
          <Tick value={value} threshold={1}>{pct(value)}</Tick>
        </b>
        {trail?.dir && (
          <span className={clsx('delta num', trail.dir)} title="较近 1 小时均值（曲线中的虚线）">
            {signed(trail.delta!, 1)}
            <small>pp</small>
          </span>
        )}
      </span>
      {trail ? <Sparkline trail={trail} minSpan={MIN_SPAN[k]} stopped={!r.online} /> : <Meter value={value} />}
    </span>
  )
}

const QuoteRow = forwardRef<HTMLAnchorElement, { r: Row; x: BoardExtras; showSpark: boolean; search: string }>(function QuoteRow({ r, x, showSpark, search }, ref) {
  const st = r.online ? r.status : undefined
  const t = x.traffic(r)
  const memText = st ? `${size(st.ram)} / ${size(st.ram_total || r.node.mem_total)}` : undefined
  const diskText = st ? `${size(st.disk)} / ${size(st.disk_total || r.node.disk_total)}` : undefined
  return (
    <motion.div layout="position" transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} className="row-wrap">
      <Link ref={ref} to={{ pathname: `/instance/${r.node.uuid}`, search }} state={{ fromBoard: true }} className={clsx('qrow', !r.online && 'is-off')} data-uuid={r.node.uuid} aria-label={`${r.node.name} ${r.region.name} ${r.online ? '在线' : '离线'}，查看详情`}>
        <span className="c-name">
          <Flag code={r.region.code} title={r.region.name} />
          <span className="name-stack">
            <b className="node-name num">{r.node.name}</b>
            <span className="node-code num">
              {r.code.area}·<em>{r.code.hash}</em>
            </span>
          </span>
        </span>
        <span className="c-state">
          <span className={clsx('state', r.online ? 'on' : 'off')}>
            <i aria-hidden="true" />
            {r.online ? '在线' : '离线'}
          </span>
          <span className="uptime num" title="系统运行时长">{duration(st?.uptime)}</span>
        </span>
        <MetricCell r={r} k="cpu" x={x} showSpark={showSpark} />
        <MetricCell r={r} k="ram" x={x} showSpark={showSpark} title={memText} />
        <MetricCell r={r} k="disk" x={x} showSpark={showSpark} title={diskText} />
        <span className="c-load num">
          <span className="m-label">负载</span>
          {(['load', 'load5', 'load15'] as const).map((k, i) => (
            <span key={k} className="load-cell">
              <small>{[1, 5, 15][i]}m</small>
              <b>{finite(st?.[k]) ? st![k].toFixed(2) : '—'}</b>
            </span>
          ))}
        </span>
        <span className="c-traffic">
          <span className="m-label">{x.trafficMonthly ? '月流量' : '累计流量'}</span>
          <Pair up={t?.up} down={t?.down} byUnit />
        </span>
        <span className="c-net">
          <span className="m-label">网络</span>
          <Pair up={st?.net_out} down={st?.net_in} rate tickUp tickDown byUnit />
        </span>
        <span className="c-tags">
          <Tags tags={r.node.tags} max={2} />
        </span>
        <span className="c-seen">
          <time className="num" dateTime={r.lastSeen ? new Date(r.lastSeen).toISOString() : undefined}>{ago(r.lastSeen, x.now)}</time>
          <ChevronRight className="row-arrow" size={14} aria-hidden="true" />
        </span>
      </Link>
    </motion.div>
  )
})

export function QuoteBoard({ rows, view, settings, x, loading, searchRef }: { rows: Row[]; view: BoardView; settings: ThemeSettings; x: BoardExtras; loading: boolean; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [{ q: query, sort }, setBoard, flushQuery] = useBoardQuery()
  const { search } = useLocation()
  const listRef = useRef<HTMLDivElement>(null)
  const showSpark = settings.showSparkline

  const { allGroups, filter, groups: visible, flat } = view
  const count = view.order.length

  // First click: the natural direction; second: reversed; third: back to the grouped board.
  const cycleSort = (key: SortKey) =>
    setBoard({ sort: sort?.key !== key ? { key, dir: firstDir(key) } : sort.dir === firstDir(key) ? { key, dir: firstDir(key) === 'asc' ? 'desc' : 'asc' } : null })

  // ↑/↓ moves between rows like a quote list; Enter follows the link.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a.qrow') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLAnchorElement)
    const next = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)
    items[next].focus()
    items[next].scrollIntoView({ block: 'nearest' })
    e.preventDefault()
  }

  // In the search box: Esc clears and leaves, ↓ steps into the list (the first matching row).
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Keys pressed while an IME is composing belong to the IME (Esc cancels the candidate).
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') {
      setBoard({ q: '' })
      e.currentTarget.blur()
      e.preventDefault()
    } else if (e.key === 'ArrowDown') {
      const first = listRef.current?.querySelector<HTMLAnchorElement>('a.qrow')
      if (!first) return
      first.focus()
      first.scrollIntoView({ block: 'nearest' })
      e.preventDefault()
    }
  }

  const cols = clsx('board', !showSpark && 'no-spark')

  return (
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-head">
        <div className="panel-title">
          <span className="slot num">01</span>
          <h1 id="board-title">全部节点</h1>
          <span className="count num">{count} 台</span>
        </div>
        {/* The label covers icon and input only: a button inside a label is not allowed. */}
        <div className="search">
          <label className="search-field">
            <Search size={14} aria-hidden="true" />
            <input ref={searchRef} type="search" value={query} onChange={(e) => setBoard({ q: e.target.value })} onKeyDown={onSearchKey} onBlur={flushQuery} placeholder="搜索节点 / 地区 / 标签" aria-label="搜索节点、地区或标签" />
          </label>
          {query ? (
            <button
              type="button"
              className="search-clear"
              aria-label="清除搜索"
              onClick={() => {
                setBoard({ q: '' })
                searchRef.current?.focus()
              }}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : (
            <kbd className="num">/</kbd>
          )}
        </div>
      </div>

      {settings.groupBy !== 'none' && allGroups.length > 1 && (
        <div className="tabs" role="tablist" aria-label="按分组筛选">
          {[{ key: 'all', label: '全部', n: rows.length }, ...allGroups.map((g) => ({ key: g.key, label: g.label, n: g.rows.length }))].map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={filter === t.key} className="tab" onClick={() => setBoard({ group: t.key })}>
              {filter === t.key && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} />}
              <span className="tab-text">{t.label}</span>
              <span className="tab-n num">{t.n}</span>
            </button>
          ))}
        </div>
      )}

      <div className={cols} ref={listRef} onKeyDown={onKeyDown}>
        <div className="qhead" role="row">
          {HEAD.map((h) =>
            h.key ? (
              <button key={h.cls} type="button" className={clsx(h.cls, 'th', sort?.key === h.key && 'is-sorted')} onClick={() => cycleSort(h.key!)} aria-sort={sort?.key === h.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {h.key === 'traffic' ? `${x.trafficMonthly ? '月流量' : '累计流量'} ↑/↓` : h.label}
                {h.trail && showSpark && <small className="th-sub">1h</small>}
                <span className="sort-mark" aria-hidden="true">
                  {sort?.key === h.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                </span>
              </button>
            ) : (
              <span key={h.cls} className={clsx(h.cls, 'th')}>
                {h.label}
              </span>
            ),
          )}
        </div>

        {loading && !rows.length ? (
          <div className="board-skeleton">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 40, margin: '10px 12px', opacity: 1 - i * 0.13 }} />
            ))}
          </div>
        ) : count === 0 ? (
          rows.length ? (
            <div className="empty">
              <p>没有匹配的节点</p>
              <button type="button" className="tool-btn" onClick={() => setBoard({ q: '', group: 'all' })}>
                清除筛选
              </button>
            </div>
          ) : (
            <p className="empty">暂无公开节点</p>
          )
        ) : flat ? (
          <div className="group-body">
            <AnimatePresence initial={false}>
              {flat.map((r) => (
                <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} search={search} />
              ))}
            </AnimatePresence>
          </div>
        ) : (
          visible.map((g) => {
            const online = g.rows.filter((r) => r.online)
            const cpuAvg = online.length ? online.reduce((a, r) => a + (r.cpu ?? 0), 0) / online.length : null
            return (
              <section key={g.key} className="group" aria-label={g.label}>
                {settings.groupBy !== 'none' && (
                  <div className="group-head">
                    <span className="group-name">
                      {g.label}
                      {g.code && <em className="num">{g.code}</em>}
                    </span>
                    <span className="group-meta num">
                      {finite(cpuAvg) && (
                        <span className="group-cpu">
                          平均 CPU 使用率 <b>{cpuAvg.toFixed(1)}%</b>
                        </span>
                      )}
                      <span>
                        <b className={online.length ? 'good' : 'dim'}>{online.length}</b> 在线 / {g.rows.length} 台
                      </span>
                    </span>
                  </div>
                )}
                <div className="group-body">
                  {g.rows.map((r) => (
                    <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} search={search} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </section>
  )
}
