import type { PingHistory } from './api'
import type { PingTask } from './types'

/** One bucket of one task. `avg` is null for a gap: no record, or every probe lost (Komari's -1). */
export interface PingPoint {
  time: number
  avg: number | null
  min: number | null
  max: number | null
  /** 0–1 share of probes lost; null without a record. */
  loss: number | null
}

export interface PingLineData {
  id: string
  name: string
  /** Index into the --ping-N palette, by task order, so a task keeps its color on every node. */
  slot: number
  points: PingPoint[]
}

/** Palette slots; a seventh task reuses the first color (Komari setups rarely pass three). */
export const PING_SLOTS = 6

const valid = (v: number | undefined) => (v === undefined || v < 0 ? null : v)

/**
 * Lines on one shared bucket grid (seconds), with leading empty buckets trimmed like the K line.
 * `slots` maps a task id to its palette slot.
 */
export function buildPingLines(h: PingHistory, tasks: PingTask[], slots: Map<string, number>): PingLineData[] {
  const step = h.interval * 1000
  const first = Math.floor(h.start / step) * step
  const times: number[] = []
  for (let t = first; t <= h.end; t += step) times.push(t)
  const lines = tasks.map((task) => {
    const id = String(task.id)
    const l = h.lines.get(id)
    return {
      id,
      name: task.name,
      slot: slots.get(id) ?? 0,
      points: times.map((t) => ({ time: t / 1000, avg: valid(l?.avg.get(t)), min: valid(l?.min.get(t)), max: valid(l?.max.get(t)), loss: l?.loss.get(t) ?? null })),
    }
  })
  const start = times.findIndex((_, i) => lines.some((l) => l.points[i].avg !== null || l.points[i].loss !== null))
  if (start < 0) return lines.map((l) => ({ ...l, points: [] }))
  return lines.map((l) => ({ ...l, points: l.points.slice(start) }))
}

export const ms = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v < 10 ? v.toFixed(1) : v.toFixed(0))

/** Loss as a short percentage: 0.4%, 3%, 12%. */
export const lossText = (pct: number) => `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}%`
