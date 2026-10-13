/**
 * Google OAuth 2.0 (PKCE) + Calendar v3 REST helpers.
 * Platform independent: only needs global fetch and crypto.subtle (browser, Node 20+, Electron main).
 * The interactive part (opening the browser / receiving the redirect) is done by the platform.
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const API = 'https://www.googleapis.com/calendar/v3'

/** openid+email only to show which account is connected; calendar for read + the "Hyper Do" task calendar. */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar']

export class GoogleAuthError extends Error {
  constructor(
    public code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export interface GoogleTokens {
  accessToken: string
  expiresAt: number
  refreshToken?: string
  idToken?: string
}

export interface GCalendar {
  id: string
  summary: string
  summaryOverride?: string
  backgroundColor?: string
  primary?: boolean
  accessRole?: string
  selected?: boolean
}

export interface GEvent {
  id: string
  status?: string
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  extendedProperties?: { private?: Record<string, string> }
  attendees?: { self?: boolean; responseStatus?: string }[]
  eventType?: string
}

// ---------- PKCE ----------

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const b of arr) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return base64url(a)
}

export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64url(digest) }
}

export function buildAuthUrl(o: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return `${GOOGLE_AUTH_URL}?${q}`
}

// ---------- tokens ----------

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(body)) if (v) params.set(k, v)
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) throw new GoogleAuthError(json.error ?? `http_${res.status}`, json.error_description ?? json.error ?? `HTTP ${res.status}`)
  return { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000, refreshToken: json.refresh_token, idToken: json.id_token }
}

/** Public clients (Android OAuth client type) have no secret: an empty `clientSecret` is simply left out of the request. */
export function exchangeCode(o: { clientId: string; clientSecret?: string; code: string; verifier: string; redirectUri: string }): Promise<GoogleTokens> {
  return tokenRequest({ client_id: o.clientId, client_secret: o.clientSecret ?? '', code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri, grant_type: 'authorization_code' })
}

export function refreshAccessToken(o: { clientId: string; clientSecret?: string; refreshToken: string }): Promise<GoogleTokens> {
  return tokenRequest({ client_id: o.clientId, client_secret: o.clientSecret ?? '', refresh_token: o.refreshToken, grant_type: 'refresh_token' })
}

/** Redirect URI of the Android app (custom scheme = package name, caught by an intent filter + `appUrlOpen`). */
export const ANDROID_REDIRECT_URI = 'com.hyperdo.app:/oauth2redirect'

/**
 * Pulls `code` / `state` / `error` out of an OAuth redirect URL, whatever its scheme
 * (`http://127.0.0.1:1234/callback?code=…`, `com.hyperdo.app:/oauth2redirect?code=…`).
 * Returns null when the URL carries neither a code nor an error.
 */
export function parseOAuthRedirect(url: string): { code: string | null; state: string | null; error: string | null } | null {
  const i = url.indexOf('?')
  if (i < 0) return null
  const q = new URLSearchParams(url.slice(i + 1).replace(/#.*$/, ''))
  const code = q.get('code')
  const error = q.get('error')
  if (!code && !error) return null
  return { code, state: q.get('state'), error }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' })
  } catch {
    /* best effort */
  }
}

/** The id_token is only used to display the account e-mail; no verification needed for that. */
export function emailFromIdToken(idToken?: string): string {
  if (!idToken) return ''
  try {
    const payload = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(decodeURIComponent(escape(atob(payload)))) as { email?: string }
    return json.email ?? ''
  } catch {
    return ''
  }
}

// ---------- Calendar API ----------

export class GoogleCalendarClient {
  /** `getToken(true)` must drop any cached access token and fetch a fresh one. */
  constructor(private getToken: (force?: boolean) => Promise<string>) {}

  private async call<T>(method: string, path: string, body?: unknown, query?: Record<string, string>, retry = true): Promise<T> {
    const token = await this.getToken(!retry)
    const url = new URL(API + path)
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401 && retry) return this.call<T>(method, path, body, query, false) // cached token revoked → refresh once
    if (res.status === 204) return undefined as T
    const json = (await res.json().catch(() => ({}))) as T & { error?: { code?: number; message?: string; status?: string } }
    if (!res.ok) {
      const code = res.status === 401 ? 'unauthorized' : res.status === 404 || res.status === 410 ? 'not_found' : `http_${res.status}`
      throw new GoogleAuthError(code, json.error?.message ?? `HTTP ${res.status}`)
    }
    return json
  }

  async listCalendars(): Promise<GCalendar[]> {
    const items: GCalendar[] = []
    let pageToken = ''
    do {
      const r = await this.call<{ items?: GCalendar[]; nextPageToken?: string }>('GET', '/users/me/calendarList', undefined, { maxResults: '250', ...(pageToken ? { pageToken } : {}) })
      items.push(...(r.items ?? []))
      pageToken = r.nextPageToken ?? ''
    } while (pageToken)
    return items
  }

  async listEvents(calendarId: string, timeMin: number, timeMax: number): Promise<GEvent[]> {
    const items: GEvent[] = []
    let pageToken = ''
    do {
      const r = await this.call<{ items?: GEvent[]; nextPageToken?: string }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, undefined, {
        timeMin: new Date(timeMin).toISOString(),
        timeMax: new Date(timeMax).toISOString(),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      })
      items.push(...(r.items ?? []))
      pageToken = r.nextPageToken ?? ''
    } while (pageToken && items.length < 1000)
    return items
  }

  /** Finds events carrying our private hyperdoId marker (used to re-link after a reinstall). */
  async findByHyperdoId(calendarId: string, hyperdoId: string): Promise<GEvent[]> {
    const r = await this.call<{ items?: GEvent[] }>('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, undefined, { privateExtendedProperty: `hyperdoId=${hyperdoId}`, maxResults: '5' })
    return r.items ?? []
  }

  insertCalendar(summary: string, description: string): Promise<GCalendar> {
    return this.call<GCalendar>('POST', '/calendars', { summary, description, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
  }

  insertEvent(calendarId: string, body: Partial<GEvent> & Record<string, unknown>): Promise<GEvent> {
    return this.call<GEvent>('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, body)
  }

  patchEvent(calendarId: string, eventId: string, body: Partial<GEvent> & Record<string, unknown>): Promise<GEvent> {
    return this.call<GEvent>('PATCH', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, body)
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<void> {
    try {
      await this.call<void>('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`)
    } catch (e) {
      if (!(e instanceof GoogleAuthError && e.code === 'not_found')) throw e // already gone → fine
    }
  }
}
