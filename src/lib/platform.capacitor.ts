/**
 * Android (Capacitor) uyarlaması.
 * Uygulama kapalıyken de dürtebilmek için hatırlatmalar yerel bildirim olarak ÖNCEDEN planlanır:
 * her kayıtta ve uygulama öne geldiğinde bekleyen bildirimler iptal edilip yeniden kurulur.
 * Bildirim düğmeleri (Bitirdim / 30 dk / Odak), "Paylaş → Hyper Do" ve Google girişi (Custom Tab) de burada.
 */
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import type { AppData, HyperDoApi, NotifyPermission, SharePayload } from './types'
import type { Lang } from './i18n'
import { buildNotification, focusSuppressedUntil, planReminderTimes } from './reminder'
import { translate } from './i18n'
import { browserDefaultSettings, parseAppData, DATA_STORAGE_KEY } from './data'
import { bumpChanged } from './tasks'
import { createEmitter } from './emitter'
import { createBrowserCalendar } from './platform.calendar'
import { SYNC_STATE_KEY, createBrowserSync } from './platform.sync'
import { applyNotificationAction } from './stats'
import { parseShareEvent } from './share'
import { ANDROID_REDIRECT_URI, buildAuthUrl, exchangeCode, parseOAuthRedirect, pkcePair, randomToken } from './gcal'
import type { CalendarSync } from './calsync'

const PER_TASK_MAX = 48 // görev başına en fazla planlanan bildirim
const TOTAL_MAX = 400 // Android alarm sınırının (500) altında kal
const HORIZON_MS = 48 * 3_600_000 // 48 saat ileriye planla
const TEST_ID = 999_999
/** Action type carrying the Done / Snooze 30 / Focus buttons (registered with translated titles). */
const ACTION_TYPE_ID = 'HYPERDO_TASK'
/** Window event fired by MainActivity.java for "Share → Hyper Do" (`triggerWindowJSEvent`). */
const SHARE_EVENT = 'hyperdoShare'
/** The same share payload arriving twice within this window (onCreate + onResume) is delivered once. */
const SHARE_DEDUPE_MS = 2000
/** Preferences key holding the PKCE verifier + state while the Google login runs in the Custom Tab. */
const AUTH_KEY = 'hyperdo-google-auth'

// Görev kimliği (string) → kararlı sayısal bildirim kimliği tabanı
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 20_000) * 100 // her görev için 100'lük blok
}

export function createCapacitorApi(): HyperDoApi {
  const defaults = browserDefaultSettings()
  let data: AppData = parseAppData(null, defaults)
  const focus = createEmitter<string>()
  const reminded = createEmitter<string>()
  const changed = createEmitter<AppData>()
  const share = createEmitter<SharePayload>()
  let perm: NotifyPermission = 'default'
  let scheduling: Promise<void> | null = null
  let actionsLang: Lang | null = null

  const persist = () => Preferences.set({ key: DATA_STORAGE_KEY, value: JSON.stringify(data) }).catch(() => {})

  /**
   * Platform-side change (notification button, calendar import): save, tell the UI, rebuild the plan.
   * Replaced task objects get their `updatedAt` bumped (#16) unless the change *is* the sync result (`bump: false`).
   */
  function mutate(fn: (d: AppData) => AppData, { bump = true } = {}) {
    let next = fn(data)
    if (bump && next.tasks !== data.tasks) next = { ...next, tasks: bumpChanged(data.tasks, next.tasks) }
    data = next
    void persist()
    changed.emit(data)
    void reschedule()
    if (bump) sync.engine.onDataSaved()
  }

  // ---- Cross-device sync (#16): WebDAV through the (CapacitorHttp-backed) fetch; state + credentials in Preferences ----
  const sync = createBrowserSync(
    () => data,
    (fn) => mutate(fn, { bump: false }),
    {
      load: () => Preferences.get({ key: SYNC_STATE_KEY }).then((r) => r.value ?? null, () => null),
      save: (json) => Preferences.set({ key: SYNC_STATE_KEY, value: json }).catch(() => {}),
    },
  )

  // ---- Google Calendar (#14): Custom Tab + custom-scheme redirect, secret-less Android OAuth client ----
  const androidClientId = () => data.settings.calendar.google.androidClientId.trim()

  async function androidConnect(): Promise<{ ok: boolean; error?: string }> {
    const clientId = androidClientId()
    if (!clientId) return { ok: false, error: 'client_id' }
    try {
      const { verifier, challenge } = await pkcePair()
      const state = randomToken(16)
      await Preferences.set({ key: AUTH_KEY, value: JSON.stringify({ verifier, state }) })
      await Browser.open({ url: buildAuthUrl({ clientId, redirectUri: ANDROID_REDIRECT_URI, challenge, state }) })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  const calendar = createBrowserCalendar(() => data, mutate, {
    googleSupported: () => androidClientId().length > 0,
    googleClient: (g) => ({ clientId: g.androidClientId, clientSecret: '' }),
    connect: androidConnect,
  })

  /** `com.hyperdo.app:/oauth2redirect?code=…&state=…` arrived (appUrlOpen): finish the login through the sync engine. */
  async function finishAndroidLogin(sync: CalendarSync, url: string) {
    void Browser.close().catch(() => {}) // Android Custom Tabs close by themselves; the call is iOS-only
    const r = parseOAuthRedirect(url)
    if (!r) return
    let saved: { verifier: string; state: string } | null = null
    try {
      saved = JSON.parse((await Preferences.get({ key: AUTH_KEY })).value ?? 'null')
      await Preferences.remove({ key: AUTH_KEY })
    } catch {
      /* ignore */
    }
    if (r.error) return sync.setGoogleError(r.error)
    if (!saved || saved.state !== r.state || !r.code) return sync.setGoogleError('state_mismatch')
    try {
      const tokens = await exchangeCode({ clientId: androidClientId(), code: r.code, verifier: saved.verifier, redirectUri: ANDROID_REDIRECT_URI })
      await sync.completeGoogleLogin(tokens)
    } catch (e) {
      sync.setGoogleError((e as Error).message)
    }
  }

  CapApp.addListener('appUrlOpen', ({ url }) => {
    if (typeof url === 'string' && url.startsWith(ANDROID_REDIRECT_URI)) void finishAndroidLogin(calendar.sync, url)
  })

  async function refreshPermission() {
    try {
      const r = await LocalNotifications.checkPermissions()
      perm = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'default'
    } catch {
      perm = 'unsupported'
    }
    return perm
  }

  /** Registers the Done / Snooze 30 / Focus buttons with titles in the current language (again when it changes). */
  async function registerActions() {
    const lang = data.settings.language
    if (actionsLang === lang) return
    try {
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: ACTION_TYPE_ID,
            actions: [
              { id: 'done', title: translate(lang, 'tg_btn_done') },
              { id: 'snooze30', title: translate(lang, 'notif_snooze_30') },
              { id: 'focus', title: translate(lang, 'tg_btn_focus') },
            ],
          },
        ],
      })
      actionsLang = lang
    } catch {
      /* older plugin / platform without action support: notifications still work without buttons */
    }
  }

  /** Tüm bekleyen bildirimleri iptal edip güncel görevlere göre yeniden planlar. */
  async function reschedule() {
    if (perm !== 'granted') return
    const run = async () => {
      await registerActions()
      try {
        const pending = await LocalNotifications.getPending()
        if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
      } catch {
        /* yoksay */
      }
      const now = Date.now()
      const active = data.tasks.filter((t) => t.completedAt === null && t.remindEveryMin > 0)
      // Öncelik: odak > gecikmiş > yüksek öncelik; kota dolarsa en az önemliler düşer
      active.sort((a, b) => Number(b.focused) - Number(a.focused) || Number(b.dueAt !== null && b.dueAt < now) - Number(a.dueAt !== null && a.dueAt < now))
      const perTask = Math.max(4, Math.min(PER_TASK_MAX, Math.floor(TOTAL_MAX / Math.max(1, active.length))))
      const list: LocalNotificationSchema[] = []
      for (const task of active) {
        const base = hashId(task.id)
        // Hyper Focus work round: other tasks stay quiet until it ends (the plan is rebuilt on every save anyway)
        planReminderTimes(task, data.settings, now, perTask, HORIZON_MS, focusSuppressedUntil(data, task.id, now)).forEach((p, i) => {
          const { title, body } = buildNotification(task, p.overdue, data.settings, p.at)
          list.push({
            id: base + i,
            title,
            body,
            schedule: { at: new Date(p.at), allowWhileIdle: true },
            extra: { taskId: task.id },
            group: task.id,
            ongoing: false,
            autoCancel: true,
            actionTypeId: ACTION_TYPE_ID,
          })
        })
      }
      if (list.length) await LocalNotifications.schedule({ notifications: list })
    }
    scheduling = (scheduling ?? Promise.resolve()).then(run).catch(() => {})
    return scheduling
  }

  /** Cancels every pending notification of one task right away (the full reschedule follows, but nothing may fire in between). */
  async function cancelTask(taskId: string) {
    try {
      const pending = await LocalNotifications.getPending()
      const mine = pending.notifications.filter((n) => n.extra?.taskId === taskId).map((n) => ({ id: n.id }))
      if (mine.length) await LocalNotifications.cancel({ notifications: mine })
    } catch {
      /* yoksay */
    }
  }

  // Bildirim düğmesi ya da dokunma (#2b): done / snooze30 / focus veriyi değiştirir, tap görevi vurgular
  LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const id = e.notification.extra?.taskId as string | undefined
    if (!id) return
    if (e.actionId === 'done' || e.actionId === 'snooze30' || e.actionId === 'focus') {
      if (e.actionId === 'done') void cancelTask(id)
      mutate((d) => applyNotificationAction(d, id, e.actionId))
      if (e.actionId === 'focus') focus.emit(id)
    } else {
      focus.emit(id)
    }
  })
  // Uygulama açıkken bildirim geldi → listede vurgula
  LocalNotifications.addListener('localNotificationReceived', (n) => {
    const id = n.extra?.taskId as string | undefined
    if (id) reminded.emit(id)
  })
  // Öne gelince planı tazele (geçen süre kadar ileriye uzat)
  CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void refreshPermission().then(() => reschedule())
  })

  // ---- Share target (#15): MainActivity fires `hyperdoShare` with { text, subject } ----
  //      The payload is kept until the UI subscribes (a cold start delivers it before React has mounted).
  let pendingShare: SharePayload | null = null
  let shareSubs = 0
  let lastShare: { key: string; at: number } | null = null
  window.addEventListener(SHARE_EVENT, (e) => {
    const payload = parseShareEvent(e)
    if (!payload) return
    const key = JSON.stringify(payload)
    const now = Date.now()
    if (lastShare && lastShare.key === key && now - lastShare.at < SHARE_DEDUPE_MS) return
    lastShare = { key, at: now }
    if (shareSubs > 0) share.emit(payload)
    else pendingShare = payload
  })

  return {
    kind: 'capacitor',
    async load() {
      try {
        const { value } = await Preferences.get({ key: DATA_STORAGE_KEY })
        data = parseAppData(value, defaults)
      } catch {
        /* varsayılan */
      }
      await refreshPermission()
      await registerActions()
      void reschedule()
      calendar.sync.start()
      void sync.engine.start()
      return data
    },
    async save(incoming) {
      data = incoming
      await persist()
      void reschedule() // re-registers the action titles too when the language changed
      calendar.sync.onDataSaved()
      sync.engine.onDataSaved()
    },
    calendar: calendar.api,
    sync: sync.api,
    async notifyTest() {
      if (perm !== 'granted') return
      const lang = data.settings.language
      await registerActions()
      await LocalNotifications.schedule({
        notifications: [{ id: TEST_ID, title: translate(lang, 'notif_test_title'), body: translate(lang, 'notif_test_body'), schedule: { at: new Date(Date.now() + 1500) } }],
      })
    },
    permission: () => perm,
    async requestPermission() {
      try {
        const r = await LocalNotifications.requestPermissions()
        perm = r.display === 'granted' ? 'granted' : 'denied'
      } catch {
        perm = 'unsupported'
      }
      if (perm === 'granted') void reschedule()
      return perm
    },
    // Android 12+: without the "Alarms & reminders" permission the plugin falls back to inexact alarms and the
    // system may hold reminders back for minutes. USE_EXACT_ALARM in the manifest grants it at install on 13+;
    // this is the safety net for devices where it was revoked.
    async exactAlarms() {
      try {
        const r = await LocalNotifications.checkExactNotificationSetting()
        return r.exact_alarm !== 'denied'
      } catch {
        return true
      }
    },
    async requestExactAlarms() {
      try {
        const r = await LocalNotifications.changeExactNotificationSetting()
        const ok = r.exact_alarm !== 'denied'
        if (ok) void reschedule()
        return ok
      } catch {
        return true
      }
    },
    onFocusTask: focus.on,
    onReminded: reminded.on,
    onDataChanged: changed.on,
    onShare(cb) {
      const off = share.on(cb)
      shareSubs++
      if (pendingShare) {
        const p = pendingShare
        pendingShare = null
        setTimeout(() => cb(p), 0)
      }
      return () => {
        shareSubs--
        off()
      }
    },
  }
}
