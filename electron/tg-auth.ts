/**
 * Telegram Mini App `initData` validation (Phase D2). Pure Node (`node:crypto`), no `electron` import:
 * `electron/tg-auth.test.ts` runs it under Vitest with a fixture signed by `initDataHash`.
 *
 * Algorithm (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *   data_check_string = every `key=value` pair except `hash`, sorted by key, joined with "\n"
 *   secret_key        = HMAC_SHA256(key = "WebAppData", message = bot_token)
 *   hash              = hex(HMAC_SHA256(key = secret_key, message = data_check_string))
 * Compared in constant time; `auth_date` must be within `maxAgeSec` of `nowSec`.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export type InitDataResult = { ok: true; userId: number; authDate: number } | { ok: false; error: 'hash' | 'expired' | 'malformed' }

/** Default freshness window: Telegram re-signs `initData` on every launch; a week tolerates a long-lived tab. */
export const INIT_DATA_MAX_AGE_SEC = 7 * 86_400

/** `data_check_string` of the given fields (without `hash`): `key=value` lines sorted by key. */
export function dataCheckString(fields: Iterable<[string, string]>): string {
  return [...fields]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

/** The hex signature Telegram puts into `hash` for these fields and this bot token (used by tests to build fixtures). */
export function initDataHash(fields: Iterable<[string, string]>, botToken: string): string {
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  return createHmac('sha256', secret).update(dataCheckString(fields)).digest('hex')
}

/**
 * Validates `initData` (the raw query string `Telegram.WebApp.initData`). Returns the Telegram user id and the
 * signing time, or why it was rejected: `malformed` (not a query string, no hash, no user id, bad auth_date),
 * `hash` (signature mismatch — wrong bot token or tampered data), `expired` (older than `maxAgeSec`).
 */
export function validateInitData(initData: string, botToken: string, nowSec: number, maxAgeSec = INIT_DATA_MAX_AGE_SEC): InitDataResult {
  if (typeof initData !== 'string' || !initData || !botToken) return { ok: false, error: 'malformed' }
  let params: URLSearchParams
  try {
    params = new URLSearchParams(initData)
  } catch {
    return { ok: false, error: 'malformed' }
  }
  const given = params.get('hash')
  if (!given || !/^[0-9a-f]{64}$/i.test(given)) return { ok: false, error: 'malformed' }
  const authDate = Number(params.get('auth_date'))
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, error: 'malformed' }
  let userId = NaN
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as { id?: unknown } | null
    if (user && typeof user === 'object' && typeof user.id === 'number') userId = user.id
  } catch {
    /* no / unreadable user → malformed below */
  }
  if (!Number.isInteger(userId)) return { ok: false, error: 'malformed' }

  const expected = Buffer.from(initDataHash(params.entries(), botToken), 'hex')
  const actual = Buffer.from(given.toLowerCase(), 'hex')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, error: 'hash' }
  if (nowSec - authDate > maxAgeSec) return { ok: false, error: 'expired' }
  return { ok: true, userId, authDate }
}

/** Parses the `Authorization` header of a Mini App request: `tma <initData>` → the initData, else null. */
export function initDataFromHeader(header: string | string[] | undefined): string | null {
  const h = Array.isArray(header) ? header[0] : header
  if (!h) return null
  const m = /^tma\s+(.+)$/is.exec(h.trim())
  return m ? m[1].trim() : null
}
