import { describe, it, expect } from 'vitest'
import { browserDefaultSettings, normalizeCalendarSettings, normalizeDailyDone, normalizeData, normalizeDigestSettings, normalizeFocusLog, normalizeHfSession, normalizeMiniAppSettings, normalizeMiniAppUrl, parseAppData } from './data'
import { FOCUS_LOG_MAX } from './types'
import { DEFAULT_SETTINGS } from './types'
import { detectLang } from './i18n'

describe('parseAppData: missing or unreadable input', () => {
  it('null / undefined / empty string → empty tasks and default settings', () => {
    for (const raw of [null, undefined, '']) {
      const d = parseAppData(raw)
      expect(d.tasks).toEqual([])
      expect(d.settings).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('garbage JSON and JSON of the wrong shape → defaults, never throws', () => {
    for (const raw of ['{not json', '"a string"', '[]', 'null', '42', 'true', '{"tasks":"nope","settings":5}']) {
      const d = parseAppData(raw)
      expect(d.tasks).toEqual([])
      expect(d.settings).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('uses the given base settings for empty input', () => {
    const d = parseAppData(null, { ...DEFAULT_SETTINGS, language: 'ru' })
    expect(d.settings.language).toBe('ru')
  })
})

describe('parseAppData: old-version documents', () => {
  const OLD = JSON.stringify({
    tasks: [
      { id: 'a', title: 'Old task', done: true, createdAt: 1000 },
      { id: 'b', title: 'Second', priority: 'high', dueAt: 5000, status: 'doing', createdAt: 2000, order: 7 },
    ],
    settings: { language: 'tr', quietHours: { enabled: true }, telegram: { token: 'abc' }, legacyFlag: 1 },
  })

  it('completes every task field and ignores unknown ones', () => {
    const d = parseAppData(OLD)
    expect(d.tasks).toHaveLength(2)
    expect(d.tasks[0]).toEqual({
      id: 'a',
      title: 'Old task',
      notes: '',
      priority: 'medium',
      tags: [],
      dueAt: null,
      recurrence: 'none',
      subtasks: [],
      remindEveryMin: 0,
      snoozedUntil: null,
      focused: false,
      status: 'todo',
      order: 1000,
      completedAt: null,
      createdAt: 1000,
      nagCount: 0,
      estimateMin: null,
      energy: null,
      updatedAt: 1000,
    })
    expect(d.tasks[1]).toMatchObject({ id: 'b', priority: 'high', dueAt: 5000, status: 'doing', order: 7 })
  })

  it('merges nested settings with the defaults instead of replacing them', () => {
    const { settings } = parseAppData(OLD)
    expect(settings.language).toBe('tr')
    expect(settings.quietHours).toEqual({ enabled: true, from: '23:00', to: '08:00' })
    expect(settings.telegram).toEqual({ enabled: false, token: 'abc', chatId: '', botUsername: '', pairCode: '', tidy: true, onlyWhenIdle: false, idleMinutes: 5 })
    expect(settings.pomodoro).toEqual({ workMin: 40, breakMin: 5 })
    expect(settings.calendar).toEqual(DEFAULT_SETTINGS.calendar)
    expect(settings.escalateOverdue).toBe(true)
    expect(settings.defaultRemindEveryMin).toBe(20)
    expect((settings as unknown as { legacyFlag: number }).legacyFlag).toBe(1) // unknown keys survive a round-trip
  })

  it('a document without a settings object gets the base settings', () => {
    const d = parseAppData('{"tasks":[]}', { ...DEFAULT_SETTINGS, theme: 'light' })
    expect(d.settings.theme).toBe('light')
  })

  it('old documents get the desktop defaults and no Hyper Focus session', () => {
    const { settings, hyperFocus } = parseAppData(OLD)
    expect(settings.launchAtLogin).toBe(false)
    expect(settings.focusSuppressOthers).toBe(true)
    expect(settings.quickAddShortcut).toBe('CommandOrControl+Shift+Space')
    expect(settings.autoBackup).toBe(true)
    expect(hyperFocus).toBeNull()
  })

  it('keeps a stored Hyper Focus session (reconstructing startedAt from the work length) and a non-string shortcut falls back to the default', () => {
    const d = parseAppData(JSON.stringify({ tasks: [], settings: { quickAddShortcut: 5, pomodoro: { workMin: 25 } }, hyperFocus: { phase: 'work', round: 2, endsAt: 1000, pausedRemaining: null, taskId: 'a' } }))
    expect(d.hyperFocus).toEqual({ phase: 'work', round: 2, endsAt: 1000, pausedRemaining: null, taskId: 'a', startedAt: 1000 - 25 * 60_000 })
    expect(d.settings.quickAddShortcut).toBe('CommandOrControl+Shift+Space')
  })

  it('old documents get the Batch 2 defaults: escalation ladder, celebration, empty focus log and counters', () => {
    const d = parseAppData(OLD)
    expect(d.settings.escalation).toEqual({ enabled: true, telegramAfter: 3, popupAfter: 5 })
    expect(d.settings.celebrate).toBe(true)
    expect(d.settings.sounds).toBe(true)
    expect(d.focusLog).toEqual([])
    expect(d.dailyDone).toEqual({})
  })

  it('a partial escalation object is merged with the defaults', () => {
    const d = parseAppData(JSON.stringify({ tasks: [], settings: { escalation: { popupAfter: 9 }, celebrate: false, sounds: false } }))
    expect(d.settings.escalation).toEqual({ enabled: true, telegramAfter: 3, popupAfter: 9 })
    expect(d.settings.celebrate).toBe(false)
    expect(d.settings.sounds).toBe(false)
  })

  it('old documents get the Telegram v2 / digest defaults: tidy on, idle rule off (5 min), no mute, morning digest 08:00', () => {
    const d = parseAppData(OLD)
    expect(d.settings.telegram).toMatchObject({ tidy: true, onlyWhenIdle: false, idleMinutes: 5 })
    expect(d.settings.mutedUntil).toBeNull()
    expect(d.settings.digest).toEqual({ enabled: true, time: '08:00', evening: false, eveningTime: '20:00' })
    const set = parseAppData(JSON.stringify({ tasks: [], settings: { mutedUntil: 1_900_000_000_000, telegram: { tidy: false, onlyWhenIdle: true, idleMinutes: 12.7 }, digest: { enabled: false, time: '07:15', evening: true } } }))
    expect(set.settings.telegram).toMatchObject({ tidy: false, onlyWhenIdle: true, idleMinutes: 12 })
    expect(set.settings.mutedUntil).toBe(1_900_000_000_000)
    expect(set.settings.digest).toEqual({ enabled: false, time: '07:15', evening: true, eveningTime: '20:00' })
    const bad = parseAppData(JSON.stringify({ tasks: [], settings: { mutedUntil: 'later', telegram: { tidy: 'yes', idleMinutes: 0 }, digest: { time: '25:00', eveningTime: 5 } } }))
    expect(bad.settings.telegram).toMatchObject({ tidy: true, idleMinutes: 5 })
    expect(bad.settings.mutedUntil).toBeNull()
    expect(bad.settings.digest).toEqual(DEFAULT_SETTINGS.digest)
    expect(normalizeDigestSettings(undefined)).toEqual(DEFAULT_SETTINGS.digest)
  })

  it('old documents get the Batch 5 defaults: auto-update on, empty Android client id', () => {
    const d = parseAppData(OLD)
    expect(d.settings.autoUpdate).toBe(true)
    expect(d.settings.calendar.google.androidClientId).toBe('')
    const off = parseAppData(JSON.stringify({ tasks: [], settings: { autoUpdate: false, calendar: { google: { androidClientId: 'abc.apps.googleusercontent.com' } } } }))
    expect(off.settings.autoUpdate).toBe(false)
    expect(off.settings.calendar.google.androidClientId).toBe('abc.apps.googleusercontent.com')
    expect(parseAppData(JSON.stringify({ tasks: [], settings: { autoUpdate: 'yes', calendar: { google: { androidClientId: 5 } } } })).settings).toMatchObject({ autoUpdate: true, calendar: { google: { androidClientId: '' } } })
  })

  it('old documents get the Mini App defaults (off, no URL); stored values are kept, the URL must be https and loses trailing slashes', () => {
    expect(parseAppData(OLD).settings.miniApp).toEqual({ mode: 'off', publicUrl: '' })
    expect(DEFAULT_SETTINGS.miniApp).toEqual({ mode: 'off', publicUrl: '' })
    const set = parseAppData(JSON.stringify({ tasks: [], settings: { miniApp: { mode: 'manual', publicUrl: ' https://abc.trycloudflare.com/ ' } } }))
    expect(set.settings.miniApp).toEqual({ mode: 'manual', publicUrl: 'https://abc.trycloudflare.com' })
    expect(parseAppData(JSON.stringify({ tasks: [], settings: { miniApp: { mode: 'cloudflare' } } })).settings.miniApp).toEqual({ mode: 'cloudflare', publicUrl: '' })
    const bad = parseAppData(JSON.stringify({ tasks: [], settings: { miniApp: { mode: 'ngrok', publicUrl: 'http://insecure.example' } } }))
    expect(bad.settings.miniApp).toEqual({ mode: 'off', publicUrl: '' })
    expect(normalizeMiniAppSettings(undefined)).toEqual(DEFAULT_SETTINGS.miniApp)
    expect(normalizeMiniAppSettings({ publicUrl: 5 } as never)).toEqual(DEFAULT_SETTINGS.miniApp)
    expect(normalizeMiniAppUrl('https://x.example/path/')).toBe('https://x.example/path')
    expect(normalizeMiniAppUrl('HTTPS://X.example')).toBe('HTTPS://X.example')
    expect(normalizeMiniAppUrl('ftp://x')).toBe('')
    expect(normalizeMiniAppUrl('https://')).toBe('')
    expect(normalizeMiniAppUrl(null)).toBe('')
  })
})

describe('normalizeHfSession', () => {
  it('accepts a well-formed session and repairs optional fields', () => {
    expect(normalizeHfSession({ phase: 'break', endsAt: 5 })).toEqual({ phase: 'break', round: 1, endsAt: 5, pausedRemaining: null, taskId: null, startedAt: 5 - 5 * 60_000 })
    expect(normalizeHfSession({ phase: 'work', round: 3.7, endsAt: 5, pausedRemaining: -3, taskId: '', startedAt: 2 })).toEqual({ phase: 'work', round: 3, endsAt: 5, pausedRemaining: 0, taskId: null, startedAt: 2 })
    expect(normalizeHfSession({ phase: 'work', endsAt: 5 }, { workMin: 10, breakMin: 1 })!.startedAt).toBe(5 - 10 * 60_000)
  })

  it('rejects garbage', () => {
    for (const bad of [null, undefined, 'work', 7, {}, { phase: 'nap', endsAt: 1 }, { phase: 'work' }, { phase: 'work', endsAt: 'soon' }, { phase: 'work', endsAt: NaN }]) {
      expect(normalizeHfSession(bad)).toBeNull()
    }
  })
})

describe('normalizeData', () => {
  it('returns the same shape for an in-memory partial object', () => {
    const d = normalizeData({ tasks: [{ id: 'x' }] } as never)
    expect(d.tasks[0].id).toBe('x')
    expect(d.tasks[0].status).toBe('todo')
    expect(d.settings).toEqual(DEFAULT_SETTINGS)
    expect(d.hyperFocus).toBeNull()
    expect(d.focusLog).toEqual([])
    expect(d.dailyDone).toEqual({})
  })
})

describe('normalizeFocusLog', () => {
  const entry = (i: number) => ({ id: 'e' + i, taskId: 't', phase: 'work' as const, startedAt: i, endedAt: i + 60_000 })

  it('keeps well-formed entries, drops garbage, and non-arrays become an empty log', () => {
    const ok = entry(1)
    const bad = [null, 5, {}, { ...ok, phase: 'nap' }, { ...ok, endedAt: 0 }, { ...ok, taskId: 7 }, { ...ok, id: 3 }]
    expect(normalizeFocusLog([ok, ...bad, { ...ok, id: 'e2', taskId: null }])).toEqual([ok, { ...ok, id: 'e2', taskId: null }])
    expect(normalizeFocusLog('x')).toEqual([])
    expect(normalizeFocusLog(undefined)).toEqual([])
  })

  it('caps the log at the newest FOCUS_LOG_MAX entries', () => {
    const log = Array.from({ length: FOCUS_LOG_MAX + 10 }, (_, i) => entry(i))
    const out = normalizeFocusLog(log)
    expect(out).toHaveLength(FOCUS_LOG_MAX)
    expect(out[0].id).toBe('e10')
    expect(out[out.length - 1].id).toBe('e' + (FOCUS_LOG_MAX + 9))
  })
})

describe('normalizeDailyDone', () => {
  it('keeps YYYY-MM-DD keys with positive numbers only', () => {
    expect(normalizeDailyDone({ '2026-10-13': 3, '2026-10-12': 1.9, '2026-10-11': 0, '2026-10-10': -1, 'yesterday': 2, '2026-10-09': '2' })).toEqual({ '2026-10-13': 3, '2026-10-12': 1 })
    expect(normalizeDailyDone(null)).toEqual({})
    expect(normalizeDailyDone([1, 2])).toEqual({})
  })
})

describe('normalizeCalendarSettings', () => {
  it('fills defaults for a missing object', () => {
    expect(normalizeCalendarSettings(undefined)).toEqual(DEFAULT_SETTINGS.calendar)
    expect(normalizeCalendarSettings(null)).toEqual(DEFAULT_SETTINGS.calendar)
  })

  it('repairs feeds: drops entries without a URL, invents ids, defaults colour and enabled', () => {
    const c = normalizeCalendarSettings({
      feeds: [{ url: 'https://a.example/cal.ics' }, { id: 'keep', name: 'Work', url: 'webcal://b.example', color: '#ff0000', enabled: false }, { name: 'no url' }] as never,
    })
    expect(c.feeds).toHaveLength(2)
    expect(c.feeds[0]).toMatchObject({ name: '', url: 'https://a.example/cal.ics', color: '#38bdf8', enabled: true })
    expect(c.feeds[0].id.length).toBeGreaterThan(0)
    expect(c.feeds[1]).toEqual({ id: 'keep', name: 'Work', url: 'webcal://b.example', color: '#ff0000', enabled: false })
  })

  it('keeps only string ids in hiddenCalendarIds and carries over the Google client', () => {
    const c = normalizeCalendarSettings({ showEvents: false, google: { clientId: 'id1', clientSecret: 'sec', androidClientId: '', pushTasks: true, hiddenCalendarIds: ['x', 3, null] as never } })
    expect(c.showEvents).toBe(false)
    expect(c.autoImport).toBe(true)
    expect(c.google).toEqual({ clientId: 'id1', clientSecret: 'sec', androidClientId: '', pushTasks: true, hiddenCalendarIds: ['x'] })
  })
})

describe('browserDefaultSettings', () => {
  it('is DEFAULT_SETTINGS with the detected language', () => {
    expect(browserDefaultSettings()).toEqual({ ...DEFAULT_SETTINGS, language: detectLang() })
  })
})
