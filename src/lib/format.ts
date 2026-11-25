import { filesize } from 'filesize'
import i18n, { currentLanguage } from '../i18n'
import { LEVEL } from './thresholds'

export const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const SYMBOLS = { B: 'B', KB: 'K', MB: 'M', GB: 'G', TB: 'T', PB: 'P' }

/** Binary (1024) size split into [number, unit] with compact units: 1.62 / M. */
/** `fixed` pads to 2 decimals (1 from 100) so ticking values keep their width; capacities stay short (12G). */
export function sizeParts(bytes: number | null | undefined, rate = false, fixed = rate): [string, string] | null {
  if (!finite(bytes) || bytes < 0) return null
  const [v, unit] = filesize(bytes, { base: 2, standard: 'jedec', round: 2, symbols: SYMBOLS, output: 'array' }) as [number, string]
  const text = v >= 100 ? v.toFixed(1) : fixed ? v.toFixed(2) : String(v)
  return [bytes > 0 && v === 0 ? '<1' : text, unit + (rate ? '/s' : '')]
}

export function size(bytes: number | null | undefined, rate = false) {
  const p = sizeParts(bytes, rate)
  return p ? p.join('') : '—'
}

export function pct(x: number | null | undefined, digits = 1) {
  return finite(x) ? `${x.toFixed(digits)}%` : '—'
}

export function ratio(used: number | undefined, total: number | undefined) {
  return finite(used) && finite(total) && total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : null
}

export function signed(x: number, digits = 1) {
  const v = x.toFixed(digits)
  // Values that round to zero (e.g. -0.03 → "-0.0") print unsigned.
  if (Number(v) === 0) return (0).toFixed(digits)
  return x > 0 ? `+${v}` : v
}

/** Uptime like 18天4时 / 18d 4h. */
export function duration(seconds: number | null | undefined) {
  if (!finite(seconds) || seconds <= 0) return '—'
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (seconds >= 86400) return i18n.t('format.dayHour', { d: Math.floor(seconds / 86400), h })
  if (seconds >= 3600) return i18n.t('format.hourMinute', { h: Math.floor(seconds / 3600), m })
  return i18n.t('format.minute', { m: Math.max(1, m) })
}

/** Compact age: 3s前 / 9m ago; `short` for narrow columns (3s前 / 9m). */
export function ago(ms: number | null, now: number, short = false) {
  if (ms === null) return '—'
  const t = Math.max(0, Math.floor((now - ms) / 1000))
  const label = t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m` : t < 86400 ? `${Math.floor(t / 3600)}h` : `${Math.floor(t / 86400)}d`
  return i18n.t(short ? 'format.agoShort' : 'format.ago', { t: label })
}

const two = (n: number) => String(n).padStart(2, '0')

export function clock(ms: number, seconds = true) {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? ':' + two(d.getSeconds()) : ''}`
}

const dayFormats = new Map<string, Intl.DateTimeFormat>()

/** Month and day in the page language's order: 11/24, 24.11., 24/11 (`pad`: two digits each). */
export function monthDay(ms: number, pad = true) {
  const key = `${currentLanguage()}|${pad}`
  let f = dayFormats.get(key)
  if (!f) dayFormats.set(key, (f = new Intl.DateTimeFormat(currentLanguage(), pad ? { month: '2-digit', day: '2-digit' } : { month: 'numeric', day: 'numeric' })))
  return f.format(ms)
}

const weekdayFormats = new Map<string, Intl.DateTimeFormat>()

/** Short weekday in the page language: 周二 / Tue / Di. */
export function weekday(ms: number) {
  const lang = currentLanguage()
  let f = weekdayFormats.get(lang)
  if (!f) weekdayFormats.set(lang, (f = new Intl.DateTimeFormat(lang, { weekday: 'short' })))
  return f.format(ms)
}

/** Month/day and time: 11/24 17:30. */
export function monthDayTime(ms: number) {
  return `${monthDay(ms)} ${clock(ms, false)}`
}

export function sameDay(a: number, b: number) {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

export function dateText(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

export function utcOffset(ms = Date.now()) {
  const off = -new Date(ms).getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `UTC${sign}${two(Math.floor(Math.abs(off) / 60))}${off % 60 ? ':' + two(Math.abs(off) % 60) : ''}`
}

export function parseTime(s: string | undefined | null) {
  if (!s) return null
  const v = Date.parse(s)
  return Number.isFinite(v) && v > Date.UTC(2000, 0, 1) ? v : null
}

/**
 * A CPU's model without the padding vendors put in its name: trademark marks, "CPU", "Processor",
 * the core count and the clock. `Intel(R) Xeon(R) CPU E5-2690 v3 @ 2.60GHz` -> `Intel Xeon E5-2690 v3`,
 * `AMD EPYC 7K62 48-Core Processor` -> `AMD EPYC 7K62`. Generic names (`QEMU Virtual CPU version 2.5+`,
 * `Common KVM processor`) stay as they are.
 */
export function cpuModel(name: string) {
  const short = name
    .replace(/\((?:R|TM)\)|[®™]/gi, '')
    .replace(/\s*@.*$/, '')
    .replace(/\b\d+-Core\b/gi, '')
    .replace(/(?<!Virtual\s)\bCPU\b/g, '')
    .replace(/\bProcessor\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return short || name
}

/** Komari tags: `a;b<red>;c` -> [{ text, color }] (color suffix is optional). */
export function parseTags(tags: string | undefined) {
  if (!tags) return []
  const seen = new Set<string>()
  const out: { text: string; color?: string }[] = []
  for (const raw of tags.split(';')) {
    const m = raw.trim().match(/^(.*?)(?:<([a-z]+)>)?$/i)
    const text = m?.[1]?.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push({ text, color: m?.[2]?.toLowerCase() })
  }
  return out
}

/** Meter level class: amber from LEVEL.warn, red from LEVEL.danger. */
export function levelOf(p: number | null) {
  if (!finite(p)) return ''
  return p >= LEVEL.danger ? 'is-danger' : p >= LEVEL.warn ? 'is-warn' : ''
}
