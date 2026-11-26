import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import * as Switch from '@radix-ui/react-switch'
import { ChevronDown, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguageChoice, useLanguageChoice, type Lang } from '../i18n'
import { fitRange, useAvailableRanges } from '../lib/api'
import { useIsPhone } from '../lib/media'
import { isDefaultPrefs, REFRESH_OPTIONS, usePrefs, type ChartStyle, type Range } from '../lib/settings'
import { Segmented, TipRoot, TipTrigger } from './primitives'

// Visitor display preferences: a popover under the top-bar button on desktop, a bottom sheet on
// phones. Every change applies at once and is kept in this browser only.

const REFRESH = REFRESH_OPTIONS.map(String)
const CHART_STYLES: ChartStyle[] = ['candle', 'line']

function Field({ label, note, children }: { label: string; note?: string; children: (ids: { label: string; note?: string }) => ReactNode }) {
  const id = useId()
  const ids = { label: `${id}-label`, note: note ? `${id}-note` : undefined }
  return (
    <div className="pref-field">
      <span className="pref-label" id={ids.label}>
        {label}
      </span>
      {children(ids)}
      {note && (
        <p className="pref-note" id={ids.note}>
          {note}
        </p>
      )}
    </div>
  )
}

function SwitchField({ label, note, checked, onChange }: { label: string; note: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId()
  return (
    <div className="pref-field pref-switch">
      <label className="pref-label" htmlFor={id}>
        {label}
      </label>
      <Switch.Root id={id} className="switch" checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-note`}>
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
      <p className="pref-note" id={`${id}-note`}>
        {note}
      </p>
    </div>
  )
}

/** The page language: automatic (the browser's) or one picked here; names are in their own language. */
function LanguageField() {
  const { t } = useTranslation()
  const choice = useLanguageChoice()
  const id = useId()
  return (
    <div className="pref-field">
      <label className="pref-label" htmlFor={id}>
        {t('settings.language')}
      </label>
      <span className="pref-select">
        <select id={id} value={choice} onChange={(e) => setLanguageChoice(e.target.value as Lang | 'auto')}>
          <option value="auto">{t('settings.languageAuto')}</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code} lang={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <ChevronDown size={13} aria-hidden="true" />
      </span>
    </div>
  )
}

function ConventionCards({ redUp, onChange, labelledBy, describedBy }: { redUp: boolean; onChange: (redUp: boolean) => void; labelledBy: string; describedBy?: string }) {
  const { t } = useTranslation()
  const card = (value: 'red-up' | 'green-up', name: string, market: string) => (
    <RadioGroup.Item value={value} className="conv-card">
      <span className="conv-name">
        {name}
        <small>{market}</small>
      </span>
      <span className="conv-sample num" aria-hidden="true">
        <b className={value === 'red-up' ? 'is-red' : 'is-green'}>▲+3.2</b>
        <b className={value === 'red-up' ? 'is-green' : 'is-red'}>▼-1.8</b>
      </span>
    </RadioGroup.Item>
  )
  return (
    <RadioGroup.Root className="conv-cards" value={redUp ? 'red-up' : 'green-up'} onValueChange={(v) => onChange(v === 'red-up')} orientation="horizontal" loop aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {card('red-up', t('settings.redUp'), t('settings.redUpMarket'))}
      {card('green-up', t('settings.greenUp'), t('settings.greenUpMarket'))}
    </RadioGroup.Root>
  )
}

function PrefsForm() {
  const { t } = useTranslation()
  const p = usePrefs()
  // Only ranges this site keeps data for; a stored longer one shows as the longest available.
  const available = useAvailableRanges()
  return (
    <div className="settings-body">
      <section className="pref-section">
        <LanguageField />
      </section>
      <section className="pref-section" aria-label={t('settings.market')}>
        <h3 className="pref-section-title">{t('settings.market')}</h3>
        <Field label={t('settings.convention')} note={t('settings.conventionNote')}>
          {(ids) => <ConventionCards redUp={p.redUp} onChange={(redUp) => p.update({ redUp })} labelledBy={ids.label} describedBy={ids.note} />}
        </Field>
        <SwitchField label={t('settings.sparkline')} note={t('settings.sparklineNote')} checked={p.showSparkline} onChange={(showSparkline) => p.update({ showSparkline })} />
        <Field label={t('settings.refresh')}>
          {(ids) => <Segmented className="seg-fill" value={String(p.refreshSeconds)} options={REFRESH} onChange={(v) => p.update({ refreshSeconds: Number(v) })} labelledBy={ids.label} format={(v) => `${v}s`} />}
        </Field>
      </section>
      <section className="pref-section" aria-label={t('settings.detail')}>
        <h3 className="pref-section-title">{t('settings.detail')}</h3>
        <Field label={t('settings.range')} note={t('settings.rangeNote')}>
          {(ids) => <Segmented<Range> className="seg-fill" value={fitRange(p.defaultRange, available)} options={available.ranges} onChange={(defaultRange) => p.update({ defaultRange })} labelledBy={ids.label} />}
        </Field>
        <Field label={t('settings.chartStyle')} note={t('settings.chartStyleNote')}>
          {(ids) => <Segmented<ChartStyle> className="seg-fill" value={p.chartStyle} options={CHART_STYLES} onChange={(chartStyle) => p.update({ chartStyle })} labelledBy={ids.label} format={(v) => (v === 'line' ? t('common.line') : t('common.candle'))} />}
        </Field>
        <SwitchField label={t('settings.events')} note={t('settings.eventsNote')} checked={p.showEvents} onChange={(showEvents) => p.update({ showEvents })} />
      </section>
    </div>
  )
}

function Panel({ title, close }: { title: ReactNode; close: ReactNode }) {
  const { t } = useTranslation()
  const custom = usePrefs((s) => !isDefaultPrefs(s))
  const reset = usePrefs((s) => s.reset)
  return (
    <>
      <header className="settings-head">
        {title}
        {close}
      </header>
      <PrefsForm />
      <footer className="settings-foot">
        <span>{t('settings.localOnly')}</span>
        <button type="button" className="settings-reset" onClick={reset} disabled={!custom}>
          <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
          {t('settings.reset')}
        </button>
      </footer>
    </>
  )
}

export function SettingsButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  const custom = usePrefs((s) => !isDefaultPrefs(s))
  const title = t('settings.title')
  const hint = custom ? t('settings.titleCustom') : title
  const trigger = (
    <TipTrigger type="button" className="tool-btn settings-btn" aria-label={hint}>
      <SlidersHorizontal size={14} strokeWidth={2} aria-hidden="true" />
      <span className="tool-btn-label">{t('settings.button')}</span>
      {custom && <i className="settings-dot" aria-hidden="true" />}
    </TipTrigger>
  )
  const closeIcon = <X size={14} strokeWidth={2} aria-hidden="true" />

  if (phone) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <TipRoot content={hint}>
          <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        </TipRoot>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="settings-panel is-sheet" aria-describedby={undefined}>
            <Panel
              title={<Dialog.Title className="settings-title">{title}</Dialog.Title>}
              close={
                <Dialog.Close className="settings-close" aria-label={t('common.close')}>
                  {closeIcon}
                </Dialog.Close>
              }
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <TipRoot content={hint}>
        <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      </TipRoot>
      <Popover.Portal>
        <Popover.Content className="settings-panel is-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label={title}>
          <Panel
            title={<h2 className="settings-title">{title}</h2>}
            close={
              <Popover.Close className="settings-close" aria-label={t('common.close')}>
                {closeIcon}
              </Popover.Close>
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
