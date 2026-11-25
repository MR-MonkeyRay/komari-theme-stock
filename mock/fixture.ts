// Dev-only offline fixture shaped like the Komari 1.6.2 public API.
// The node profiles follow a real deployment (hardware, systems, usage levels, traffic, latency),
// with names, groups, tags, remarks and prices changed. The time series are synthetic.

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const SAMPLE_SECONDS = 30
const START = Date.now()
const DAY = 86400_000
/** An expiry `n` days after the fixture started. */
const inDays = (n: number) => new Date(START + n * DAY).toISOString()
/** Komari's "no expiry". */
const NEVER = '0001-01-01T00:00:00Z'

interface Spec {
  name: string
  flag: string
  /** Typical CPU usage (%) and how far it wanders. */
  cpu: number
  cpuSd: number
  /** Height of the occasional CPU burst (%); six times the wander by default. */
  spike?: number
  /** Typical memory use (%) and how far it wanders, as a share of the total. */
  ram: number
  ramSd: number
  disk: number
  /** Typical upload / download rate, MiB/s. */
  up: number
  down: number
  /** System uptime (s) when the fixture started. */
  uptime: number
  tags: string
  ramGiB: number
  diskGiB: number
  cores: number
  phys: number
  cpuName: string
  arch: string
  virt: string
  os: string
  kernel: string
  /** Load average over 1, 5 and 15 minutes; the 1-minute value is the typical level. */
  load: [number, number, number]
  /** Swap size and typical use, GiB; no swap by default. */
  swap?: [number, number]
  proc: number
  /** TCP and UDP connections. */
  conn: [number, number]
  /** The agent's traffic counters since boot, up / down in GiB. */
  counters: [number, number]
  /** Traffic quota in GiB and how Komari counts it (sum, max, up, down); none by default. */
  quota?: [number, string]
  /** Price, currency, cycle (days, -1 one-off), expiry, auto renewal; price -1 is free. */
  bill?: [number, string, number, string, boolean]
  group?: string
  remark?: string
  /** Hidden in Komari's admin: only logged-in sessions get the node, its status and its metrics. */
  hidden?: boolean
  /** Minutes since the node last reported; online when absent. */
  offline?: number
  /** Typical latency (ms) to the three carrier ping targets; no entry = the node is in no ping task. */
  ping?: [number, number, number]
  /** How much the latency wanders (1 is about 8% of it), and the loss on the mobile route (0–1). */
  jitter?: number
  loss?: number
  /** Days since the node was added to Komari; by default 40 + 9 per place in the list. */
  added?: number
  /** Stretches without reports, as [hours before the fixture started, minutes]: the agent was down. */
  outages?: [number, number][]
}

// Asia, North America, Europe, Oceania. Groups give a node's role, tags its kind. HKG-05 is hidden
// and its plan runs out in 3 days (inside the 7-day expiry notice), for the admin-only views; HKG-04
// went quiet a few hours ago; LAX-05's disk is nearly full; WAW-01 and SYD-01 run above their core
// count; TPE-01 was added 12 days ago.
const specs: Spec[] = [
  { name: 'HKG-01', flag: '🇭🇰', cpu: 0.43, cpuSd: 0.05, ram: 26.1, ramSd: 0.002, disk: 11.3, up: 0.0009, down: 0.0002, uptime: 1565608, tags: 'VPS', ramGiB: 0.7, diskGiB: 20, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.115+deb13.1-cloud-amd64', load: [0, 0, 0], swap: [0.5, 0.01], proc: 85, conn: [7, 0], counters: [0.2, 0.1], quota: [1024, 'up'], bill: [2.5, '$', 30, inDays(9), true], group: '主力', ping: [46, 62, 56], jitter: 1.1, outages: [[70, 12], [214, 50]] },
  { name: 'HKG-02', flag: '🇭🇰', cpu: 3.17, cpuSd: 0.98, ram: 19.9, ramSd: 0.002, disk: 32.2, up: 0.0008, down: 0.0004, uptime: 1368356, tags: 'VPS', ramGiB: 1, diskGiB: 10, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) Gold 6138 CPU @ 2.00GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 11 (bullseye)', kernel: '5.10.0-36-cloud-amd64', load: [0, 0, 0], proc: 75, conn: [21, 7], counters: [0.2, 0.1], quota: [1024, 'sum'], bill: [72, '¥', 365, inDays(130), true], group: '主力', ping: [156, 209, 190], jitter: 0.7, loss: 0.08 },
  { name: 'HKG-03', flag: '🇭🇰', cpu: 1.06, cpuSd: 0.05, ram: 14.6, ramSd: 0.002, disk: 13.8, up: 0.0057, down: 0.0086, uptime: 273187, tags: 'VPS;Alpine', ramGiB: 0.5, diskGiB: 5, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz', arch: 'amd64', virt: 'kvm', os: 'Alpine Linux v3.21', kernel: '6.12.118-0-virt', load: [0, 0, 0], proc: 70, conn: [8, 0], counters: [1.3, 2], bill: [10, '$', 365, inDays(29), true], group: '备用', ping: [76, 102, 93], jitter: 2.5, loss: 0.15 },
  { name: 'HKG-04', flag: '🇭🇰', cpu: 0.9, cpuSd: 0.3, ram: 31.0, ramSd: 0.01, disk: 24.0, up: 0.004, down: 0.006, uptime: 3974400, tags: 'VPS', ramGiB: 2.0, diskGiB: 40, cores: 2, phys: 2, cpuName: 'AMD EPYC-Genoa Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-28-amd64', load: [0.02, 0.03, 0.01], proc: 88, conn: [40, 6], counters: [6.2, 7.9], quota: [2048, 'sum'], bill: [99, '$', 365, inDays(210), true], group: '备用', offline: 300, ping: [43, 57, 52], jitter: 2.2 },
  { name: 'HKG-05', flag: '🇭🇰', cpu: 0.53, cpuSd: 0.28, ram: 36.1, ramSd: 0.011, disk: 68.3, up: 0.0151, down: 0.0131, uptime: 3324094, tags: 'VPS;内部<plum>', ramGiB: 0.7, diskGiB: 5, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-40-cloud-amd64', load: [0, 0, 0], proc: 76, conn: [36, 13], counters: [3, 2.6], quota: [1024, 'up'], bill: [3.5, '$', 30, inDays(3), false], group: '测试', remark: '内部测试节点', hidden: true, ping: [48, 64, 58], jitter: 1.4 },
  { name: 'NRT-01', flag: '🇯🇵', cpu: 1.21, cpuSd: 0.71, ram: 27.2, ramSd: 0.024, disk: 41.6, up: 0.0379, down: 0.0392, uptime: 3410021, tags: 'VPS', ramGiB: 1, diskGiB: 6, cores: 1, phys: 1, cpuName: 'AMD EPYC 7D12 32-Core Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-53-cloud-amd64', load: [0, 0, 0], proc: 76, conn: [74, 10], counters: [3.4, 3.6], bill: [10.5, '$', 365, inDays(370), true], group: '备用', ping: [158, 185, 176], jitter: 2.5, outages: [[44, 4]] },
  { name: 'NRT-02', flag: '🇯🇵', cpu: 1.27, cpuSd: 0.09, ram: 8.9, ramSd: 0.002, disk: 13.3, up: 0.0446, down: 0.6469, uptime: 2529553, tags: '存储<teal>', ramGiB: 6.7, diskGiB: 4114, cores: 4, phys: 4, cpuName: 'Intel Xeon Processor (Cascadelake)', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.113+deb13-amd64', load: [0.13, 0.09, 0.02], proc: 160, conn: [216, 0], counters: [0.3, 4], quota: [4096, 'sum'], bill: [150, '$', 1095, inDays(1050), true], group: '备份', remark: '4 TB 存储机', ping: [54, 62, 60], jitter: 1.3 },
  { name: 'SIN-01', flag: '🇸🇬', cpu: 0.35, cpuSd: 0.61, ram: 29.1, ramSd: 0.005, disk: 3.8, up: 0.0045, down: 0.0032, uptime: 1729227, tags: '免费<green>', ramGiB: 0.9, diskGiB: 49, cores: 2, phys: 1, cpuName: 'AMD EPYC 7J13 64-Core Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.107+deb13-cloud-amd64', load: [0, 0, 0], proc: 101, conn: [13, 5], counters: [1.2, 0.8], quota: [5120, 'sum'], bill: [-1, '', -1, NEVER, false], group: '备用', ping: [136, 113, 118], jitter: 2.5 },
  { name: 'SIN-02', flag: '🇸🇬', cpu: 0.13, cpuSd: 0.35, ram: 36.7, ramSd: 0.002, disk: 1.9, up: 0.0687, down: 0.2284, uptime: 1666317, tags: 'ARM64;免费<green>', ramGiB: 23.4, diskGiB: 147, cores: 4, phys: 4, cpuName: 'Neoverse-N1', arch: 'arm64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.107+deb13-arm64', load: [0, 0, 0], proc: 156, conn: [19, 5], counters: [19.1, 61.8], quota: [5120, 'sum'], bill: [-1, '', -1, NEVER, false], group: '备用', remark: 'ARM 4C24G / 150G', ping: [103, 85, 90], jitter: 2.5 },
  { name: 'TPE-01', flag: '🇹🇼', cpu: 5.4, cpuSd: 2.77, ram: 42.7, ramSd: 0.023, disk: 36.4, up: 0.0033, down: 0.0029, uptime: 1370463, tags: 'VPS', ramGiB: 0.5, diskGiB: 10, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) CPU E5-2690 v3 @ 2.60GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-25-cloud-amd64', load: [0, 0, 0], swap: [0.5, 0], proc: 84, conn: [31, 16], counters: [1.6, 1.4], quota: [1024, 'sum'], bill: [79, '¥', 365, inDays(58), true], group: '备用', ping: [64, 70, 58], jitter: 0.1, loss: 0.2, added: 12 },
  { name: 'HGH-01', flag: '🇨🇳', cpu: 2.48, cpuSd: 0.06, ram: 20.5, ramSd: 0.002, disk: 2.6, up: 0.002, down: 0.0018, uptime: 62729534, tags: 'VPS', ramGiB: 3.8, diskGiB: 1053, cores: 2, phys: 2, cpuName: 'Intel(R) Xeon(R) Platinum 8272CL CPU @ 2.60GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-10-amd64', load: [0.15, 0.09, 0.02], proc: 130, conn: [86, 24], counters: [0.6, 0.5], quota: [1024, 'sum'], group: '备份', ping: [10, 14, 11], jitter: 1.3 },
  { name: 'SHA-01', flag: '🇨🇳', cpu: 0.38, cpuSd: 0.05, ram: 49.6, ramSd: 0.002, disk: 46, up: 0.0637, down: 0.0672, uptime: 60045746, tags: '独服<violet>;IPv6', ramGiB: 125.5, diskGiB: 872, cores: 96, phys: 48, cpuName: 'Intel(R) Xeon(R) Platinum 8259CL CPU @ 2.50GHz', arch: 'amd64', virt: 'none', os: 'Debian GNU/Linux 11 (bullseye)', kernel: '6.1.0-0.deb11.21-amd64', load: [0.35, 0.34, 0.35], swap: [7.63, 6.82], proc: 915, conn: [184, 98], counters: [15.3, 16.2], quota: [2048, 'sum'], bill: [420, '¥', 30, inDays(24), true], group: '主力', remark: '双路 24C/48T · 128 GB · 1 TB NVMe', ping: [13, 19, 15], jitter: 2.1 },
  { name: 'SJC-01', flag: '🇺🇸', cpu: 1.79, cpuSd: 0.14, ram: 61.1, ramSd: 0.011, disk: 25.3, up: 0.0095, down: 0.0095, uptime: 288365, tags: 'VPS', ramGiB: 1.9, diskGiB: 49, cores: 2, phys: 2, cpuName: 'AMD EPYC 7K62 48-Core Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.117+deb13-amd64', load: [0, 0.03, 0.01], swap: [2, 0.06], proc: 119, conn: [138, 14], counters: [3.4, 4], quota: [1024, 'up'], bill: [108, '¥', 365, inDays(105), true], group: '主力', ping: [158, 190, 179], jitter: 1.1 },
  { name: 'LAX-01', flag: '🇺🇸', cpu: 11.19, cpuSd: 6.9, ram: 44.6, ramSd: 0.096, disk: 46.9, up: 0.9562, down: 1.6693, uptime: 53445358, tags: '独服<violet>;IPv6', ramGiB: 31.3, diskGiB: 929, cores: 8, phys: 4, cpuName: 'Intel(R) Xeon(R) CPU E3-1240 v3 @ 3.40GHz', arch: 'amd64', virt: 'none', os: 'Ubuntu 24.04.4 LTS', kernel: '6.8.0-55-generic', load: [2.44, 3.07, 2.54], swap: [8, 0.6], proc: 487, conn: [1064, 86], counters: [154.2, 248.2], quota: [307200, 'sum'], bill: [139, '$', 365, inDays(366), true], group: '主力', remark: 'E3-1240 v3 · 32 GB · 1 TB', ping: [153, 184, 174], jitter: 0.6, loss: 0.03, outages: [[52, 18]] },
  { name: 'PHX-01', flag: '🇺🇸', cpu: 2.52, cpuSd: 0.67, ram: 11.7, ramSd: 0.002, disk: 7.7, up: 0.6058, down: 0.6028, uptime: 2854132, tags: 'ARM64;免费<green>', ramGiB: 23.4, diskGiB: 196, cores: 4, phys: 4, cpuName: 'Neoverse-N1', arch: 'arm64', virt: 'kvm', os: 'Debian GNU/Linux 13 (trixie)', kernel: '6.12.113+deb13-arm64', load: [0.05, 0.06, 0.02], proc: 181, conn: [623, 52], counters: [146.1, 144.7], quota: [10240, 'sum'], bill: [-1, '', -1, NEVER, false], group: '备用', remark: 'ARM 4C24G / 200G', ping: [170, 205, 193], jitter: 0.9 },
  { name: 'LAX-02', flag: '🇺🇸', cpu: 1.8, cpuSd: 0.85, ram: 32.4, ramSd: 0.029, disk: 31.3, up: 0.103, down: 0.099, uptime: 46084268, tags: 'VPS', ramGiB: 1, diskGiB: 20, cores: 1, phys: 1, cpuName: 'Intel Xeon Processor (SierraForest)', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-26-amd64', load: [0, 0, 0], swap: [0.51, 0], proc: 89, conn: [150, 12], counters: [29.8, 29.4], quota: [2048, 'sum'], bill: [54, '$', 365, inDays(343), true], group: '主力', ping: [114, 137, 129], jitter: 0.1 },
  { name: 'LAX-03', flag: '🇺🇸', cpu: 1.23, cpuSd: 0.61, ram: 28.8, ramSd: 0.003, disk: 21.5, up: 0.0255, down: 0.0269, uptime: 3407710, tags: 'VPS', ramGiB: 1, diskGiB: 20, cores: 1, phys: 1, cpuName: 'AMD EPYC 7402 24-Core Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 11 (bullseye)', kernel: '5.10.0-46-cloud-amd64', load: [0, 0, 0], proc: 78, conn: [124, 7], counters: [9.5, 9.9], quota: [4096, 'sum'], bill: [18, '$', 365, inDays(347), true], group: '备用', ping: [157, 189, 178], jitter: 0.9 },
  { name: 'LAX-04', flag: '🇺🇸', cpu: 3.23, cpuSd: 1.25, ram: 22, ramSd: 0.008, disk: 43.1, up: 0.8517, down: 1.1731, uptime: 3426764, tags: 'VPS', ramGiB: 1.8, diskGiB: 21, cores: 2, phys: 2, cpuName: 'Intel(R) Xeon(R) CPU E5-2697 v2 @ 2.70GHz', arch: 'amd64', virt: 'kvm', os: 'CentOS Linux 7 (Core)', kernel: '3.10.0-1160.119.1.el7.x86_64', load: [0.13, 0.1, 0.07], swap: [1, 0], proc: 103, conn: [244, 47], counters: [254.6, 361], quota: [12288, 'sum'], bill: [11.99, '$', 365, inDays(364), true], group: '主力', ping: [155, 187, 176], jitter: 0.6, outages: [[500, 100]] },
  { name: 'LAX-05', flag: '🇺🇸', cpu: 7.96, cpuSd: 20.69, spike: 95, ram: 40.8, ramSd: 0.017, disk: 88.4, up: 0.007, down: 0.009, uptime: 3423754, tags: 'VPS', ramGiB: 0.2, diskGiB: 5, cores: 1, phys: 1, cpuName: 'Intel(R) Xeon(R) CPU E5-2696 v4 @ 2.20GHz', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 11 (bullseye)', kernel: '5.10.0-33-cloud-amd64', load: [0.14, 0.29, 0.18], swap: [0.5, 0.02], proc: 70, conn: [44, 10], counters: [2.8, 4.7], bill: [9.99, '$', 365, inDays(29), false], group: '备用', ping: [153, 184, 174], jitter: 1.6 },
  { name: 'LAX-06', flag: '🇺🇸', cpu: 0.76, cpuSd: 0.43, ram: 31.1, ramSd: 0.047, disk: 20.8, up: 0.0537, down: 0.0734, uptime: 4183042, tags: 'VPS;IPv6', ramGiB: 2, diskGiB: 40, cores: 2, phys: 2, cpuName: 'AMD EPYC-Genoa Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-48-amd64', load: [0.18, 0.08, 0.02], proc: 92, conn: [553, 17], counters: [7.8, 10.8], quota: [2048, 'sum'], bill: [46, '$', 365, inDays(224), true], group: '备用', ping: [114, 137, 129], jitter: 0.1 },
  { name: 'FRA-01', flag: '🇩🇪', cpu: 2.71, cpuSd: 1.52, ram: 24.3, ramSd: 0.003, disk: 30, up: 0.0027, down: 0.0121, uptime: 1858843, tags: 'Docker', ramGiB: 11.7, diskGiB: 118, cores: 4, phys: 4, cpuName: 'AMD EPYC 9575F 64-Core Processor', arch: 'amd64', virt: 'docker', os: 'Alpine Linux v3.21', kernel: '6.12.115+deb13.1-cloud-amd64', load: [0.05, 0.06, 0.07], proc: 1, conn: [102, 2], counters: [1.7, 4], quota: [10240, 'sum'], bill: [5.5, '€', 30, inDays(320), true], group: '主力', ping: [228, 205, 211], jitter: 1.3 },
  { name: 'AMS-01', flag: '🇳🇱', cpu: 0.36, cpuSd: 0.12, ram: 24.3, ramSd: 0.005, disk: 26.3, up: 0.0288, down: 0.0293, uptime: 46009964, tags: 'VPS', ramGiB: 1.1, diskGiB: 20, cores: 1, phys: 1, cpuName: 'AMD EPYC-Genoa Processor', arch: 'amd64', virt: 'kvm', os: 'Debian GNU/Linux 12 (bookworm)', kernel: '6.1.0-9-amd64', load: [0, 0, 0], swap: [0.56, 0], proc: 83, conn: [16, 4], counters: [2.9, 2.9], quota: [1024, 'sum'], bill: [39.9, '$', 365, inDays(196), true], group: '备份', ping: [168, 159, 153], jitter: 0.2, outages: [[30, 8]] },
  { name: 'WAW-01', flag: '🇵🇱', cpu: 13.59, cpuSd: 5.05, ram: 35.5, ramSd: 0.003, disk: 15.9, up: 1.6512, down: 0.5842, uptime: 586688, tags: 'FreeBSD;免费<green>', ramGiB: 190.6, diskGiB: 4380, cores: 5, phys: 5, cpuName: 'Unknown', arch: 'amd64', virt: 'none', os: 'FreeBSD 14.3-RELEASE-p19', kernel: '14.3-RELEASE-p19', load: [5.35, 4.92, 5.31], swap: [5, 0], proc: 7, conn: [0, 0], counters: [586, 302.5], bill: [-1, '', -1, NEVER, false], group: '备用', ping: [277, 306, 292], jitter: 0.3, loss: 0.12, outages: [[20, 95], [160, 25], [400, 15]] },
  { name: 'SYD-01', flag: '🇦🇺', cpu: 100, cpuSd: 0.05, ram: 1.5, ramSd: 0.002, disk: 20.1, up: 0.0001, down: 0.0024, uptime: 7293264, tags: 'LXC;IPv6 Only<amber>', ramGiB: 0.2, diskGiB: 1, cores: 1, phys: 2, cpuName: 'Intel(R) Xeon(R) Gold 5218 CPU @ 2.30GHz', arch: 'amd64', virt: 'lxc', os: 'Alpine Linux v3.19', kernel: '5.15.158-2-pve', load: [6.68, 6.2, 5.9], swap: [0.12, 0.01], proc: 10, conn: [8, 0], counters: [5.3, 42.5], bill: [32, '¥', 365, inDays(38), true], group: '测试', remark: 'IPv6 Only', ping: [211, 256, 229], jitter: 0.7, outages: [[300, 1440]] },
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
  return s.offline ? START - s.offline * 60_000 : Date.now() - (i % 3) * 1000
}

/** Whether node i reported at `ms`: added by then, not yet gone quiet, and not in an outage. */
function reporting(i: number, ms: number) {
  if (ms < addedAt(i) || ms > lastSeen(i)) return false
  return !(specs[i].outages ?? []).some(([hours, minutes]) => {
    const from = START - hours * 3600_000
    return ms >= from && ms < from + minutes * 60_000
  })
}

type MetricKey = 'cpu.usage' | 'memory.used' | 'disk.used' | 'net.in.rate' | 'net.out.rate' | 'traffic.up' | 'traffic.down' | 'load.average' | 'swap.used' | 'connections.tcp' | 'connections.udp'

/** Node i's occasional CPU burst (%) at minute `m`. */
function burst(i: number, m: number) {
  const s = specs[i]
  return Math.max(0, smoothNoise(i + 40, m / 37)) ** 3 * (s.spike ?? s.cpuSd * 6)
}

function value(i: number, key: MetricKey, ms: number): number {
  const s = specs[i]
  const m = ms / 60000 // minutes
  const w = (period: number, ph = 0) => Math.sin((m / period) * Math.PI * 2 + i * 1.7 + ph)
  // Traffic mostly idles near its level and now and then bursts well above it; about 1 on average.
  const flow = (seed: number, ph: number) => Math.max(0, 0.7 * (1 + 0.32 * w(150, ph) + 0.25 * smoothNoise(i + seed, m / 4) + 0.12 * smoothNoise(i + seed + 2, m * 2)) + 3 * Math.max(0, smoothNoise(i + seed + 4, m / 11)) ** 4)
  switch (key) {
    case 'cpu.usage': {
      // Each node wanders by its own measured spread: an idle VPS by tenths of a percent.
      const v = s.cpu + s.cpuSd * (0.9 * w(240) + 0.6 * w(73, 1) + 0.8 * smoothNoise(i, m / 6) + 0.45 * smoothNoise(i + 9, m * 1.3)) + burst(i, m)
      return Math.min(100, Math.max(0.05, v))
    }
    case 'memory.used': {
      // Memory wanders slowly and without a fixed rhythm, as services grow, get restarted and settle.
      const ratio = s.ram / 100 + s.ramSd * (1.1 * smoothNoise(i + 3, m / 160) + 0.55 * smoothNoise(i + 4, m / 35) + 0.2 * smoothNoise(i + 5, m / 3))
      return Math.max(0.01, Math.min(0.98, ratio)) * s.ramGiB * GIB
    }
    case 'disk.used': {
      // Disks barely move: logs pile up through the day and are rotated at midnight, with a slow
      // drift of a few tenths of a percent over the days.
      const ratio = (s.disk / 100) * (1 + 0.004 * smoothNoise(i + 11, m / 2880)) + 0.0015 * ((m / 1440 + i / 7) % 1) + 0.0002 * smoothNoise(i + 17, m / 5)
      return Math.max(0.02, Math.min(0.99, ratio)) * s.diskGiB * GIB
    }
    case 'net.out.rate':
    case 'traffic.up': {
      const rate = s.up * flow(21, 3) * MIB
      return key === 'traffic.up' ? rate * 3 : rate
    }
    case 'net.in.rate':
    case 'traffic.down': {
      const rate = s.down * flow(31, 4) * MIB
      return key === 'traffic.down' ? rate * 3 : rate
    }
    case 'load.average':
      // CPU bursts queue tasks, so the load follows them across the cores.
      return Math.max(0, s.load[0] * (1 + 0.3 * smoothNoise(i + 51, m / 3) + 0.2 * w(240, 2)) + (burst(i, m) / 100) * s.cores)
    case 'swap.used': {
      // Swap drifts slowly, as pages go out under memory pressure and come back over hours; a
      // nearly full swap barely moves.
      if (!s.swap) return 0
      const [size, used] = s.swap
      const drift = used / size > 0.5 ? 0.04 : 0.35
      return Math.max(0, Math.min(0.97 * size, used * (1 + drift * w(420, 5) + 0.12 * smoothNoise(i + 81, m / 25)))) * GIB
    }
    case 'connections.tcp':
      // Follows the traffic loosely, with the odd burst of short-lived connections.
      return Math.round(s.conn[0] * (1 + 0.25 * w(150, 3) + 0.2 * smoothNoise(i + 61, m / 6) + 4 * Math.max(0, smoothNoise(i + 67, m / 29)) ** 4))
    case 'connections.udp':
      return Math.round(s.conn[1] * (1 + 0.3 * smoothNoise(i + 71, m / 10)))
  }
}

/** Whether the caller may see node `i`: hidden nodes only reach logged-in sessions, as in Komari. */
const visible = (i: number, admin: boolean) => admin || !specs[i].hidden

export function nodesInformation(admin = false) {
  return specs.flatMap((s, i) => (visible(i, admin) ? [node(s, i)] : []))
}

/** When node i was added to Komari: its metrics start there. */
const addedAt = (i: number) => START - (specs[i].added ?? 40 + 9 * i) * 86400_000

function node(s: Spec, i: number) {
  return {
    uuid: uuidOf(i),
    name: s.name,
    cpu_name: s.cpuName,
    virtualization: s.virt,
    arch: s.arch,
    cpu_cores: s.cores,
    cpu_physical_cores: s.phys,
    os: s.os,
    kernel_version: s.kernel,
    gpu_name: '',
    region: s.flag,
    public_remark: s.remark ?? '',
    mem_total: s.ramGiB * GIB,
    swap_total: (s.swap?.[0] ?? 0) * GIB,
    disk_total: s.diskGiB * GIB,
    weight: i,
    price: s.bill?.[0] ?? 0,
    billing_cycle: s.bill?.[2] ?? 0,
    auto_renewal: s.bill?.[4] ?? false,
    currency: s.bill?.[1] ?? '',
    expired_at: s.bill?.[3] ?? NEVER,
    group: s.group ?? '',
    tags: s.tags,
    hidden: !!s.hidden,
    traffic_limit: (s.quota?.[0] ?? 0) * GIB,
    traffic_limit_type: s.quota?.[1] ?? 'max',
    // Komari 1.6 includes when the node was added; the all-time traffic counts from there.
    created_at: new Date(addedAt(i)).toISOString(),
  }
}

/**
 * `admin:listClients`: the public fields plus what only an admin gets. The token is a dummy so a
 * test can check the theme never renders it; addresses come from the documentation ranges.
 */
export function listClients() {
  const stamp = new Date(START - 40 * 86400_000).toISOString()
  return specs.map((s, i) => ({
    ...node(s, i),
    ipv4: `203.0.113.${10 + i}`,
    ipv6: i % 3 === 2 ? '' : `2001:db8:${(i + 1).toString(16)}::1`,
    version: i % 5 === 3 ? '1.6.18' : '1.6.20',
    token: 'mock-agent-token-never-render',
    updated_at: stamp,
  }))
}

/** `admin:listOfflineNotifications`: every third node has the notice off; a node gone quiet was
 * notified once its grace period ran out. */
export function offlineNotifications() {
  return specs.map((s, i) => {
    const grace = i % 2 ? 300 : 180
    const enable = i % 3 !== 2
    return {
      client: uuidOf(i),
      enable,
      grace_period: grace,
      last_notified: enable && s.offline ? new Date(lastSeen(i) + grace * 1000).toISOString() : null,
    }
  })
}

/** The part of `admin:getSettings` the theme reads. */
export const adminSettings = {
  expire_notification_enabled: true,
  expire_notification_lead_days: 7,
}

export function latestStatus(admin = false) {
  const out: Record<string, unknown> = {}
  const now = Date.now()
  specs.forEach((s, i) => {
    if (!visible(i, admin)) return
    const online = !s.offline
    const t = online ? now - (1 + (i % 4)) * 1000 : lastSeen(i)
    const tick = Math.floor(now / 2000)
    const jitter = online ? hash(i * 97 + tick) : 0
    out[uuidOf(i)] = {
      client: uuidOf(i),
      time: new Date(t).toISOString(),
      cpu: Math.max(0.05, Math.min(100, value(i, 'cpu.usage', t) + 0.5 * s.cpuSd * jitter)),
      gpu: 0,
      ram: value(i, 'memory.used', t),
      ram_total: s.ramGiB * GIB,
      swap: value(i, 'swap.used', t),
      swap_total: (s.swap?.[0] ?? 0) * GIB,
      load: +value(i, 'load.average', t).toFixed(2),
      load5: s.load[1],
      load15: s.load[2],
      temp: 0,
      disk: value(i, 'disk.used', t),
      disk_total: s.diskGiB * GIB,
      net_in: value(i, 'net.in.rate', t) * (1 + 0.1 * jitter),
      net_out: value(i, 'net.out.rate', t) * (1 - 0.1 * jitter),
      net_total_up: s.counters[0] * GIB,
      net_total_down: s.counters[1] * GIB,
      process: s.proc,
      connections: value(i, 'connections.tcp', t),
      connections_udp: value(i, 'connections.udp', t),
      online,
      uptime: online ? s.uptime + Math.floor((now - START) / 1000) : 0,
      ping: {},
    }
  })
  return out
}

// --- Ping -------------------------------------------------------------------------------------
// Three carrier tasks probing by ICMP every 120 s, as in the deployment the profiles follow, which
// keeps ping records for 24 hours. A lost probe is recorded as latency -1.

const PING_TASKS = [
  { id: 1, name: '电信', weight: 1 },
  { id: 2, name: '联通', weight: 2 },
  { id: 3, name: '移动', weight: 3 },
]
const PING_INTERVAL = 120
const PING_RETENTION_DAYS = 1

export function pingTasks(admin = false) {
  const clients = specs.flatMap((s, i) => (s.ping && visible(i, admin) ? [uuidOf(i)] : []))
  return PING_TASKS.map((t) => ({ ...t, clients, default_on: true, type: 'icmp', interval: PING_INTERVAL }))
}

/** One probe: latency in ms, or null when it was lost. */
function probe(i: number, task: number, sec: number): number | null {
  const s = specs[i]
  const base = s.ping![task]
  const j = s.jitter ?? 1
  const m = sec / 60
  const seed = i * 31 + task * 7
  // The mobile route loses the most (ICMP is often rate-limited on it); every node gets an
  // occasional bad stretch.
  const lossRate = (task === 2 ? (s.loss ?? 0.035) : 0.006) + Math.max(0, smoothNoise(seed + 300, m / 45)) ** 4 * 0.6
  if ((hash(seed * 7919 + sec / PING_INTERVAL) + 1) / 2 < lossRate) return null
  const congestion = Math.max(0, smoothNoise(seed + 200, m / 90)) ** 2 * 0.5
  const v = base * (1 + j * (0.04 * smoothNoise(seed, m / 5) + congestion)) + Math.abs(hash(seed * 131 + sec)) * base * 0.06 * j
  return Math.round(v * 10) / 10
}

interface PingRecord {
  t: number
  latency: number
  loss: number
}

/** The records of one node and task in [start, end] (ms), one per probe, as Komari stores them. */
function pingRecords(i: number, task: number, start: number, end: number): PingRecord[] {
  const out: PingRecord[] = []
  const floor = Math.max(start, Date.now() - PING_RETENTION_DAYS * 86400_000)
  const step = PING_INTERVAL * 1000
  for (let t = Math.ceil(floor / step) * step; t <= Math.min(end, lastSeen(i)); t += step) {
    if (!reporting(i, t)) continue
    const v = probe(i, task, t / 1000)
    out.push({ t, latency: v ?? -1, loss: v === null ? 1 : 0 })
  }
  return out
}

function pingSeries(i: number, key: string, start: number, end: number, interval: number, agg: string) {
  return PING_TASKS.map((task, k) => {
    const byBucket = new Map<number, PingRecord[]>()
    for (const r of pingRecords(i, k, start, end)) {
      const b = Math.floor(r.t / 1000 / interval) * interval
      byBucket.set(b, [...(byBucket.get(b) ?? []), r])
    }
    const points = [...byBucket].map(([b, recs]) => {
      // Lost probes stay out of the latency aggregate; a bucket with nothing but losses is -1.
      const vals = key === 'ping.loss' ? recs.map((r) => r.loss) : recs.filter((r) => r.latency >= 0).map((r) => r.latency)
      let v = -1
      if (vals.length) {
        if (agg === 'max') v = Math.max(...vals)
        else if (agg === 'min') v = Math.min(...vals)
        else if (agg === 'last') v = vals[vals.length - 1]
        else v = vals.reduce((a, c) => a + c, 0) / vals.length
      }
      return { time: new Date(b * 1000).toISOString(), value: v, count: recs.length, tags: { task_id: String(task.id) } }
    })
    return { tags: { task_id: String(task.id) }, unit: key === 'ping.loss' ? 'ratio' : 'ms', points }
  })
}

/** `public:getPingMetricStats`, including Komari's quirk: p50 is the mean and p99 is mean + σ. */
export function pingStats(p: { uuid?: string; hours?: number }, admin = false) {
  const end = Date.now()
  const start = end - (p.hours ?? 1) * 3600_000
  const i = specs.findIndex((_, n) => uuidOf(n) === p.uuid)
  const stats =
    i < 0 || !visible(i, admin) || !specs[i].ping
      ? []
      : PING_TASKS.map((task, k) => {
          const all: (number | null)[] = []
          const floor = Math.max(start, end - PING_RETENTION_DAYS * 86400_000)
          for (let s = Math.ceil(floor / 1000 / PING_INTERVAL) * PING_INTERVAL; s * 1000 <= Math.min(end, lastSeen(i)); s += PING_INTERVAL) if (reporting(i, s * 1000)) all.push(probe(i, k, s))
          const ok = all.filter((v): v is number => v !== null)
          const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0
          const sd = ok.length ? Math.sqrt(ok.reduce((a, b) => a + (b - avg) ** 2, 0) / ok.length) : 0
          return {
            entity_id: p.uuid,
            task_id: String(task.id),
            name: task.name,
            type: 'tcp',
            interval: PING_INTERVAL,
            tags: { task_id: String(task.id) },
            total: all.length,
            valid: ok.length,
            loss: all.length ? ((all.length - ok.length) / all.length) * 100 : 0,
            min: ok.length ? Math.min(...ok) : 0,
            max: ok.length ? Math.max(...ok) : 0,
            avg,
            latest: [...all].reverse().find((v) => v !== null) ?? 0,
            p50: avg,
            p99: avg + sd,
            stddev: sd,
            p99_p50_ratio: avg ? sd / avg : 0,
          }
        })
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), interval_seconds: 60, stats }
}

const NICE = [60, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]
/** Komari keeps hourly rollups for 600 hours by default; a query that starts before that gets daily
 * buckets, and nothing older is left. Traffic is spared here so the board's totals stay whole. */
const HOURLY_RETENTION = 600 * 3600_000

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

export function queryMetrics(p: QueryParams, admin = false) {
  const keys = (p.metric_keys ?? (p.metric_key ? [p.metric_key] : [])) as MetricKey[]
  const ids = p.entity_ids ?? (p.entity_id ? [p.entity_id] : [])
  const end = p.end ? Date.parse(p.end) : Date.now()
  const start = p.start ? Date.parse(p.start) : end - (p.hours ?? 4) * 3600_000
  const maxPoints = p.max_points ?? 500
  const span = (end - start) / 1000
  const min = span > 6 * 3600 + 60 ? 300 : 60
  const retainedFrom = Date.now() - HOURLY_RETENTION
  const beyond = start < retainedFrom
  const auto = NICE.find((n) => n >= Math.max(min, span / maxPoints)) ?? 86400
  const agg = p.aggregation ?? 'avg'
  const series = []
  for (const key of keys) {
    for (const id of ids) {
      const i = specs.findIndex((_, n) => uuidOf(n) === id)
      if (i < 0 || !visible(i, admin)) continue
      if (key.startsWith('ping.')) {
        if (!specs[i].ping) continue
        for (const s of pingSeries(i, key, start, end, auto, agg))
          series.push({ metric_key: key, entity_id: id, type: 'gauge', retention_days: PING_RETENTION_DAYS, downsampled: true, downsample_algorithm: agg, max_points: maxPoints, interval_seconds: auto, count: s.points.length, ...s })
        continue
      }
      const points = []
      const trimmed = !key.startsWith('traffic.')
      const interval = trimmed && beyond ? 86400 : auto
      const firstBucket = Math.floor(start / 1000 / interval) * interval
      for (let b = firstBucket; b * 1000 < end; b += interval) {
        const values: number[] = []
        const step = Math.max(SAMPLE_SECONDS, interval / 240)
        for (let t = b; t < b + interval; t += step) {
          const ms = t * 1000
          if (ms < start || ms > end || !reporting(i, ms) || (trimmed && ms < retainedFrom)) continue
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
    ['swap.used', 'gauge', 'bytes'],
    ['connections.tcp', 'gauge', 'count'],
    ['connections.udp', 'gauge', 'count'],
    ['ping.latency_ms', 'gauge', 'ms'],
    ['ping.loss', 'gauge', 'ratio'],
  ]
  return defs.map(([name, type, unit]) => ({ name, type, unit, retention_days: name.startsWith('ping.') ? PING_RETENTION_DAYS : 31 }))
}

export const publicSettings = {
  sitename: 'Komari Monitor',
  description: 'A simple server monitor tool.',
  theme: 'komari-theme-stock',
  theme_settings: {},
  private_site: false,
  custom_head: '',
  custom_body: '',
}
