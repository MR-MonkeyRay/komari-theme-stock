import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { Time } from 'lightweight-charts'
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { usePingHistory, usePingStats, usePingTasks } from '../../lib/api'
import { finite, monthDayTime } from '../../lib/format'
import { buildPingLines, lossText, ms, PING_SLOTS, type PingLineData, type PingPoint } from '../../lib/ping'
import type { Range } from '../../lib/settings'
import type { PingTask, PingTaskStats } from '../../lib/types'
import { crosshairLabel } from './chartBase'
import { bucketAt, useChartSync } from './chartSync'

const PingChart = lazy(() => import('./PingChart'))

/** The carrier picked in the drawer: matched by id, then by name on a node with other tasks. */
export interface PingPick {
  id: string
  name: string
}

// Chips that fit the panel head beside the title; more tasks fold into a menu.
const MAX_CHIPS = 4

function statsTitle(task: PingTask, s: PingTaskStats | undefined, t: TFunction) {
  const how = t('ping.probe', { type: task.type.toUpperCase(), count: task.interval })
  if (!s || !s.valid) return `${task.name} · ${how}\n${t('ping.noSamples')}`
  return `${task.name} · ${how}\n${t('ping.stats', { latest: ms(s.latest), avg: ms(s.avg), min: ms(s.min), max: ms(s.max), sd: ms(s.stddev), loss: lossText(s.loss) })}`
}

// The legend under the chips reads the same slots whatever it shows (the range, or the bucket under
// the crosshair), and every reading sits in a slot of fixed width: only the figures change, nothing
// moves. See .ping-legend in detail.css for the widths.

/** A latency in ms, or a quiet dash; `lost` marks where every probe was lost (the dash in warning). */
function Ms({ v, lost }: { v: number | null | undefined; lost?: boolean }) {
  return <b className={clsx('lg-v lg-ms', lost ? 'warn' : !finite(v) && 'quiet')}>{finite(v) ? `${ms(v)}ms` : '—'}</b>
}

/** Loss in percent: quiet at 0, highlighted above it. */
function Loss({ pct }: { pct: number | null | undefined }) {
  return <b className={clsx('lg-v lg-loss', finite(pct) && pct > 0 ? 'warn' : 'quiet')}>{finite(pct) ? lossText(pct) : '—'}</b>
}

/** A range's loss: also for a carrier that lost every probe (no valid sample, but probes sent). */
const rangeLoss = (s: PingTaskStats | undefined) => (s && s.total > 0 ? s.loss : null)
const rangeLost = (s: PingTaskStats | undefined) => !!s && s.total > 0 && !s.valid && s.loss > 0

// The widest month/day and time, to size the slot that shows either a label or a time.
const WIDEST_TIME = new Date(2000, 11, 28, 23, 59).getTime() / 1000

/** The legend's first slot: what the readings are (the range) or the bucket's time, at one width. */
function Context({ label, time }: { label: string; time: number | null }) {
  return (
    <span className={clsx('lg-ctx', time !== null && 'is-time')}>
      <span className={clsx(time !== null && 'off')}>{label}</span>
      <span className={clsx(time === null && 'off')}>{crosshairLabel((time ?? WIDEST_TIME) as Time)}</span>
    </span>
  )
}

/** One carrier's readings: the range from the stats, or the bucket `p` while one is read. */
function OneLegend({ s, p, reading }: { s: PingTaskStats | undefined; p: PingPoint | undefined; reading: boolean }) {
  const { t } = useTranslation()
  const ok = !!s?.valid
  const lost = reading ? !!p && p.avg === null && !!p.loss : rangeLost(s)
  const spread = reading ? (p?.min != null && p.max != null ? `${ms(p.min)}–${ms(p.max)}` : null) : ok ? `${ms(s!.min)}–${ms(s!.max)}` : null
  // Jitter is a figure of the whole range; a single bucket has none.
  const sd = !reading && ok ? ms(s!.stddev) : null
  return (
    <>
      <span>
        {t('chart.avg')} <Ms v={reading ? p?.avg : ok ? s!.avg : null} lost={lost} />
      </span>
      <span>
        {t('ping.spread')} <b className={clsx('lg-v lg-spread', spread === null && 'quiet')}>{spread ?? '—'}</b>
      </span>
      <span>
        {t('ping.loss')} <Loss pct={reading ? (p && p.loss !== null ? p.loss * 100 : null) : rangeLoss(s)} />
      </span>
      <span>
        {t('ping.jitter')} <b className={clsx('lg-v lg-sd', sd === null && 'quiet')}>{sd ?? '—'}</b>
      </span>
    </>
  )
}

/** Every carrier: its mean and loss over the range, or in the bucket `at` while one is read (a time
 *  outside the buckets, `at` -1, reads as a gap). */
function AllLegend({ lines, stats, at, reading }: { lines: PingLineData[]; stats: Map<string, PingTaskStats> | undefined; at: number; reading: boolean }) {
  const { t } = useTranslation()
  return (
    <>
      {lines.map((l) => {
        const s = stats?.get(l.id)
        const p = at >= 0 ? l.points[at] : undefined
        return (
          <span key={l.id} className="lg-line">
            <i className="ping-dot" style={{ background: `var(--ping-${l.slot + 1})` }} aria-hidden="true" />
            {l.name} <Ms v={reading ? p?.avg : s?.valid ? s.avg : null} lost={reading ? !!p && p.avg === null && !!p.loss : rangeLost(s)} />
            <span className="lg-sub">{t('ping.lossShort')}</span>
            <Loss pct={reading ? (p && p.loss !== null ? p.loss * 100 : null) : rangeLoss(s)} />
          </span>
        )
      })}
    </>
  )
}

/** A chip's figure in a slot of fixed width, so the chips keep their places as it changes. Left out
 *  of the chip's name, which stays the carrier's while the figure follows the crosshair. */
function ChipValue({ v }: { v: { text: string; lost?: boolean } }) {
  return (
    <b className={clsx('num chip-v', v.lost && 'warn')} aria-hidden="true">
      {v.text}
    </b>
  )
}

export function PingPanel({ uuid, range, refreshSeconds, offline, pick, onPick }: { uuid: string; range: Range; refreshSeconds: number; offline: boolean; pick: PingPick | null; onPick: (p: PingPick | null) => void }) {
  const { t } = useTranslation()
  const { tasks, place } = usePingTasks(uuid)
  const on = tasks.length > 0
  const history = usePingHistory(uuid, range, refreshSeconds, on)
  const stats = usePingStats(uuid, range, refreshSeconds, on)
  const [hover, setHover] = useState<number | null>(null)

  // Colors follow the task's place in Komari's whole list, so 电信 has the same color on every node.
  const slots = useMemo(() => new Map(tasks.map((t) => [String(t.id), (place.get(String(t.id)) ?? 0) % PING_SLOTS])), [tasks, place])
  const h = history.data
  const lines: PingLineData[] = useMemo(() => (h ? buildPingLines(h, tasks, slots) : []), [h, tasks, slots])
  // New data (another node or range) starts without a hovered time (its chart may not have been
  // mounted to clear it).
  const dataKey = `${uuid}-${h?.range}`
  const [hoverData, setHoverData] = useState(dataKey)
  if (hoverData !== dataKey) {
    setHoverData(dataKey)
    setHover(null)
  }
  const pin = useChartSync((st) => st.pin)

  if (!on) return null

  // The pick carries over to the next node by id, else by name; otherwise this node shows all.
  const matched = pick ? (tasks.find((t) => String(t.id) === pick.id) ?? tasks.find((t) => t.name === pick.name)) : undefined
  const single = tasks.length === 1 ? tasks[0] : matched
  const selected = single ? String(single.id) : null
  const choose = (id: string) => {
    const t = tasks.find((x) => String(x.id) === id)
    onPick(!t || id === selected ? null : { id, name: t.name })
  }

  // The bucket being read: the one under the crosshair, else the pinned one (null: none, read the
  // range). The lines share one bucket grid; a time outside it reads as a gap.
  const times = lines[0]?.points.map((p) => p.time) ?? []
  const readTime = hover ?? pin
  const at = readTime === null ? -1 : bucketAt(times, readTime)
  // The pin is what is read: nothing else hovered, or the hover on its bucket (two times outside
  // the buckets are not the same bucket).
  const pinAt = pin === null ? -1 : bucketAt(times, pin)
  const onPin = pin !== null && (hover === null || (pinAt >= 0 ? at === pinAt : hover === pin))
  /** A chip's figure: the latest latency, or the bucket's while one is read (a dash where all was lost). */
  const chipValue = (task: PingTask): { text: string; lost?: boolean } => {
    const id = String(task.id)
    if (readTime !== null) {
      const p = at >= 0 ? lines.find((l) => l.id === id)?.points[at] : undefined
      return finite(p?.avg) ? { text: `${ms(p.avg)}ms` } : { text: '—', lost: !!p?.loss }
    }
    const s = stats.data?.get(id)
    return { text: s?.valid ? `${ms(s.latest)}ms` : '—', lost: rangeLost(s) }
  }

  // Up to MAX_CHIPS chips; the chosen one always among them.
  let chips = tasks.slice(0, MAX_CHIPS)
  if (single && !chips.includes(single)) chips = [...chips.slice(0, MAX_CHIPS - 1), single]
  const rest = tasks.filter((t) => !chips.includes(t))
  const stale = !!history.isPlaceholderData
  const from = h?.retainedFrom

  const one = single ? lines.find((l) => l.id === String(single.id)) : undefined
  const legend: ReactNode = (
    <>
      <Context label={single ? t('ping.rangeStats') : t('ping.rangeMean')} time={readTime === null ? null : at >= 0 ? times[at] : readTime} />
      {single ? <OneLegend s={stats.data?.get(String(single.id))} p={at >= 0 ? one?.points[at] : undefined} reading={readTime !== null} /> : <AllLegend lines={lines} stats={stats.data} at={at} reading={readTime !== null} />}
      {from && <span className="lg-since">{t('ping.since', { time: monthDayTime(from) })}</span>}
    </>
  )

  return (
    <section className="panel chart-panel chart-ping">
      <div className="panel-head compact">
        <h3>
          {t('ping.title')} <small>ms</small>
        </h3>
        <div className="ping-pick">
          <RadioGroup.Root className="ping-chips" value={selected ?? 'all'} onValueChange={(v) => onPick(v === 'all' ? null : { id: v, name: tasks.find((t) => String(t.id) === v)?.name ?? '' })} orientation="horizontal" loop aria-label={t('ping.lines')}>
            {tasks.length > 1 && (
              <RadioGroup.Item value="all" className="ping-chip">
                {t('common.all')}
              </RadioGroup.Item>
            )}
            {chips.map((task) => {
              const id = String(task.id)
              const s = stats.data?.get(id)
              return (
                <RadioGroup.Item key={id} value={id} className="ping-chip" aria-label={task.name} title={statsTitle(task, s, t)} onClick={() => id === selected && tasks.length > 1 && choose(id)}>
                  <i style={{ background: `var(--ping-${(slots.get(id) ?? 0) + 1})` }} aria-hidden="true" />
                  {task.name}
                  <ChipValue v={chipValue(task)} />
                </RadioGroup.Item>
              )
            })}
          </RadioGroup.Root>
          {rest.length > 0 && (
            <Popover.Root>
              <Popover.Trigger className="ping-chip ping-more" aria-label={t('ping.more', { count: rest.length })}>
                +{rest.length} <ChevronDown size={12} aria-hidden="true" />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="sort-menu ping-menu" align="end" sideOffset={6}>
                  {rest.map((task) => {
                    const v = chipValue(task)
                    return (
                      <Popover.Close asChild key={task.id}>
                        <button type="button" className="sort-opt ping-opt" onClick={() => choose(String(task.id))}>
                          <i className="ping-dot" style={{ background: `var(--ping-${(slots.get(String(task.id)) ?? 0) + 1})` }} aria-hidden="true" />
                          {task.name}
                          <span className={clsx('num', v.lost ? 'warn' : 'dim')}>{v.text}</span>
                        </button>
                      </Popover.Close>
                    )
                  })}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
        </div>
      </div>
      <Suspense fallback={<div className="kline skeleton" />}>
        <PingChart
          lines={lines}
          selected={selected}
          loading={history.isFetching && !h}
          stale={stale}
          offline={offline}
          rangeKey={`${uuid}-${h?.range}`}
          onHover={setHover}
          legend={legend}
          legendPinned={onPin}
        />
      </Suspense>
    </section>
  )
}
