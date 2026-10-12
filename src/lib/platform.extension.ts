/**
 * Chrome extension adapter: chrome.storage.local + messaging with the service worker.
 * Reminders themselves are fired by extension/background.ts, so this adapter only
 * persists data and relays focus / reminded events to the UI.
 */
import type { AppData, HyperDoApi } from './types'
import { parseStored } from './platform.web'

const DATA_KEY = 'hyperdo-data'

export function isExtension(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local && location.protocol === 'chrome-extension:'
}

export function createExtensionApi(): HyperDoApi {
  let data: AppData = parseStored(null)
  const focusListeners = new Set<(id: string) => void>()
  const remindListeners = new Set<(id: string) => void>()
  const changeListeners = new Set<(d: AppData) => void>()
  let lastSaved = ''

  chrome.runtime.onMessage.addListener((msg: { type?: string; id?: string }) => {
    if (msg?.type === 'focus' && msg.id) focusListeners.forEach((cb) => cb(msg.id!))
    if (msg?.type === 'reminded' && msg.id) remindListeners.forEach((cb) => cb(msg.id!))
  })

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[DATA_KEY]) return
    const next = changes[DATA_KEY].newValue as AppData | undefined
    if (!next) return
    const serialized = JSON.stringify(next)
    if (serialized === lastSaved) return // our own write echoing back
    data = next
    changeListeners.forEach((cb) => cb(next))
  })

  // Deep link from a notification click: index.html?focus=<id>
  const focusParam = new URLSearchParams(location.search).get('focus')
  if (focusParam) {
    setTimeout(() => focusListeners.forEach((cb) => cb(focusParam)), 400)
    history.replaceState(null, '', location.pathname)
  }

  // Make sure the alarm exists even if the worker was asleep.
  chrome.runtime.sendMessage({ type: 'ping' }).catch(() => {})

  return {
    kind: 'extension',
    async load() {
      const res = await chrome.storage.local.get(DATA_KEY)
      const raw = res[DATA_KEY]
      data = parseStored(raw ? JSON.stringify(raw) : null)
      lastSaved = JSON.stringify(data)
      return data
    },
    async save(incoming) {
      data = incoming
      lastSaved = JSON.stringify(incoming)
      await chrome.storage.local.set({ [DATA_KEY]: incoming })
    },
    async notifyTest() {
      await chrome.runtime.sendMessage({ type: 'notifyTest' }).catch(() => {})
    },
    permission: () => 'granted',
    requestPermission: async () => 'granted',
    onFocusTask(cb) {
      focusListeners.add(cb)
      return () => focusListeners.delete(cb)
    },
    onReminded(cb) {
      remindListeners.add(cb)
      return () => remindListeners.delete(cb)
    },
    onDataChanged(cb) {
      changeListeners.add(cb)
      return () => changeListeners.delete(cb)
    },
  }
}
