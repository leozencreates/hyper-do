import { useEffect, useState } from 'react'
import { SYNC_MODES, type Settings, type SyncApi, type SyncMode, type SyncStatus } from '../lib/types'
import { relativeMinutes } from '../lib/dates'
import { useNow } from '../lib/hooks'
import { useLang, useT } from '../lib/useT'

interface Props {
  api: SyncApi
  settings: Settings
  onChange(s: Settings): void
}

/** Translates the engine's error codes; unknown text (file-system messages) is shown as is. */
function errorLine(t: ReturnType<typeof useT>, code: string): string {
  switch (code) {
    case 'not_configured':
      return t('sync_err_not_configured')
    case 'unauthorized':
      return t('sync_err_unauthorized')
    case 'conflict':
      return t('sync_err_conflict')
    case 'invalid_file':
      return t('sync_err_invalid_file')
    default: {
      const m = /^http_(\d+)$/.exec(code)
      return m ? t('sync_err_http', { n: m[1] }) : t('sync_err', { e: code })
    }
  }
}

/**
 * Settings → Sync (#16): Off / Folder / WebDAV, the folder or the file URL, write-only WebDAV credentials
 * (stored by the platform, never in AppData), status line and "Sync now". Folder mode only where the platform
 * offers a directory picker (Electron).
 */
export default function SyncSettings({ api, settings, onChange }: Props) {
  const t = useT()
  const lang = useLang()
  const s = settings.sync
  const setSync = (patch: Partial<Settings['sync']>) => onChange({ ...settings, sync: { ...s, ...patch } })
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [credsMsg, setCredsMsg] = useState<string | null>(null)
  const now = useNow(30_000) // keeps "last sync x min ago" fresh

  useEffect(() => {
    let alive = true
    void api.status().then((st) => alive && setStatus(st))
    const off = api.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [api])

  const modes = SYNC_MODES.filter((m) => m !== 'folder' || !!api.pickFolder)

  const pickFolder = async () => {
    const dir = await api.pickFolder?.()
    if (dir) setSync({ folder: dir })
  }

  const saveCreds = async () => {
    await api.setCredentials(user.trim(), pass)
    setPass('')
    setCredsMsg(t('sync_creds_saved'))
  }

  const sinceMs = status?.lastSyncAt ? now - status.lastSyncAt : 0
  const line = status?.syncing ? t('sync_syncing') : status?.lastSyncAt ? (sinceMs < 60_000 ? t('sync_last_now') : t('sync_last', { t: relativeMinutes(sinceMs, lang) })) : t('sync_never')
  const error = status?.lastError ? errorLine(t, status.lastError) : null

  return (
    <div className="sync-section">
      <div className="field">
        <span>{t('s_sync')}</span>
        <p className="hint">{t('sync_explain')}</p>
        <div className="seg">
          {modes.map((m: SyncMode) => (
            <button key={m} type="button" className={s.mode === m ? 'seg-btn active lang' : 'seg-btn'} onClick={() => setSync({ mode: m })}>
              {t(`sync_mode_${m}` as const)}
            </button>
          ))}
        </div>
      </div>

      {s.mode === 'folder' && (
        <div className="indent sync-body">
          <div className="field">
            <span>{t('sync_folder')}</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <code className="mono sync-path" title={s.folder}>
                {s.folder || t('sync_folder_none')}
              </code>
              <button type="button" className="ghost small" onClick={() => void pickFolder()}>
                📂 {t('sync_choose')}
              </button>
            </div>
            <p className="hint">{t('sync_folder_d')}</p>
          </div>
        </div>
      )}

      {s.mode === 'webdav' && (
        <div className="indent sync-body">
          <label className="field">
            <span>{t('sync_url')}</span>
            <input className="mono" type="url" inputMode="url" value={s.webdavUrl} placeholder={t('sync_url_ph')} onChange={(e) => setSync({ webdavUrl: e.target.value.trim() })} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
          </label>
          <p className="hint">{t('sync_url_d')}</p>
          <div className="grid2">
            <label className="field">
              <span>{t('sync_user')}</span>
              <input value={user} onChange={(e) => setUser(e.target.value)} autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>
                {t('sync_pass')}
                {status?.credentialsSaved && <span className="tg-status ok"> · {t('sync_pass_saved')}</span>}
              </span>
              <input type="password" value={pass} placeholder={status?.credentialsSaved ? '••••••••' : ''} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </label>
          </div>
          <div className="row">
            <button type="button" className="ghost small" disabled={!user.trim() && !pass} onClick={() => void saveCreds()}>
              {t('sync_save_creds')}
            </button>
            {credsMsg && <span className="hint">{credsMsg}</span>}
          </div>
          <p className="hint">{t('sync_creds_hint')}</p>
        </div>
      )}

      {s.mode !== 'off' && (
        <div className="indent sync-body">
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="ghost small" disabled={status?.syncing || status?.transport === null} onClick={() => void api.syncNow()}>
              {status?.syncing ? '⏳' : '⟳'} {t('sync_now')}
            </button>
            <span className="hint">{line}</span>
          </div>
          {error && <p className="hint error">{error}</p>}
        </div>
      )}
    </div>
  )
}
