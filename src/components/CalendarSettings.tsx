import { useEffect, useState } from 'react'
import type { CalendarFeed, Settings, Task } from '../lib/types'
import type { CalendarState } from '../lib/useCalendar'
import { platform } from '../lib/platform'
import { uid } from '../lib/tasks'
import { relativeMinutes } from '../lib/dates'
import { downloadAllTasksIcs } from '../lib/calendar-links'
import { webRedirectUri } from '../lib/platform.calendar'
import { useLang, useT } from '../lib/useT'

interface Props {
  settings: Settings
  tasks: Task[]
  cal: CalendarState
  onChange(s: Settings): void
}

const FEED_COLORS = ['#38bdf8', '#a78bfa', '#2dd4bf', '#ff5fa2', '#a3e635', '#ffb03a', '#ff8a3d', '#4fa3ff']

/** Settings → Calendars: Google Calendar (OAuth), ICS/webcal feeds, .ics export. */
export default function CalendarSettings({ settings, tasks, cal, onChange }: Props) {
  const t = useT()
  const lang = useLang()
  const c = settings.calendar
  const setCal = (patch: Partial<Settings['calendar']>) => onChange({ ...settings, calendar: { ...c, ...patch } })
  const setGoogle = (patch: Partial<Settings['calendar']['google']>) => setCal({ google: { ...c.google, ...patch } })
  const status = cal.status
  const g = status?.google
  const isElectron = platform.kind === 'electron'
  const isWeb = platform.kind === 'web'

  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const h = setInterval(() => setTick((x) => x + 1), 30_000)
    return () => clearInterval(h)
  }, [])
  void tick

  const connect = async () => {
    if (!cal.api) return
    setBusy(true)
    setLocalError(null)
    const r = await cal.api.connectGoogle()
    setBusy(false)
    if (!r.ok) setLocalError(r.error === 'client_id' ? t('cal_err_client_id') : r.error === 'timeout' ? t('cal_err_timeout') : r.error === 'busy' ? t('cal_err_busy') : r.error === 'unsupported' ? t('cal_unsupported') : t('cal_error', { e: r.error ?? '?' }))
  }

  const googleError = g?.error === 'reconnect' ? t('cal_reconnect') : g?.error ? t('cal_error', { e: g.error }) : null
  const syncLine = status?.syncing ? t('cal_syncing') : status?.syncedAt ? t('cal_synced', { t: relativeMinutes(Date.now() - status.syncedAt, lang) }) : t('cal_never')

  return (
    <div className="cal-settings">
      <div className="field">
        <span>{t('cal_section')}</span>
      </div>
      <Toggle checked={c.autoImport} onChange={(v) => setCal({ autoImport: v })} label={t('s_cal_import')} desc={t('s_cal_import_d')} />
      <Toggle checked={c.showEvents} onChange={(v) => setCal({ showEvents: v })} label={t('s_cal_show')} desc={t('s_cal_show_d')} />

      {/* ---- Google ---- */}
      <div className="cal-block">
        <div className="cal-block-head">
          <b>{t('cal_google')}</b>
          {g?.connected ? <span className="tg-status ok">{t('cal_connected', { email: g.email || '✓' })}</span> : <span className="tg-status">{t('cal_not_connected')}</span>}
        </div>

        {!status?.googleSupported ? (
          <p className="hint">{t('cal_unsupported')}</p>
        ) : g?.connected ? (
          <>
            {g.calendars.length > 0 && (
              <div className="field">
                <span>{t('cal_show_cals')}</span>
                <div className="cal-list">
                  {g.calendars.map((x) => {
                    const hidden = c.google.hiddenCalendarIds.includes(x.id)
                    return (
                      <label key={x.id} className={hidden ? 'cal-item off' : 'cal-item'}>
                        <input type="checkbox" checked={!hidden} onChange={(e) => setGoogle({ hiddenCalendarIds: e.target.checked ? c.google.hiddenCalendarIds.filter((y) => y !== x.id) : [...c.google.hiddenCalendarIds, x.id] })} />
                        <span className="cal-dot" style={{ ['--c' as string]: x.color }} />
                        <span>{x.name}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
            <Toggle checked={c.google.pushTasks} onChange={(v) => setGoogle({ pushTasks: v })} label={t('cal_push')} desc={t('cal_push_d')} />
            <div className="row">
              <button type="button" className="ghost small" disabled={status?.syncing} onClick={() => void cal.api?.syncNow()}>
                ⟳ {t('cal_sync_now')}
              </button>
              <span className="hint">{syncLine}</span>
              <button type="button" className="ghost small" onClick={() => void cal.api?.disconnectGoogle()}>
                {t('cal_disconnect')}
              </button>
            </div>
            {googleError && <p className="hint error">{googleError}</p>}
          </>
        ) : (
          <>
            <div className="grid2">
              <label className="field">
                <span>{t('cal_client_id')}</span>
                <input className="mono" value={c.google.clientId} placeholder="xxxx.apps.googleusercontent.com" onChange={(e) => setGoogle({ clientId: e.target.value.trim() })} autoComplete="off" />
              </label>
              <label className="field">
                <span>{t('cal_client_secret')}</span>
                <input className="mono" type="password" value={c.google.clientSecret} placeholder="GOCSPX-…" onChange={(e) => setGoogle({ clientSecret: e.target.value.trim() })} autoComplete="off" />
              </label>
            </div>
            <p className="hint">{t('cal_google_steps', { type: isElectron ? t('cal_type_desktop') : t('cal_type_web') })}</p>
            {isWeb && (
              <p className="hint">
                {t('cal_redirect_hint', { uri: '' })} <code className="mono">{webRedirectUri()}</code>
              </p>
            )}
            <div className="row">
              <button type="button" className="primary" disabled={busy || !c.google.clientId} onClick={() => void connect()}>
                {busy ? t('cal_connecting') : t('cal_connect')}
              </button>
              {(localError || googleError) && <span className="hint error">{localError ?? googleError}</span>}
            </div>
          </>
        )}
      </div>

      {/* ---- ICS feeds ---- */}
      <div className="cal-block">
        <div className="cal-block-head">
          <b>{t('cal_feeds')}</b>
        </div>
        <p className="hint">{t('cal_feeds_d')}</p>
        {c.feeds.length > 0 && (
          <div className="cal-list">
            {c.feeds.map((f) => {
              const st = status?.feeds[f.id]
              return (
                <div key={f.id} className={f.enabled ? 'cal-item feed' : 'cal-item feed off'}>
                  <input type="checkbox" checked={f.enabled} onChange={(e) => setCal({ feeds: c.feeds.map((x) => (x.id === f.id ? { ...x, enabled: e.target.checked } : x)) })} />
                  <input
                    type="color"
                    className="cal-color"
                    value={f.color}
                    title={f.color}
                    onChange={(e) => setCal({ feeds: c.feeds.map((x) => (x.id === f.id ? { ...x, color: e.target.value } : x)) })}
                  />
                  <input className="cal-feed-name" value={f.name} placeholder={t('cal_feed_name_ph')} onChange={(e) => setCal({ feeds: c.feeds.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)) })} />
                  <span className="cal-feed-url mono" title={f.url}>
                    {f.url.replace(/^https?:\/\//, '').slice(0, 42)}
                    {f.url.length > 50 ? '…' : ''}
                  </span>
                  <span className={st?.error ? 'hint error' : 'hint'}>{st ? (st.error ? st.error : t('cal_feed_events', { n: st.count })) : ''}</span>
                  <button type="button" className="icon" title={t('delete')} onClick={() => setCal({ feeds: c.feeds.filter((x) => x.id !== f.id) })}>
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <AddFeed onAdd={(f) => setCal({ feeds: [...c.feeds, f] })} nextColor={FEED_COLORS[c.feeds.length % FEED_COLORS.length]} />
        <p className="hint">{t('cal_feed_where')}</p>
        {!isElectron && <p className="hint">{t('cal_web_cors')}</p>}
        {c.feeds.length > 0 && (
          <div className="row">
            <button type="button" className="ghost small" disabled={status?.syncing} onClick={() => void cal.api?.syncNow()}>
              ⟳ {t('cal_sync_now')}
            </button>
            <span className="hint">{syncLine}</span>
          </div>
        )}
      </div>

      {/* ---- export ---- */}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button type="button" className="ghost small" disabled={!tasks.some((x) => x.completedAt === null && x.dueAt !== null)} onClick={() => downloadAllTasksIcs(tasks)}>
          ⬇ {t('cal_export_ics')}
        </button>
        <span className="hint">{t('cal_export_ics_d')}</span>
      </div>
    </div>
  )
}

function AddFeed({ onAdd, nextColor }: { onAdd(f: CalendarFeed): void; nextColor: string }) {
  const t = useT()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const valid = /^(https?|webcal):\/\/\S+/i.test(url.trim())
  const add = () => {
    if (!valid) return
    onAdd({ id: uid(), name: name.trim(), url: url.trim(), color: nextColor, enabled: true })
    setName('')
    setUrl('')
  }
  return (
    <div className="row cal-add-feed">
      <input className="cal-feed-name" value={name} placeholder={t('cal_feed_name_ph')} onChange={(e) => setName(e.target.value)} />
      <input
        className="mono"
        value={url}
        placeholder={t('cal_feed_url_ph')}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            add()
          }
        }}
      />
      <button type="button" className="mini" disabled={!valid} onClick={add}>
        {t('add')}
      </button>
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
