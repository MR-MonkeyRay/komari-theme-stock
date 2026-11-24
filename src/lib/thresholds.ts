// Alert thresholds in percent, shared so cell colors, the summary, the news ticker and the
// detail panels agree on what counts as high.

/** Usage cells and meters: amber from `warn`, red from `danger`. */
export const LEVEL = { warn: 70, danger: 85 } as const

/** A node is "high load" (高负载) when CPU or memory reaches these. Disk filling up is not load. */
export const HOT = { cpu: 80, ram: 90 } as const

/** The ticker reports every value that turned red and every high-load metric. */
export const ALERT = {
  cpu: Math.min(HOT.cpu, LEVEL.danger),
  ram: Math.min(HOT.ram, LEVEL.danger),
  disk: LEVEL.danger,
} as const

/** Traffic quota bar. */
export const QUOTA = { warn: 75, danger: 90 } as const

/** Inferred detail events: CPU rises at `rise` for 3 buckets, recovers below `fall` for 2. */
export const CPU_EVENT = { rise: HOT.cpu, fall: HOT.cpu - 5 } as const
