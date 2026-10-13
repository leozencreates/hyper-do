/**
 * Sync engine (#16), platform independent like `calsync.ts`: runs in the Electron main process (so it keeps
 * working while the window is closed) and inside the browser / Android adapters.
 *
 * Cycle (`syncNow`): pull the remote document (missing → empty) → `mergeData` → when the merge changed the
 * local side, replace the synced subset of the app data (`applySyncDoc`) → when it changed the remote side,
 * push with the transport's optimistic-concurrency token (ETag / file mtime). A conflict (somebody wrote in
 * between) re-pulls, merges and retries once. Triggers: every local save (debounced 2 s), a 60 s timer, the
 * folder watcher, "Sync now". An in-flight guard serialises cycles; a trigger during a cycle queues one more.
 *
 * State (device id, last token, last sync time, WebDAV credentials) lives in the platform state store — never
 * in `AppData`, never in backups.
 */
import type { AppData, SyncSettings, SyncStatus } from './types'
import { applySyncDoc, emptySyncDoc, mergeData, parseSyncDoc, syncFingerprint, toSyncDoc, type SyncDoc } from './sync'
import { SyncConflictError, SyncTransportError, type SyncTransport } from './synctransport'

export interface SyncCredentials {
  username: string
  password: string
}

export interface SyncEngineHost {
  getData(): AppData
  /** Replaces the app data (saves it and refreshes the UI). The engine's own writes must not bump `updatedAt`. */
  mutate(fn: (d: AppData) => AppData): void
  /** Builds the transport for the current settings, or null when sync is off / not configured yet. */
  transport(settings: SyncSettings, credentials: SyncCredentials): SyncTransport | null
  loadState(): string | null | Promise<string | null>
  saveState(json: string): void | Promise<void>
  onStatus(status: SyncStatus): void
  /** Clock (tests). */
  now?(): number
  /** Debounce after a local save (default 2 s), periodic interval (default 60 s), delay of the first cycle after `start` (default 2.5 s). */
  debounceMs?: number
  intervalMs?: number
  startDelayMs?: number
}

interface PersistedState {
  deviceId: string
  lastToken: string | null
  lastSyncAt: number | null
  credentials: SyncCredentials
}

const DEBOUNCE_MS = 2000
const INTERVAL_MS = 60_000
const START_DELAY_MS = 2500
/** Folder watcher events are coalesced for this long. */
const WATCH_DEBOUNCE_MS = 1000

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Codes the Settings UI translates; every other failure is reported with its message. */
const CODED = new Set(['unauthorized', 'invalid_file', 'conflict'])
function errorText(e: unknown): string {
  if (e instanceof SyncConflictError) return e.code
  if (e instanceof SyncTransportError && (CODED.has(e.code) || e.code.startsWith('http_'))) return e.code
  return (e as Error)?.message || String(e)
}

export function parseSyncState(raw: string | null | undefined): PersistedState {
  const base: PersistedState = { deviceId: '', lastToken: null, lastSyncAt: null, credentials: { username: '', password: '' } }
  if (!raw) return base
  try {
    const p = JSON.parse(raw) as Partial<PersistedState>
    return {
      deviceId: typeof p.deviceId === 'string' ? p.deviceId : '',
      lastToken: typeof p.lastToken === 'string' ? p.lastToken : null,
      lastSyncAt: typeof p.lastSyncAt === 'number' && Number.isFinite(p.lastSyncAt) ? p.lastSyncAt : null,
      credentials: {
        username: typeof p.credentials?.username === 'string' ? p.credentials.username : '',
        password: typeof p.credentials?.password === 'string' ? p.credentials.password : '',
      },
    }
  } catch {
    return base
  }
}

export class SyncEngine {
  private state: PersistedState = parseSyncState(null)
  private transport: SyncTransport | null = null
  private unwatch: (() => void) | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private again = false
  private syncing = false
  private lastError: string | null = null
  private started = false
  /** True while `mutate(applySyncDoc)` runs: the save it triggers is ours. */
  private applying = false
  private lastSettingsFp = ''
  /** Fingerprint of the local synced subset after the last successful cycle (nothing new → no merge needed). */
  private lastLocalFp: string | null = null
  /** The remote document as last seen, keyed by its token (reused when the transport answers `unchanged`). */
  private remoteCache: { token: string; doc: SyncDoc } | null = null

  constructor(private host: SyncEngineHost) {}

  // ---------- state ----------

  private now(): number {
    return this.host.now ? this.host.now() : Date.now()
  }

  private persist() {
    try {
      void this.host.saveState(JSON.stringify(this.state))
    } catch {
      /* ignore */
    }
  }

  private get settings(): SyncSettings {
    return this.host.getData().settings.sync
  }

  get deviceId(): string {
    return this.state.deviceId
  }

  get credentialsSaved(): boolean {
    return this.state.credentials.username.length > 0 || this.state.credentials.password.length > 0
  }

  status(): SyncStatus {
    const enabled = this.settings.mode !== 'off'
    return {
      enabled,
      transport: this.transport?.kind ?? null,
      lastSyncAt: this.state.lastSyncAt,
      lastError: this.lastError ?? (enabled && !this.transport ? 'not_configured' : null),
      syncing: this.syncing,
      credentialsSaved: this.credentialsSaved,
    }
  }

  private emitStatus() {
    this.host.onStatus(this.status())
  }

  // ---------- lifecycle ----------

  async start() {
    this.stop()
    this.state = parseSyncState(await this.host.loadState())
    if (!this.state.deviceId) {
      this.state.deviceId = randomId()
      this.persist()
    }
    this.started = true
    this.lastSettingsFp = JSON.stringify(this.settings)
    this.configure()
    this.timer = setInterval(() => void this.syncNow(), this.host.intervalMs ?? INTERVAL_MS)
    if (this.transport) this.schedule(this.host.startDelayMs ?? START_DELAY_MS)
    this.emitStatus()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.pending) clearTimeout(this.pending)
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.timer = null
    this.pending = null
    this.watchTimer = null
    this.unwatch?.()
    this.unwatch = null
    this.started = false
  }

  /** (Re)builds the transport from the current settings + credentials; forgets everything known about the old one. */
  private configure() {
    this.unwatch?.()
    this.unwatch = null
    this.remoteCache = null
    this.lastLocalFp = null
    this.lastError = null
    let transport: SyncTransport | null = null
    try {
      transport = this.host.transport(this.settings, this.state.credentials)
    } catch (e) {
      this.lastError = (e as Error)?.message || String(e)
    }
    this.transport = transport
    if (transport?.watch) {
      try {
        this.unwatch = transport.watch(() => this.onRemoteChanged())
      } catch {
        /* watching is best effort; the timer still polls */
      }
    }
  }

  private onRemoteChanged() {
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      void this.syncNow()
    }, WATCH_DEBOUNCE_MS)
  }

  private schedule(ms: number) {
    if (this.pending) clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.pending = null
      void this.syncNow()
    }, ms)
  }

  /** Call after every data save. Sync settings changed → rebuild the transport and sync; task data changed → sync in 2 s. */
  onDataSaved() {
    if (this.applying || !this.started) return
    const sfp = JSON.stringify(this.settings)
    if (sfp !== this.lastSettingsFp) {
      this.lastSettingsFp = sfp
      this.configure()
      this.emitStatus()
      if (this.transport) this.schedule(0)
      return
    }
    if (!this.transport) return
    if (this.lastLocalFp !== null && syncFingerprint(this.host.getData()) === this.lastLocalFp) return
    this.schedule(this.host.debounceMs ?? DEBOUNCE_MS)
  }

  /** Stores the WebDAV credentials in the platform state and reconnects. */
  setCredentials(username: string, password: string) {
    this.state.credentials = { username: username.trim(), password }
    this.persist()
    if (!this.started) return
    this.configure()
    this.emitStatus()
    if (this.transport) this.schedule(0)
  }

  // ---------- the cycle ----------

  /** Runs one cycle now (or queues one when a cycle is in flight). Never rejects: errors land in the status. */
  syncNow(): Promise<void> {
    if (this.inFlight) {
      this.again = true
      return this.inFlight
    }
    if (this.pending) {
      clearTimeout(this.pending)
      this.pending = null
    }
    const run = (async () => {
      try {
        await this.cycle()
      } finally {
        this.inFlight = null
        if (this.again) {
          this.again = false
          void this.syncNow()
        }
      }
    })()
    this.inFlight = run
    return run
  }

  private async cycle() {
    const transport = this.transport
    if (!transport) {
      this.emitStatus()
      return
    }
    this.syncing = true
    this.emitStatus()
    try {
      await this.attempt(transport, false)
      this.lastError = null
      this.state.lastSyncAt = this.now()
      this.lastLocalFp = syncFingerprint(this.host.getData())
      this.persist()
    } catch (e) {
      this.lastError = errorText(e)
      this.remoteCache = null // whatever we knew may be stale
    } finally {
      this.syncing = false
      this.emitStatus()
    }
  }

  private async attempt(transport: SyncTransport, isRetry: boolean): Promise<void> {
    const now = this.now()
    // pull (conditional when we still hold the last copy)
    const known = this.remoteCache?.token || null
    const r = await transport.pull(known)
    let remote: { doc: SyncDoc; token: string } | null
    if (r.status === 'unchanged') remote = this.remoteCache
    else if (r.status === 'missing') remote = null
    else {
      const doc = r.body.trim() ? parseSyncDoc(r.body, now) : emptySyncDoc('', now)
      if (!doc) throw new SyncTransportError('invalid_file', 'The remote file is not a Hyper Do sync document')
      remote = { doc, token: r.token }
      this.remoteCache = remote
    }

    const data = this.host.getData()
    const local = toSyncDoc(data, this.state.deviceId, now)
    const remoteDoc = remote?.doc ?? emptySyncDoc('', now)
    const { merged, changedLocal, changedRemote } = mergeData(local, remoteDoc, now)

    if (changedLocal) {
      this.applying = true
      try {
        this.host.mutate((d) => applySyncDoc(d, merged))
      } finally {
        this.applying = false
      }
    }

    if (changedRemote || remote === null) {
      const body = JSON.stringify({ ...merged, deviceId: this.state.deviceId, savedAt: now }, null, 1)
      try {
        const token = await transport.push(body, remote ? remote.token : null)
        this.state.lastToken = token
        this.remoteCache = token ? { token, doc: merged } : null
      } catch (e) {
        if (e instanceof SyncConflictError && !isRetry) {
          this.remoteCache = null
          return this.attempt(transport, true)
        }
        throw e
      }
    } else {
      this.state.lastToken = remote.token
    }
  }
}
