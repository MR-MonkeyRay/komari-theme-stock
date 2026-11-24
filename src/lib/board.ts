import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { create } from 'zustand'

// Board view state (search, group tab, sort) lives in the URL query, so a reload or a shared link
// shows the same board, and the detail drawer keeps it while it is open.

export type SortKey = 'name' | 'uptime' | 'cpu' | 'ram' | 'disk' | 'load' | 'traffic' | 'net' | 'seen'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' } | null

export interface BoardQuery {
  /** Search text. */
  q: string
  /** Group tab key; 'all' shows every group. */
  group: string
  sort: Sort
}

const SORT_KEYS: SortKey[] = ['name', 'uptime', 'cpu', 'ram', 'disk', 'load', 'traffic', 'net', 'seen']

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
  const sortRaw = params.get('sort')
  const query = useMemo<BoardQuery>(() => ({ q, group, sort: parseSort(sortRaw) }), [q, group, sortRaw])

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
