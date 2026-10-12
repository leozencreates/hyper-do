import { useEffect, useRef, useState } from 'react'
import type { AppData, Settings, SortMode, Theme } from '../lib/types'
import { LANGS, type Lang } from '../lib/i18n'
import { platform } from '../lib/platform'
import { useT } from '../lib/useT'

interface Props {
  settings: Settings
  data: AppData
  onChange(s: Settings): void
  onImport(d: AppData): void
  onClose(): void
}

const THEMES: Theme[] = ['dark', 'light', 'system']
const SORTS: SortMode[] = ['smart', 'due', 'priority', 'created', 'alpha', 'manual']

export default function SettingsPanel({ settings, data, onChange, onImport, onClose }: Props) {
  const t = useT()
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const isElectron = platform.kind === 'electron'

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{t('settings')}</h2>

        <div className="field">
          <span>{t('s_language')}</span>
          <div className="seg">
            {LANGS.map((l) => (
              <button key={l.key} type="button" className={settings.language === l.key ? 'seg-btn active lang' : 'seg-btn'} onClick={() => set('language', l.key as Lang)}>
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>{t('s_theme')}</span>
          <div className="seg">
            {THEMES.map((th) => (
              <button key={th} type="button" className={settings.theme === th ? 'seg-btn active lang' : 'seg-btn'} onClick={() => set('theme', th)}>
                {t(`theme_${th}` as const)}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>{t('s_sort')}</span>
          <select value={settings.sort} onChange={(e) => set('sort', e.target.value as SortMode)}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`sort_${s}` as const)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>{t('s_default_interval')}</span>
          <select value={settings.defaultRemindEveryMin} onChange={(e) => set('defaultRemindEveryMin', Number(e.target.value))}>
            {[5, 10, 15, 20, 30, 45, 60, 120].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? t('minutes', { n: m }) : t('hours', { n: m / 60 })}
              </option>
            ))}
          </select>
        </label>

        <Toggle checked={settings.funTitles} onChange={(v) => set('funTitles', v)} label={t('s_fun')} desc={t('s_fun_d')} />
        <Toggle checked={settings.escalateOverdue} onChange={(v) => set('escalateOverdue', v)} label={t('s_escalate')} desc={t('s_escalate_d')} />
        {isElectron && <Toggle checked={settings.flashWindow} onChange={(v) => set('flashWindow', v)} label={t('s_flash')} desc={t('s_flash_d')} />}
        {isElectron && <Toggle checked={settings.showWindowOnRemind} onChange={(v) => set('showWindowOnRemind', v)} label={t('s_show')} desc={t('s_show_d')} />}
        <Toggle
          checked={settings.quietHours.enabled}
          onChange={(v) => set('quietHours', { ...settings.quietHours, enabled: v })}
          label={t('s_quiet')}
          desc={t('s_quiet_d')}
        />
        {settings.quietHours.enabled && (
          <div className="row indent">
            <input type="time" value={settings.quietHours.from} onChange={(e) => set('quietHours', { ...settings.quietHours, from: e.target.value })} />
            <span>→</span>
            <input type="time" value={settings.quietHours.to} onChange={(e) => set('quietHours', { ...settings.quietHours, to: e.target.value })} />
          </div>
        )}

        {isElectron && <TelegramSection settings={settings} onChange={onChange} />}

        <BackupSection data={data} onImport={onImport} />

        <div className="field">
          <span>{t('s_shortcuts')}</span>
          <p className="hint">{t('s_shortcuts_d')}</p>
        </div>

        {platform.kind === 'web' && <p className="hint">{t('web_note')}</p>}
        {platform.kind === 'capacitor' && <p className="hint">{t('android_note')}</p>}

        <div className="modal-actions">
          <button className="ghost" onClick={() => void platform.notifyTest()}>
            {t('test_notif')}
          </button>
          <button className="primary" onClick={onClose}>
            {t('ok')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** JSON yedek: dışa aktar / içe aktar (içe aktarma mevcut veriyi değiştirir, onay ister). */
function BackupSection({ data, onImport }: { data: AppData; onImport(d: AppData): void }) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<AppData | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hyperdo-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppData>
      if (!Array.isArray(parsed.tasks)) throw new Error('no tasks')
      setPending({ tasks: parsed.tasks, settings: { ...data.settings, ...(parsed.settings ?? {}) } })
      setMsg(null)
    } catch {
      setMsg(t('import_fail'))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="field">
      <span>{t('s_backup')}</span>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="ghost small" onClick={exportJson}>
          ⬇ {t('export_btn')}
        </button>
        <button type="button" className="ghost small" onClick={() => fileRef.current?.click()}>
          ⬆ {t('import_btn')}
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        {msg && <span className="hint">{msg}</span>}
      </div>
      {pending && (
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="hint">{t('import_q')}</span>
          <button
            type="button"
            className="mini danger"
            onClick={() => {
              onImport(pending)
              setPending(null)
              setMsg(t('import_ok'))
            }}
          >
            {t('import_btn')}
          </button>
          <button type="button" className="mini" onClick={() => setPending(null)}>
            {t('cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

function TelegramSection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const t = useT()
  const tg = settings.telegram
  const setTg = (patch: Partial<Settings['telegram']>) => onChange({ ...settings, telegram: { ...tg, ...patch } })
  const [result, setResult] = useState<string | null>(null)

  const test = async () => {
    setResult('…')
    const r = await platform.telegramTest?.()
    if (!r) return setResult(null)
    setResult(r.ok ? t('tg_test_ok') : t('tg_test_fail', { e: r.error ?? '?' }))
  }

  return (
    <div className="tg-section">
      <Toggle checked={tg.enabled} onChange={(v) => setTg({ enabled: v })} label={t('s_telegram')} desc={t('s_telegram_d')} />
      {tg.enabled && (
        <div className="indent tg-body">
          <label className="field">
            <span>{t('tg_token')}</span>
            <input type="password" className="mono" value={tg.token} placeholder={t('tg_token_ph')} onChange={(e) => setTg({ token: e.target.value.trim() })} autoComplete="off" />
          </label>
          <p className="hint">{t('tg_steps')}</p>
          <div className="row">
            {tg.chatId ? (
              <>
                <span className="tg-status ok">{t('tg_linked', { id: tg.chatId })}</span>
                <button type="button" className="ghost small" onClick={() => setTg({ chatId: '' })}>
                  {t('tg_unlink')}
                </button>
              </>
            ) : (
              <span className="tg-status">{t('tg_waiting')}</span>
            )}
          </div>
          <div className="row">
            <button type="button" className="ghost small" disabled={!tg.token || !tg.chatId} onClick={() => void test()}>
              {t('tg_test')}
            </button>
            {result && <span className="hint">{result}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange(v: boolean): void; label: string; desc: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b>{label}</b>
        <small>{desc}</small>
      </span>
    </label>
  )
}
