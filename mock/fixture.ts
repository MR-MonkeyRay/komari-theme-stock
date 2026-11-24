// Dev-only offline fixture shaped like the Komari 1.6.2 public API.
// Values are synthetic; they only exist so the theme can be rendered without a live server.

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const SAMPLE_SECONDS = 30
const START = Date.now()

interface Spec {
  name: string
  flag: string
  cpu: number | null
  ram: number
  disk: number
  up: number
  down: number
  age: number
  uptime: number
  tags: string
  ramGiB: number
  diskGiB: number
  cores: number
  cpuName: string
  arch: string
  virt: string
  load: [number, number, number]
  bill?: [number, string, number, string, boolean]
  monthly?: [number, number]
  group?: string
  remark?: string
}

const specs: Spec[] = [
  { name: 'HK-01', flag: '🇭🇰', cpu: 38, ram: 62, disk: 27, up: 1.62, down: 2.41, age: 3, uptime: 18 * 86400 + 4 * 3600, tags: 'VPS;IPv6', ramGiB: 8, diskGiB: 100, cores: 4, cpuName: 'AMD EPYC 7B13', arch: 'amd64', virt: 'kvm', load: [0.42, 0.38, 0.31], bill: [8.4, '$', 30, '2026-12-13T03:00:00Z', true], monthly: [92.4, 168.1], group: '亚太', remark: '香港 CN2 GIA 线路' },
  { name: 'JP-01', flag: '🇯🇵', cpu: 56, ram: 72, disk: 91, up: 1.89, down: 3.16, age: 5, uptime: 11 * 86400 + 7 * 3600, tags: 'VPS;ARM64', ramGiB: 12, diskGiB: 120, cores: 8, cpuName: 'Ampere Altra', arch: 'arm64', virt: 'kvm', load: [1.26, 1.04, 0.88], bill: [42, '$', 365, '2027-03-18T00:00:00Z', false], monthly: [61.2, 118.4], group: '亚太' },
  { name: 'SG-01', flag: '🇸🇬', cpu: 24, ram: 48, disk: 35, up: 0.63, down: 1.24, age: 4, uptime: 8 * 86400 + 3600, tags: 'VPS', ramGiB: 4, diskGiB: 140, cores: 2, cpuName: 'Intel Xeon Platinum 8272CL', arch: 'amd64', virt: 'kvm', load: [0.18, 0.22, 0.21], monthly: [31.1, 66.2], group: '亚太' },
  { name: 'SYD-01', flag: '🇦🇺', cpu: null, ram: 41, disk: 52, up: 0.3, down: 0.6, age: 12 * 60, uptime: 0, tags: '备份<amber>;IPv6', ramGiB: 8, diskGiB: 160, cores: 4, cpuName: 'Intel Xeon E5-2680 v4', arch: 'amd64', virt: 'kvm', load: [0, 0, 0], group: '亚太' },
  { name: 'FRA-01', flag: '🇩🇪', cpu: 67, ram: 82, disk: 59, up: 1.44, down: 2.39, age: 4, uptime: 18 * 86400 + 11 * 3600, tags: 'VPS;IPv6', ramGiB: 12, diskGiB: 180, cores: 8, cpuName: 'AMD EPYC 7443P', arch: 'amd64', virt: 'kvm', load: [2.31, 1.96, 1.57], bill: [29.9, '€', 365, '2027-02-18T00:00:00Z', true], monthly: [286.3, 419.9], group: '欧洲', remark: '欧洲公开监控节点' },
  { name: 'AMS-01', flag: '🇳🇱', cpu: 32, ram: 49, disk: 61, up: 0.93, down: 1.86, age: 6, uptime: 26 * 86400 + 9 * 3600, tags: '存储<teal>', ramGiB: 4, diskGiB: 500, cores: 2, cpuName: 'Intel Xeon Gold 6230', arch: 'amd64', virt: 'kvm', load: [0.74, 0.7, 0.63], bill: [5, '€', 30, '2026-12-01T00:00:00Z', true], monthly: [86.5, 127.8], group: '欧洲' },
  { name: 'LON-01', flag: '🇬🇧', cpu: 45, ram: 60, disk: 35, up: 1.02, down: 2.14, age: 4, uptime: 14 * 86400 + 2 * 3600, tags: 'VPS;IPv6', ramGiB: 8, diskGiB: 160, cores: 4, cpuName: 'AMD EPYC 7763', arch: 'amd64', virt: 'kvm', load: [0.96, 0.9, 0.82], monthly: [52.6, 90.1], group: '欧洲' },
  { name: 'JNB-01', flag: '🇿🇦', cpu: 18, ram: 36, disk: 31, up: 0.25, down: 0.67, age: 7, uptime: 7 * 86400 + 5 * 3600, tags: 'VPS', ramGiB: 4, diskGiB: 80, cores: 2, cpuName: 'Intel Xeon E-2276G', arch: 'amd64', virt: 'kvm', load: [0.12, 0.18, 0.21], monthly: [9.7, 24.1], group: '其他' },
  { name: 'LAX-01', flag: '🇺🇸', cpu: 42, ram: 63, disk: 51, up: 1.71, down: 2.95, age: 3, uptime: 22 * 86400 + 6 * 3600, tags: '裸金属<violet>;IPv6', ramGiB: 64, diskGiB: 960, cores: 16, cpuName: 'AMD Ryzen 9 7950X', arch: 'amd64', virt: 'none', load: [1.32, 1.19, 1.08], bill: [96, '$', 365, '2027-08-17T00:00:00Z', true], monthly: [311.8, 528.2], group: '北美' },
  { name: 'GRU-01', flag: '🇧🇷', cpu: 21, ram: 39, disk: 67, up: 0.52, down: 1.12, age: 5, uptime: 16 * 86400 + 3 * 3600, tags: 'VPS', ramGiB: 4, diskGiB: 100, cores: 2, cpuName: 'Intel Xeon Silver 4214', arch: 'amd64', virt: 'kvm', load: [0.36, 0.4, 0.42], monthly: [67.4, 116.3], group: '其他' },
  { name: 'NYC-01', flag: '🇺🇸', cpu: null, ram: 55, disk: 44, up: 0.4, down: 0.9, age: 9 * 60, uptime: 0, tags: 'VPS', ramGiB: 8, diskGiB: 120, cores: 4, cpuName: 'Intel Xeon Gold 6148', arch: 'amd64', virt: 'kvm', load: [0, 0, 0], group: '北美' },
  { name: 'YUL-01', flag: '🇨🇦', cpu: 28, ram: 44, disk: 30, up: 0.31, down: 0.86, age: 6, uptime: 9 * 86400 + 8 * 3600, tags: 'VPS', ramGiB: 8, diskGiB: 120, cores: 4, cpuName: 'Intel Xeon E5-2697 v2', arch: 'amd64', virt: 'kvm', load: [0.57, 0.53, 0.47], bill: [-1, '', -1, '0001-01-01T00:00:00Z', false], monthly: [18.0, 37.1], group: '北美' },
]

const uuidOf = (i: number) => {
  const h = (n: number) => Math.floor(Math.abs(Math.sin((i + 1) * 9301 + n * 49297)) * 0xffffffff).toString(16).padStart(8, '0')
  return `${h(1)}-${h(2).slice(0, 4)}-4${h(3).slice(0, 3)}-9${h(4).slice(0, 3)}-${h(5)}${h(6).slice(0, 4)}`
}

// Deterministic value noise in [-1, 1].
function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1
}
function smoothNoise(seed: number, t: number) {
  const i = Math.floor(t)
  const f = t - i
  const u = f * f * (3 - 2 * f)
  return hash(seed * 1000 + i) * (1 - u) + hash(seed * 1000 + i + 1) * u
}

/** Last moment a node produced samples (ms). */
function lastSeen(i: number) {
  const s = specs[i]
  return s.cpu === null ? START - s.age * 1000 : Date.now() - (s.age % 3) * 1000
}

type MetricKey = 'cpu.usage' | 'memory.used' | 'disk.used' | 'net.in.rate' | 'net.out.rate' | 'traffic.up' | 'traffic.down' | 'load.average'

function value(i: number, key: MetricKey, ms: number): number {
  const s = specs[i]
  const m = ms / 60000 // minutes
  const w = (period: number, ph = 0) => Math.sin((m / period) * Math.PI * 2 + i * 1.7 + ph)
  switch (key) {
    case 'cpu.usage': {
      const base = s.cpu ?? 40
      const burst = Math.max(0, smoothNoise(i + 40, m / 37)) ** 3 * 55
      const v = base + 9 * w(240) + 6 * w(73, 1) + 7 * smoothNoise(i, m / 6) + 4 * smoothNoise(i + 9, m * 1.3) + burst
      return Math.min(100, Math.max(0.5, v))
    }
    case 'memory.used': {
      const ratio = s.ram / 100 + 0.035 * w(180) + 0.012 * smoothNoise(i + 3, m / 8) + 0.006 * smoothNoise(i + 5, m)
      return Math.max(0.05, Math.min(0.98, ratio)) * s.ramGiB * GIB
    }
    case 'disk.used': {
      const ratio = s.disk / 100 + 0.018 * w(520, 2) + 0.006 * smoothNoise(i + 11, m / 15) + 0.002 * smoothNoise(i + 17, m)
      return Math.max(0.02, Math.min(0.99, ratio)) * s.diskGiB * GIB
    }
    case 'net.out.rate':
    case 'traffic.up': {
      const rate = Math.max(0.02, s.up * (1 + 0.32 * w(150, 3) + 0.25 * smoothNoise(i + 21, m / 4) + 0.12 * smoothNoise(i + 23, m * 2))) * MIB
      return key === 'traffic.up' ? rate * 3 : rate
    }
    case 'net.in.rate':
    case 'traffic.down': {
      const rate = Math.max(0.02, s.down * (1 + 0.36 * w(150, 4) + 0.28 * smoothNoise(i + 31, m / 4) + 0.14 * smoothNoise(i + 33, m * 2))) * MIB
      return key === 'traffic.down' ? rate * 3 : rate
    }
    case 'load.average':
      return Math.max(0, s.load[0] * (1 + 0.2 * smoothNoise(i + 51, m / 3)))
  }
}

export function nodesInformation() {
  return specs.map((s, i) => ({
    uuid: uuidOf(i),
    name: s.name,
    cpu_name: s.cpuName,
    virtualization: s.virt,
    arch: s.arch,
    cpu_cores: s.cores,
    cpu_physical_cores: Math.max(1, s.cores / 2),
    os: i % 4 === 1 ? 'Ubuntu 24.04.3 LTS' : 'Debian GNU/Linux 12 (bookworm)',
    kernel_version: '6.1.0-28-amd64',
    gpu_name: '',
    region: s.flag,
    public_remark: s.remark ?? '',
    mem_total: s.ramGiB * GIB,
    swap_total: 1 * GIB,
    disk_total: s.diskGiB * GIB,
    weight: i,
    price: s.bill?.[0] ?? 0,
    billing_cycle: s.bill?.[2] ?? 0,
    auto_renewal: s.bill?.[4] ?? false,
    currency: s.bill?.[1] ?? '',
    expired_at: s.bill?.[3] ?? '0001-01-01T00:00:00Z',
    group: s.group ?? '',
    tags: s.tags,
    hidden: false,
    traffic_limit: i === 4 ? 10 * 1024 * GIB : 0,
    traffic_limit_type: 'sum',
  }))
}

export function latestStatus() {
  const out: Record<string, unknown> = {}
  const now = Date.now()
  specs.forEach((s, i) => {
    const online = s.cpu !== null
    const t = online ? now - (1 + (i % 4)) * 1000 : lastSeen(i)
    const tick = Math.floor(now / 2000)
    const jitter = online ? hash(i * 97 + tick) : 0
    const loadScale = 1 + 0.06 * jitter
    out[uuidOf(i)] = {
      client: uuidOf(i),
      time: new Date(t).toISOString(),
      cpu: Math.max(0.5, Math.min(100, value(i, 'cpu.usage', t) + 2.5 * jitter)),
      gpu: 0,
      ram: value(i, 'memory.used', t),
      ram_total: s.ramGiB * GIB,
      swap: 0,
      swap_total: GIB,
      load: +(s.load[0] * loadScale).toFixed(2),
      load5: s.load[1],
      load15: s.load[2],
      temp: 0,
      disk: value(i, 'disk.used', t),
      disk_total: s.diskGiB * GIB,
      net_in: value(i, 'net.in.rate', t) * (1 + 0.1 * jitter),
      net_out: value(i, 'net.out.rate', t) * (1 - 0.1 * jitter),
      net_total_up: (s.monthly?.[0] ?? 20) * 3.2 * GIB,
      net_total_down: (s.monthly?.[1] ?? 40) * 3.2 * GIB,
      process: 120 + i * 7,
      connections: 80 + i * 13,
      connections_udp: 6 + i,
      online,
      uptime: online ? s.uptime + Math.floor((now - START) / 1000) : 0,
      ping: {},
    }
  })
  return out
}

const NICE = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]

interface QueryParams {
  metric_key?: string
  metric_keys?: string[]
  entity_id?: string
  entity_ids?: string[]
  hours?: number
  start?: string
  end?: string
  max_points?: number
  aggregation?: string
}

export function queryMetrics(p: QueryParams) {
  const keys = (p.metric_keys ?? (p.metric_key ? [p.metric_key] : [])) as MetricKey[]
  const ids = p.entity_ids ?? (p.entity_id ? [p.entity_id] : [])
  const end = p.end ? Date.parse(p.end) : Date.now()
  const start = p.start ? Date.parse(p.start) : end - (p.hours ?? 4) * 3600_000
  const maxPoints = p.max_points ?? 500
  const span = (end - start) / 1000
  const min = span > 6 * 3600 + 60 ? 300 : 60
  const interval = NICE.find((n) => n >= Math.max(min, span / maxPoints)) ?? 86400
  const agg = p.aggregation ?? 'avg'
  const series = []
  for (const key of keys) {
    for (const id of ids) {
      const i = specs.findIndex((_, n) => uuidOf(n) === id)
      if (i < 0) continue
      const points = []
      const last = lastSeen(i)
      const firstBucket = Math.floor(start / 1000 / interval) * interval
      for (let b = firstBucket; b * 1000 < end; b += interval) {
        const values: number[] = []
        const step = Math.max(SAMPLE_SECONDS, interval / 240)
        for (let t = b; t < b + interval; t += step) {
          const ms = t * 1000
          if (ms < start || ms > end || ms > last) continue
          values.push(value(i, key, ms))
        }
        if (!values.length) continue
        let v: number
        if (agg === 'max') v = Math.max(...values)
        else if (agg === 'min') v = Math.min(...values)
        else if (agg === 'last') v = values[values.length - 1]
        else v = values.reduce((a, c) => a + c, 0) / values.length
        // Raw agents report about every 3 s; scale the count like the real server.
        const count = Math.round((values.length * step) / 3)
        points.push({ time: new Date(b * 1000).toISOString(), value: v, count })
      }
      series.push({
        metric_key: key,
        entity_id: id,
        type: 'gauge',
        retention_days: 31,
        downsampled: true,
        downsample_algorithm: agg,
        max_points: maxPoints,
        interval_seconds: interval,
        count: points.length,
        points,
      })
    }
  }
  return {
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    server_downsample_default: true,
    default_points: 500,
    series,
    count: series.length,
  }
}

export function metricDefinitions() {
  const defs: [string, string, string][] = [
    ['cpu.usage', 'gauge', '%'],
    ['memory.used', 'gauge', 'bytes'],
    ['disk.used', 'gauge', 'bytes'],
    ['net.in.rate', 'gauge', 'bytes/s'],
    ['net.out.rate', 'gauge', 'bytes/s'],
    ['traffic.up', 'gauge', 'bytes'],
    ['traffic.down', 'gauge', 'bytes'],
    ['load.average', 'gauge', ''],
  ]
  return defs.map(([name, type, unit]) => ({ name, type, unit, retention_days: 31 }))
}

export const publicSettings = {
  sitename: 'Komari Monitor',
  description: 'A simple server monitor tool.',
  theme: 'AtlasStock',
  theme_settings: {},
  private_site: false,
  custom_head: '',
  custom_body: '',
}
