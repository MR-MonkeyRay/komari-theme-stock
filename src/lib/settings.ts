import type { PublicSettings } from './types'

// Mirrors the managed `configuration` in komari-theme.json. Komari returns the
// saved values under `theme_settings` in /api/public; missing keys use these defaults.

export type Range = '1h' | '6h' | '24h' | '3d' | '7d'

export interface ThemeSettings {
  /** true: red means rising (A-share convention); false: green means rising. */
  redUp: boolean
  groupBy: 'continent' | 'group' | 'none'
  showSparkline: boolean
  defaultRange: Range
  refreshSeconds: number
  showEvents: boolean
}

export const defaultSettings: ThemeSettings = {
  redUp: true,
  groupBy: 'continent',
  showSparkline: true,
  defaultRange: '24h',
  refreshSeconds: 2,
  showEvents: true,
}

const groupOptions: Record<string, ThemeSettings['groupBy']> = {
  大洲: 'continent',
  后台分组: 'group',
  不分组: 'none',
}

export function readSettings(pub: PublicSettings | undefined): ThemeSettings {
  const raw = (pub?.theme_settings ?? {}) as Record<string, unknown>
  const pick = <T>(key: string, fallback: T, valid: (v: unknown) => boolean) => (valid(raw[key]) ? (raw[key] as T) : fallback)
  const refresh = Number(raw.refreshSeconds)
  const range = String(raw.defaultRange ?? '')
  return {
    redUp: raw.colorConvention !== '绿涨红跌',
    groupBy: groupOptions[String(raw.groupBy)] ?? defaultSettings.groupBy,
    showSparkline: pick('showSparkline', defaultSettings.showSparkline, (v) => typeof v === 'boolean'),
    defaultRange: (['1h', '6h', '24h'] as const).includes(range as never) ? (range as Range) : defaultSettings.defaultRange,
    refreshSeconds: Number.isFinite(refresh) && refresh >= 1 ? Math.min(60, refresh) : defaultSettings.refreshSeconds,
    showEvents: pick('showEvents', defaultSettings.showEvents, (v) => typeof v === 'boolean'),
  }
}
