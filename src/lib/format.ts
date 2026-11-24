import { filesize } from 'filesize'

export const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

const SYMBOLS = { B: 'B', KB: 'K', MB: 'M', GB: 'G', TB: 'T', PB: 'P' }

/** Binary (1024) size split into [number, unit] with compact units: 1.62 / M. */
export function sizeParts(bytes: number | null | undefined, rate = false): [string, string] | null {
  if (!finite(bytes) || bytes < 0) return null
  const [v, unit] = filesize(bytes, { base: 2, standard: 'jedec', round: 2, symbols: SYMBOLS, output: 'array' }) as [number, string]
  const text = v >= 100 ? v.toFixed(1) : String(v)
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
  return x > 0 ? `+${v}` : v === (-0).toFixed(digits) ? (0).toFixed(digits) : v
}

/** Uptime like 18天4时 / 5时12分. */
export function duration(seconds: number | null | undefined) {
  if (!finite(seconds) || seconds <= 0) return '—'
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}天${Math.floor((seconds % 86400) / 3600)}时`
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`
  return `${Math.max(1, Math.floor(seconds / 60))}分`
}

/** Compact age: 3s前 / 9m前 / 2h前 / 3d前. */
export function ago(ms: number | null, now: number) {
  if (ms === null) return '—'
  const t = Math.max(0, Math.floor((now - ms) / 1000))
  const label = t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m` : t < 86400 ? `${Math.floor(t / 3600)}h` : `${Math.floor(t / 86400)}d`
  return `${label}前`
}

const two = (n: number) => String(n).padStart(2, '0')

export function clock(ms: number, seconds = true) {
  const d = new Date(ms)
  return `${two(d.getHours())}:${two(d.getMinutes())}${seconds ? ':' + two(d.getSeconds()) : ''}`
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

/** Meter level class: warn at 70%, danger at 85%. */
export function levelOf(p: number | null) {
  if (!finite(p)) return ''
  return p >= 85 ? 'is-danger' : p >= 70 ? 'is-warn' : ''
}
