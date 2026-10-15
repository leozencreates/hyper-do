/**
 * Telegram Mini App adapter (Phase D5): the React UI inside the Telegram client, with the data living on the
 * PC. `electron/miniapp-server.ts` is reached over the tunnel at the page's own origin:
 *
 *   GET /api/data → { rev, data }      load (secrets blanked by the server)
 *   PUT /api/data   { tasks, deleted, dailyDone, focusLog } → { rev, data }   save = merge on the PC
 *   GET /api/rev  → { rev }            3 s poll while the page is visible; a new rev refetches the data
 *
 * Every request carries `Authorization: tma <initData>`. Failures become `ConnectionStatus`: the UI shows a
 * full-screen panel (PC unreachable → retry; 401/403 → wrong account) or a "not saved" chip; the local copy is
 * kept and the save retried on the next change, on retry, and when the page becomes visible again.
 * No service worker, no local reminders: reminders, Telegram and calendars run on the desktop.
 */
import type { AppData, ConnectionStatus, HyperDoApi } from './types'
import { browserDefaultSettings, normalizeData, parseAppData } from './data'
import { syncFingerprint } from './sync'
import { createEmitter } from './emitter'
import { setupTelegram, tgInitData } from './tg-bridge'

/** Revision poll interval while visible. */
export const POLL_MS = 3000
/** Automatic retry after a failed load / poll / save (while visible). */
const RETRY_MS = 5000

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
  }
}

export function createTelegramApi(): HyperDoApi {
  setupTelegram()
  const initData = tgInitData()
  let data: AppData = parseAppData(null, browserDefaultSettings())
  let rev = -1
  let status: ConnectionStatus = { state: 'connecting', saved: true, error: null }
  const changed = createEmitter<AppData>()
  const statusChanged = createEmitter<ConnectionStatus>()
  const focus = createEmitter<string>()
  const reminded = createEmitter<string>()
  /** Newest local copy that is not on the PC yet. */
  let pending: AppData | null = null
  let saving = false
  let loaded = false
  let loadResolve: ((d: AppData) => void) | null = null
  let retryTimer: number | null = null

  const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible'

  function setStatus(patch: Partial<ConnectionStatus>) {
    const next = { ...status, ...patch }
    if (next.state === status.state && next.saved === status.saved && next.error === status.error) return
    status = next
    statusChanged.emit(status)
  }

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(path, { ...init, cache: 'no-store', headers: { ...(init.headers as Record<string, string> | undefined), authorization: `tma ${initData}` } })
    if (!res.ok) throw new HttpError(res.status)
    return (await res.json()) as T
  }

  function adopt(reply: { rev: number; data: AppData }) {
    rev = reply.rev
    data = normalizeData(reply.data)
  }

  function fail(e: unknown, saveFailed = false) {
    const forbidden = e instanceof HttpError && (e.status === 401 || e.status === 403)
    setStatus({ state: forbidden ? 'forbidden' : 'unreachable', error: e instanceof Error ? e.message : String(e), ...(saveFailed ? { saved: false } : {}) })
    if (!forbidden) scheduleRetry()
  }

  function scheduleRetry() {
    if (retryTimer !== null) return
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      if (visible()) void retry()
    }, RETRY_MS)
  }

  /** The next useful step: first load, the pending save, or a poll. */
  async function retry() {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer)
      retryTimer = null
    }
    if (!loaded) return attemptLoad()
    if (pending) return flush()
    return poll()
  }

  async function attemptLoad() {
    try {
      adopt(await call<{ rev: number; data: AppData }>('/api/data'))
      setStatus({ state: 'ok', error: null })
      loaded = true
      loadResolve?.(data)
      loadResolve = null
      startPolling()
    } catch (e) {
      fail(e)
    }
  }

  /** PUTs the newest local copy; the PC's merge result becomes the local truth (shown when it differs and nothing newer was typed). */
  async function flush() {
    if (saving || !pending) return
    saving = true
    const body = pending
    pending = null
    const sent = syncFingerprint(body)
    try {
      const reply = await call<{ rev: number; data: AppData }>('/api/data', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tasks: body.tasks, deleted: body.deleted, dailyDone: body.dailyDone, focusLog: body.focusLog }),
      })
      adopt(reply)
      setStatus({ state: 'ok', saved: true, error: null })
      if (!pending && syncFingerprint(data) !== sent) changed.emit(data)
    } catch (e) {
      if (!pending) pending = body // keep the local copy for the next attempt (a newer one wins)
      fail(e, true)
    } finally {
      saving = false
      if (pending && status.state === 'ok') void flush()
    }
  }

  async function poll() {
    if (saving || pending || !visible()) return
    try {
      const r = await call<{ rev: number }>('/api/rev')
      if (r.rev !== rev) {
        adopt(await call<{ rev: number; data: AppData }>('/api/data'))
        changed.emit(data)
      }
      setStatus({ state: 'ok', error: null })
    } catch (e) {
      fail(e)
    }
  }

  function startPolling() {
    window.setInterval(() => {
      if (visible()) void poll()
    }, POLL_MS)
    document.addEventListener('visibilitychange', () => {
      if (!visible()) return
      if (pending) void flush()
      else void poll()
    })
  }

  return {
    kind: 'telegram',
    load: () =>
      new Promise<AppData>((resolve) => {
        loadResolve = resolve
        void attemptLoad()
      }),
    async save(incoming) {
      pending = incoming
      void flush()
    },
    async notifyTest() {
      /* reminders live on the desktop */
    },
    permission: () => 'granted',
    requestPermission: async () => 'granted',
    onFocusTask: focus.on,
    onReminded: reminded.on,
    onDataChanged: changed.on,
    connection: {
      status: () => status,
      onStatus: statusChanged.on,
      retry: () => void retry(),
    },
  }
}
