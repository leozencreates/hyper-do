import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tidi', {
  kind: 'electron',
  load: () => ipcRenderer.invoke('tidi:load'),
  save: (data: unknown) => ipcRenderer.invoke('tidi:save', data),
  notifyTest: () => ipcRenderer.invoke('tidi:notify-test'),
  telegramTest: () => ipcRenderer.invoke('tidi:telegram-test'),
  permission: () => 'granted',
  requestPermission: async () => 'granted',
  onFocusTask: (cb: (id: string) => void) => {
    const h = (_: unknown, id: string) => cb(id)
    ipcRenderer.on('tidi:focus-task', h)
    return () => ipcRenderer.removeListener('tidi:focus-task', h)
  },
  onReminded: (cb: (id: string) => void) => {
    const h = (_: unknown, id: string) => cb(id)
    ipcRenderer.on('tidi:reminded', h)
    return () => ipcRenderer.removeListener('tidi:reminded', h)
  },
  onDataChanged: (cb: (data: unknown) => void) => {
    const h = (_: unknown, d: unknown) => cb(d)
    ipcRenderer.on('tidi:data-changed', h)
    return () => ipcRenderer.removeListener('tidi:data-changed', h)
  },
  // Takvim köprüsü: senkron ana süreçte çalışır (pencere kapalıyken de), arayüz yalnızca dinler.
  calendar: {
    status: () => ipcRenderer.invoke('tidi:cal-status'),
    events: () => ipcRenderer.invoke('tidi:cal-events'),
    connectGoogle: () => ipcRenderer.invoke('tidi:cal-connect'),
    disconnectGoogle: () => ipcRenderer.invoke('tidi:cal-disconnect'),
    syncNow: () => ipcRenderer.invoke('tidi:cal-sync'),
    onEvents: (cb: (events: unknown) => void) => {
      const h = (_: unknown, e: unknown) => cb(e)
      ipcRenderer.on('tidi:cal-events', h)
      return () => ipcRenderer.removeListener('tidi:cal-events', h)
    },
    onStatus: (cb: (status: unknown) => void) => {
      const h = (_: unknown, s: unknown) => cb(s)
      ipcRenderer.on('tidi:cal-status', h)
      return () => ipcRenderer.removeListener('tidi:cal-status', h)
    },
  },
})
