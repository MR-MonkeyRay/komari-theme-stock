import clsx from 'clsx'
import { ChartCandlestick, ChevronLeft, ChevronRight, CircleQuestionMark, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useUptime } from '../../lib/api'
import { clock, duration, monthDay, parseTime, sameDay, weekday } from '../../lib/format'
import type { Row } from '../../lib/model'
import { buildUptime, UPTIME_DAYS, type UptimeDay } from '../../lib/uptime'
import { Tip } from '../primitives'
import { useOpenDay } from './uptimeDay'

/** Floored, so a day with any time offline never reads 100%. */
function share(ratio: number, digits: number) {
  if (ratio >= 1) return '100%'
  const f = 10 ** digits
  return `${(Math.floor(ratio * 100 * f) / f).toFixed(digits)}%`
}

/** At most this many offline stretches are listed; the rest are counted. */
const MAX_GAPS = 3

function useDayText() {
  const { t } = useTranslation()
  return {
    date: (d: UptimeDay, now: number) => (sameDay(d.day, now) ? t('uptime.today') : `${monthDay(d.day, false)} ${weekday(d.day)}`),
    level: (d: UptimeDay) => t(`uptime.level.${d.level}`),
    offline: (d: UptimeDay) => {
      const off = d.tracked - d.online
      if (off < 1) return t('uptime.noGap')
      if (d.online < 1) return t('uptime.allDay')
      return t('uptime.offlineFor', { span: duration(off) })
    },
    gaps: (d: UptimeDay) => {
      const list = d.gaps.slice(0, MAX_GAPS).map(([a, b]) => `${clock(a, false)}–${clock(b, false)}`).join(t('uptime.listSep'))
      return d.gaps.length > MAX_GAPS ? t('uptime.gapsMore', { list, count: d.gaps.length }) : t('uptime.gaps', { list })
    },
  }
}

/**
 * Up to 30 days of availability, one bar a day, today at the right end. A bar's color and height
 * both give its level, so a dip shows without telling the colors apart. Pointing at a bar (or
 * focusing it) shows its day in a floating tip; clicking or tapping opens the day under the strip,
 * and a finger dragged along the strip opens each day it passes. An opened day the charts reach
 * back to (`reach`, ms) can be shown in them (`onShow`: the day's window and where its first
 * offline stretch begins, ms).
 */
export function UptimeStrip({ r, now, reach, onShow }: { r: Row; now: number; reach: number; onShow: (from: number, to: number, pin: number | null) => void }) {
  const { t } = useTranslation()
  const uuid = r.node.uuid
  const q = useUptime(uuid, parseTime(r.node.created_at))
  const up = useMemo(() => (q.data ? buildUptime(q.data, { online: r.online, lastSeen: r.lastSeen }) : null), [q.data, r.online, r.lastSeen])
  const days = up?.days ?? []
  const [help, setHelp] = useState(false)
  const opened = useOpenDay((s) => (s.uuid === uuid ? s.day : null))
  const open = opened === null ? -1 : days.findIndex((d) => d.day === opened)
  const text = useDayText()
  const bars = useRef<HTMLDivElement>(null)
  const dayBox = useRef<HTMLDivElement>(null)
  const noteId = useId()
  const asOf = q.data?.asOf ?? now

  const openDay = (i: number | null) => useOpenDay.setState({ uuid, day: i === null ? null : days[i].day })
  // One tab stop for the strip: the opened day, else today; arrows move between the days.
  const stop = open >= 0 ? open : days.length - 1
  const focusBar = (i: number) => bars.current?.querySelectorAll<HTMLButtonElement>('.ubar')[i]?.focus()

  // Touch: a finger that moves to another bar opens each day it passes; a plain tap toggles as a
  // click does. The strip lets vertical moves scroll the page (touch-action), which cancels this.
  const drag = useRef<{ start: number | null; moved: boolean } | null>(null)
  const barAt = (x: number) => {
    const box = bars.current?.getBoundingClientRect()
    if (!box) return null
    // Columns are as wide as (width + gap) / 30, the gap being 3px.
    const i = Math.floor(((x - box.left) / (box.width + 3)) * UPTIME_DAYS) - (UPTIME_DAYS - days.length)
    return i >= 0 && i < days.length ? i : null
  }
  const onDown = (e: PointerEvent) => {
    drag.current = e.pointerType === 'touch' ? { start: barAt(e.clientX), moved: false } : null
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const i = barAt(e.clientX)
    if (i === null || (i === d.start && !d.moved)) return
    d.moved = true
    if (i !== open) openDay(i)
  }
  const onBarClick = (i: number) => {
    const dragged = drag.current?.moved
    drag.current = null
    if (!dragged) openDay(i === open ? null : i)
  }
  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? days.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const j = Math.max(0, Math.min(days.length - 1, to))
    focusBar(j)
    if (open >= 0) openDay(j)
  }

  const day = open >= 0 ? days[open] : null
  // At the foot of a column that scrolls, an opened day would land out of sight.
  const opening = day !== null
  useEffect(() => {
    if (opening) dayBox.current?.scrollIntoView({ block: 'nearest' })
  }, [opening])
  // The strip is keyed by node: paging on, or closing the drawer, leaves no day open behind it for
  // Esc to close unseen.
  useEffect(() => () => useOpenDay.setState({ uuid: null, day: null }), [])
  const label = (d: UptimeDay) => t('uptime.bar', { date: text.date(d, now), level: text.level(d), value: share(d.ratio, 1) })

  return (
    <div className="uptime-strip">
      <div className="panel-head compact uptime-head">
        <h3>
          {t('uptime.title')}
          <Tip content={help ? undefined : t('uptime.hint')}>
            <button type="button" className="uptime-help" aria-label={t('uptime.help')} aria-expanded={help} aria-controls={noteId} onClick={() => setHelp((v) => !v)}>
              <CircleQuestionMark size={12} strokeWidth={2} aria-hidden="true" />
            </button>
          </Tip>
        </h3>
        <span className="panel-extra uptime-sum">
          {up && <span>{t('uptime.range', { count: days.length })}</span>}
          <b className={clsx('num', up && `ul-${up.level}`)}>{up ? share(up.ratio, 2) : '—'}</b>
        </span>
      </div>
      {help && (
        <p id={noteId} className="uptime-note">
          {t('uptime.hint')}
        </p>
      )}
      <div className="uptime-body">
        <div
          ref={bars}
          className="uptime-bars"
          role="group"
          aria-label={t('uptime.bars')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerCancel={() => (drag.current = null)}
        >
          {/* The opened day is shown below in full; pointing at it adds no tip. */}
          {days.map((d, i) => (
            <Tip key={d.day} content={i === open ? null : <DayTip d={d} now={now} />} side="bottom" delay={0}>
              <button
                type="button"
                className={clsx('ubar', `ub-${d.level}`, sameDay(d.day, now) && 'is-today', i === open && 'is-open')}
                style={i === 0 ? { gridColumnStart: UPTIME_DAYS - days.length + 1 } : undefined}
                tabIndex={i === stop ? 0 : -1}
                aria-label={label(d)}
                aria-pressed={i === open}
                onKeyDown={(e) => onKey(e, i)}
                onClick={() => onBarClick(i)}
              />
            </Tip>
          ))}
        </div>
        {day && (
          <div ref={dayBox} className="uptime-day" role="group" aria-label={label(day)}>
            <div className="uptime-day-head">
              <b>{text.date(day, now)}</b>
              <b className={`ul-${day.level}`}>{text.level(day)}</b>
              {sameDay(day.day, now) && <span className="dim">{t('uptime.asOf', { time: clock(asOf, false) })}</span>}
              <span className="uptime-day-tools">
                {/* aria-disabled, not disabled: an end reached keeps the focus on its button. */}
                <button type="button" className="icon-btn" aria-label={t('uptime.prev')} aria-disabled={open === 0} onClick={() => open > 0 && openDay(open - 1)}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" aria-label={t('uptime.next')} aria-disabled={open === days.length - 1} onClick={() => open < days.length - 1 && openDay(open + 1)}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
                <button type="button" className="icon-btn" aria-label={t('uptime.close')} onClick={() => openDay(null)}>
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            </div>
            <p>
              {t('uptime.online', { value: share(day.ratio, 2) })}
              <span className="sep">·</span>
              {text.offline(day)}
            </p>
            {day.gaps.length > 0 && day.online >= 1 && <p className="dim">{text.gaps(day)}</p>}
            {day.day + 86_400_000 > reach && (
              <button type="button" className="uptime-show" onClick={() => onShow(day.day, day.day + 86_400_000, day.gaps[0]?.[0] ?? null)}>
                <ChartCandlestick size={13} aria-hidden="true" />
                {t('uptime.show')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** A day in short, in the tip of its bar. */
function DayTip({ d, now }: { d: UptimeDay; now: number }) {
  const { t } = useTranslation()
  const text = useDayText()
  return (
    <div className="uptime-tip">
      <div className="uptime-tip-head">
        <b>{text.date(d, now)}</b>
        <b className={`ul-${d.level}`}>{text.level(d)}</b>
      </div>
      <p>
        {t('uptime.online', { value: share(d.ratio, 2) })}
        <span className="sep">·</span>
        {text.offline(d)}
      </p>
      {d.gaps.length > 0 && d.online >= 1 && <p className="dim">{text.gaps(d)}</p>}
    </div>
  )
}
