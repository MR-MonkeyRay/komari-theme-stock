import clsx from 'clsx'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { HistoryResult } from '../../lib/api'
import { buildCandles } from '../../lib/candles'
import { finite, pct, size } from '../../lib/format'
import type { Row } from '../../lib/model'
import type { ChartStyle } from '../../lib/settings'
import { KLineChart } from './lazyChart'

const fmtLoad = (v: number) => v.toFixed(2)

/**
 * The node's 1-minute load over the CPU chart's range and buckets, from zero, against a dashed line
 * at its logical core count (load above it means tasks wait for a CPU); the scale always reaches
 * that line. A node with swap that used some in the range also gets swap in use drawn over it, on a
 * scale from none to all of its swap.
 *
 * Last in the side column: on a desktop it takes the row of the memory and disk charts, level with
 * them (see .chart-load).
 */
export function LoadPanel({ r, h, look, loading, stale, rangeKey }: { r: Row; h: HistoryResult | undefined; look: ChartStyle; loading: boolean; stale: boolean; rangeKey: string }) {
  const { t } = useTranslation()
  const uuid = r.node.uuid
  const st = r.online ? r.status : undefined
  const slots = useMemo(() => (h ? buildCandles(h, 'load.average', uuid) : []), [h, uuid])
  const cores = r.node.cpu_cores > 0 ? r.node.cpu_cores : null
  const swapTotal = st?.swap_total || r.node.swap_total || 0
  const swap = useMemo(() => {
    const m = h?.agg.avg.get(`swap.used|${uuid}`)
    return m ? [...m].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time / 1000, value })) : []
  }, [h, uuid])
  // A line flat at zero tells nothing: swap is drawn only where some was in use.
  const overlay = useMemo(
    () => (swapTotal > 0 && swap.some((p) => p.value > 0) ? { points: swap, max: swapTotal, label: t('chart.swap'), color: '--swap-line', format: (v: number) => size(v) } : null),
    [swap, swapTotal, t],
  )
  const level = useMemo(() => (cores ? { value: cores, title: t('detail.cores', { count: cores }) } : null), [cores, t])
  const now = st?.load
  const perCore = finite(now) && cores ? (now / cores) * 100 : null

  return (
    <section className="panel chart-panel chart-load">
      <div className="panel-head compact">
        <h3>
          {t('detail.loadTitle')} <small>{t('detail.load1m')}</small>
        </h3>
        <span className="chart-now num">
          {t('detail.current')} <b>{finite(now) ? fmtLoad(now) : '—'}</b>
          {cores && ` / ${t('detail.cores', { count: cores })}`}
          {perCore !== null && (
            <em className={clsx('has-hint', perCore >= 100 ? 'warn' : 'dim')} title={t('detail.perCoreHint')}>
              {' '}
              {pct(perCore, 0)}
            </em>
          )}
        </span>
      </div>
      <KLineChart look={look} slots={slots} format={fmtLoad} zero level={level} overlay={overlay} loading={loading} stale={stale} offline={!r.online} label={t('detail.loadTitle')} rangeKey={rangeKey} />
    </section>
  )
}
