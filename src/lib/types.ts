/** Public node record from `public:getNodesInformation` (Komari 1.6). */
export interface NodeInfo {
  uuid: string
  name: string
  cpu_name: string
  virtualization: string
  arch: string
  cpu_cores: number
  cpu_physical_cores?: number
  os: string
  kernel_version?: string
  gpu_name?: string
  region: string
  public_remark: string
  mem_total: number
  swap_total: number
  disk_total: number
  weight: number
  price: number
  billing_cycle: number
  auto_renewal: boolean
  currency: string
  expired_at: string
  group: string
  tags: string
  hidden: boolean
  traffic_limit: number
  traffic_limit_type: string
  /** When the node was added to Komari. */
  created_at?: string
}

/** Latest report from `common:getNodesLatestStatus`. Nodes that never reported are absent. */
export interface NodeStatus {
  client: string
  time: string
  cpu: number
  gpu: number
  ram: number
  ram_total: number
  swap: number
  swap_total: number
  load: number
  load5: number
  load15: number
  temp: number
  disk: number
  disk_total: number
  net_in: number
  net_out: number
  net_total_up: number
  net_total_down: number
  process: number
  connections: number
  connections_udp: number
  online: boolean
  uptime: number
}

export interface PublicSettings {
  sitename: string
  description: string
  theme: string
  theme_settings: Record<string, unknown> | null
  private_site?: boolean
}

export interface MetricPoint {
  time: string
  value: number
  count: number
}

export interface MetricSeries {
  metric_key: string
  entity_id: string
  interval_seconds: number
  retention_days?: number
  /** Ping series carry the task they belong to. */
  tags?: Record<string, string> | null
  points: MetricPoint[] | null
}

/** A Komari ping task as the public API lists it (no target address for guests). */
export interface PingTask {
  id: number
  name: string
  weight: number
  type: string
  interval: number
  clients: string[] | null
}

/** One task's figures from `public:getPingMetricStats`, over raw records. */
export interface PingTaskStats {
  task_id: string
  name: string
  total: number
  valid: number
  /** Percent of probes lost. */
  loss: number
  min: number
  max: number
  avg: number
  latest: number
  /** Komari also sends p50/p99, but they are the mean and mean + σ, so they are not used. */
  stddev: number
}

export interface MetricQueryResult {
  start: string
  end: string
  series: MetricSeries[] | null
}

export interface MetricDefinition {
  name: string
  type: string
  unit?: string
  retention_days: number
}

export type Aggregation = 'avg' | 'min' | 'max' | 'last'
