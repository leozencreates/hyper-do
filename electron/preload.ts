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
})
