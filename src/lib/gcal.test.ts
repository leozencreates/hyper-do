import { describe, it, expect, vi, afterEach } from 'vitest'
import { ANDROID_REDIRECT_URI, CALENDAR_SCOPE_ERROR, GoogleCalendarClient, buildAuthUrl, exchangeCode, hasCalendarScope, parseOAuthRedirect, refreshAccessToken } from './gcal'

/** Captures the form body of the next token request and answers with a valid token. */
function stubToken() {
  const calls: URLSearchParams[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: { body?: URLSearchParams }) => {
      calls.push(init?.body ?? new URLSearchParams())
      return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('token requests (PKCE)', () => {
  it('exchangeCode omits client_secret for public clients (Android) and sends it when present', async () => {
    const calls = stubToken()
    await exchangeCode({ clientId: 'id', code: 'c', verifier: 'v', redirectUri: ANDROID_REDIRECT_URI })
    expect(calls[0].has('client_secret')).toBe(false)
    expect(calls[0].get('client_id')).toBe('id')
    expect(calls[0].get('code_verifier')).toBe('v')
    expect(calls[0].get('redirect_uri')).toBe('com.hyperdo.app:/oauth2redirect')
    expect(calls[0].get('grant_type')).toBe('authorization_code')

    await exchangeCode({ clientId: 'id', clientSecret: 'sec', code: 'c', verifier: 'v', redirectUri: 'http://127.0.0.1:1/callback' })
    expect(calls[1].get('client_secret')).toBe('sec')
  })

  it('refreshAccessToken treats an empty secret like a missing one', async () => {
    const calls = stubToken()
    const t = await refreshAccessToken({ clientId: 'id', clientSecret: '', refreshToken: 'rt' })
    expect(calls[0].has('client_secret')).toBe(false)
    expect(calls[0].get('grant_type')).toBe('refresh_token')
    expect(t.accessToken).toBe('at')
  })
})

describe('buildAuthUrl', () => {
  it('carries the PKCE challenge, state and the custom-scheme redirect', () => {
    const u = new URL(buildAuthUrl({ clientId: 'id', redirectUri: ANDROID_REDIRECT_URI, challenge: 'ch', state: 'st' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(u.searchParams.get('redirect_uri')).toBe(ANDROID_REDIRECT_URI)
    expect(u.searchParams.get('code_challenge')).toBe('ch')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('state')).toBe('st')
    expect(u.searchParams.get('access_type')).toBe('offline')
  })
})

describe('parseOAuthRedirect', () => {
  it('parses code + state from the Android custom-scheme URL', () => {
    expect(parseOAuthRedirect('com.hyperdo.app:/oauth2redirect?state=abc&code=4%2Fxyz&scope=email')).toEqual({ code: '4/xyz', state: 'abc', error: null })
  })

  it('parses an error and a loopback URL', () => {
    expect(parseOAuthRedirect('http://127.0.0.1:5000/callback?error=access_denied&state=s')).toEqual({ code: null, state: 's', error: 'access_denied' })
  })

  it('returns null without a query or without code/error', () => {
    expect(parseOAuthRedirect('com.hyperdo.app:/oauth2redirect')).toBeNull()
    expect(parseOAuthRedirect('com.hyperdo.app:/oauth2redirect?foo=bar')).toBeNull()
  })
})

describe('calendar scope (consent screen box left unticked)', () => {
  it('hasCalendarScope: missing calendar scope is detected, an absent list counts as granted', () => {
    expect(hasCalendarScope('openid https://www.googleapis.com/auth/userinfo.email')).toBe(false)
    expect(hasCalendarScope('openid https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email')).toBe(true)
    expect(hasCalendarScope('https://www.googleapis.com/auth/calendar.readonly')).toBe(false)
    expect(hasCalendarScope(undefined)).toBe(true)
    expect(hasCalendarScope('')).toBe(true)
  })

  it('token responses carry the granted scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600, scope: 'openid email' }), { status: 200 })))
    expect((await refreshAccessToken({ clientId: 'id', refreshToken: 'rt' })).scope).toBe('openid email')
  })

  it('a 403 "insufficient authentication scopes" becomes the calendar_scope error', async () => {
    const body = { error: { code: 403, message: 'Request had insufficient authentication scopes.', errors: [{ reason: 'insufficientPermissions' }] } }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 403 })))
    const api = new GoogleCalendarClient(async () => 'at')
    await expect(api.listCalendars()).rejects.toMatchObject({ code: CALENDAR_SCOPE_ERROR })
  })
})
