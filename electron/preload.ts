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
  // The main process reads event.sender.id so the saving window is not echoed its own data.
  save: (data: unknown) => ipcRenderer.invoke('tidi:save', data),
  notifyTest: () => ipcRenderer.invoke('tidi:notify-test'),
  telegramTest: () => ipcRenderer.invoke('tidi:telegram-test'),
  // Bot durumu: ana süreç yoklar, ayarlar paneli dinler (handle + push aynı kanal)
  telegramStatus: () => ipcRenderer.invoke('tidi:tg-status'),
  onTelegramStatus: listen<unknown>('tidi:tg-status'),
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
  // Cihazlar arası eşitleme (#16): motor ana süreçte çalışır; kimlik bilgileri userData/hyperdo-sync.json'da
  sync: {
    status: () => ipcRenderer.invoke('tidi:sync-status'),
    syncNow: () => ipcRenderer.invoke('tidi:sync-now'),
    setCredentials: (username: string, password: string) => ipcRenderer.invoke('tidi:sync-set-credentials', { username, password }),
    pickFolder: () => ipcRenderer.invoke('tidi:sync-pick-folder'),
    onStatus: listen<unknown>('tidi:sync-status'),
  },
  // Masaüstüne özel: hızlı ekleme penceresi, global kısayol, otomatik yedekler, mini pencere (HyperDoApi.desktop)
  desktop: {
    shortcutStatus: () => ipcRenderer.invoke('tidi:shortcut-status'),
    onShortcutStatus: listen<unknown>('tidi:shortcut-status'),
    backupInfo: () => ipcRenderer.invoke('tidi:backup-info'),
    openBackups: () => ipcRenderer.invoke('tidi:open-backups'),
    quickAdd: (text: string) => ipcRenderer.invoke('tidi:quick-add', text),
    hideQuick: () => ipcRenderer.invoke('tidi:quick-hide'),
    onQuickShown: listen<void>('tidi:quick-shown'),
    toggleMini: () => ipcRenderer.invoke('tidi:mini-toggle'),
    hideMini: () => ipcRenderer.invoke('tidi:mini-hide'),
    miniVisible: () => ipcRenderer.invoke('tidi:mini-visible'),
    onMiniVisible: listen<boolean>('tidi:mini-visible'),
    showMain: () => ipcRenderer.invoke('tidi:show-main'),
    // Otomatik güncelleme (#18): durum sorgulama + push aynı kanal, elle denetleme, kur, sürüm
    updateStatus: () => ipcRenderer.invoke('tidi:update-status'),
    checkForUpdates: () => ipcRenderer.invoke('tidi:update-check'),
    installUpdate: () => ipcRenderer.invoke('tidi:update-install'),
    onUpdateStatus: listen<unknown>('tidi:update-status'),
    appVersion: () => ipcRenderer.invoke('tidi:app-version'),
    // Telegram Mini App (Phase D): server + tunnel status (query + push), restart
    miniAppStatus: () => ipcRenderer.invoke('tidi:miniapp-status'),
    onMiniAppStatus: listen<unknown>('tidi:miniapp-status'),
    miniAppRestart: () => ipcRenderer.invoke('tidi:miniapp-restart'),
  },
})
