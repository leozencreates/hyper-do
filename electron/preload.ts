import { contextBridge, ipcRenderer } from 'electron'

/** Subscribes to a main → renderer channel; returns the unsubscribe function expected by HyperDoApi. */
const listen =
  <T>(channel: string) =>
  (cb: (value: T) => void) => {
    const h = (_: unknown, value: T) => cb(value)
    ipcRenderer.on(channel, h)
    return () => ipcRenderer.removeListener(channel, h)
  }

contextBridge.exposeInMainWorld('tidi', {
  kind: 'electron',
  load: () => ipcRenderer.invoke('tidi:load'),
  save: (data: unknown) => ipcRenderer.invoke('tidi:save', data),
  notifyTest: () => ipcRenderer.invoke('tidi:notify-test'),
  telegramTest: () => ipcRenderer.invoke('tidi:telegram-test'),
  permission: () => 'granted',
  requestPermission: async () => 'granted',
  onFocusTask: listen<string>('tidi:focus-task'),
  onReminded: listen<string>('tidi:reminded'),
  onDataChanged: listen<unknown>('tidi:data-changed'),
  // Takvim köprüsü: senkron ana süreçte çalışır (pencere kapalıyken de), arayüz yalnızca dinler.
  calendar: {
    status: () => ipcRenderer.invoke('tidi:cal-status'),
    events: () => ipcRenderer.invoke('tidi:cal-events'),
    connectGoogle: () => ipcRenderer.invoke('tidi:cal-connect'),
    disconnectGoogle: () => ipcRenderer.invoke('tidi:cal-disconnect'),
    syncNow: () => ipcRenderer.invoke('tidi:cal-sync'),
    onEvents: listen<unknown>('tidi:cal-events'),
    onStatus: listen<unknown>('tidi:cal-status'),
  },
})
