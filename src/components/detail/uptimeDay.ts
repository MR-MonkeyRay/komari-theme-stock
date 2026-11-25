import { create } from 'zustand'

/** The day opened under the availability strip, for one node; Esc closes it before the drawer. */
export const useOpenDay = create<{ uuid: string | null; day: number | null }>(() => ({ uuid: null, day: null }))

/** Closes the opened day; false when none was open. */
export function closeUptimeDay() {
  if (useOpenDay.getState().day === null) return false
  useOpenDay.setState({ day: null })
  return true
}
