import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import { ChevronDown } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
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

function statsTitle(task: PingTask, s: PingTaskStats | undefined) {
  const how = `${task.type.toUpperCase()} 每 ${task.interval} 秒探测`
  if (!s || !s.valid) return `${task.name} · ${how}\n所选范围内无延迟样本`
  return `${task.name} · ${how}\n最新 ${ms(s.latest)}ms · 均值 ${ms(s.avg)} · 最低 ${ms(s.min)} · 最高 ${ms(s.max)} · 抖动 σ ${ms(s.stddev)} · 丢包 ${lossText(s.loss)}`
}

function Summary({ s }: { s: PingTaskStats | undefined }) {
  if (!s || !s.valid) return <span className="dim">所选范围内无延迟样本</span>
  return (
    <>
      <span>
        最新 <b>{ms(s.latest)}</b>ms
      </span>
      <span>
        均值 <b>{ms(s.avg)}</b>
      </span>
      <span>
        最低 <b>{ms(s.min)}</b>
      </span>
      <span>
        最高 <b>{ms(s.max)}</b>
      </span>
      <span>
        抖动 σ <b>{ms(s.stddev)}</b>
      </span>
      <span className={s.loss > 0 ? 'warn' : undefined}>
        丢包 <b>{lossText(s.loss)}</b>
      </span>
    </>
  )
}

export function PingPanel({ uuid, range, refreshSeconds, offline, pick, onPick }: { uuid: string; range: Range; refreshSeconds: number; offline: boolean; pick: PingPick | null; onPick: (p: PingPick | null) => void }) {
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
  const chipValue = (t: PingTask) => {
    const id = String(t.id)
    if (hover !== null) {
      const p = at(lines.find((l) => l.id === id))
      return p?.avg !== null && p?.avg !== undefined ? `${ms(p.avg)}ms` : p?.loss ? '丢包' : '—'
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
          网络延迟 <small>ms</small>
        </h3>
        <RadioGroup.Root className="ping-chips" value={selected ?? 'all'} onValueChange={(v) => onPick(v === 'all' ? null : { id: v, name: tasks.find((t) => String(t.id) === v)?.name ?? '' })} orientation="horizontal" loop aria-label="延迟线路">
          {tasks.length > 1 && (
            <RadioGroup.Item value="all" className="ping-chip">
              全部
            </RadioGroup.Item>
          )}
          {chips.map((t) => {
            const id = String(t.id)
            const s = stats.data?.get(id)
            return (
              <RadioGroup.Item key={id} value={id} className="ping-chip" title={statsTitle(t, s)} onClick={() => id === selected && tasks.length > 1 && choose(id)}>
                <i style={{ background: `var(--ping-${(slots.get(id) ?? 0) + 1})` }} aria-hidden="true" />
                {t.name}
                <b className="num">{chipValue(t)}</b>
                {hover === null && !!s?.loss && <em className="num">{lossText(s.loss)}丢</em>}
              </RadioGroup.Item>
            )
          })}
        </RadioGroup.Root>
        {rest.length > 0 && (
          <Popover.Root>
            <Popover.Trigger className="ping-chip ping-more" aria-label={`其余 ${rest.length} 条线路`}>
              +{rest.length} <ChevronDown size={12} aria-hidden="true" />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content className="sort-menu ping-menu" align="end" sideOffset={6}>
                {rest.map((t) => (
                  <Popover.Close asChild key={t.id}>
                    <button type="button" className="sort-opt ping-opt" onClick={() => choose(String(t.id))}>
                      <i className="ping-dot" style={{ background: `var(--ping-${(slots.get(String(t.id)) ?? 0) + 1})` }} aria-hidden="true" />
                      {t.name}
                      <span className="num dim">{chipValue(t)}</span>
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
          rangeKey={`${uuid}-${range}`}
          onHover={setHover}
          summary={
            <>
              {single ? (
                <Summary s={stats.data?.get(String(single.id))} />
              ) : (
                // Every line: the range mean (the chips carry the latest value).
                <span className="ping-means">
                  区间均值
                  {tasks.map((t) => {
                    const id = String(t.id)
                    const s = stats.data?.get(id)
                    return (
                      <span key={id}>
                        <i className="ping-dot" style={{ background: `var(--ping-${(slots.get(id) ?? 0) + 1})` }} aria-hidden="true" />
                        {t.name} <b>{s?.valid ? ms(s.avg) : '—'}</b>
                      </span>
                    )
                  })}
                </span>
              )}
              {from && <span className="dim">延迟数据自 {monthDayTime(from)} 起</span>}
            </>
          }
        />
      </Suspense>
    </section>
  )
}
