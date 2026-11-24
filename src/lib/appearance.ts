import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

// `appearance` is the localStorage key shared with Komari's default theme.
export type Appearance = 'light' | 'dark' | 'system'
const KEY = 'appearance'
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readStored(): Appearance {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
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
    // Brief cross-fade between palettes; skipped when reduced motion is preferred.
    const root = document.documentElement
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 400)
    setState(a)
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
