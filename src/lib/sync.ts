/**
 * Cross-device sync without a server (#16), pure part: the document every device reads and writes
 * (`SyncDoc`) and the merge that never loses data. No React, no Electron, no network here — the engine
 * (`syncengine.ts`) and the transports (`synctransport.ts`, `electron/syncfolder.ts`) build on this.
 *
 * Rules (see `mergeData`):
 *  - per task id the copy with the newer `updatedAt` wins (tie → local);
 *  - a tombstone at least as new as the task's `updatedAt` deletes it on both sides; a task edited after its
 *    tombstone comes back (and the tombstone is dropped);
 *  - `deleted` = union of the tombstones, pruned after `TOMBSTONE_TTL_MS`;
 *  - `dailyDone` = per-day maximum; `focusLog` = union by id, sorted by `startedAt`, newest `FOCUS_LOG_MAX` kept;
 *  - at most one task stays `focused`: the most recently updated one.
 * Settings and the Hyper Focus session are device-local and never part of the document.
 */
import { FOCUS_LOG_MAX, TOMBSTONE_TTL_MS, type AppData, type FocusEntry, type Task, type Tombstone } from './types'
import { normalizeDailyDone, normalizeDeleted, normalizeFocusLog } from './data'
import { normalizeTask } from './tasks'
import { preserveVersions } from './history'

export const SYNC_DOC_VERSION = 1
/** File name used by the folder transport (and suggested for WebDAV). */
export const SYNC_FILE_NAME = 'hyperdo-sync.json'

export interface SyncDoc {
  version: 1
  /** Device that wrote the document last (informational). */
  deviceId: string
  savedAt: number
  tasks: Task[]
  deleted: Tombstone[]
  dailyDone: Record<string, number>
  focusLog: FocusEntry[]
}

/** The subset of `AppData` that is synced. */
export type SyncedData = Pick<AppData, 'tasks' | 'deleted' | 'dailyDone' | 'focusLog'>

export interface MergeResult {
  merged: SyncDoc
  /** The local data must be replaced by `merged`. */
  changedLocal: boolean
  /** The remote document must be replaced by `merged`. */
  changedRemote: boolean
}

export function emptySyncDoc(deviceId: string, nowMs: number): SyncDoc {
  return { version: SYNC_DOC_VERSION, deviceId, savedAt: nowMs, tasks: [], deleted: [], dailyDone: {}, focusLog: [] }
}

/** The document this device would upload: the synced subset of `data` with pruned tombstones. */
export function toSyncDoc(data: SyncedData, deviceId: string, nowMs: number): SyncDoc {
  return {
    version: SYNC_DOC_VERSION,
    deviceId,
    savedAt: nowMs,
    tasks: data.tasks,
    deleted: normalizeDeleted(data.deleted, nowMs),
    dailyDone: data.dailyDone,
    focusLog: data.focusLog,
  }
}

/** Replaces the synced subset of `data` with `doc`; settings and the Hyper Focus session stay untouched. */
export function applySyncDoc<T extends SyncedData>(data: T, doc: SyncDoc): T {
  return { ...data, tasks: doc.tasks, deleted: doc.deleted, dailyDone: doc.dailyDone, focusLog: doc.focusLog }
}

/** Parses a document written by another device; null when it is not a Hyper Do sync file. Tasks get the usual defaults. */
export function parseSyncDoc(raw: string, nowMs = Date.now()): SyncDoc | null {
  let p: unknown
  try {
    p = JSON.parse(raw)
  } catch {
    return null
  }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null
  const o = p as Partial<SyncDoc>
  if (!Array.isArray(o.tasks)) return null
  const tasks: Task[] = []
  const seen = new Set<string>()
  for (const t of o.tasks) {
    if (!t || typeof t !== 'object' || typeof (t as Task).id !== 'string' || !(t as Task).id || seen.has((t as Task).id)) continue
    seen.add((t as Task).id)
    tasks.push(normalizeTask(t as Partial<Task> & { id: string }))
  }
  return {
    version: SYNC_DOC_VERSION,
    deviceId: typeof o.deviceId === 'string' ? o.deviceId : '',
    savedAt: typeof o.savedAt === 'number' && Number.isFinite(o.savedAt) ? o.savedAt : 0,
    tasks,
    deleted: normalizeDeleted(o.deleted, nowMs),
    dailyDone: normalizeDailyDone(o.dailyDone),
    focusLog: normalizeFocusLog(o.focusLog),
  }
}

/** Adds (or refreshes) tombstones for `ids` at `nowMs`; the list stays unique per id and sorted. */
export function addTombstones(deleted: Tombstone[], ids: Iterable<string>, nowMs: number): Tombstone[] {
  const add = [...ids].map((id) => ({ id, at: nowMs }))
  return add.length ? normalizeDeleted([...deleted, ...add], nowMs) : deleted
}

/** Removes the tombstones of `ids` (undo delete). */
export function dropTombstones(deleted: Tombstone[], ids: Iterable<string>): Tombstone[] {
  const set = new Set(ids)
  return deleted.some((t) => set.has(t.id)) ? deleted.filter((t) => !set.has(t.id)) : deleted
}

/** Canonical fingerprint of a task (key order independent) for value comparison. */
const taskFp = (t: Task) => JSON.stringify(normalizeTask(t))

/** Same object, or the same timestamp with the same content. */
function sameTask(a: Task, b: Task): boolean {
  return a === b || (a.updatedAt === b.updatedAt && taskFp(a) === taskFp(b))
}

function sameTombstones(a: Tombstone[], b: Tombstone[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.at === b[i].at)
}

function sameDailyDone(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every((k) => a[k] === b[k])
}

function sameLog(a: FocusEntry[], b: FocusEntry[]): boolean {
  if (a.length !== b.length) return false
  const ids = new Set(a.map((e) => e.id))
  return b.every((e) => ids.has(e.id))
}

/** Fingerprint of the synced subset of the data: equal strings ⇒ nothing to upload. */
export function syncFingerprint(data: SyncedData): string {
  return JSON.stringify([data.tasks, data.deleted, data.dailyDone, data.focusLog.map((e) => e.id)])
}

/**
 * Three-way-free merge of the local and the remote document (rules in the header comment).
 * Idempotent: merging the result with either input again changes nothing.
 */
export function mergeData(local: SyncDoc, remote: SyncDoc, nowMs: number): MergeResult {
  const cutoff = nowMs - TOMBSTONE_TTL_MS

  // tombstones: union, newest `at` per id, pruned
  const tomb = new Map<string, number>()
  for (const t of [...local.deleted, ...remote.deleted]) {
    if (t.at < cutoff) continue
    tomb.set(t.id, Math.max(tomb.get(t.id) ?? 0, t.at))
  }

  // tasks: local order first, remote-only tasks appended in their remote order
  const localBy = new Map(local.tasks.map((t) => [t.id, t]))
  const remoteBy = new Map(remote.tasks.map((t) => [t.id, t]))
  const ids = [...localBy.keys(), ...remote.tasks.filter((t) => !localBy.has(t.id)).map((t) => t.id)]
  const merged: Task[] = []
  let changedLocal = false
  let changedRemote = false
  for (const id of ids) {
    const l = localBy.get(id)
    const r = remoteBy.get(id)
    let winner: Task = l && r ? (r.updatedAt > l.updatedAt ? r : l) : (l ?? r)!
    const at = tomb.get(id)
    if (at !== undefined) {
      if (at >= winner.updatedAt) {
        // deleted on one device after the last edit anywhere → gone on both
        if (l) changedLocal = true
        if (r) changedRemote = true
        continue
      }
      tomb.delete(id) // edited after the delete → resurrected
    }
    if (l && r) winner = preserveVersions(winner, winner === l ? r : l)
    if (!l || !sameTask(winner, l)) changedLocal = true
    if (!r || !sameTask(winner, r)) changedRemote = true
    merged.push(winner)
  }

  // at most one focused task: the most recently updated one keeps the flag
  const focused = merged.filter((t) => t.focused)
  if (focused.length > 1) {
    const keep = focused.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
    for (let i = 0; i < merged.length; i++) {
      const t = merged[i]
      if (t.focused && t !== keep) {
        merged[i] = { ...t, focused: false, updatedAt: keep.updatedAt + 1 }
        changedLocal = true
        changedRemote = true
      }
    }
  }

  const deleted = [...tomb.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const localDeleted = normalizeDeleted(local.deleted, nowMs)
  const remoteDeleted = normalizeDeleted(remote.deleted, nowMs)
  if (!sameTombstones(deleted, localDeleted)) changedLocal = true
  if (!sameTombstones(deleted, remoteDeleted)) changedRemote = true

  // completions per day: maximum
  const dailyDone: Record<string, number> = { ...local.dailyDone }
  for (const [k, n] of Object.entries(remote.dailyDone)) dailyDone[k] = Math.max(dailyDone[k] ?? 0, n)
  if (!sameDailyDone(dailyDone, local.dailyDone)) changedLocal = true
  if (!sameDailyDone(dailyDone, remote.dailyDone)) changedRemote = true

  // focus log: union by id (local copy preferred), chronological, capped
  const log = new Map<string, FocusEntry>()
  for (const e of remote.focusLog) log.set(e.id, e)
  for (const e of local.focusLog) log.set(e.id, e)
  let focusLog = [...log.values()].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  if (focusLog.length > FOCUS_LOG_MAX) focusLog = focusLog.slice(focusLog.length - FOCUS_LOG_MAX)
  if (!sameLog(focusLog, local.focusLog)) changedLocal = true
  if (!sameLog(focusLog, remote.focusLog)) changedRemote = true

  return {
    merged: { version: SYNC_DOC_VERSION, deviceId: local.deviceId, savedAt: nowMs, tasks: merged, deleted, dailyDone, focusLog },
    changedLocal,
    changedRemote,
  }
}
