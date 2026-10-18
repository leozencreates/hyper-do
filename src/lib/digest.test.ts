import { describe, it, expect } from 'vitest'
import { buildDigest, digestDue, markDigestSent, parseDigestState, parseHHMM, planDigestTimes, type DigestState } from './digest'
import { normalizeData } from './data'
import { normalizeTask } from './tasks'
import { DEFAULT_SETTINGS, type AppData, type Settings, type Task } from './types'
import { translate } from './i18n'
import { dayKey, formatDue } from './dates'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
const at = (day: number, h: number, m = 0, month = 9) => new Date(2026, month, day, h, m).getTime()

const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o })
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, ...o })
const data = (tasks: Task[], extra: Partial<AppData> = {}): AppData => normalizeData({ tasks, settings: settings(), ...extra })

const SAMPLE = () =>
  data(
    [
      task({ id: 'a', title: 'Pay <bill>', dueAt: NOW - H, priority: 'high' }),
      task({ id: 'b', title: 'Call mom', dueAt: NOW + 2 * H }),
      task({ id: 'c', title: 'Dentist', dueAt: NOW + 26 * H, priority: 'low' }),
      task({ id: 'd', title: 'Write report', focused: true }),
      task({ id: 'e', title: 'Laundry', dueAt: NOW + 5 * H, priority: 'low' }),
      task({ id: 'z', title: 'Old one', completedAt: NOW - H }),
    ],
    { dailyDone: { [dayKey(NOW)]: 1, [dayKey(NOW - 24 * H)]: 2, [dayKey(NOW - 48 * H)]: 1, [dayKey(NOW - 5 * 24 * H)]: 3 } },
  )

describe('parseHHMM / parseDigestState', () => {
  it('reads HH:MM and tolerates garbage', () => {
    expect(parseHHMM('08:00')).toBe(480)
    expect(parseHHMM('20:30')).toBe(1230)
    expect(parseHHMM('x')).toBe(0)
    expect(parseDigestState(null)).toEqual({ lastDigestAt: null, lastEveningAt: null })
    expect(parseDigestState('{bad')).toEqual({ lastDigestAt: null, lastEveningAt: null })
    expect(parseDigestState(JSON.stringify({ lastDigestAt: 5, lastEveningAt: 'no' }))).toEqual({ lastDigestAt: 5, lastEveningAt: null })
  })
})

describe('buildDigest', () => {
  it('morning: counts overdue / due today / open, the streak, and lists the top 3 by smart order (plain + HTML)', () => {
    const d = buildDigest(SAMPLE(), NOW, 'en', 'morning')
    expect(d.kind).toBe('morning')
    expect(d.title).toBe(translate('en', 'digest_morning_title'))
    expect(d.tasks.map((t) => t.id)).toEqual(['d', 'a', 'b'])
    const head = `${translate('en', 'digest_morning', { overdue: 1, today: 2, open: 5 })} · ${translate('en', 'digest_streak', { n: 3 })}`
    expect(d.body.split('\n')).toEqual([head, '1. 🟠 Write report', `2. 🔴 Pay <bill> · ${formatDue(NOW - H, 'en', NOW)}`, `3. 🟠 Call mom · ${formatDue(NOW + 2 * H, 'en', NOW)}`])
    expect(d.html.split('\n')).toEqual([
      `<b>${translate('en', 'digest_morning_title')}</b>`,
      head,
      '1. 🟠 <b>Write report</b>',
      `2. 🔴 <b>Pay &lt;bill&gt;</b> · ${formatDue(NOW - H, 'en', NOW)}`,
      `3. 🟠 <b>Call mom</b> · ${formatDue(NOW + 2 * H, 'en', NOW)}`,
    ])
  })

  it('morning without open tasks says so; no streak line when the streak is 0', () => {
    const d = buildDigest(data([task({ id: 'z', completedAt: NOW - 3 * 24 * H })]), NOW, 'en', 'morning')
    expect(d.body).toBe(`${translate('en', 'digest_morning', { overdue: 0, today: 0, open: 0 })}\n${translate('en', 'digest_empty')}`)
    expect(d.tasks).toEqual([])
    expect(d.body).not.toContain('🔥')
  })

  it('evening: done today and what is still open for today; weekly: done this week, open, streak; no task list', () => {
    const e = buildDigest(SAMPLE(), NOW, 'en', 'evening')
    expect(e.title).toBe(translate('en', 'digest_evening_title'))
    expect(e.body).toBe(`${translate('en', 'digest_evening', { done: 1, open: 3 })} · ${translate('en', 'digest_streak', { n: 3 })}`)
    expect(e.tasks).toEqual([])
    const w = buildDigest(SAMPLE(), NOW, 'tr', 'weekly')
    expect(w.title).toBe(translate('tr', 'digest_weekly_title'))
    expect(w.body).toBe(`${translate('tr', 'digest_weekly', { done: 7, open: 5 })} · ${translate('tr', 'digest_streak', { n: 3 })}`)
    expect(w.html.startsWith(`<b>${translate('tr', 'digest_weekly_title')}</b>\n`)).toBe(true)
  })

  it('follows the requested language', () => {
    expect(buildDigest(SAMPLE(), NOW, 'ru', 'morning').title).toBe(translate('ru', 'digest_morning_title'))
  })
})

describe('digestDue', () => {
  const never: DigestState = { lastDigestAt: null, lastEveningAt: null }
  const s = (digest: Partial<Settings['digest']> = {}) => settings({ digest: { ...DEFAULT_SETTINGS.digest, ...digest } })

  it('morning fires from its time on, once per local day, for at most 12 hours', () => {
    expect(digestDue(s(), never, at(13, 7, 59))).toBeNull()
    expect(digestDue(s(), never, at(13, 8, 0))).toBe('morning')
    expect(digestDue(s(), never, at(13, 11, 30))).toBe('morning') // PC switched on late
    expect(digestDue(s(), never, at(13, 19, 59))).toBe('morning')
    expect(digestDue(s(), never, at(13, 20, 0))).toBeNull()
    const sent = markDigestSent(never, 'morning', at(13, 8, 0))
    expect(sent).toEqual({ lastDigestAt: at(13, 8, 0), lastEveningAt: null })
    expect(digestDue(s(), sent, at(13, 9, 0))).toBeNull()
    expect(digestDue(s(), sent, at(14, 8, 0))).toBe('morning') // next day again
    expect(digestDue(s({ enabled: false }), never, at(13, 9, 0))).toBeNull()
  })

  it('evening fires from eveningTime until midnight, once per day; Sunday evening is the weekly review', () => {
    const ev = s({ evening: true, eveningTime: '20:00' })
    expect(digestDue(ev, { lastDigestAt: at(13, 8), lastEveningAt: null }, at(13, 19, 59))).toBeNull()
    expect(digestDue(ev, { lastDigestAt: at(13, 8), lastEveningAt: null }, at(13, 20, 0))).toBe('evening')
    expect(digestDue(ev, { lastDigestAt: at(13, 8), lastEveningAt: null }, at(13, 23, 59))).toBe('evening')
    const sent = markDigestSent({ lastDigestAt: at(13, 8), lastEveningAt: null }, 'evening', at(13, 20))
    expect(digestDue(ev, sent, at(13, 21))).toBeNull()
    // Sunday 18 October 2026
    expect(digestDue(ev, { lastDigestAt: at(18, 8), lastEveningAt: null }, at(18, 20, 30))).toBe('weekly')
    expect(digestDue(ev, markDigestSent(never, 'weekly', at(18, 20, 30)), at(18, 21))).toBeNull()
    expect(digestDue(s({ evening: false }), { lastDigestAt: at(13, 8), lastEveningAt: null }, at(13, 21))).toBeNull()
  })

  it('a pending morning digest takes precedence over the evening one in the same tick', () => {
    const ev = s({ evening: true, eveningTime: '19:00' })
    expect(digestDue(ev, never, at(13, 19, 30))).toBe('morning')
    expect(digestDue(ev, markDigestSent(never, 'morning', at(13, 19, 30)), at(13, 19, 30))).toBe('evening')
  })
})

describe('planDigestTimes (Android)', () => {
  const s = (digest: Partial<Settings['digest']> = {}) => settings({ digest: { ...DEFAULT_SETTINGS.digest, ...digest } })

  it('plans every morning / evening in the window, oldest first, skipping times already passed', () => {
    // Tuesday 13 Oct 10:00, 48 h → Wed + Thu morning (today's 08:00 is gone), Tue + Wed evening
    expect(planDigestTimes(s({ evening: true }), NOW, 48 * H)).toEqual([
      { at: at(13, 20, 0), kind: 'evening' },
      { at: at(14, 8, 0), kind: 'morning' },
      { at: at(14, 20, 0), kind: 'evening' },
      { at: at(15, 8, 0), kind: 'morning' },
    ])
  })

  it('Sunday evening is the weekly review; disabled parts are left out', () => {
    // Saturday 17 Oct 21:00 → Sunday 08:00 + Sunday 20:00 weekly
    expect(planDigestTimes(s({ evening: true, time: '08:00' }), at(17, 21, 0), 24 * H)).toEqual([
      { at: at(18, 8, 0), kind: 'morning' },
      { at: at(18, 20, 0), kind: 'weekly' },
    ])
    expect(planDigestTimes(s({ enabled: false, evening: true }), at(17, 21, 0), 24 * H)).toEqual([{ at: at(18, 20, 0), kind: 'weekly' }])
    expect(planDigestTimes(s({ enabled: false, evening: false }), NOW, 48 * H)).toEqual([])
  })

  it('a time exactly at the start of the window is not planned again (it just fired)', () => {
    expect(planDigestTimes(s(), at(14, 8, 0), 24 * H)).toEqual([{ at: at(15, 8, 0), kind: 'morning' }])
  })
})
