/**
 * Chrome extension service worker.
 * Runs the shared reminder engine on a 1-minute alarm and delivers reminders
 * through chrome.notifications, so nagging continues while Chrome is open
 * even if no Hyper Do tab or popup is open.
 */
import { DEFAULT_SETTINGS, type AppData, type Task } from '../src/lib/types'
import { buildNotification, collectDueReminders, syncCounters } from '../src/lib/reminder'
import { translate, type Key } from '../src/lib/i18n'
import { completeTask, normalizeTask } from '../src/lib/tasks'

const DATA_KEY = 'hyperdo-data'
const COUNTERS_KEY = 'hyperdo-last-notified'
const ALARM = 'hyperdo-tick'
const NOTIF_PREFIX = 'hyperdo-'
const SNOOZE_MIN = 30

// ---- Storage helpers ----
async function loadData(): Promise<AppData> {
  const res = await chrome.storage.local.get(DATA_KEY)
  const raw = res[DATA_KEY] as Partial<AppData> | undefined
  return {
    tasks: Array.isArray(raw?.tasks) ? raw.tasks.map(normalizeTask) : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
  }
}

async function saveData(data: AppData) {
  await chrome.storage.local.set({ [DATA_KEY]: data })
}

async function loadCounters(): Promise<Map<string, number>> {
  const res = await chrome.storage.local.get(COUNTERS_KEY)
  const obj = (res[COUNTERS_KEY] as Record<string, number> | undefined) ?? {}
  return new Map(Object.entries(obj))
}

async function saveCounters(m: Map<string, number>) {
  await chrome.storage.local.set({ [COUNTERS_KEY]: Object.fromEntries(m) })
}

// ---- Badge ----
function overdueCount(tasks: Task[], now = Date.now()) {
  return tasks.filter((t) => t.completedAt === null && t.dueAt !== null && t.dueAt < now).length
}

async function updateBadge(data?: AppData) {
  const d = data ?? (await loadData())
  const n = overdueCount(d.tasks)
  await chrome.action.setBadgeText({ text: n > 0 ? String(n) : '' })
  await chrome.action.setBadgeBackgroundColor({ color: '#ff5fa2' })
}

// ---- Notifications ----
function t(data: AppData, key: Key, vars?: Record<string, string | number>) {
  return translate(data.settings.language, key, vars)
}

async function notify(id: string, title: string, message: string, data: AppData, withButtons: boolean) {
  const opts: chrome.notifications.NotificationCreateOptions = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon-192.png'),
    title,
    message,
    priority: 2,
    requireInteraction: true,
  }
  if (withButtons) {
    opts.buttons = [{ title: t(data, 'tg_btn_done') }, { title: t(data, 'tg_btn_30') }]
  }
  await new Promise<void>((resolve) => chrome.notifications.create(id, opts, () => resolve()))
}

async function broadcast(msg: unknown) {
  try {
    await chrome.runtime.sendMessage(msg)
  } catch {
    /* no extension page open to receive it */
  }
}

// ---- Reminder tick ----
async function tick() {
  const data = await loadData()
  const counters = await loadCounters()
  const hits = collectDueReminders(data.tasks, data.settings, counters)
  await saveCounters(counters)
  for (const h of hits) {
    const { title, body } = buildNotification(h.task, h.overdue, data.settings)
    await notify(NOTIF_PREFIX + h.task.id, title, body, data, true)
    void broadcast({ type: 'reminded', id: h.task.id })
  }
  await updateBadge(data)
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM)
  if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 1, delayInMinutes: 1 })
}

// ---- Task actions triggered from notifications ----
async function finishTask(id: string) {
  const data = await loadData()
  const next = { ...data, tasks: completeTask(data.tasks, id) }
  await saveData(next)
  await updateBadge(next)
}

async function snoozeTask(id: string, minutes: number) {
  const data = await loadData()
  const until = Date.now() + minutes * 60_000
  const next = { ...data, tasks: data.tasks.map((x) => (x.id === id ? { ...x, snoozedUntil: until } : x)) }
  await saveData(next)
  const counters = await loadCounters()
  counters.delete(id)
  await saveCounters(counters)
}

async function openApp(focusId?: string) {
  const url = chrome.runtime.getURL('index.html') + (focusId ? `?focus=${encodeURIComponent(focusId)}` : '')
  const base = chrome.runtime.getURL('index.html')
  const tabs = await chrome.tabs.query({ url: base + '*' })
  if (tabs.length > 0 && tabs[0].id !== undefined) {
    await chrome.tabs.update(tabs[0].id, { active: true, url: focusId ? url : undefined })
    if (tabs[0].windowId !== undefined) await chrome.windows.update(tabs[0].windowId, { focused: true })
    if (focusId) void broadcast({ type: 'focus', id: focusId })
    return
  }
  await chrome.tabs.create({ url })
}

// ---- Event wiring ----
chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm()
  void updateBadge()
  chrome.contextMenus.create({ id: 'hyperdo-open-tab', title: 'Open Hyper Do in a tab', contexts: ['action'] })
})

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm()
  void updateBadge()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void tick()
})

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'hyperdo-open-tab') void openApp()
})

chrome.notifications.onClicked.addListener((nid) => {
  if (!nid.startsWith(NOTIF_PREFIX)) return
  chrome.notifications.clear(nid)
  const id = nid.slice(NOTIF_PREFIX.length)
  if (id !== 'test') void openApp(id)
})

chrome.notifications.onButtonClicked.addListener((nid, idx) => {
  if (!nid.startsWith(NOTIF_PREFIX)) return
  chrome.notifications.clear(nid)
  const id = nid.slice(NOTIF_PREFIX.length)
  if (idx === 0) void finishTask(id)
  else void snoozeTask(id, SNOOZE_MIN)
})

// Keep reminder counters in sync when the UI edits tasks (new task → start counting now, snooze changed → reset).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[DATA_KEY]) return
  const prev = (changes[DATA_KEY].oldValue as AppData | undefined)?.tasks ?? []
  const next = (changes[DATA_KEY].newValue as AppData | undefined)?.tasks ?? []
  void (async () => {
    const counters = await loadCounters()
    syncCounters(prev, next, counters)
    for (const id of counters.keys()) if (!next.some((x) => x.id === id)) counters.delete(id)
    await saveCounters(counters)
    await updateBadge({ tasks: next, settings: (changes[DATA_KEY].newValue as AppData | undefined)?.settings ?? DEFAULT_SETTINGS })
  })()
})

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
  if (msg?.type === 'notifyTest') {
    void loadData().then((data) => notify(NOTIF_PREFIX + 'test', t(data, 'notif_test_title'), t(data, 'notif_test_body'), data, false)).then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg?.type === 'openTab') {
    void openApp().then(() => sendResponse({ ok: true }))
    return true
  }
  if (msg?.type === 'ping') {
    void ensureAlarm().then(() => sendResponse({ ok: true }))
    return true
  }
  return false
})

void ensureAlarm()
