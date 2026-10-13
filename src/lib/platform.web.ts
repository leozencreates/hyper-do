/**
 * Tarayıcı / PWA uyarlaması: localStorage + Web Notification.
 * Hatırlatmalar yalnızca sekme ya da ana ekrana eklenmiş uygulama açıkken gelir.
 */
import type { AppData, HyperDoApi, NotifyPermission } from './types'
import { activeFocusTaskId, buildNotification, collectDueReminders, markNagged, syncCounters } from './reminder'
import { translate } from './i18n'
import { browserDefaultSettings, parseAppData, DATA_STORAGE_KEY } from './data'
import { bumpChanged } from './tasks'
import { createEmitter } from './emitter'
import { createBrowserCalendar } from './platform.calendar'
import { createBrowserSync, localStorageSyncStore } from './platform.sync'

export function createWebApi(): HyperDoApi {
  const defaults = browserDefaultSettings()
  let data: AppData = parseAppData(null, defaults)
  const lastNotified = new Map<string, number>()
  const focus = createEmitter<string>()
  const reminded = createEmitter<string>()
  const changed = createEmitter<AppData>()

  function persist() {
    try {
      localStorage.setItem(DATA_STORAGE_KEY, JSON.stringify(data))
    } catch {
      /* kota dolu vb. */
    }
  }

  /**
   * Platform-side change (calendar import, nag counters): save and tell the UI, like the Electron main process does.
   * Replaced task objects get their `updatedAt` bumped (#16) unless the change *is* the sync result (`bump: false`).
   */
  function mutate(fn: (d: AppData) => AppData, { bump = true } = {}) {
    let next = fn(data)
    if (bump && next.tasks !== data.tasks) next = { ...next, tasks: bumpChanged(data.tasks, next.tasks) }
    syncCounters(data.tasks, next.tasks, lastNotified)
    data = next
    persist()
    changed.emit(data)
    if (bump) sync.engine.onDataSaved()
  }

  // Google login needs a real http(s) origin to redirect back to (not file://).
  const calendar = createBrowserCalendar(() => data, mutate, { googleSupported: location.protocol.startsWith('http') })
  // Cross-device sync (#16): WebDAV only in the browser; state + credentials in localStorage
  const sync = createBrowserSync(
    () => data,
    (fn) => mutate(fn, { bump: false }),
    localStorageSyncStore,
  )
  const hasNotif = typeof Notification !== 'undefined'

  const permission = (): NotifyPermission => (hasNotif ? Notification.permission : 'unsupported')

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
    const now = Date.now()
    const hits = collectDueReminders(data.tasks, data.settings, lastNotified, now, activeFocusTaskId(data, now))
    if (hits.length === 0) return
    for (const h of hits) {
      const { title, body } = buildNotification(h.task, h.overdue, data.settings)
      show(title, body, 'hyperdo-' + h.task.id, () => focus.emit(h.task.id))
      reminded.emit(h.task.id)
      document.title = `🔔 ${h.task.title} – Hyper Do`
      setTimeout(() => (document.title = 'Hyper Do'), 15_000)
    }
    // Escalation ladder (#6): the delivered reminders count as ignored until the user reacts
    mutate((d) => ({ ...d, tasks: markNagged(d.tasks, hits.map((h) => h.task.id)) }))
  }

  navigator.serviceWorker?.addEventListener('message', (e) => {
    const tag = e.data?.tag as string | undefined
    if (tag?.startsWith('hyperdo-')) focus.emit(tag.slice(8))
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
        data = parseAppData(localStorage.getItem(DATA_STORAGE_KEY), defaults)
      } catch {
        /* localStorage erişilemez */
      }
      for (const t of data.tasks) if (!lastNotified.has(t.id)) lastNotified.set(t.id, Date.now())
      await calendar.handleRedirect()
      calendar.sync.start()
      void sync.engine.start()
      return data
    },
    async save(incoming) {
      syncCounters(data.tasks, incoming.tasks, lastNotified)
      data = incoming
      persist()
      calendar.sync.onDataSaved()
      sync.engine.onDataSaved()
    },
    calendar: calendar.api,
    sync: sync.api,
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
    onFocusTask: focus.on,
    onReminded: reminded.on,
    onDataChanged: changed.on,
  }
}
