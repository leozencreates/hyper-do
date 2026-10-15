import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, MINI_APP_MODES, SORT_MODES, THEMES, type AppData, type BackupInfo, type DesktopApi, type MiniAppMode, type MiniAppSettings, type MiniAppStatus, type Settings, type ShortcutStatus, type SortMode, type TelegramStatus, type UpdateStatus } from '../lib/types'
import { LANGS, LOCALE, type Lang } from '../lib/i18n'
import { platform } from '../lib/platform'
import { useLang, useT } from '../lib/useT'
import type { CalendarState } from '../lib/useCalendar'
import { dateStamp, downloadJson } from '../lib/download'
import CalendarSettings from './CalendarSettings'
import SyncSettings from './SyncSettings'
import Modal from './Modal'
import Toggle from './Toggle'

interface Props {
  settings: Settings
  data: AppData
  cal: CalendarState
  onChange(s: Settings): void
  onImport(d: AppData): void
  onClose(): void
}

export default function SettingsPanel({ settings, data, cal, onChange, onImport, onClose }: Props) {
  const t = useT()
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const isElectron = platform.kind === 'electron'

  return (
    <Modal title={t('settings')} onClose={onClose}>
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
          {SORT_MODES.map((s) => (
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

      <div className="field">
        <span>{t('s_pomodoro')}</span>
        <div className="row pomodoro-row">
          <label className="pomo">
            <small>{t('s_work')}</small>
            <input type="number" min={5} max={180} value={settings.pomodoro.workMin} onChange={(e) => set('pomodoro', { ...settings.pomodoro, workMin: Math.max(1, Number(e.target.value) || 40) })} />
          </label>
          <label className="pomo">
            <small>{t('s_break')}</small>
            <input type="number" min={1} max={60} value={settings.pomodoro.breakMin} onChange={(e) => set('pomodoro', { ...settings.pomodoro, breakMin: Math.max(1, Number(e.target.value) || 5) })} />
          </label>
          <span className="hint">{t('s_pomodoro_d')}</span>
        </div>
      </div>
      <Toggle checked={settings.focusSuppressOthers} onChange={(v) => set('focusSuppressOthers', v)} label={t('s_focus_suppress')} desc={t('s_focus_suppress_d')} />

      <Toggle checked={settings.funTitles} onChange={(v) => set('funTitles', v)} label={t('s_fun')} desc={t('s_fun_d')} />
      <Toggle checked={settings.escalateOverdue} onChange={(v) => set('escalateOverdue', v)} label={t('s_escalate')} desc={t('s_escalate_d')} />
      <Toggle checked={settings.escalation.enabled} onChange={(v) => set('escalation', { ...settings.escalation, enabled: v })} label={t('s_escalation')} desc={t('s_escalation_d')} />
      {settings.escalation.enabled && (
        <div className="row indent pomodoro-row">
          <label className="pomo">
            <small>{t('s_esc_line_after')}</small>
            <input
              type="number"
              min={1}
              max={99}
              value={settings.escalation.telegramAfter}
              onChange={(e) => set('escalation', { ...settings.escalation, telegramAfter: Math.max(1, Math.floor(Number(e.target.value)) || 3) })}
            />
          </label>
          <label className="pomo">
            <small>{t('s_esc_popup_after')}</small>
            <input
              type="number"
              min={1}
              max={99}
              value={settings.escalation.popupAfter}
              onChange={(e) => set('escalation', { ...settings.escalation, popupAfter: Math.max(1, Math.floor(Number(e.target.value)) || 5) })}
            />
          </label>
          <span className="hint">{t('s_esc_unit')}</span>
        </div>
      )}
      <Toggle checked={settings.sounds} onChange={(v) => set('sounds', v)} label={t('s_sounds')} desc={t('s_sounds_d')} />
      <Toggle checked={settings.celebrate} onChange={(v) => set('celebrate', v)} label={t('s_celebrate')} desc={t('s_celebrate_d')} />
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
      {isElectron && (
        <>
          <Toggle checked={settings.digest.enabled} onChange={(v) => set('digest', { ...settings.digest, enabled: v })} label={t('s_digest')} desc={t('s_digest_d')} />
          {settings.digest.enabled && (
            <div className="row indent">
              <input type="time" value={settings.digest.time} onChange={(e) => e.target.value && set('digest', { ...settings.digest, time: e.target.value })} />
            </div>
          )}
          <Toggle checked={settings.digest.evening} onChange={(v) => set('digest', { ...settings.digest, evening: v })} label={t('s_digest_evening')} desc={t('s_digest_evening_d')} />
          {settings.digest.evening && (
            <div className="row indent">
              <input type="time" value={settings.digest.eveningTime} onChange={(e) => e.target.value && set('digest', { ...settings.digest, eveningTime: e.target.value })} />
            </div>
          )}
        </>
      )}

      {platform.desktop && <DesktopSection desktop={platform.desktop} settings={settings} onChange={onChange} />}

      {isElectron && <TelegramSection settings={settings} onChange={onChange} />}

      {cal.available && <CalendarSettings settings={settings} tasks={data.tasks} cal={cal} onChange={onChange} />}

      {platform.sync && <SyncSettings api={platform.sync} settings={settings} onChange={onChange} />}

      <BackupSection data={data} onImport={onImport} />
      {platform.desktop && <AutoBackupSection desktop={platform.desktop} settings={settings} onChange={onChange} />}

      <div className="field">
        <span>{t('s_shortcuts')}</span>
        <p className="hint">{t('s_shortcuts_d')}</p>
      </div>

      <AboutSection settings={settings} onChange={onChange} />

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
    </Modal>
  )
}

/** JSON yedek: dışa aktar / içe aktar (içe aktarma mevcut veriyi değiştirir, onay ister). */
function BackupSection({ data, onImport }: { data: AppData; onImport(d: AppData): void }) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<AppData | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const exportJson = () => downloadJson(`hyperdo-backup-${dateStamp()}.json`, data)

  const pick = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as Partial<AppData>
      if (!Array.isArray(parsed.tasks)) throw new Error('no tasks')
      setPending({
        tasks: parsed.tasks,
        settings: { ...data.settings, ...(parsed.settings ?? {}) },
        hyperFocus: parsed.hyperFocus ?? null,
        focusLog: parsed.focusLog ?? [],
        dailyDone: parsed.dailyDone ?? {},
        deleted: parsed.deleted ?? [],
      })
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

interface DesktopProps {
  desktop: DesktopApi
  settings: Settings
  onChange(s: Settings): void
}

/** Settings → Desktop (Electron only): launch at login + global quick-add shortcut with its registration status. */
function DesktopSection({ desktop, settings, onChange }: DesktopProps) {
  const t = useT()
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v })
  const [status, setStatus] = useState<ShortcutStatus | null>(null)
  const [mini, setMini] = useState(false)
  // The text field is edited freely; the setting (and the registration) follows on blur / Enter.
  const [draft, setDraft] = useState(settings.quickAddShortcut)
  useEffect(() => setDraft(settings.quickAddShortcut), [settings.quickAddShortcut])

  useEffect(() => {
    let alive = true
    void desktop.shortcutStatus().then((s) => alive && setStatus(s))
    void desktop.miniVisible().then((v) => alive && setMini(v))
    const off = desktop.onShortcutStatus(setStatus)
    const offMini = desktop.onMiniVisible(setMini)
    return () => {
      alive = false
      off()
      offMini()
    }
  }, [desktop])

  const commit = () => {
    const v = draft.trim()
    if (v !== settings.quickAddShortcut) set('quickAddShortcut', v)
  }
  const statusLine = !status
    ? null
    : !status.accelerator
      ? t('shortcut_off')
      : status.ok
        ? t('shortcut_ok', { acc: status.accelerator })
        : t('shortcut_fail', { acc: status.accelerator, e: status.error || t('shortcut_taken') })

  return (
    <div className="desktop-section">
      <div className="field">
        <span>{t('s_desktop')}</span>
      </div>
      <Toggle checked={settings.launchAtLogin} onChange={(v) => set('launchAtLogin', v)} label={t('s_launch')} desc={t('s_launch_d')} />
      <Toggle checked={mini} onChange={() => void desktop.toggleMini()} label={t('mini_window')} desc={t('mini_window_d')} />
      <div className="field">
        <span>{t('s_quick_shortcut')}</span>
        <div className="row shortcut-row">
          <input
            className="mono"
            value={draft}
            spellCheck={false}
            placeholder={DEFAULT_SETTINGS.quickAddShortcut}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
          />
          <button type="button" className="ghost small" onClick={() => set('quickAddShortcut', DEFAULT_SETTINGS.quickAddShortcut)}>
            ↺ {t('shortcut_reset')}
          </button>
        </div>
        {statusLine && <p className={status?.ok || !status?.accelerator ? 'hint' : 'hint error'}>{statusLine}</p>}
        <p className="hint">{t('s_quick_shortcut_d')}</p>
      </div>
    </div>
  )
}

/** Settings → Backup (Electron only): automatic daily copies, folder and the time of the last one. */
function AutoBackupSection({ desktop, settings, onChange }: DesktopProps) {
  const t = useT()
  const lang = useLang()
  const [info, setInfo] = useState<BackupInfo | null>(null)

  useEffect(() => {
    let alive = true
    void desktop.backupInfo().then((i) => alive && setInfo(i))
    return () => {
      alive = false
    }
  }, [desktop, settings.autoBackup])

  return (
    <div className="autobackup">
      <Toggle checked={settings.autoBackup} onChange={(v) => onChange({ ...settings, autoBackup: v })} label={t('s_autobackup')} desc={t('s_autobackup_d')} />
      {info && (
        <div className="indent backup-info">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className="hint">
              {t('backup_folder')}: <code>{info.dir}</code>
            </span>
            <button type="button" className="ghost small" onClick={() => void desktop.openBackups()}>
              📂 {t('backup_open')}
            </button>
          </div>
          <p className="hint">{info.lastAt ? t('backup_last', { t: new Date(info.lastAt).toLocaleString(LOCALE[lang], { dateStyle: 'medium', timeStyle: 'short' }) }) : t('backup_never')}</p>
        </div>
      )}
    </div>
  )
}

/** Version injected at build time (both Vite configs); '' under tools that do not define it. */
const BUILD_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

/** One line for the updater state (Settings → About and the toast share the wording). */
function updateStatusLine(t: ReturnType<typeof useT>, s: UpdateStatus): string {
  const v = s.version ?? '?'
  switch (s.status) {
    case 'unavailable':
      return t('update_unavailable')
    case 'checking':
      return t('update_checking')
    case 'available':
      return t('update_available', { v })
    case 'not-available':
      return t('update_not_available')
    case 'downloading':
      return t('update_downloading', { v, p: s.percent ?? 0 })
    case 'downloaded':
      return t('update_downloaded', { v })
    case 'error':
      return t('update_error', { e: s.error ?? '?' })
    default:
      return t('update_idle')
  }
}

/**
 * Settings → About (#18): version on every platform; "Check for updates" with the live updater state and the
 * auto-update toggle on the desktop app (the PWA and the Android app are updated by hand).
 */
function AboutSection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const t = useT()
  const desktop = platform.desktop
  const [version, setVersion] = useState(BUILD_VERSION)
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!desktop) return
    let alive = true
    void desktop.appVersion().then((v) => alive && v && setVersion(v))
    void desktop.updateStatus().then((s) => alive && setStatus(s))
    const off = desktop.onUpdateStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [desktop])

  const check = async () => {
    if (!desktop) return
    setBusy(true)
    try {
      setStatus(await desktop.checkForUpdates())
    } finally {
      setBusy(false)
    }
  }

  const line = status ? updateStatusLine(t, status) : null

  return (
    <div className="about-section">
      <div className="field">
        <span>{t('s_about')}</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="hint">Hyper Do {version && t('about_version', { v: version })}</span>
          {desktop && (
            <button type="button" className="ghost small" disabled={busy || status?.status === 'checking' || status?.status === 'downloading'} onClick={() => void check()}>
              ⟳ {t('update_check')}
            </button>
          )}
          {desktop && status?.status === 'downloaded' && (
            <button type="button" className="mini" onClick={() => void desktop.installUpdate()}>
              {t('update_install')}
            </button>
          )}
        </div>
        {line && <p className={status?.status === 'error' ? 'hint error' : 'hint'}>{line}</p>}
        {!desktop && <p className="hint">{t('about_manual_update')}</p>}
      </div>
      {desktop && <Toggle checked={settings.autoUpdate} onChange={(v) => onChange({ ...settings, autoUpdate: v })} label={t('s_autoupdate')} desc={t('s_autoupdate_d')} />}
    </div>
  )
}

/**
 * Settings → Telegram (Electron only): token, live bot status, pairing code + t.me link while nothing is linked,
 * test / unlink. Unlinking clears the chat and the code; the main process generates a fresh code on the next save.
 */
function TelegramSection({ settings, onChange }: { settings: Settings; onChange(s: Settings): void }) {
  const t = useT()
  const lang = useLang()
  const tg = settings.telegram
  const setTg = (patch: Partial<Settings['telegram']>) => onChange({ ...settings, telegram: { ...tg, ...patch } })
  const [result, setResult] = useState<string | null>(null)
  const [status, setStatus] = useState<TelegramStatus | null>(null)

  // Platforms without a bot have neither member; the section is then shown without a status line.
  useEffect(() => {
    if (!platform.telegramStatus || !platform.onTelegramStatus) return
    let alive = true
    void platform.telegramStatus().then((s) => alive && setStatus(s))
    const off = platform.onTelegramStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  const test = async () => {
    setResult('…')
    const r = await platform.telegramTest?.()
    if (!r) return setResult(null)
    setResult(r.ok ? t('tg_test_ok') : t('tg_test_fail', { e: r.error ?? '?' }))
  }

  const statusLine = !status
    ? null
    : status.state === 'off'
      ? t('tg_status_off')
      : status.state === 'starting'
        ? t('tg_status_starting')
        : status.state === 'error'
          ? t('tg_status_error', { e: status.error ?? '?' })
          : t('tg_status_running', { u: status.username || tg.botUsername || '?' }) +
            (status.lastPollAt ? ` · ${t('tg_status_poll', { t: new Date(status.lastPollAt).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' }) })}` : '')
  const username = tg.botUsername || status?.username || ''

  return (
    <div className="tg-section">
      <Toggle checked={tg.enabled} onChange={(v) => setTg({ enabled: v })} label={t('s_telegram')} desc={t('s_telegram_d')} />
      {tg.enabled && (
        <div className="indent tg-body">
          <label className="field">
            <span>{t('tg_token')}</span>
            <input type="password" className="mono" value={tg.token} placeholder={t('tg_token_ph')} onChange={(e) => setTg({ token: e.target.value.trim() })} autoComplete="off" />
          </label>
          {statusLine && <p className={status?.state === 'error' ? 'tg-status error' : status?.state === 'running' ? 'tg-status ok' : 'tg-status'}>{statusLine}</p>}
          <p className="hint">{t('tg_steps')}</p>
          {tg.chatId ? (
            <div className="row">
              <span className="tg-status ok">{t('tg_linked', { id: tg.chatId })}</span>
              <button type="button" className="ghost small" onClick={() => setTg({ chatId: '', pairCode: '' })}>
                {t('tg_unlink')}
              </button>
            </div>
          ) : tg.pairCode ? (
            <div className="tg-pair">
              <span className="hint">{t('tg_pair_code')}</span>
              <code className="tg-code">{tg.pairCode}</code>
              <p className="hint">{t('tg_pair_hint', { code: tg.pairCode })}</p>
              {username && (
                <a className="ghost small btn-link" href={`https://t.me/${username}?start=${tg.pairCode}`} target="_blank" rel="noreferrer">
                  ✈️ {t('tg_open_bot')}
                </a>
              )}
            </div>
          ) : (
            <div className="row">
              <span className="tg-status">{t('tg_waiting')}</span>
            </div>
          )}
          <div className="row">
            <button type="button" className="ghost small" disabled={!tg.token || !tg.chatId} onClick={() => void test()}>
              {t('tg_test')}
            </button>
            {result && <span className="hint">{result}</span>}
          </div>
          <Toggle checked={tg.tidy} onChange={(v) => setTg({ tidy: v })} label={t('tg_tidy')} desc="" />
          <Toggle checked={tg.onlyWhenIdle} onChange={(v) => setTg({ onlyWhenIdle: v })} label={t('tg_only_idle')} desc={t('tg_idle_min', { n: tg.idleMinutes })} />
          {tg.onlyWhenIdle && (
            <div className="row indent pomodoro-row">
              <label className="pomo">
                <small>{t('tg_idle_label')}</small>
                <input type="number" min={1} max={720} value={tg.idleMinutes} onChange={(e) => setTg({ idleMinutes: Math.max(1, Math.floor(Number(e.target.value)) || 5) })} />
              </label>
            </div>
          )}
          {platform.desktop && <MiniAppBlock desktop={platform.desktop} settings={settings} onChange={onChange} />}
        </div>
      )}
    </div>
  )
}

/** One line for the Mini App server / tunnel state. */
function miniAppStatusLine(t: ReturnType<typeof useT>, s: MiniAppStatus): string {
  switch (s.state) {
    case 'downloading':
      return t('miniapp_status_downloading', { p: s.progress === null ? '' : `${s.progress}%` })
    case 'starting':
      return t('miniapp_status_starting')
    case 'up':
      return t('miniapp_status_up')
    case 'error':
      return t('miniapp_status_error', { e: s.error ?? '?' })
    default:
      return t('miniapp_status_off')
  }
}

/**
 * Settings → Telegram → Mini App (Phase D, Electron only): mode (off / Cloudflare tunnel / own URL), live status
 * with the public URL (copy button), the local port, download progress, the manual URL field with inline https
 * validation and "Restart tunnel".
 */
function MiniAppBlock({ desktop, settings, onChange }: DesktopProps) {
  const t = useT()
  const ma = settings.miniApp
  const setMa = (patch: Partial<MiniAppSettings>) => onChange({ ...settings, miniApp: { ...ma, ...patch } })
  const [status, setStatus] = useState<MiniAppStatus | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  // The URL field is edited freely; the setting follows on blur / Enter when it is a valid https:// address.
  const [draft, setDraft] = useState(ma.publicUrl)
  useEffect(() => setDraft(ma.publicUrl), [ma.publicUrl])

  useEffect(() => {
    let alive = true
    void desktop.miniAppStatus().then((s) => alive && setStatus(s))
    const off = desktop.onMiniAppStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [desktop])

  const trimmed = draft.trim().replace(/\/+$/, '')
  const draftValid = trimmed === '' || /^https:\/\/[^\s/]+/i.test(trimmed)
  const commitUrl = () => {
    if (!draftValid) return
    if (trimmed !== ma.publicUrl) setMa({ publicUrl: trimmed })
  }
  const copy = () => {
    if (!status?.url) return
    void navigator.clipboard?.writeText(status.url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  const restart = async () => {
    setBusy(true)
    try {
      await desktop.miniAppRestart()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="miniapp-block">
      <div className="field">
        <span>{t('miniapp_title')}</span>
        <p className="hint">{t('miniapp_d')}</p>
      </div>
      <label className="field">
        <span>{t('miniapp_mode')}</span>
        <select value={ma.mode} onChange={(e) => setMa({ mode: e.target.value as MiniAppMode })}>
          {MINI_APP_MODES.map((m) => (
            <option key={m} value={m}>
              {t(`miniapp_mode_${m}` as const)}
            </option>
          ))}
        </select>
      </label>
      {ma.mode !== 'off' && status && (
        <>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <span className={status.state === 'error' ? 'tg-status error' : status.state === 'up' ? 'tg-status ok' : 'tg-status'}>{miniAppStatusLine(t, status)}</span>
            {status.url && (
              <>
                <code className="miniapp-url">{status.url}</code>
                <button type="button" className="ghost small" onClick={copy}>
                  {copied ? t('miniapp_copied') : `📋 ${t('miniapp_copy')}`}
                </button>
              </>
            )}
            {status.port > 0 && <span className="hint">· {t('miniapp_port', { n: status.port })}</span>}
          </div>
          {ma.mode === 'manual' && (
            <div className="field">
              <span>{t('miniapp_manual_url')}</span>
              <input
                className="mono"
                value={draft}
                spellCheck={false}
                placeholder="https://…"
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitUrl()
                }}
              />
              {!draftValid && <p className="hint error">{t('miniapp_url_https')}</p>}
              {status.port > 0 && <p className="hint">{t('miniapp_manual_hint', { n: status.port })}</p>}
            </div>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="ghost small" disabled={busy || status.state === 'downloading'} onClick={() => void restart()}>
              ⟳ {t('miniapp_restart')}
            </button>
          </div>
          <p className="hint">{t('miniapp_hint')}</p>
        </>
      )}
    </div>
  )
}
