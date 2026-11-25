import { useCallback, type KeyboardEvent, type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * Opening a node from the board or the ticker. These are buttons, not links: a link shows its URL
 * in the corner of the window while the pointer rests on it, and the board is all rows. The drawer
 * still has its own address (Back closes it, a reload or a shared link reopens it), and Ctrl/⌘,
 * Shift or the middle button still open the node in a new tab, as they would on a link.
 */
export function useOpenNode() {
  const navigate = useNavigate()
  const { search } = useLocation()
  const open = useCallback(
    (uuid: string, e: MouseEvent | KeyboardEvent) => {
      if (newTab(e)) {
        window.open(`${import.meta.env.BASE_URL}instance/${encodeURIComponent(uuid)}${search}`, '_blank', 'noopener')
        return
      }
      navigate({ pathname: `/instance/${uuid}`, search }, { state: { fromBoard: true } })
    },
    [navigate, search],
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
