import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import * as RadioGroup from '@radix-ui/react-radio-group'
import * as Switch from '@radix-ui/react-switch'
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react'
import { fitRange, useAvailableRanges } from '../lib/api'
import { isDefaultPrefs, REFRESH_OPTIONS, usePrefs, type Range } from '../lib/settings'
import { Segmented } from './primitives'

// Visitor display preferences: a popover under the top-bar button on desktop, a bottom sheet on
// phones. Every change applies at once and is kept in this browser only.

const phoneQuery = typeof window !== 'undefined' ? window.matchMedia('(max-width: 720px)') : null

function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      phoneQuery?.addEventListener('change', cb)
      return () => phoneQuery?.removeEventListener('change', cb)
    },
    () => phoneQuery?.matches ?? false,
  )
}

const REFRESH = REFRESH_OPTIONS.map(String)

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

function ConventionCards({ redUp, onChange, labelledBy, describedBy }: { redUp: boolean; onChange: (redUp: boolean) => void; labelledBy: string; describedBy?: string }) {
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
      {card('red-up', '红涨绿跌', 'A 股')}
      {card('green-up', '绿涨红跌', '欧美')}
    </RadioGroup.Root>
  )
}

function PrefsForm() {
  const p = usePrefs()
  // Only ranges this site keeps data for; a stored longer one shows as the longest available.
  const available = useAvailableRanges()
  return (
    <div className="settings-body">
      <section className="pref-section" aria-label="行情">
        <h3 className="pref-section-title">行情</h3>
        <Field label="涨跌配色" note="高负载告警始终为红色">
          {(ids) => <ConventionCards redUp={p.redUp} onChange={(redUp) => p.update({ redUp })} labelledBy={ids.label} describedBy={ids.note} />}
        </Field>
        <SwitchField label="1 小时走势曲线" note="关闭后显示占用条，减少一次请求" checked={p.showSparkline} onChange={(showSparkline) => p.update({ showSparkline })} />
        <Field label="实时刷新间隔">
          {(ids) => <Segmented className="seg-fill" value={String(p.refreshSeconds)} options={REFRESH} onChange={(v) => p.update({ refreshSeconds: Number(v) })} labelledBy={ids.label} format={(v) => `${v}s`} />}
        </Field>
      </section>
      <section className="pref-section" aria-label="节点详情">
        <h3 className="pref-section-title">节点详情</h3>
        <Field label="默认时间范围" note="详情页内可临时切换">
          {(ids) => <Segmented<Range> className="seg-fill" value={fitRange(p.defaultRange, available)} options={available.ranges} onChange={(defaultRange) => p.update({ defaultRange })} labelledBy={ids.label} />}
        </Field>
        <SwitchField label="显示节点事件" note="由样本推断的升高、回落与缺测" checked={p.showEvents} onChange={(showEvents) => p.update({ showEvents })} />
      </section>
    </div>
  )
}

function Panel({ title, close }: { title: ReactNode; close: ReactNode }) {
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
        <span>仅保存在当前浏览器</span>
        <button type="button" className="settings-reset" onClick={reset} disabled={!custom}>
          <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
          恢复默认
        </button>
      </footer>
    </>
  )
}

const TITLE = '显示设置'

export function SettingsButton() {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  const custom = usePrefs((s) => !isDefaultPrefs(s))
  const hint = custom ? `${TITLE}（已自定义）` : TITLE
  const trigger = (
    <button type="button" className="tool-btn settings-btn" title={hint} aria-label={hint}>
      <SlidersHorizontal size={14} strokeWidth={2} aria-hidden="true" />
      <span className="tool-btn-label">设置</span>
      {custom && <i className="settings-dot" aria-hidden="true" />}
    </button>
  )
  const closeIcon = <X size={14} strokeWidth={2} aria-hidden="true" />

  if (phone) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="sheet-overlay" />
          <Dialog.Content className="settings-panel is-sheet" aria-describedby={undefined}>
            <Panel
              title={<Dialog.Title className="settings-title">{TITLE}</Dialog.Title>}
              close={
                <Dialog.Close className="settings-close" aria-label="关闭">
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
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="settings-panel is-popover" side="bottom" align="end" sideOffset={8} collisionPadding={12} aria-label={TITLE}>
          <Panel
            title={<h2 className="settings-title">{TITLE}</h2>}
            close={
              <Popover.Close className="settings-close" aria-label="关闭">
                {closeIcon}
              </Popover.Close>
            }
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
