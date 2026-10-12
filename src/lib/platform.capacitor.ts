/**
 * Android (Capacitor) uyarlaması.
 * Uygulama kapalıyken de dürtebilmek için hatırlatmalar yerel bildirim olarak ÖNCEDEN planlanır:
 * her kayıtta ve uygulama öne geldiğinde bekleyen bildirimler iptal edilip yeniden kurulur.
 */
import { App as CapApp } from '@capacitor/app'
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import { Preferences } from '@capacitor/preferences'
import { type AppData, type HyperDoApi } from './types'
import { buildNotification, planReminderTimes } from './reminder'
import { translate } from './i18n'
import { parseStored } from './platform.web'
import { createBrowserCalendar } from './platform.calendar'

const STORAGE_KEY = 'hyperdo-data'
const PER_TASK_MAX = 48 // görev başına en fazla planlanan bildirim
const TOTAL_MAX = 400 // Android alarm sınırının (500) altında kal
const HORIZON_MS = 48 * 3_600_000 // 48 saat ileriye planla
const TEST_ID = 999_999

// Görev kimliği (string) → kararlı sayısal bildirim kimliği tabanı
function hashId(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (Math.abs(h) % 20_000) * 100 // her görev için 100'lük blok
}

export function createCapacitorApi(): HyperDoApi {
  let data: AppData = parseStored(null)
  // Google blocks OAuth inside Android WebViews, so only ICS feeds are offered here; CapacitorHttp lifts CORS for them.
  const calendar = createBrowserCalendar(() => data, { googleSupported: false })
  const focusListeners = new Set<(id: string) => void>()
  const remindListeners = new Set<(id: string) => void>()
  let perm: ReturnType<HyperDoApi['permission']> = 'default'
  let scheduling: Promise<void> | null = null

  async function refreshPermission() {
    try {
      const r = await LocalNotifications.checkPermissions()
      perm = r.display === 'granted' ? 'granted' : r.display === 'denied' ? 'denied' : 'default'
    } catch {
      perm = 'unsupported'
    }
    return perm
  }

  /** Tüm bekleyen bildirimleri iptal edip güncel görevlere göre yeniden planlar. */
  async function reschedule() {
    if (perm !== 'granted') return
    const run = async () => {
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
        planReminderTimes(task, data.settings, now, perTask, HORIZON_MS).forEach((p, i) => {
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
          })
        })
      }
      if (list.length) await LocalNotifications.schedule({ notifications: list })
    }
    scheduling = (scheduling ?? Promise.resolve()).then(run).catch(() => {})
    return scheduling
  }

  // Bildirime dokunuldu → görevi vurgula
  LocalNotifications.addListener('localNotificationActionPerformed', (e) => {
    const id = e.notification.extra?.taskId as string | undefined
    if (id) focusListeners.forEach((cb) => cb(id))
  })
  // Uygulama açıkken bildirim geldi → listede vurgula
  LocalNotifications.addListener('localNotificationReceived', (n) => {
    const id = n.extra?.taskId as string | undefined
    if (id) remindListeners.forEach((cb) => cb(id))
  })
  // Öne gelince planı tazele (geçen süre kadar ileriye uzat)
  CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void refreshPermission().then(() => reschedule())
  })

  return {
    kind: 'capacitor',
    async load() {
      try {
        const { value } = await Preferences.get({ key: STORAGE_KEY })
        data = parseStored(value)
      } catch {
        /* varsayılan */
      }
      await refreshPermission()
      void reschedule()
      calendar.sync.start()
      return data
    },
    async save(incoming) {
      data = incoming
      try {
        await Preferences.set({ key: STORAGE_KEY, value: JSON.stringify(data) })
      } catch {
        /* yoksay */
      }
      void reschedule()
      calendar.sync.onDataSaved()
    },
    calendar: calendar.api,
    async notifyTest() {
      if (perm !== 'granted') return
      const lang = data.settings.language
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
    onFocusTask(cb) {
      focusListeners.add(cb)
      return () => focusListeners.delete(cb)
    },
    onReminded(cb) {
      remindListeners.add(cb)
      return () => remindListeners.delete(cb)
    },
  }
}
