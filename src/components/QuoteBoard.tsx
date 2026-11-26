import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { ArrowDownUp, Check, ChevronRight, CircleQuestionMark, Eye, EyeOff, Search, X } from 'lucide-react'
import { motion } from 'motion/react'
import { createContext, memo, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { NodeTraffic, Sparks, TrafficSum } from '../lib/api'
import { firstDir, useBoardQuery, type BoardView, type Sort, type SortKey } from '../lib/board'
import { ago, duration, finite, levelOf, monthDay, parseTags, pct, signed, size } from '../lib/format'
import { metricTrail, useNow, type BoardMetric, type Row } from '../lib/model'
import { newTabKey, useOpenNode } from '../lib/nav'
import type { ThemeSettings } from '../lib/settings'
import { Flag, Meter, Pair, Segmented, Sparkline, Tick, Tip } from './primitives'

// Rows re-render only when their own data or these shared extras change; nothing here ticks every
// second (the "x s ago" label keeps its own clock), so a large board stays cheap between refreshes.
export interface BoardExtras {
  sparks: Sparks | undefined
  traffic: NodeTraffic | undefined
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
    <Tip content={list.map((t) => t.text).join(' · ')}>
      <span className="tags">
        {shown.map((t) => (
          <span key={t.text} className={clsx('tag', t.color && 'tag-colored')} style={t.color && TAG_COLORS[t.color] ? ({ '--tag': TAG_COLORS[t.color] } as React.CSSProperties) : undefined}>
            {t.text}
          </span>
        ))}
        {max && list.length > max && <span className="tag tag-more">+{list.length - max}</span>}
      </span>
    </Tip>
  )
}

/** Columns; `col` names the header (board.col.*). `sub` follows the name in small type; a column
 * with a `hint` explains itself under a ? mark. */
const HEAD: { key: SortKey | null; col: 'name' | 'state' | 'cpu' | 'ram' | 'disk' | 'load' | 'net' | 'trafficMonth' | 'trafficTotal' | 'tags' | 'seen'; cls: string; trail?: boolean; sub?: string; hint?: 'board.col.trafficMonthHint' | 'board.col.trafficTotalHint' }[] = [
  { key: 'name', col: 'name', cls: 'c-name' },
  { key: 'uptime', col: 'state', cls: 'c-state' },
  { key: 'cpu', col: 'cpu', cls: 'c-cpu', trail: true },
  { key: 'ram', col: 'ram', cls: 'c-ram', trail: true },
  { key: 'disk', col: 'disk', cls: 'c-disk', trail: true },
  { key: 'load', col: 'load', cls: 'c-load', sub: '1m' },
  { key: 'net', col: 'net', cls: 'c-net' },
  { key: 'month', col: 'trafficMonth', cls: 'c-month', hint: 'board.col.trafficMonthHint' },
  { key: 'total', col: 'trafficTotal', cls: 'c-total', hint: 'board.col.trafficTotalHint' },
  { key: null, col: 'tags', cls: 'c-tags' },
  { key: 'seen', col: 'seen', cls: 'c-seen' },
]

/** A traffic sum; one that only covers part of its period (older data past retention) is marked
 * in its own color and says from when it counts. */
function TrafficCell({ cls, label, v }: { cls: string; label: string; v: TrafficSum | undefined }) {
  const { t } = useTranslation()
  const partial = v?.since != null
  return (
    <Tip content={partial ? t('board.partialSince', { date: monthDay(v.since!) }) : undefined}>
      <span className={clsx(cls, partial && 'is-partial')}>
        <span className="m-label">{label}</span>
        <Pair up={v?.up} down={v?.down} byUnit />
      </span>
    </Tip>
  )
}
/** Disk barely moves within an hour; a wider minimum range keeps its trail visibly flat. */
const MIN_SPAN: Record<BoardMetric, number> = { cpu: 6, ram: 6, disk: 10 }

/** Value, Δ vs. the 1h mean and the 1h trail (or a usage bar when trails are off). */
function MetricCell({ r, k, x, showSpark, title }: { r: Row; k: BoardMetric; x: BoardExtras; showSpark: boolean; title?: string }) {
  const { t } = useTranslation()
  const value = r[k]
  // The trail window ends at the node's latest report; a node that stopped reporting drifts left
  // with the minute clock.
  const end = r.online && r.lastSeen ? r.lastSeen : x.minute
  const trail = showSpark ? metricTrail(r, x.sparks?.get(r.node.uuid), k, end) : null
  return (
    <Tip content={title}>
      <span className={clsx(`c-${k}`, 'metric', trail ? 'has-spark' : 'has-meter', levelOf(value))}>
        <span className="m-label">{t(`board.col.${k}`)}</span>
        <span className="m-nums">
          <b className="m-value num">
            <Tick value={value} threshold={1}>{pct(value)}</Tick>
          </b>
          {trail?.dir && (
            <Tip content={t('board.deltaHint')}>
              <span className={clsx('delta num', trail.dir)}>
                {signed(trail.delta!, 1)}
                <small>pp</small>
              </span>
            </Tip>
          )}
        </span>
        {trail ? <Sparkline trail={trail} minSpan={MIN_SPAN[k]} stopped={!r.online} /> : <Meter value={value} />}
      </span>
    </Tip>
  )
}

/** True while a node's drawer covers the board: its "x s ago" labels stop counting. */
const Covered = createContext(false)

/** "x s ago" on the shared 1 s clock, so only this label re-renders every second, not its row. */
function Ago({ t }: { t: number | null }) {
  const now = useNow(1000, useContext(Covered))
  return (
    <time className="num" dateTime={t ? new Date(t).toISOString() : undefined}>
      {ago(t, now, true)}
    </time>
  )
}

/** `rank` is the row's place in a sorted board (null when grouped); a change of place slides it. */
const QuoteRow = memo(function QuoteRow({ r, x, showSpark, rank }: { r: Row; x: BoardExtras; showSpark: boolean; rank: number | null }) {
  const { t } = useTranslation()
  const st = r.online ? r.status : undefined
  const memText = st ? `${size(st.ram)} / ${size(st.ram_total || r.node.mem_total)}` : undefined
  const diskText = st ? `${size(st.disk)} / ${size(st.disk_total || r.node.disk_total)}` : undefined
  return (
    // Only a sorted board reorders. Layout tracking would measure every row on every data refresh;
    // with the rank as its dependency it measures a row only when its place changes (rows are of
    // equal height, so a row that keeps its rank keeps its position).
    <motion.div layout={rank !== null ? 'position' : false} layoutDependency={rank} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="row-wrap">
      {/* A button that opens the node's drawer (the board's list handles the click, see onRowClick). */}
      <button type="button" aria-haspopup="dialog" className={clsx('qrow', !r.online && 'is-off')} data-uuid={r.node.uuid} aria-label={t(r.node.hidden ? 'board.rowHidden' : 'board.row', { name: r.node.name, region: r.region.name, state: r.online ? t('common.online') : t('common.offline') })}>
        <span className="c-name">
          <Flag code={r.region.code} title={r.region.name} />
          <span className="name-stack">
            <b className="node-name num">{r.node.name}</b>
            <span className="node-code num">
              {r.code.area}·<em>{r.code.hash}</em>
              {r.node.hidden && (
                <Tip content={t('common.hiddenHint')}>
                  <span className="hidden-tag">
                    {t('common.hidden')}
                  </span>
                </Tip>
              )}
            </span>
          </span>
        </span>
        <span className="c-state">
          <span className={clsx('state', r.online ? 'on' : 'off')}>
            <i aria-hidden="true" />
            {r.online ? t('common.online') : t('common.offline')}
          </span>
          <Tip content={t('board.uptimeHint')}>
            <span className="uptime num">{duration(st?.uptime)}</span>
          </Tip>
        </span>
        <MetricCell r={r} k="cpu" x={x} showSpark={showSpark} />
        <MetricCell r={r} k="ram" x={x} showSpark={showSpark} title={memText} />
        <MetricCell r={r} k="disk" x={x} showSpark={showSpark} title={diskText} />
        <span className="c-load num">
          <span className="m-label">{t('board.load')}</span>
          <b>{finite(st?.load) ? st!.load.toFixed(2) : '—'}</b>
        </span>
        <span className="c-net">
          <span className="m-label">{t('board.network')}</span>
          <Pair up={st?.net_out} down={st?.net_in} rate tickUp tickDown byUnit />
        </span>
        <TrafficCell cls="c-month" label={t('board.trafficMonth')} v={x.traffic?.month.get(r.node.uuid)} />
        <TrafficCell cls="c-total" label={t('board.trafficTotal')} v={x.traffic?.total.get(r.node.uuid)} />
        <span className="c-tags">
          <Tags tags={r.node.tags} max={2} />
        </span>
        <span className="c-seen">
          <Ago t={r.lastSeen} />
          <ChevronRight className="row-arrow" size={14} aria-hidden="true" />
        </span>
      </button>
    </motion.div>
  )
})

const SORT_KEYS: SortKey[] = ['cpu', 'ram', 'disk', 'load', 'net', 'month', 'total', 'uptime', 'seen', 'name']

/**
 * Phones hide the column headers, so the sort lives behind a button beside the search box:
 * pick what to order by, then the direction. Hidden on wider screens, where headers sort.
 */
function SortMenu({ sort, grouped, onChange }: { sort: Sort; grouped: boolean; onChange: (s: Sort) => void }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const dirLabel = useId()
  const dirText = (d: 'asc' | 'desc') => t(`sort.${d}`)
  // Names are lower case for use inside sentences (by name, descending); as options they start a line.
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase(i18n.language) + s.slice(1)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className={clsx('tool-btn sort-btn', sort && 'is-on')} aria-label={sort ? t('sort.current', { key: t(`sort.key.${sort.key}`), dir: dirText(sort.dir) }) : t('sort.button')}>
          <ArrowDownUp size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="sort-menu" side="bottom" align="end" sideOffset={6} collisionPadding={12} aria-label={t('sort.button')}>
          <RadioGroup.Root
            className="sort-list"
            value={sort?.key ?? 'none'}
            onValueChange={(v) => {
              onChange(v === 'none' ? null : { key: v as SortKey, dir: sort?.key === v ? sort.dir : firstDir(v as SortKey) })
              // Back to the default order there is no direction to pick, so the menu is done.
              if (v === 'none') setOpen(false)
            }}
            aria-label={t('sort.by')}
            loop
          >
            {(['none', ...SORT_KEYS] as const).map((k) => (
              <RadioGroup.Item key={k} value={k} className="sort-opt">
                {k === 'none' ? (grouped ? t('sort.defaultGrouped') : t('sort.default')) : cap(t(`sort.key.${k}`))}
                <RadioGroup.Indicator asChild>
                  <Check size={14} aria-hidden="true" />
                </RadioGroup.Indicator>
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
          {sort && (
            <div className="sort-dir">
              <span id={dirLabel}>{t('sort.direction')}</span>
              <Segmented className="seg-fill" value={sort.dir} options={['desc', 'asc'] as const} format={(d) => cap(dirText(d))} labelledBy={dirLabel} onChange={(dir) => onChange({ ...sort, dir })} />
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// Memoized: the app re-renders every second for its clocks, the board only when its data does.
export const QuoteBoard = memo(function QuoteBoard({ rows, view, paused, onHold, hiddenCount, showHidden, onToggleHidden, settings, x, loading, searchRef }: { rows: Row[]; view: BoardView; paused: boolean; onHold: (hold: boolean) => void; hiddenCount: number; showHidden: boolean; onToggleHidden: () => void; settings: ThemeSettings; x: BoardExtras; loading: boolean; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const { t } = useTranslation()
  const [{ q: query, quick, sort }, setBoard, flushQuery] = useBoardQuery()
  const openNode = useOpenNode()
  const listRef = useRef<HTMLDivElement>(null)
  const showSpark = settings.showSparkline

  const { allGroups, filter, groups: visible, flat } = view
  const count = view.order.length

  // First click: the natural direction; second: reversed; third: back to the grouped board.
  const cycleSort = (key: SortKey) =>
    setBoard({ sort: sort?.key !== key ? { key, dir: firstDir(key) } : sort.dir === firstDir(key) ? { key, dir: firstDir(key) === 'asc' ? 'desc' : 'asc' } : null })

  // One set of handlers for every row: a click opens its node, a middle click opens it in a new tab
  // (without the middle button's autoscroll).
  const rowOf = (e: UIEvent) => (e.target instanceof Element ? e.target.closest<HTMLElement>('.qrow')?.dataset.uuid : undefined)
  const onRowClick = (e: MouseEvent) => {
    const id = rowOf(e)
    if (id) openNode(id, e)
  }
  const onRowAux = (e: MouseEvent) => {
    const id = e.button === 1 ? rowOf(e) : undefined
    if (id) openNode(id, e)
  }
  const onRowDown = (e: MouseEvent) => {
    if (e.button !== 1 || !rowOf(e)) return
    // Keeping focus where it is also keeps a search typed a moment ago from being written to the
    // address on blur: write it now, so the new tab gets it.
    e.preventDefault()
    flushQuery()
  }

  // ↑/↓ moves between rows like a quote list; Enter opens the row.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const id = rowOf(e)
    if (id && newTabKey(e)) return openNode(id, e)
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.qrow') ?? [])]
    if (!items.length) return
    const i = items.indexOf(document.activeElement as HTMLElement)
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
      const first = listRef.current?.querySelector<HTMLElement>('.qrow')
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
    if (!el || (!el.matches(':hover') && !el.querySelector('.qrow:focus-visible'))) onHold(false)
  }, [view.order, onHold])
  useEffect(() => () => onHold(false), [onHold])

  const cols = clsx('board', !showSpark && 'no-spark')
  const hintId = useId()

  return (
    <Covered.Provider value={paused}>
    <section className="panel board-panel" aria-labelledby="board-title">
      <div className="panel-head">
        <div className="panel-title">
          <span className="slot num">01</span>
          <h1 id="board-title">{t('board.title')}</h1>
          <span className="count num">{t('board.count', { count })}</span>
          {/* What is narrowing or reordering the board, each one click from undone. */}
          {quick && (
            <button type="button" className="chip" onClick={() => setBoard({ quick: null })} aria-label={t('board.clearQuick', { label: t(`board.quick.${quick}`) })}>
              {t(`board.quick.${quick}`)}
              <X size={12} aria-hidden="true" />
            </button>
          )}
          {/* Only a logged-in session gets hidden nodes, so only it sees this toggle. */}
          {hiddenCount > 0 &&
            (showHidden ? (
              <Tip content={t('board.hiddenHint')}>
                <button type="button" className="chip chip-quiet" onClick={onToggleHidden} aria-label={t('board.hideHidden', { count: hiddenCount })}>
                  <Eye size={12} aria-hidden="true" />
                  {t('board.hiddenCount', { count: hiddenCount })}
                </button>
              </Tip>
            ) : (
              <button type="button" className="chip" onClick={onToggleHidden} aria-label={t('board.showHidden', { count: hiddenCount })}>
                <EyeOff size={12} aria-hidden="true" />
                {t('board.hiddenOff')}
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          {sort && (
            <button type="button" className="chip" onClick={() => setBoard({ sort: null })} aria-label={t('board.clearSort', { key: t(`sort.key.${sort.key}`), dir: t(`sort.${sort.dir}`), restore: settings.groupBy === 'none' ? t('board.restoreOrder') : t('board.restoreGroups') })}>
              {t('board.sortChip', { key: t(`sort.key.${sort.key}`), dir: t(`sort.${sort.dir}`) })}
              <X size={12} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="board-tools">
          {/* The label covers icon and input only: a button inside a label is not allowed. */}
          <div className="search">
            <label className="search-field">
              <Search size={14} aria-hidden="true" />
              <input ref={searchRef} type="search" value={query} onChange={(e) => setBoard({ q: e.target.value })} onKeyDown={onSearchKey} onBlur={flushQuery} placeholder={t('board.searchPlaceholder')} aria-label={t('board.searchLabel')} />
            </label>
            {query ? (
              <button
                type="button"
                className="search-clear"
                aria-label={t('board.clearSearch')}
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

      {/* One choice that filters the list below: a Radix radio group, so the tabs are one tab stop
          and the arrow keys move and pick. */}
      {settings.groupBy !== 'none' && allGroups.length > 1 && (
        <RadioGroup.Root className="tabs" value={filter} onValueChange={(group) => setBoard({ group })} orientation="horizontal" loop aria-label={t('board.groupTabs')}>
          {[{ key: 'all', label: t('common.all'), n: rows.length }, ...allGroups.map((g) => ({ key: g.key, label: g.label, n: g.rows.length }))].map((tab) => (
            <RadioGroup.Item key={tab.key} value={tab.key} className="tab">
              {filter === tab.key && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }} />}
              <span className="tab-text">{tab.label}</span>
              <span className="tab-n num">{tab.n}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      )}

      {/* While the mouse is over the list or the keyboard is on a row, a sorted board keeps its order
          (see useHeldOrder). A clicked header keeps focus but must not hold the board. */}
      <div
        className={cols}
        ref={listRef}
        onKeyDown={onKeyDown}
        onClick={onRowClick}
        onAuxClick={onRowAux}
        onMouseDown={onRowDown}
        onPointerEnter={(e) => e.pointerType === 'mouse' && onHold(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && !listRef.current?.querySelector('.qrow:focus-visible') && onHold(false)}
        onFocus={(e) => e.target.matches('.qrow:focus-visible') && onHold(true)}
        onBlur={(e) => !(e.relatedTarget instanceof Element && e.relatedTarget.matches('.qrow')) && !listRef.current?.matches(':hover') && onHold(false)}
      >
        <div className="qhead" role="row">
          {HEAD.map((h) =>
            h.key ? (
              <Tip key={h.cls} content={h.hint ? t(h.hint) : undefined}>
                <button
                  type="button"
                  className={clsx(h.cls, 'th', sort?.key === h.key && 'is-sorted')}
                  onClick={() => cycleSort(h.key!)}
                  aria-sort={sort?.key === h.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  aria-describedby={h.hint ? `${hintId}-${h.col}` : undefined}
                >
                  <span className="th-text">{t(`board.col.${h.col}`)}</span>
                  {h.sub && <small className="th-sub">{h.sub}</small>}
                  {h.trail && showSpark && <small className="th-sub">1h</small>}
                  {h.hint && (
                    <>
                      <CircleQuestionMark className="th-help" size={11} strokeWidth={2} aria-hidden="true" />
                      <span id={`${hintId}-${h.col}`} hidden>
                        {t(h.hint)}
                      </span>
                    </>
                  )}
                  <span className="sort-mark" aria-hidden="true">
                    {sort?.key === h.key ? (sort.dir === 'asc' ? '▲' : '▼') : '⇅'}
                  </span>
                </button>
              </Tip>
            ) : (
              <span key={h.cls} className={clsx(h.cls, 'th')}>
                <span className="th-text">{t(`board.col.${h.col}`)}</span>
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
              <p>{t('board.noMatch')}</p>
              <button type="button" className="tool-btn" onClick={() => setBoard({ q: '', group: 'all', quick: null })}>
                {t('board.clearFilters')}
              </button>
            </div>
          ) : (
            <p className="empty">{t('board.empty')}</p>
          )
        ) : flat ? (
          <div className="group-body">
            {flat.map((r, i) => (
              <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} rank={i} />
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
                          {t('board.groupCpu')} <b>{cpuAvg.toFixed(1)}%</b>
                        </span>
                      )}
                      <span>
                        <Trans t={t} i18nKey="board.groupOnline" values={{ online: online.length, count: g.rows.length }} components={{ b: <b className={online.length ? 'good' : 'dim'} /> }} />
                      </span>
                    </span>
                  </div>
                )}
                <div className="group-body">
                  {g.rows.map((r) => (
                    <QuoteRow key={r.node.uuid} r={r} x={x} showSpark={showSpark} rank={null} />
                  ))}
                </div>
              </section>
            )
          })
        )}
      </div>
    </section>
    </Covered.Provider>
  )
})
