/**
 * Browser-side calendar bridge (web / PWA / Capacitor): runs the CalendarSync engine in the page,
 * keeps its state in localStorage and does the Google login with a redirect back to the app URL.
 * (Electron has its own bridge in the main process: electron/calendar.ts)
 */
import { CalendarSync } from './calsync'
import { buildAuthUrl, exchangeCode, pkcePair, randomToken } from './gcal'
import type { AppData, CalendarApi, CalendarEvent, CalendarStatus } from './types'

const STATE_KEY = 'hyperdo-calendar'
const AUTH_KEY = 'hyperdo-google-auth'

/** Exact redirect URI the user must register on the "Web application" OAuth client. */
export function webRedirectUri(): string {
  return location.origin + location.pathname
}

export function createBrowserCalendar(getData: () => AppData, mutate: (fn: (d: AppData) => AppData) => void, opts: { googleSupported: boolean }) {
  const evListeners = new Set<(e: CalendarEvent[]) => void>()
  const stListeners = new Set<(s: CalendarStatus) => void>()

  const sync = new CalendarSync({
    getData,
    mutate,
    loadState: () => {
      try {
        return localStorage.getItem(STATE_KEY)
      } catch {
        return null
      }
    },
    saveState: (json) => {
      try {
        localStorage.setItem(STATE_KEY, json)
      } catch {
        /* quota */
      }
    },
    onEvents: (e) => evListeners.forEach((cb) => cb(e)),
    onStatus: (s) => stListeners.forEach((cb) => cb(s)),
    googleSupported: opts.googleSupported,
  })

  /** Call once at startup (after settings are loaded): finishes a Google login redirect if there is one. */
  async function handleRedirect() {
    const q = new URLSearchParams(location.search)
    const code = q.get('code')
    const state = q.get('state')
    const err = q.get('error')
    if (!code && !err) return
    let saved: { verifier: string; state: string; redirectUri: string } | null = null
    try {
      saved = JSON.parse(sessionStorage.getItem(AUTH_KEY) ?? 'null')
      sessionStorage.removeItem(AUTH_KEY)
    } catch {
      /* ignore */
    }
    const keep = new URLSearchParams()
    const view = q.get('view')
    if (view) keep.set('view', view)
    history.replaceState(null, '', location.pathname + (keep.size ? `?${keep}` : ''))

    if (err) return sync.setGoogleError(err)
    if (!saved || saved.state !== state || !code) return sync.setGoogleError('state_mismatch')
    const { clientId, clientSecret } = getData().settings.calendar.google
    try {
      const tokens = await exchangeCode({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), code, verifier: saved.verifier, redirectUri: saved.redirectUri })
      await sync.completeGoogleLogin(tokens)
    } catch (e) {
      sync.setGoogleError((e as Error).message)
    }
  }

  const api: CalendarApi = {
    async status() {
      return sync.status()
    },
    async events() {
      return sync.events()
    },
    async connectGoogle() {
      if (!opts.googleSupported) return { ok: false, error: 'unsupported' }
      const clientId = getData().settings.calendar.google.clientId.trim()
      if (!clientId) return { ok: false, error: 'client_id' }
      const { verifier, challenge } = await pkcePair()
      const state = randomToken(16)
      const redirectUri = webRedirectUri()
      sessionStorage.setItem(AUTH_KEY, JSON.stringify({ verifier, state, redirectUri }))
      location.assign(buildAuthUrl({ clientId, redirectUri, challenge, state }))
      return { ok: true }
    },
    async disconnectGoogle() {
      await sync.disconnectGoogle()
    },
    async syncNow() {
      await sync.sync()
    },
    onEvents(cb) {
      evListeners.add(cb)
      return () => evListeners.delete(cb)
    },
    onStatus(cb) {
      stListeners.add(cb)
      return () => stListeners.delete(cb)
    },
  }

  return { api, sync, handleRedirect }
}
