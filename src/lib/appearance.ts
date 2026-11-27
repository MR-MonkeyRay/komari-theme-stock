import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

// `appearance` is the localStorage key shared with Komari's default theme. With nothing stored
// (or storage blocked) the page is dark, the trading-terminal look; index.html does the same.
export type Appearance = 'light' | 'dark' | 'system'
const KEY = 'appearance'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readStored(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(a: Appearance): 'light' | 'dark' {
  return a === 'system' ? (media?.matches ? 'dark' : 'light') : a
}

function apply(a: Appearance) {
  document.documentElement.dataset.theme = resolveTheme(a)
}

export function useAppearance() {
  const [appearance, setState] = useState<Appearance>(readStored)

  useEffect(() => {
    apply(appearance)
    if (appearance !== 'system' || !media) return
    const onChange = () => apply('system')
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [appearance])

  const set = useCallback((a: Appearance) => {
    try {
      localStorage.setItem(KEY, a)
    } catch {
      /* storage may be unavailable */
    }
    // Cross-fade the whole page, charts included: a view transition snapshots the canvases too,
    // which per-element CSS transitions cannot. Without support, or with reduced motion, switch at once.
    // Also switch at once when the colors stay the same (e.g. light → system on a light system).
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const same = resolveTheme(a) === document.documentElement.dataset.theme
    if (reduce || same || !document.startViewTransition) {
      apply(a)
      setState(a)
      return
    }
    // Rendering is paused until the callback returns, so it must not wait for frames (that stalls
    // until the browser's timeout). Commit React synchronously; the new side of the transition is
    // live, so the charts' repaint on the next frame still lands inside the fade.
    document.startViewTransition(() => {
      apply(a)
      flushSync(() => setState(a))
    })
  }, [])

  return [appearance, set] as const
}

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-convention'] })
  return () => obs.disconnect()
}

/** Re-renders when the resolved palette (theme or up/down convention) changes. */
export function usePaletteVersion() {
  return useSyncExternalStore(
    subscribeTheme,
    () => `${document.documentElement.dataset.theme}|${document.documentElement.dataset.convention}`,
  )
}

export function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
