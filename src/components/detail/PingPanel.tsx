import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { ChevronDown } from 'lucide-react'
import type { TFunction } from 'i18next'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePingHistory, usePingStats, usePingTasks } from '../../lib/api'
import { monthDayTime } from '../../lib/format'
import { buildPingLines, lossText, ms, PING_SLOTS, type PingLineData } from '../../lib/ping'
import type { Range } from '../../lib/settings'
import type { PingTask, PingTaskStats } from '../../lib/types'

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

function Summary({ s }: { s: PingTaskStats | undefined }) {
  const { t } = useTranslation()
  if (!s || !s.valid) return <span className="dim">{t('ping.noSamples')}</span>
  return (
    <>
      <span>
        {t('ping.latest')} <b>{ms(s.latest)}</b>ms
      </span>
      <span>
        {t('ping.mean')} <b>{ms(s.avg)}</b>
      </span>
      <span>
        {t('ping.min')} <b>{ms(s.min)}</b>
      </span>
      <span>
        {t('ping.max')} <b>{ms(s.max)}</b>
      </span>
      <span>
        {t('ping.jitter')} <b>{ms(s.stddev)}</b>
      </span>
      <span className={s.loss > 0 ? 'warn' : undefined}>
        {t('ping.loss')} <b>{lossText(s.loss)}</b>
      </span>
    </>
  )
}

export function PingPanel({ uuid, range, refreshSeconds, offline, pick, onPick }: { uuid: string; range: Range; refreshSeconds: number; offline: boolean; pick: PingPick | null; onPick: (p: PingPick | null) => void }) {
  const { t } = useTranslation()
  const { tasks, place } = usePingTasks(uuid)
  const on = tasks.length > 0
  const history = usePingHistory(uuid, range, refreshSeconds, on)
  const stats = usePingStats(uuid, range, refreshSeconds, on)
  const [hover, setHover] = useState<number | null>(null)
  // A new node starts without a hovered time (its chart may not have been mounted to clear it).
  const [hoverNode, setHoverNode] = useState(uuid)
  if (hoverNode !== uuid) {
    setHoverNode(uuid)
    setHover(null)
  }

  // Colors follow the task's place in Komari's whole list, so 电信 has the same color on every node.
  const slots = useMemo(() => new Map(tasks.map((t) => [String(t.id), (place.get(String(t.id)) ?? 0) % PING_SLOTS])), [tasks, place])
  const h = history.data
  const lines: PingLineData[] = useMemo(() => (h ? buildPingLines(h, tasks, slots) : []), [h, tasks, slots])

  if (!on) return null

  // The pick carries over to the next node by id, else by name; otherwise this node shows all.
  const matched = pick ? (tasks.find((t) => String(t.id) === pick.id) ?? tasks.find((t) => t.name === pick.name)) : undefined
  const single = tasks.length === 1 ? tasks[0] : matched
  const selected = single ? String(single.id) : null
  const choose = (id: string) => {
    const t = tasks.find((x) => String(x.id) === id)
    onPick(!t || id === selected ? null : { id, name: t.name })
  }

  const at = (l: PingLineData | undefined) => (hover !== null && l ? l.points.find((p) => p.time === hover) : undefined)
  const chipValue = (task: PingTask) => {
    const id = String(task.id)
    if (hover !== null) {
      const p = at(lines.find((l) => l.id === id))
      return p?.avg !== null && p?.avg !== undefined ? `${ms(p.avg)}ms` : p?.loss ? t('ping.loss') : '—'
    }
    const s = stats.data?.get(id)
    return s?.valid ? `${ms(s.latest)}ms` : '—'
  }

  // Up to MAX_CHIPS chips; the chosen one always among them.
  let chips = tasks.slice(0, MAX_CHIPS)
  if (single && !chips.includes(single)) chips = [...chips.slice(0, MAX_CHIPS - 1), single]
  const rest = tasks.filter((t) => !chips.includes(t))
  const stale = !!history.isPlaceholderData
  const from = h?.retainedFrom

  return (
    <section className="panel chart-panel chart-ping">
      <div className="panel-head compact">
        <h3>
          {t('ping.title')} <small>ms</small>
        </h3>
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
              <RadioGroup.Item key={id} value={id} className="ping-chip" title={statsTitle(task, s, t)} onClick={() => id === selected && tasks.length > 1 && choose(id)}>
                <i style={{ background: `var(--ping-${(slots.get(id) ?? 0) + 1})` }} aria-hidden="true" />
                {task.name}
                <b className="num">{chipValue(task)}</b>
                {hover === null && !!s?.loss && <em className="num">{t('ping.lossTag', { loss: lossText(s.loss) })}</em>}
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
                {rest.map((task) => (
                  <Popover.Close asChild key={task.id}>
                    <button type="button" className="sort-opt ping-opt" onClick={() => choose(String(task.id))}>
                      <i className="ping-dot" style={{ background: `var(--ping-${(slots.get(String(task.id)) ?? 0) + 1})` }} aria-hidden="true" />
                      {task.name}
                      <span className="num dim">{chipValue(task)}</span>
                    </button>
                  </Popover.Close>
                ))}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
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
          summary={
            <>
              {single ? (
                <Summary s={stats.data?.get(String(single.id))} />
              ) : (
                // Every line: the range mean (the chips carry the latest value).
                <span className="ping-means">
                  {t('ping.rangeMean')}
                  {tasks.map((task) => {
                    const id = String(task.id)
                    const s = stats.data?.get(id)
                    return (
                      <span key={id}>
                        <i className="ping-dot" style={{ background: `var(--ping-${(slots.get(id) ?? 0) + 1})` }} aria-hidden="true" />
                        {task.name} <b>{s?.valid ? ms(s.avg) : '—'}</b>
                      </span>
                    )
                  })}
                </span>
              )}
              {from && <span className="dim">{t('ping.since', { time: monthDayTime(from) })}</span>}
            </>
          }
        />
      </Suspense>
    </section>
  )
}
