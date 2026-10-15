/**
 * initData validation (D2): the fixture is signed inside the test with a dummy bot token, exactly the way
 * Telegram signs it (HMAC "WebAppData" → secret, HMAC over the sorted key=value lines).
 */
import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { dataCheckString, initDataFromHeader, initDataHash, validateInitData } from './tg-auth'

const TOKEN = '123456:ABC-dummy-token'
const NOW_SEC = Math.floor(new Date(2026, 9, 15, 12, 0).getTime() / 1000)

/** Builds a signed `initData` query string like the Telegram client does. */
function signed(fields: Record<string, string>, token = TOKEN): string {
  const entries = Object.entries(fields)
  const p = new URLSearchParams(entries)
  p.set('hash', initDataHash(entries, token))
  return p.toString()
}

const USER = JSON.stringify({ id: 42, first_name: 'Leo', language_code: 'tr' })
const base = { auth_date: String(NOW_SEC - 60), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', user: USER }

describe('validateInitData', () => {
  it('matches the documented algorithm (independent HMAC computation)', () => {
    const entries = Object.entries(base)
    const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest()
    const check = entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
    expect(dataCheckString(entries)).toBe(check)
    expect(initDataHash(entries, TOKEN)).toBe(createHmac('sha256', secret).update(check).digest('hex'))
  })

  it('accepts a freshly signed string and returns the user id + auth date', () => {
    const r = validateInitData(signed(base), TOKEN, NOW_SEC)
    expect(r).toEqual({ ok: true, userId: 42, authDate: NOW_SEC - 60 })
  })

  it('rejects a wrong hash: another token, tampered fields, upper-case hex still compares', () => {
    expect(validateInitData(signed(base, 'other-token'), TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'hash' })
    const tampered = signed(base).replace('%22id%22%3A42', '%22id%22%3A43')
    expect(tampered).not.toBe(signed(base))
    expect(validateInitData(tampered, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'hash' })
    const upper = signed(base).replace(/hash=([0-9a-f]+)/, (_m, h: string) => `hash=${h.toUpperCase()}`)
    expect(validateInitData(upper, TOKEN, NOW_SEC).ok).toBe(true)
  })

  it('rejects an expired auth_date (older than maxAgeSec), default window 7 days', () => {
    const old = signed({ ...base, auth_date: String(NOW_SEC - 8 * 86_400) })
    expect(validateInitData(old, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'expired' })
    const sixDays = signed({ ...base, auth_date: String(NOW_SEC - 6 * 86_400) })
    expect(validateInitData(sixDays, TOKEN, NOW_SEC).ok).toBe(true)
    expect(validateInitData(sixDays, TOKEN, NOW_SEC, 3600)).toEqual({ ok: false, error: 'expired' })
  })

  it('malformed: empty, no hash, non-hex hash, missing / unreadable user, no auth_date, empty token', () => {
    expect(validateInitData('', TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    expect(validateInitData('auth_date=1&user=%7B%22id%22%3A1%7D', TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    expect(validateInitData('auth_date=1&user=%7B%22id%22%3A1%7D&hash=zz', TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    const noUser = signed({ auth_date: base.auth_date, query_id: 'q' })
    expect(validateInitData(noUser, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    const badUser = signed({ ...base, user: '{not json' })
    expect(validateInitData(badUser, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    const stringId = signed({ ...base, user: JSON.stringify({ id: '42' }) })
    expect(validateInitData(stringId, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    const noDate = signed({ query_id: 'q', user: USER })
    expect(validateInitData(noDate, TOKEN, NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
    expect(validateInitData(signed(base), '', NOW_SEC)).toEqual({ ok: false, error: 'malformed' })
  })
})

describe('initDataFromHeader', () => {
  it('extracts the initData after the tma scheme, otherwise null', () => {
    expect(initDataFromHeader('tma auth_date=1&hash=ab')).toBe('auth_date=1&hash=ab')
    expect(initDataFromHeader('TMA  x=1 ')).toBe('x=1')
    expect(initDataFromHeader(['tma a=1', 'tma b=2'])).toBe('a=1')
    expect(initDataFromHeader('Bearer abc')).toBeNull()
    expect(initDataFromHeader('tma')).toBeNull()
    expect(initDataFromHeader(undefined)).toBeNull()
  })
})
