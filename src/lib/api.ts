import { useQuery } from '@tanstack/react-query'
import { rpc, rpcBatch } from './rpc'
import type { Range } from './settings'
import type { Aggregation, MetricDefinition, MetricQueryResult, NodeInfo, NodeStatus, PublicSettings } from './types'

export const RANGE_SPEC: Record<Range, { hours: number; points: number }> = {
  '1h': { hours: 1, points: 60 },
  '6h': { hours: 6, points: 72 },
  '24h': { hours: 24, points: 144 },
  '3d': { hours: 72, points: 144 },
  '7d': { hours: 168, points: 168 },
}

export const HISTORY_KEYS = ['cpu.usage', 'memory.used', 'disk.used', 'net.out.rate', 'net.in.rate'] as const
export type HistoryKey = (typeof HISTORY_KEYS)[number]

async function getPublic(): Promise<PublicSettings> {
  const res = await fetch(`${import.meta.env.BASE_URL}api/public`, { credentials: 'same-origin' })
  const json = await res.json()
  if (json.status !== 'success') throw new Error(json.message || 'failed to load /api/public')
  return json.data
}

export function usePublicSettings() {
  return useQuery({ queryKey: ['public'], queryFn: getPublic, staleTime: 60_000 })
}

export function useNodes() {
  return useQuery({
    queryKey: ['nodes'],
    queryFn: async ({ signal }) => {
      const res = await rpc<NodeInfo[] | Record<string, NodeInfo>>('public:getNodesInformation', {}, signal)
      const list = Array.isArray(res) ? res : Object.values(res ?? {})
      return list.filter((n) => !n.hidden).sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
    },
    refetchInterval: 60_000,
  })
}

export function useLatestStatus(refreshSeconds: number) {
  return useQuery<Record<string, NodeStatus>>({
    queryKey: ['status'],
    queryFn: ({ signal }) => rpc<Record<string, NodeStatus>>('common:getNodesLatestStatus', {}, signal).then((r) => r ?? {}),
    refetchInterval: refreshSeconds * 1000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  })
}

export function useMetricDefinitions() {
  return useQuery({
    queryKey: ['metric-defs'],
    queryFn: ({ signal }) => rpc<MetricDefinition[]>('public:listMetricDefinitions', {}, signal).then((r) => r ?? []),
    staleTime: 10 * 60_000,
  })
}

/** Point maps keyed by `${metric}|${entity}` -> time(ms) -> value. */
export type SeriesMap = Map<string, Map<number, number>>

function toMap(res: MetricQueryResult): SeriesMap {
  const out: SeriesMap = new Map()
  for (const s of res.series ?? []) {
    const m = new Map<number, number>()
    for (const p of s.points ?? []) m.set(Date.parse(p.time), p.value)
    out.set(`${s.metric_key}|${s.entity_id}`, m)
  }
  return out
}

export interface HistoryResult {
  interval: number
  start: number
  end: number
  agg: Record<Aggregation, SeriesMap>
}

/** OHLC source for one node: max/min/last/avg aggregations in one batched request. */
export function useHistory(uuid: string | undefined, range: Range, refreshSeconds: number) {
  const spec = RANGE_SPEC[range]
  return useQuery<HistoryResult>({
    queryKey: ['history', uuid, range],
    enabled: !!uuid,
    placeholderData: (prev) => prev,
    refetchInterval: Math.max(30, refreshSeconds * 10) * 1000,
    queryFn: async ({ signal }): Promise<HistoryResult> => {
      const aggs: Aggregation[] = ['max', 'min', 'last', 'avg']
      const params = { metric_keys: HISTORY_KEYS, entity_ids: [uuid], hours: spec.hours, max_points: spec.points }
      const results = await rpcBatch<MetricQueryResult[]>(
        aggs.map((aggregation) => ({ method: 'public:queryMetrics', params: { ...params, aggregation } })),
        signal,
      )
      const first = results[0]
      const interval = first.series?.find((s) => s.interval_seconds)?.interval_seconds ?? (spec.hours * 3600) / spec.points
      return {
        interval,
        start: Date.parse(first.start),
        end: Date.parse(first.end),
        agg: Object.fromEntries(aggs.map((a, i) => [a, toMap(results[i])])) as Record<Aggregation, SeriesMap>,
      }
    },
  })
}

/** 1h CPU trail for every node in one request, used by the board sparklines. */
export type Sparks = Map<string, { t: number; v: number }[]>

export function useSparklines(uuids: string[], enabled: boolean) {
  return useQuery<Sparks>({
    queryKey: ['sparklines', uuids.join(',')],
    enabled: enabled && uuids.length > 0,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const res = await rpc<MetricQueryResult>(
        'public:queryMetrics',
        { metric_keys: ['cpu.usage'], entity_ids: uuids, hours: 1, max_points: 60, aggregation: 'avg' },
        signal,
      )
      const out = new Map<string, { t: number; v: number }[]>()
      for (const s of res.series ?? []) {
        out.set(
          s.entity_id,
          (s.points ?? []).map((p) => ({ t: Date.parse(p.time), v: p.value })),
        )
      }
      return out
    },
  })
}

export function monthStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

/**
 * Natural-month traffic per node (bytes), summed from `traffic.up/down` deltas.
 * Only enabled when metric retention covers the whole month so far; the caller
 * falls back to the agent's cumulative counters otherwise.
 */
export function useMonthlyTraffic(uuids: string[], enabled: boolean) {
  return useQuery<Map<string, { up: number; down: number }>>({
    queryKey: ['monthly', uuids.join(',')],
    enabled: enabled && uuids.length > 0,
    refetchInterval: 5 * 60_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const res = await rpc<MetricQueryResult>(
        'public:queryMetrics',
        {
          metric_keys: ['traffic.up', 'traffic.down'],
          entity_ids: uuids,
          start: monthStart().toISOString(),
          max_points: 31,
          aggregation: 'avg',
        },
        signal,
      )
      const out = new Map<string, { up: number; down: number }>()
      for (const s of res.series ?? []) {
        const sum = (s.points ?? []).reduce((acc, p) => acc + p.value * p.count, 0)
        const cur = out.get(s.entity_id) ?? { up: 0, down: 0 }
        if (s.metric_key === 'traffic.up') cur.up = sum
        else cur.down = sum
        out.set(s.entity_id, cur)
      }
      return out
    },
  })
}
