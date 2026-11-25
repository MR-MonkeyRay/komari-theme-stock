import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { create } from 'zustand'
import type { TFunction } from 'i18next'
import type { NodeTraffic } from './api'
import { parseTags } from './format'
import { isHot } from './market'
import type { Row } from './model'
import { CONTINENTS } from './region'
import type { SiteSettings } from './settings'

// Board view state (search, group tab, quick filter, sort) lives in the URL query, so a reload or a
// shared link shows the same board, and the detail drawer keeps it while it is open.

export type SortKey = 'name' | 'uptime' | 'cpu' | 'ram' | 'disk' | 'load' | 'net' | 'month' | 'total' | 'seen'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

/** Quick filters from the index strip: only offline nodes, or only high-load ones. */
export type Quick = 'offline' | 'hot' | null

export interface BoardQuery {
  /** Search text. */
  q: string
  /** Group tab key; 'all' shows every group. */
  group: string
  quick: Quick
  sort: Sort
}

const SORT_KEYS: SortKey[] = ['name', 'uptime', 'cpu', 'ram', 'disk', 'load', 'net', 'month', 'total', 'seen']

function parseSort(raw: string | null): Sort {
  const [key, dir] = (raw ?? '').split('-')
  if (!SORT_KEYS.includes(key as SortKey) || (dir !== 'asc' && dir !== 'desc')) return null
  return { key: key as SortKey, dir }
}

/** Default direction when a column is first sorted: names A→Z, numbers high→low. */
export const firstDir = (key: SortKey) => (key === 'name' ? 'asc' : 'desc')

// Typed search text runs ahead of the URL: the board filters on every keystroke, but the URL is
// written once typing pauses. A write per keystroke (IME composition included) would hit Safari's
// cap on history updates (100 per 30 s, then it throws) and re-route the app each time. The text
// is shared by every caller of useBoardQuery, and module state tracks the pending write.
const useTyped = create<{ text: string | null }>(() => ({ text: null }))
const DEBOUNCE_MS = 250
let timer = 0
/** The q our last write put in the URL, until that navigation is seen. */
let awaiting: string | null = null
/** The last location key handled, so several callers handle each navigation once. */
let seenKey: string | null = null

export function useBoardQuery() {
  const [params, setParams] = useSearchParams()
  const { key } = useLocation()
  const urlQ = params.get('q') ?? ''
  const typed = useTyped((s) => s.text)
  const q = typed ?? urlQ
  const group = params.get('g') ?? 'all'
  const f = params.get('f')
  const quick: Quick = f === 'offline' || f === 'hot' ? f : null
  const sortRaw = params.get('sort')
  const query = useMemo<BoardQuery>(() => ({ q, group, quick, sort: parseSort(sortRaw) }), [q, group, quick, sortRaw])

  // Our own write landing keeps the typed text (typing may have gone on meanwhile); any other
  // navigation (a link, back/forward, the site mark) brings the URL's search back.
  useEffect(() => {
    if (key === seenKey) return
    seenKey = key
    const text = useTyped.getState().text
    if (awaiting !== null && urlQ === awaiting) {
      awaiting = null
      if (text === urlQ) useTyped.setState({ text: null })
      return
    }
    if (text !== null) {
      window.clearTimeout(timer)
      timer = 0
      awaiting = null
      useTyped.setState({ text: null })
    }
  }, [key, urlQ])

  /** Writes the patch, plus any typed search not yet in the URL. */
  const write = useCallback(
    (patch: Partial<BoardQuery>) => {
      window.clearTimeout(timer)
      timer = 0
      const text = useTyped.getState().text
      const current = new URLSearchParams(window.location.search)
      if (text !== null && text !== (current.get('q') ?? '')) awaiting = text
      setParams(
        () => {
          // Start from the live URL rather than the hook's last render, so two updates in one frame
          // (e.g. a tab click right after a sort click) both land.
          const next = new URLSearchParams(window.location.search)
          const set = (k: string, v: string | null) => (v ? next.set(k, v) : next.delete(k))
          if (text !== null) set('q', text || null)
          if ('group' in patch) set('g', patch.group && patch.group !== 'all' ? patch.group : null)
          if ('quick' in patch) set('f', patch.quick ?? null)
          if ('sort' in patch) set('sort', patch.sort ? `${patch.sort.key}-${patch.sort.dir}` : null)
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const update = useCallback(
    (patch: Partial<BoardQuery>) => {
      if ('q' in patch) useTyped.setState({ text: patch.q ?? '' })
      // Typing waits for a pause; clearing the box and every other change are written at once.
      if (Object.keys(patch).length === 1 && patch.q) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => write({}), DEBOUNCE_MS)
        return
      }
      write(patch)
    },
    [write],
  )

  /** Writes a pending search now (the search box lost focus, e.g. a row is being opened). */
  const flush = useCallback(() => {
    if (timer) write({})
  }, [write])

  return [query, update, flush] as const
}

export interface Group {
  key: string
  label: string
  code?: string
  rows: Row[]
}

/** Key of the admin-group tab for nodes without a group; kept as is so old links still open it. */
const UNGROUPED = '未分组'

/** `t` gives the labels. */
export function groupRows(rows: Row[], by: SiteSettings['groupBy'], t: TFunction): Group[] {
  if (by === 'none') return [{ key: 'all', label: t('common.all'), rows }]
  const map = new Map<string, Row[]>()
  for (const r of rows) {
    const k = by === 'continent' ? r.region.continent : r.node.group?.trim() || UNGROUPED
    map.set(k, [...(map.get(k) ?? []), r])
  }
  if (by === 'continent') {
    return CONTINENTS.filter((c) => map.has(c)).map((c) => ({ key: c, label: t(`continent.${c}`), code: c === 'OT' ? undefined : c, rows: map.get(c)! }))
  }
  return [...map.entries()].map(([k, rs]) => ({ key: k, label: k === UNGROUPED ? t('board.ungrouped') : k, rows: rs }))
}

function sortValue(r: Row, key: SortKey, traffic: NodeTraffic | undefined): number | string | null {
  const st = r.online ? r.status : undefined
  switch (key) {
    case 'name':
      return r.node.name.toLowerCase()
    case 'uptime':
      return st?.uptime ?? null
    case 'cpu':
      return r.cpu
    case 'ram':
      return r.ram
    case 'disk':
      return r.disk
    case 'load':
      return st?.load ?? null
    case 'net':
      return st ? st.net_in + st.net_out : null
    case 'month':
    case 'total': {
      const t = traffic?.[key].get(r.node.uuid)
      return t ? t.up + t.down : null
    }
    case 'seen':
      return r.lastSeen
  }
}

export interface BoardView {
  /** Every group, for the tabs and their counts. */
  allGroups: Group[]
  /** The tab in effect: the URL's when it still exists, else 'all'. */
  filter: string
  /** Groups after the tab, quick and search filters (empty groups dropped). */
  groups: Group[]
  /** Sorted rows when a column sort is on (the board is then one flat list), else null. */
  flat: Row[] | null
  /** Rows on screen, in screen order: what ↑/↓ and the drawer's [ / ] step through. */
  order: Row[]
}

/** `t` gives the group labels. */
export function boardView(rows: Row[], by: SiteSettings['groupBy'], query: BoardQuery, traffic: NodeTraffic | undefined, t: TFunction): BoardView {
  const allGroups = groupRows(rows, by, t)
  // A tab from an old link that no longer exists (or grouping switched off) shows everything.
  const filter = by !== 'none' && allGroups.some((g) => g.key === query.group) ? query.group : 'all'
  const q = query.q.trim().toLowerCase()
  const quick = (r: Row) => (query.quick === 'offline' ? !r.online : query.quick === 'hot' ? isHot(r) : true)
  const match = (r: Row) =>
    quick(r) && (!q || [r.node.name, r.region.name, r.region.code ?? '', r.code.area, r.code.hash, r.node.group, ...parseTags(r.node.tags).map((t) => t.text)].some((s) => s?.toLowerCase().includes(q)))
  const groups = allGroups
    .filter((g) => filter === 'all' || g.key === filter)
    .map((g) => ({ ...g, rows: g.rows.filter(match) }))
    .filter((g) => g.rows.length)

  let flat: Row[] | null = null
  const sort = query.sort
  if (sort) {
    const dir = sort.dir === 'asc' ? 1 : -1
    flat = groups
      .flatMap((g) => g.rows)
      .sort((a, b) => {
        const va = sortValue(a, sort.key, traffic)
        const vb = sortValue(b, sort.key, traffic)
        if (va === null && vb === null) return 0
        if (va === null) return 1
        if (vb === null) return -1
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir
      })
  }
  return { allGroups, filter, groups, flat, order: flat ?? groups.flatMap((g) => g.rows) }
}

/**
 * Holds a sorted board's row order while `hold` is on (pointer or focus on the list), so rows sorted
 * by a live value do not slide away under the pointer every refresh. A new search, tab, filter or
 * sort applies at once; rows that leave the filter drop out and new ones join at the end.
 */
export function useHeldOrder(view: BoardView, query: BoardQuery, hold: boolean): BoardView {
  const [held, setHeld] = useState<{ key: string; ids: string[] } | null>(null)
  const key = `${query.q}|${view.filter}|${query.quick}|${query.sort?.key}-${query.sort?.dir}`
  // Only a non-empty list is held: an empty one (still loading, or nothing matches yet) has no
  // order to keep, and holding it would leave every row that arrives later unordered.
  const live = hold && view.flat?.length ? view.flat : null
  if (!live) {
    if (held) setHeld(null)
  } else if (held?.key !== key) {
    setHeld({ key, ids: live.map((r) => r.node.uuid) })
  }
  return useMemo(() => {
    if (!live || held?.key !== key) return view
    const byId = new Map(live.map((r) => [r.node.uuid, r]))
    const kept = held.ids.flatMap((id) => byId.get(id) ?? [])
    const seen = new Set(held.ids)
    const flat = [...kept, ...live.filter((r) => !seen.has(r.node.uuid))]
    return { ...view, flat, order: flat }
  }, [view, live, held, key])
}
