/**
 * Browser-side sync bridge (web / PWA / Capacitor): runs the SyncEngine in the page over WebDAV. The state
 * (device id, last token, credentials) lives in the store the platform passes in — localStorage on the web,
 * Capacitor Preferences on Android — never in AppData. (Electron has its own bridge in the main process.)
 */
import { SyncEngine } from './syncengine'
import { WebDavTransport } from './synctransport'
import { createEmitter } from './emitter'
import type { AppData, SyncApi, SyncStatus } from './types'

/** Key of the sync state in localStorage / Capacitor Preferences. */
export const SYNC_STATE_KEY = 'hyperdo-sync'

export interface BrowserSyncStore {
  load(): string | null | Promise<string | null>
  save(json: string): void | Promise<void>
}

export const localStorageSyncStore: BrowserSyncStore = {
  load() {
    try {
      return localStorage.getItem(SYNC_STATE_KEY)
    } catch {
      return null
    }
  },
  save(json) {
    try {
      localStorage.setItem(SYNC_STATE_KEY, json)
    } catch {
      /* quota */
    }
  },
}

export function createBrowserSync(getData: () => AppData, mutate: (fn: (d: AppData) => AppData) => void, store: BrowserSyncStore) {
  const status = createEmitter<SyncStatus>()
  const engine = new SyncEngine({
    getData,
    mutate,
    transport: (s, c) => (s.mode === 'webdav' && s.webdavUrl.trim() ? new WebDavTransport({ url: s.webdavUrl, username: c.username, password: c.password }) : null),
    loadState: () => store.load(),
    saveState: (json) => store.save(json),
    onStatus: status.emit,
  })
  const api: SyncApi = {
    async status() {
      return engine.status()
    },
    syncNow: () => engine.syncNow(),
    async setCredentials(username, password) {
      engine.setCredentials(username, password)
    },
    onStatus: status.on,
  }
  return { api, engine }
}
