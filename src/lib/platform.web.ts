/**
 * Tarayıcı / PWA uyarlaması: localStorage + Web Notification.
 * Hatırlatmalar yalnızca sekme ya da ana ekrana eklenmiş uygulama açıkken gelir.
 */
import { DEFAULT_SETTINGS, type AppData, type HyperDoApi } from './types'
import { buildNotification, collectDueReminders, syncCounters } from './reminder'
import { detectLang, translate } from './i18n'
import { normalizeCalendarSettings } from './calsync'
import { createBrowserCalendar } from './platform.calendar'

const STORAGE_KEY = 'hyperdo-data'

export function parseStored(raw: string | null): AppData {
  const base: AppData = { tasks: [], settings: { ...DEFAULT_SETTINGS, language: detectLang() } }
  if (!raw) return base
  try {
    const parsed = JSON.parse(raw) as Partial<AppData>
    const settings = { ...base.settings, ...(parsed.settings ?? {}) }
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      settings: { ...settings, calendar: normalizeCalendarSettings(settings.calendar) },
    }
  } catch {
    return base
  }
}

export function createWebApi(): HyperDoApi {
  let data: AppData = parseStored(null)
  const lastNotified = new Map<string, number>()
  const focusListeners = new Set<(id: string) => void>()
  const remindListeners = new Set<(id: string) => void>()
  const dataListeners = new Set<(d: AppData) => void>()

  /** Platform-side change (calendar import): save and tell the UI, like the Electron main process does. */
  function mutate(fn: (d: AppData) => AppData) {
    const next = fn(data)
    syncCounters(data.tasks, next.tasks, lastNotified)
    data = next
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* kota */
    }
    dataListeners.forEach((cb) => cb(data))
  }

  // Google login needs a real http(s) origin to redirect back to (not file://).
  const calendar = createBrowserCalendar(() => data, mutate, { googleSupported: location.protocol.startsWith('http') })
  const hasNotif = typeof Notification !== 'undefined'

  const permission = (): ReturnType<HyperDoApi['permission']> => (hasNotif ? Notification.permission : 'unsupported')

  function show(title: string, body: string, tag: string, onClick?: () => void) {
    if (permission() !== 'granted') return
    try {
      const n = new Notification(title, { body, tag, requireInteraction: true, icon: './icon-192.png' })
      n.onclick = () => {
        window.focus()
        n.close()
        onClick?.()
      }
    } catch {
      // iOS: Notification yalnızca service worker üzerinden gösterilebilir
      navigator.serviceWorker?.ready.then((reg) => reg.showNotification(title, { body, tag, requireInteraction: true, data: { tag } })).catch(() => {})
    }
  }

  function tick() {
    const hits = collectDueReminders(data.tasks, data.settings, lastNotified)
    for (const h of hits) {
      const { title, body } = buildNotification(h.task, h.overdue, data.settings)
      show(title, body, 'hyperdo-' + h.task.id, () => focusListeners.forEach((cb) => cb(h.task.id)))
      remindListeners.forEach((cb) => cb(h.task.id))
      document.title = `🔔 ${h.task.title} – Hyper Do`
      setTimeout(() => (document.title = 'Hyper Do'), 15_000)
    }
  }

  navigator.serviceWorker?.addEventListener('message', (e) => {
    const tag = e.data?.tag as string | undefined
    if (tag?.startsWith('hyperdo-')) focusListeners.forEach((cb) => cb(tag.slice(8)))
  })

  setInterval(tick, 30_000)
  setTimeout(tick, 5_000)

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  }

  return {
    kind: 'web',
    async load() {
      try {
        data = parseStored(localStorage.getItem(STORAGE_KEY))
      } catch {
        /* localStorage erişilemez */
      }
      for (const t of data.tasks) if (!lastNotified.has(t.id)) lastNotified.set(t.id, Date.now())
      await calendar.handleRedirect()
      calendar.sync.start()
      return data
    },
    async save(incoming) {
      syncCounters(data.tasks, incoming.tasks, lastNotified)
      data = incoming
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        /* kota dolu vb. */
      }
      calendar.sync.onDataSaved()
    },
    calendar: calendar.api,
    async notifyTest() {
      show(translate(data.settings.language, 'notif_test_title'), translate(data.settings.language, 'notif_test_body'), 'hyperdo-test')
    },
    permission,
    async requestPermission() {
      if (!hasNotif) return 'unsupported'
      try {
        return await Notification.requestPermission()
      } catch {
        return permission()
      }
    },
    onFocusTask(cb) {
      focusListeners.add(cb)
      return () => focusListeners.delete(cb)
    },
    onReminded(cb) {
      remindListeners.add(cb)
      return () => remindListeners.delete(cb)
    },
    onDataChanged(cb) {
      dataListeners.add(cb)
      return () => dataListeners.delete(cb)
    },
  }
}
