import { useSyncExternalStore } from 'react'

/** Phones (and small tablets): where the stylesheets switch to the one-column phone layout. */
export const PHONE_QUERY = '(max-width: 860px)'

const phone = typeof window !== 'undefined' ? window.matchMedia(PHONE_QUERY) : null

/** Whether the phone layout applies now (read once, e.g. when a chart is created). */
export function isPhone() {
  return phone?.matches ?? false
}

/** Whether the phone layout applies, re-rendering when the window crosses the breakpoint. */
export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      phone?.addEventListener('change', cb)
      return () => phone?.removeEventListener('change', cb)
    },
    isPhone,
  )
}
