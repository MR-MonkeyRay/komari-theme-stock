import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PublicSettings } from './types'

export type Range = '1h' | '6h' | '24h' | '3d' | '7d'
export const RANGES: Range[] = ['1h', '6h', '24h', '3d', '7d']
export const REFRESH_OPTIONS = [1, 2, 5, 10, 30] as const

// ---- Site settings: the managed `configuration` in komari-theme.json, saved by the admin and
// returned under `theme_settings` in /api/public. Only what needs the backend lives there.

export interface SiteSettings {
  groupBy: 'continent' | 'group' | 'none'
}

const groupOptions: Record<string, SiteSettings['groupBy']> = {
  大洲: 'continent',
  后台分组: 'group',
  不分组: 'none',
}

export function readSiteSettings(pub: PublicSettings | undefined): SiteSettings {
  const raw = (pub?.theme_settings ?? {}) as Record<string, unknown>
  return { groupBy: groupOptions[String(raw.groupBy)] ?? 'continent' }
}

// ---- Visitor preferences: chosen on the page, kept in this browser only.

export interface Prefs {
  /** true: red means rising (A-share convention); false: green means rising. */
  redUp: boolean
  showSparkline: boolean
  refreshSeconds: number
  defaultRange: Range
  showEvents: boolean
  /** Detail charts as candles (K 线) or as a line of bucket averages (分时). */
  chartStyle: ChartStyle
}

export type ChartStyle = 'candle' | 'line'

export const defaultPrefs: Prefs = {
  redUp: true,
  showSparkline: true,
  refreshSeconds: 2,
  defaultRange: '24h',
  showEvents: true,
  chartStyle: 'candle',
}

export type ThemeSettings = SiteSettings & Prefs

/** Keeps only valid stored values, so a hand-edited or outdated entry falls back to defaults. */
function sanitize(raw: unknown): Partial<Prefs> {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Partial<Prefs> = {}
  for (const key of ['redUp', 'showSparkline', 'showEvents'] as const) if (typeof s[key] === 'boolean') out[key] = s[key]
  if (REFRESH_OPTIONS.includes(s.refreshSeconds as never)) out.refreshSeconds = s.refreshSeconds as number
  if (RANGES.includes(s.defaultRange as never)) out.defaultRange = s.defaultRange as Range
  if (s.chartStyle === 'candle' || s.chartStyle === 'line') out.chartStyle = s.chartStyle
  return out
}

interface PrefsStore extends Prefs {
  update: (p: Partial<Prefs>) => void
  reset: () => void
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      ...defaultPrefs,
      update: (p) => set(p),
      reset: () => set(defaultPrefs),
    }),
    {
      name: 'komari-theme-stock.prefs',
      version: 1,
      partialize: ({ redUp, showSparkline, refreshSeconds, defaultRange, showEvents, chartStyle }) => ({ redUp, showSparkline, refreshSeconds, defaultRange, showEvents, chartStyle }),
      merge: (stored, current) => ({ ...current, ...sanitize(stored) }),
    },
  ),
)

export function isDefaultPrefs(p: Prefs) {
  return (Object.keys(defaultPrefs) as (keyof Prefs)[]).every((k) => p[k] === defaultPrefs[k])
}
