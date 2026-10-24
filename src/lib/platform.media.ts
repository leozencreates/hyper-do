/**
 * Attachment bytes in IndexedDB (database `hyperdo-media`, store `files`, key = `Attachment.id`). Shared by the
 * Electron renderer, the browser/PWA and the Android WebView; each window of the same origin sees the same store.
 */
import type { MediaApi } from './types'

const DB_NAME = 'hyperdo-media'
const STORE = 'files'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export function createMediaStore(): MediaApi | undefined {
  if (typeof indexedDB === 'undefined') return undefined
  let db: Promise<IDBDatabase> | null = null
  const store = async (mode: IDBTransactionMode) => {
    db ??= openDb().catch((e) => {
      db = null
      throw e
    })
    return (await db).transaction(STORE, mode).objectStore(STORE)
  }
  return {
    async put(id, blob) {
      await done((await store('readwrite')).put(blob, id))
    },
    async get(id) {
      const v = await done((await store('readonly')).get(id))
      return v instanceof Blob ? v : null
    },
    async gc(keep) {
      const keys = await done((await store('readonly')).getAllKeys())
      const stale = keys.filter((k) => typeof k === 'string' && !keep.has(k))
      if (!stale.length) return 0
      const s = await store('readwrite')
      await Promise.all(stale.map((k) => done(s.delete(k))))
      return stale.length
    },
  }
}
