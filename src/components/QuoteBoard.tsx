import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { ArrowDownUp, Check, ChevronRight, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { memo, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useLocation } from 'react-router'
import type { Sparks } from '../lib/api'
import { firstDir, QUICK_LABEL, SORT_LABEL, useBoardQuery, type BoardView, type Sort, type SortKey } from '../lib/board'
import { ago, duration, finite, levelOf, parseTags, pct, signed, size } from '../lib/format'
import { metricTrail, useNow, type BoardMetric, type Row } from '../lib/model'
import type { ThemeSettings } from '../lib/settings'
import { Flag, Meter, Pair, Segmented, Sparkline, Tick } from './primitives'

// Rows re-render only when their own data or these shared extras change; nothing here ticks every
// second (the "x s ago" label keeps its own clock), so a large board stays cheap between refreshes.
export interface BoardExtras {
  sparks: Sparks | undefined
  traffic: (r: Row) => { up: number; down: number } | null
  trafficMonthly: boolean
  /** Current time, refreshed once a minute: moves the 1h trails of nodes that stopped reporting. */
  minute: number
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
  // The trail window ends at the node's latest report; a node that stopped reporting drifts left
  // with the minute clock.
  const end = r.online && r.lastSeen ? r.lastSeen : x.minute
  const trail = showSpark ? metricTrail(r, x.sparks?.get(r.node.uuid), k, end) : null
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

/** "x s ago" on the shared 1 s clock, so only this label re-renders every second, not its row. */
function Ago({ t }: { t: number | null }) {
  const now = useNow(1000)
  return (
    <time className="num" dateTime={t ? new Date(t).toISOString() : undefined}>
      {ago(t, now)}
    </time>
  )
}

/** `rank` is the row's place in a sorted board (null when grouped); a change of place slides it. */
const QuoteRow = memo(function QuoteRow({ r, x, showSpark, search, rank }: { r: Row; x: BoardExtras; showSpark: boolean; search: string; rank: number | null }) {
  const st = r.online ? r.status : undefined
  const t = x.traffic(r)
  const memText = st ? `${size(st.ram)} / ${size(st.ram_total || r.node.mem_total)}` : undefined
  const diskText = st ? `${size(st.disk)} / ${size(st.disk_total || r.node.disk_total)}` : undefined
  return (
    // Only a sorted board reorders. Layout tracking would measure every row on every data refresh;
    // with the rank as its dependency it measures a row only when its place changes (rows are of
    // equal height, so a row that keeps its rank keeps its position).
    <motion.div layout={rank !== null ? 'position' : false} layoutDependency={rank} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="row-wrap">
      <Link to={{ pathname: `/instance/${r.node.uuid}`, search }} state={{ fromBoard: true }} className={clsx('qrow', !r.online && 'is-off')} data-uuid={r.node.uuid} aria-label={`${r.node.name} ${r.region.name} ${r.online ? '在线' : '离线'}，查看详情`}>
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
          <Ago t={r.lastSeen} />
          <ChevronRight className="row-arrow" size={14} aria-hidden="true" />
        </span>
      </Link>
    </motion.div>
  )
})

const SORT_KEYS: SortKey[] = ['cpu', 'ram', 'disk', 'load', 'net', 'traffic', 'uptime', 'seen', 'name']
const dirText = (d: 'asc' | 'desc') => (d === 'asc' ? '升序' : '降序')

/**
 * Phones hide the column headers, so the sort lives behind a button beside the search box:
 * pick what to order by, then the direction. Hidden on wider screens, where headers sort.
 */
function SortMenu({ sort, grouped, onChange }: { sort: Sort; grouped: boolean; onChange: (s: Sort) => void }) {
  const [open, setOpen] = useState(false)
  const dirLabel = useId()
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={clsx('tool-btn sort-btn', sort && 'is-on')} aria-label={sort ? `排序：按${SORT_LABEL[sort.key]}${dirText(sort.dir)}` : '排序'}>
          <ArrowDownUp size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="sort-menu" side="bottom" align="end" sideOffset={6} collisionPadding={12} aria-label="排序">
          <RadioGroup.Root
            className="sort-list"
            value={sort?.key ?? 'none'}
            onValueChange={(v) => {
              onChange(v === 'none' ? null : { key: v as SortKey, dir: sort?.key === v ? sort.dir : firstDir(v as SortKey) })
              // Back to the default order there is no direction to pick, so the menu is done.
              if (v === 'none') setOpen(false)
            }}
            aria-label="排序依据"
            loop
          >
            {(['none', ...SORT_KEYS] as const).map((k) => (
              <RadioGroup.Item key={k} value={k} className="sort-opt">
                {k === 'none' ? (grouped ? '默认（按分组）' : '默认顺序') : SORT_LABEL[k]}
                <RadioGroup.Indicator asChild>
                  <Check size={14} aria-hidden="true" />
                </RadioGroup.Indicator>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          {sort && (
            <div className="sort-dir">
              <span id={dirLabel}>方向</span>
              <Segmented className="seg-fill" value={sort.dir} options={['desc', 'asc'] as const} format={dirText} labelledBy={dirLabel} onChange={(dir) => onChange({ ...sort, dir })} />
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Memoized: the app re-renders every second for its clocks, the board only when its data does.
export const QuoteBoard = memo(function QuoteBoard({ rows, view, onHold, settings, x, loading, searchRef }: { rows: Row[]; view: BoardView; onHold: (hold: boolean) => void; settings: ThemeSettings; x: BoardExtras; loading: boolean; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const [{ q: query, quick, sort }, setBoard, flushQuery] = useBoardQuery()
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

  // A focused row that leaves the list (filtered out, or the board unmounts) never fires blur,
  // so release the hold whenever the rows change and neither the mouse nor a row holds it.
  useEffect(() => {
    const el = listRef.current
    if (!el || (!el.matches(':hover') && !el.querySelector('a.qrow:focus-visible'))) onHold(false)
  }, [view.order, onHold])
  useEffect(() => () => onHold(false), [onHold])

  const cols = clsx('board', !showSpark && 'no-spark')

  return (
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-head">
        <div className="panel-title">
          <span className="slot num">01</span>
          <h1 id="board-title">全部节点</h1>
          <span className="count num">{count} 台</span>
          {/* What is narrowing or reordering the board, each one click from undone. */}
          {quick && (
            <button type="button" className="chip" onClick={() => setBoard({ quick: null })} aria-label={`取消筛选：${QUICK_LABEL[quick]}`}>
              {QUICK_LABEL[quick]}
              <X size={12} aria-hidden="true" />
            </button>
          )}
          {sort && (
            <button type="button" className="chip" onClick={() => setBoard({ sort: null })} aria-label={`取消排序（按${SORT_LABEL[sort.key]}${sort.dir === 'asc' ? '升序' : '降序'}），${settings.groupBy === 'none' ? '恢复默认顺序' : '恢复分组'}`}>
              按 {SORT_LABEL[sort.key]} {sort.dir === 'asc' ? '升序' : '降序'}
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="board-tools">
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
          <SortMenu sort={sort} grouped={settings.groupBy !== 'none'} onChange={(next) => setBoard({ sort: next })} />
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

      {/* While the mouse is over the list or the keyboard is on a row, a sorted board keeps its order
          (see useHeldOrder). A clicked header keeps focus but must not hold the board. */}
      <div
        className={cols}
        ref={listRef}
        onKeyDown={onKeyDown}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHold(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !listRef.current?.querySelector('a.qrow:focus-visible') && onHold(false)}
        onFocus={(e) => e.target.matches('a.qrow:focus-visible') && onHold(true)}
        onBlur={(e) => !(e.relatedTarget instanceof Element && e.relatedTarget.matches('a.qrow')) && !listRef.current?.matches(':hover') && onHold(false)}
      >
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
              <button type="button" className="tool-btn" onClick={() => setBoard({ q: '', group: 'all', quick: null })}>
                清除筛选
              </button>
            </div>
          ) : (
            <p className="empty">暂无公开节点</p>
          )
        ) : flat ? (
          <div className="group-body">
            {flat.map((r, i) => (
              <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} search={search} rank={i} />
            ))}
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
                    <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} search={search} rank={null} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </section>
  )
})
