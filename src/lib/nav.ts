import { useCallback, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { useBoardSearch } from './board'

/**
 * Opening a node from the board or the ticker. These are buttons, not links: a link shows its URL
 * in the corner of the window while the pointer rests on it, and the board is all rows. The drawer
 * still has its own address (Back closes it, a reload or a shared link reopens it), and Ctrl/⌘,
 * Shift or the middle button still open the node in a new tab, as they would on a link.
 */
export function useOpenNode() {
  const navigate = useNavigate()
  const boardSearch = useBoardSearch()
  const open = useCallback(
    (uuid: string, e: MouseEvent | KeyboardEvent) => {
      const search = boardSearch()
      if (newTab(e)) {
        window.open(`${import.meta.env.BASE_URL}instance/${encodeURIComponent(uuid)}${search}`, '_blank', 'noopener')
        return
      }
      // The board's own entry takes a search typed a moment ago first (its write may still be
      // pending), so Back from the drawer returns to the board as it was left.
      // Compared as parsed: the serializer leaves characters unescaped that the address escapes.
      if (new URLSearchParams(search).toString() !== new URLSearchParams(window.location.search).toString()) navigate({ search }, { replace: true, state: window.history.state?.usr })
      navigate({ pathname: `/instance/${uuid}`, search }, { state: { fromBoard: true } })
    },
    [navigate, boardSearch],
  )
  return open
}

const newTab = (e: MouseEvent | KeyboardEvent) => ('button' in e && e.button === 1) || e.ctrlKey || e.metaKey || e.shiftKey

/**
 * Enter with Ctrl/⌘ or Shift on a focused button: a new tab, as on a link. Some browsers send no
 * click for it; where they do, the default is cancelled so it does not open twice.
 */
export function newTabKey(e: KeyboardEvent) {
  if (e.key !== 'Enter' || !newTab(e)) return false
  e.preventDefault()
  return true
}

/** Handlers for an element that opens `uuid` this way; the middle button also skips autoscroll. */
export function openProps(uuid: string, open: ReturnType<typeof useOpenNode>) {
  return {
    onClick: (e: MouseEvent) => open(uuid, e),
    onAuxClick: (e: MouseEvent) => e.button === 1 && open(uuid, e),
    onMouseDown: (e: MouseEvent) => e.button === 1 && e.preventDefault(),
    onKeyDown: (e: KeyboardEvent) => newTabKey(e) && open(uuid, e),
  }
}
