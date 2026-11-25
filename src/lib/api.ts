import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { rpc, rpcBatch } from './rpc'
import type { Range } from './settings'
import type { Aggregation, MetricDefinition, MetricQueryResult, NodeInfo, NodeStatus, PingTask, PingTaskStats, PublicSettings } from './types'

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

/** Current viewer; Komari answers with a `Guest` placeholder when nobody is logged in. */
export interface Me {
  logged_in: boolean
  username: string
}

export function useMe() {
  return useQuery<Me>({
    queryKey: ['me'],
    queryFn: ({ signal }) => rpc<Me>('public:getMe', {}, signal),
    staleTime: 60_000,
    // Logging in or out happens in the admin pages, often in another tab; check again whenever the
    // viewer comes back, even within staleTime, so login-only content does not linger.
    refetchOnWindowFocus: 'always',
    retry: 1,
  })
}

/**
 * True only once Komari confirms a logged-in session. While getMe is pending (or failed) the page
 * renders as for a guest, so login-only content never flashes up for one.
 */
export function useIsAdmin() {
  return useMe().data?.logged_in === true
}

/** The few fields the theme takes from `admin:listClients`. */
export interface ClientOps {
  ipv4: string
  ipv6: string
  version: string
}

const text = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Addresses and agent versions, which Komari gives only to a logged-in session. Pass `enabled` only
 * for one: a guest never sends the request. Each client is cut down to the fields above right
 * here, so the agent token in the same response never reaches the cache or the page.
 */
export function useClientOps(enabled: boolean) {
  return useQuery({
    queryKey: ['admin', 'clients'],
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await rpc<Record<string, unknown>[] | Record<string, Record<string, unknown>>>('admin:listClients', {}, signal)
      const out: Record<string, ClientOps> = {}
      for (const c of Array.isArray(res) ? res : Object.values(res ?? {})) {
        out[text(c.uuid)] = { ipv4: text(c.ipv4), ipv6: text(c.ipv6), version: text(c.version) }
      }
      return out
    },
  })
}

/** Komari's default for how many days before expiry its own notice goes out. */
const DEFAULT_LEAD_DAYS = 7

/**
 * Days before expiry that count as due soon, from Komari's expiry notice setting, so the theme and
 * Komari's notices agree. Null for a guest (no request is sent) and while loading; the default if
 * the setting cannot be read.
 */
export function useExpiryLeadDays(enabled: boolean) {
  const q = useQuery({
    queryKey: ['admin', 'expiry-lead-days'],
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    // getSettings also holds credentials (API keys, OAuth secrets): only this number is kept.
    queryFn: async ({ signal }) => {
      const s = await rpc<Record<string, unknown> | null>('admin:getSettings', {}, signal)
      const d = s?.expire_notification_lead_days
      return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : DEFAULT_LEAD_DAYS
    },
  })
  if (!enabled) return null
  return q.data ?? (q.isError ? DEFAULT_LEAD_DAYS : null)
}

export function usePublicSettings() {
  return useQuery({ queryKey: ['public'], queryFn: getPublic, staleTime: 60_000 })
}

export function useNodes() {
  return useQuery({
    queryKey: ['nodes'],
    queryFn: async ({ signal }) => {
      const res = await rpc<NodeInfo[] | Record<string, NodeInfo>>('public:getNodesInformation', {}, signal)
      // Komari returns hidden nodes only to logged-in sessions, so whatever arrives may be shown;
      // hidden ones carry a 隐藏 mark.
      const list = Array.isArray(res) ? res : Object.values(res ?? {})
      return list.sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
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
    // Polling pauses in a background tab; on return, fetch at once instead of showing 陈旧 for a period.
    refetchOnWindowFocus: true,
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

/**
 * History ranges this site keeps enough data for (by `cpu.usage` retention; up to 24h is always
 * offered). `ready` is false until the metric definitions have loaded.
 */
export function useAvailableRanges() {
  const defs = useMetricDefinitions()
  const retention = defs.data?.find((d) => d.name === 'cpu.usage')?.retention_days ?? 1
  const ranges = useMemo(() => (Object.keys(RANGE_SPEC) as Range[]).filter((k) => RANGE_SPEC[k].hours <= Math.max(24, retention * 24)), [retention])
  return { ranges, ready: defs.isSuccess }
}

/** Range to show for a preferred one: itself when available, else the longest available. */
export function fitRange(preferred: Range, { ranges, ready }: ReturnType<typeof useAvailableRanges>) {
  return !ready || ranges.includes(preferred) ? preferred : ranges[ranges.length - 1]
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
  /** The range this data covers; differs from the requested one while another range loads. */
  range: Range
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
    // While another range of the same node loads, keep the old one (dimmed); never another node's.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === uuid ? prev : undefined),
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
        range,
        interval,
        start: Date.parse(first.start),
        end: Date.parse(first.end),
        agg: Object.fromEntries(aggs.map((a, i) => [a, toMap(results[i])])) as Record<Aggregation, SeriesMap>,
      }
    },
  })
}

/** Average TCP and UDP connections per bucket, on the CPU chart's range and buckets. */
export interface ConnPoint {
  time: number
  tcp: number | null
  udp: number | null
}

/** Connection counts for the CPU chart's sub-pane; fetched only while that view is on. */
export function useConnHistory(uuid: string | undefined, range: Range, refreshSeconds: number, enabled: boolean) {
  const spec = RANGE_SPEC[range]
  return useQuery<{ range: Range; points: ConnPoint[] }>({
    queryKey: ['connections', uuid, range],
    enabled: enabled && !!uuid,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === uuid ? prev : undefined),
    refetchInterval: Math.max(30, refreshSeconds * 10) * 1000,
    queryFn: async ({ signal }) => {
      const res = await rpc<MetricQueryResult>('public:queryMetrics', { metric_keys: ['connections.tcp', 'connections.udp'], entity_id: uuid, hours: spec.hours, max_points: spec.points, aggregation: 'avg' }, signal)
      const tcp = new Map<number, number>()
      const udp = new Map<number, number>()
      for (const s of res.series ?? []) {
        const into = s.metric_key === 'connections.tcp' ? tcp : s.metric_key === 'connections.udp' ? udp : null
        for (const p of s.points ?? []) into?.set(Date.parse(p.time) / 1000, p.value)
      }
      const times = [...new Set([...tcp.keys(), ...udp.keys()])].sort((a, b) => a - b)
      return { range, points: times.map((time) => ({ time, tcp: tcp.get(time) ?? null, udp: udp.get(time) ?? null })) }
    },
  })
}

/**
 * Ping tasks that probe this node, in Komari's order, and each task's place in the site's whole list
 * (`place`, by id), so a task keeps its color on nodes that run only some of the tasks.
 */
export function usePingTasks(uuid: string | undefined) {
  const all = useQuery({
    queryKey: ['ping-tasks'],
    queryFn: async ({ signal }) => {
      const res = await rpc<PingTask[] | null>('public:getPublicPingTasks', {}, signal)
      return (res ?? []).slice().sort((a, b) => a.weight - b.weight || a.id - b.id)
    },
    staleTime: 5 * 60_000,
  })
  const tasks = useMemo(() => (uuid ? (all.data ?? []).filter((t) => t.clients?.includes(uuid)) : []), [all.data, uuid])
  const place = useMemo(() => new Map((all.data ?? []).map((t, i) => [String(t.id), i])), [all.data])
  return { tasks, place, ready: all.isSuccess }
}

/** Per task: time (ms) -> value. Lost minutes arrive as latency -1 and stay that way here. */
export interface PingLine {
  avg: Map<number, number>
  min: Map<number, number>
  max: Map<number, number>
  /** 0–1 share of probes lost in the bucket. */
  loss: Map<number, number>
}
export interface PingHistory {
  range: Range
  interval: number
  start: number
  end: number
  /** Keyed by task id. */
  lines: Map<string, PingLine>
  /** Komari keeps ping records for its own period; data never starts before this (ms). */
  retainedFrom: number | null
}

/**
 * Latency and loss for one node over the same range and bucket count as the CPU chart, so the time
 * axes line up. avg drives the lines; min/max give the single-carrier band.
 */
export function usePingHistory(uuid: string | undefined, range: Range, refreshSeconds: number, enabled: boolean) {
  const spec = RANGE_SPEC[range]
  const defs = useMetricDefinitions()
  const retention = defs.data?.find((d) => d.name === 'ping.latency_ms')?.retention_days ?? null
  // Derived on read, not cached with the data: the definitions may arrive after the history.
  const withRetention = useCallback(
    (d: Omit<PingHistory, 'retainedFrom'>): PingHistory => ({ ...d, retainedFrom: retention !== null && retention * 24 < spec.hours ? d.end - retention * 86400_000 : null }),
    [retention, spec.hours],
  )
  return useQuery<Omit<PingHistory, 'retainedFrom'>, Error, PingHistory>({
    queryKey: ['ping', uuid, range],
    enabled: enabled && !!uuid,
    // While another range of the same node loads, keep its lines (dimmed); never another node's.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === uuid ? prev : undefined),
    refetchInterval: Math.max(30, refreshSeconds * 10) * 1000,
    select: withRetention,
    queryFn: async ({ signal }) => {
      const params = { metric_keys: ['ping.latency_ms', 'ping.loss'], entity_id: uuid, hours: spec.hours, max_points: spec.points }
      const aggs: Aggregation[] = ['avg', 'min', 'max']
      const results = await rpcBatch<MetricQueryResult[]>(
        aggs.map((aggregation) => ({ method: 'public:queryMetrics', params: { ...params, aggregation } })),
        signal,
      )
      const lines = new Map<string, PingLine>()
      const line = (id: string) => {
        let l = lines.get(id)
        if (!l) lines.set(id, (l = { avg: new Map(), min: new Map(), max: new Map(), loss: new Map() }))
        return l
      }
      results.forEach((res, k) => {
        for (const s of res.series ?? []) {
          const id = s.tags?.task_id
          if (!id) continue
          const isLoss = s.metric_key === 'ping.loss'
          if (isLoss && aggs[k] !== 'avg') continue
          const target = isLoss ? line(id).loss : line(id)[aggs[k] as 'avg' | 'min' | 'max']
          for (const p of s.points ?? []) target.set(Date.parse(p.time), p.value)
        }
      })
      const first = results[0]
      const end = Date.parse(first.end)
      return {
        range,
        interval: first.series?.find((s) => s.interval_seconds)?.interval_seconds ?? (spec.hours * 3600) / spec.points,
        start: Date.parse(first.start),
        end,
        lines,
      }
    },
  })
}

/** Latest/mean/min/max/σ/loss per task over the range, from raw records. Keyed by task id. */
export function usePingStats(uuid: string | undefined, range: Range, refreshSeconds: number, enabled: boolean) {
  const hours = RANGE_SPEC[range].hours
  return useQuery<Map<string, PingTaskStats>>({
    queryKey: ['ping-stats', uuid, range],
    enabled: enabled && !!uuid,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === uuid ? prev : undefined),
    refetchInterval: Math.max(30, refreshSeconds * 10) * 1000,
    queryFn: async ({ signal }) => {
      const res = await rpc<{ stats: PingTaskStats[] | null }>('public:getPingMetricStats', { uuid, hours }, signal)
      return new Map((res?.stats ?? []).map((s) => [String(s.task_id), s]))
    },
  })
}

/** 1h CPU %, memory bytes and disk bytes for every node in one request, used by the board sparklines. */
export type Trail = { t: number; v: number }[]
export interface SparkSet {
  cpu: Trail
  mem: Trail
  disk: Trail
}
export type Sparks = Map<string, SparkSet>
const SPARK_KEYS = { 'cpu.usage': 'cpu', 'memory.used': 'mem', 'disk.used': 'disk' } as const

export function useSparklines(uuids: string[], enabled: boolean) {
  return useQuery<Sparks>({
    queryKey: ['sparklines', uuids.join(',')],
    enabled: enabled && uuids.length > 0,
    refetchInterval: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async ({ signal }) => {
      const res = await rpc<MetricQueryResult>(
        'public:queryMetrics',
        { metric_keys: Object.keys(SPARK_KEYS), entity_ids: uuids, hours: 1, max_points: 60, aggregation: 'avg' },
        signal,
      )
      const out: Sparks = new Map()
      for (const s of res.series ?? []) {
        const field = SPARK_KEYS[s.metric_key as keyof typeof SPARK_KEYS]
        if (!field) continue
        let set = out.get(s.entity_id)
        if (!set) out.set(s.entity_id, (set = { cpu: [], mem: [], disk: [] }))
        set[field] = (s.points ?? []).filter((p) => Number.isFinite(p.value)).map((p) => ({ t: Date.parse(p.time), v: p.value }))
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
