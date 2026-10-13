import { describe, it, expect } from 'vitest'
import { DAY, addDays, dayKey, dayKeyToDate, endOfDay, formatDue, formatMinutes, fromLocalInput, isEndOfDay, isOverdue, isThisWeek, isToday, nextOccurrence, recurrenceLabel, recurrenceText, recurrenceUnitName, relativeMinutes, startOfDay, toLocalInput, weekdayShort } from './dates'
import type { RecurrenceRule } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
const d = (day: number, h = 0, m = 0, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime()

describe('day boundaries', () => {
  it('startOfDay / endOfDay / isEndOfDay', () => {
    expect(startOfDay(NOW)).toBe(d(13))
    expect(endOfDay(NOW)).toBe(d(13, 23, 59))
    expect(isEndOfDay(endOfDay(NOW))).toBe(true)
    expect(isEndOfDay(NOW)).toBe(false)
  })

  it('isToday / isOverdue', () => {
    expect(isToday(d(13, 23, 59), NOW)).toBe(true)
    expect(isToday(d(14, 0, 0), NOW)).toBe(false)
    expect(isOverdue(NOW - 1, NOW)).toBe(true)
    expect(isOverdue(NOW, NOW)).toBe(false)
    expect(isOverdue(null, NOW)).toBe(false)
  })

  it('isThisWeek covers today 00:00 up to (excluding) the 7th midnight', () => {
    expect(isThisWeek(d(13, 0, 0), NOW)).toBe(true)
    expect(isThisWeek(d(12, 23, 59), NOW)).toBe(false)
    expect(isThisWeek(d(19, 23, 59), NOW)).toBe(true)
    expect(isThisWeek(d(13) + 7 * DAY, NOW)).toBe(false)
  })
})

describe('dayKey / dayKeyToDate / addDays', () => {
  it('dayKey is the zero-padded local date', () => {
    expect(dayKey(NOW)).toBe('2026-10-13')
    expect(dayKey(d(1, 0, 0, 0))).toBe('2026-01-01')
    expect(dayKey(d(13, 23, 59))).toBe('2026-10-13')
    expect(dayKey(d(14, 0, 0))).toBe('2026-10-14')
  })

  it('dayKeyToDate is local midnight of that day; a malformed key falls back to today', () => {
    expect(dayKeyToDate('2026-10-13').getTime()).toBe(d(13))
    expect(dayKeyToDate('2026-01-01').getTime()).toBe(d(1, 0, 0, 0))
    expect(dayKeyToDate('nope').getTime()).toBe(startOfDay(Date.now()))
  })

  it('addDays steps by calendar days from local midnight', () => {
    expect(addDays(NOW, 1)).toBe(d(14))
    expect(addDays(NOW, -13)).toBe(d(30, 0, 0, 8))
    expect(addDays(d(31, 18, 0), 1)).toBe(d(1, 0, 0, 10))
  })
})

describe('formatMinutes', () => {
  it('EN: 30m · 1h · 1h 10m; TR and RU units', () => {
    expect(formatMinutes(30, 'en')).toBe('30m')
    expect(formatMinutes(60, 'en')).toBe('1h')
    expect(formatMinutes(70, 'en')).toBe('1h 10m')
    expect(formatMinutes(0, 'en')).toBe('0m')
    expect(formatMinutes(-5, 'en')).toBe('0m')
    expect(formatMinutes(29.6, 'en')).toBe('30m')
    expect(formatMinutes(70, 'tr')).toBe('1sa 10dk')
    expect(formatMinutes(120, 'ru')).toBe('2 ч')
    expect(formatMinutes(45, 'ru')).toBe('45 мин')
  })
})

describe('nextOccurrence', () => {
  it('daily: the first day after the due date that is still in the future', () => {
    expect(nextOccurrence(d(12, 18, 0), 'daily', NOW)).toBe(d(13, 18, 0))
    expect(nextOccurrence(d(14, 18, 0), 'daily', NOW)).toBe(d(15, 18, 0))
    expect(nextOccurrence(d(1, 18, 0), 'daily', NOW)).toBe(d(13, 18, 0)) // skips the missed days
    expect(nextOccurrence(d(13, 9, 0), 'daily', NOW)).toBe(d(14, 9, 0)) // today's time already passed
  })

  it('weekdays: skips Saturday and Sunday', () => {
    expect(nextOccurrence(d(16, 18, 0), 'weekdays', NOW)).toBe(d(19, 18, 0)) // Fri → Mon
    expect(nextOccurrence(d(15, 18, 0), 'weekdays', NOW)).toBe(d(16, 18, 0)) // Thu → Fri
    expect(nextOccurrence(d(10, 18, 0), 'weekdays', NOW)).toBe(d(13, 18, 0)) // Sat 10th → Mon 12th is past → Tue 13th
  })

  it('weekly: same weekday, same time, first slot after now', () => {
    expect(nextOccurrence(d(13, 9, 0), 'weekly', NOW)).toBe(d(20, 9, 0))
    expect(nextOccurrence(d(1, 9, 0, 8), 'weekly', NOW)).toBe(d(20, 9, 0)) // 1 Sep (Tue) → 20 Oct
  })

  it('monthly: same day next month', () => {
    expect(nextOccurrence(d(13, 18, 0, 8), 'monthly', NOW)).toBe(d(13, 18, 0))
    expect(nextOccurrence(d(13, 9, 0), 'monthly', NOW)).toBe(d(13, 9, 0, 10))
  })

  it('monthly from the 31st clamps to the last day of the month and does not drift', () => {
    expect(nextOccurrence(d(31, 18, 0, 0), 'monthly', d(1, 0, 0, 1))).toBe(d(28, 18, 0, 1)) // 31 Jan → 28 Feb
    expect(nextOccurrence(d(31, 18, 0, 0), 'monthly', d(1, 0, 0, 2))).toBe(d(31, 18, 0, 2)) // 31 Jan → (28 Feb) → 31 Mar
    expect(nextOccurrence(d(31, 18, 0, 2), 'monthly', d(1, 0, 0, 3))).toBe(d(30, 18, 0, 3)) // 31 Mar → 30 Apr
    expect(nextOccurrence(d(30, 18, 0, 0), 'monthly', d(1, 0, 0, 1))).toBe(d(28, 18, 0, 1)) // 30 Jan → 28 Feb
    expect(nextOccurrence(d(31, 18, 0, 0), 'monthly', d(1, 0, 0, 4))).toBe(d(31, 18, 0, 4)) // 31 Jan → … → 31 May
  })

  it('yearly: +1 year; 29 Feb falls back to 28 Feb in common years and returns on the next leap year', () => {
    expect(nextOccurrence(d(13, 18, 0, 9, 2025), 'yearly', NOW)).toBe(d(13, 18, 0, 9, 2026))
    expect(nextOccurrence(d(13, 9, 0), 'yearly', NOW)).toBe(d(13, 9, 0, 9, 2027)) // today 09:00 already passed
    expect(nextOccurrence(d(29, 9, 0, 1, 2024), 'yearly', d(1, 0, 0, 2, 2024))).toBe(d(28, 9, 0, 1, 2025))
    expect(nextOccurrence(d(29, 9, 0, 1, 2024), 'yearly', d(1, 0, 0, 2, 2027))).toBe(d(29, 9, 0, 1, 2028))
  })

  it('none returns the due date unchanged', () => {
    expect(nextOccurrence(d(1, 18, 0), 'none', NOW)).toBe(d(1, 18, 0))
  })

  it('custom every N days / weeks / months / years', () => {
    expect(nextOccurrence(d(12, 18, 0), 'custom', NOW, { every: 3, unit: 'day' })).toBe(d(15, 18, 0))
    expect(nextOccurrence(d(1, 18, 0), 'custom', NOW, { every: 3, unit: 'day' })).toBe(d(13, 18, 0)) // 1 → 4 → 7 → 10 → 13
    expect(nextOccurrence(d(13, 9, 0), 'custom', NOW, { every: 2, unit: 'week' })).toBe(d(27, 9, 0))
    expect(nextOccurrence(d(13, 9, 0, 8), 'custom', NOW, { every: 2, unit: 'month' })).toBe(d(13, 9, 0, 10)) // 13 Sep → 13 Nov
    expect(nextOccurrence(d(13, 9, 0, 9, 2024), 'custom', NOW, { every: 2, unit: 'year' })).toBe(d(13, 9, 0, 9, 2028)) // 2026 09:00 is past
    expect(nextOccurrence(d(31, 18, 0, 0), 'custom', d(1, 0, 0, 1), { every: 2, unit: 'month' })).toBe(d(31, 18, 0, 2)) // 31 Jan → 31 Mar
    expect(nextOccurrence(d(31, 18, 0, 2), 'custom', d(1, 0, 0, 3), { every: 3, unit: 'month' })).toBe(d(30, 18, 0, 5)) // 31 Mar → 30 Jun
  })

  it('custom without a stored rule behaves like the default (weekly)', () => {
    expect(nextOccurrence(d(13, 9, 0), 'custom', NOW)).toBe(d(20, 9, 0))
  })

  it('weekday set: the next listed weekday after the base, same time of day', () => {
    const mwf: RecurrenceRule = { every: 1, unit: 'week', weekdays: [1, 3, 5] }
    const after = (day: number, now = d(day, 19, 0)) => nextOccurrence(d(day, 18, 0), 'custom', now, mwf)
    expect(after(12)).toBe(d(14, 18, 0)) // Mon → Wed
    expect(after(14)).toBe(d(16, 18, 0)) // Wed → Fri
    expect(after(16)).toBe(d(19, 18, 0)) // Fri → Mon
    expect(after(15)).toBe(d(16, 18, 0)) // Thu (not listed) → Fri
    expect(after(17)).toBe(d(19, 18, 0)) // Sat → Mon
    expect(nextOccurrence(d(5, 18, 0), 'custom', NOW, mwf)).toBe(d(14, 18, 0)) // skips the missed Wed 7, Fri 9, Mon 12
    expect(nextOccurrence(d(12, 18, 0), 'custom', NOW, { every: 1, unit: 'week', weekdays: [0] })).toBe(d(18, 18, 0)) // Sunday only
  })

  it('every 2 weeks Mon/Wed: after Wed jump to Mon of the week two weeks after the anchor week', () => {
    const rule: RecurrenceRule = { every: 2, unit: 'week', weekdays: [1, 3] }
    expect(nextOccurrence(d(12, 18, 0), 'custom', d(12, 19, 0), rule)).toBe(d(14, 18, 0)) // Mon 12 → Wed 14 (same week)
    expect(nextOccurrence(d(14, 18, 0), 'custom', d(14, 19, 0), rule)).toBe(d(26, 18, 0)) // Wed 14 → Mon 26 (skips week of 19th)
    expect(nextOccurrence(d(7, 18, 0), 'custom', NOW, rule)).toBe(d(19, 18, 0)) // anchor week 5 Oct → on-weeks 5, 19 Oct
  })

  it('afterCompletion: base is the completion time at the original time of day', () => {
    expect(nextOccurrence(d(1, 18, 0), 'custom', NOW, { every: 3, unit: 'day', afterCompletion: true })).toBe(d(16, 18, 0))
    expect(nextOccurrence(d(1, 9, 0), 'custom', NOW, { every: 1, unit: 'week', afterCompletion: true })).toBe(d(20, 9, 0))
    expect(nextOccurrence(d(5, 18, 0), 'custom', NOW, { every: 1, unit: 'week', weekdays: [1, 3], afterCompletion: true })).toBe(d(14, 18, 0)) // Tue → Wed
    expect(nextOccurrence(d(31, 18, 0, 0), 'custom', NOW, { every: 1, unit: 'month', afterCompletion: true })).toBe(d(13, 18, 0, 10)) // completed 13 Oct → 13 Nov
    expect(nextOccurrence(d(1, 18, 0), 'custom', NOW, { every: 1, unit: 'year', afterCompletion: true })).toBe(d(13, 18, 0, 9, 2027))
  })

  it('never returns a time at or before now', () => {
    for (const rec of ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'] as const) {
      expect(nextOccurrence(d(13, 10, 0), rec, NOW)).toBeGreaterThan(NOW)
    }
    expect(nextOccurrence(d(13, 10, 0), 'custom', NOW, { every: 1, unit: 'day', afterCompletion: true })).toBeGreaterThan(NOW)
    expect(nextOccurrence(d(13, 10, 0), 'custom', NOW, { every: 2, unit: 'week', weekdays: [2] })).toBe(d(27, 10, 0))
  })
})

describe('recurrence labels', () => {
  it('weekdayShort uses Intl in the UI language', () => {
    expect(weekdayShort('en', 1)).toBe('Mon')
    expect(weekdayShort('en', 0)).toBe('Sun')
    expect(weekdayShort('tr', 1)).toBe('Pzt')
    expect(weekdayShort('ru', 1)).toBe('пн')
  })

  it('recurrenceUnitName picks singular / plural (EN) and the Russian 1 / 2–4 / 5+ forms', () => {
    expect(recurrenceUnitName('en', 'day', 1)).toBe('day')
    expect(recurrenceUnitName('en', 'week', 2)).toBe('weeks')
    expect(recurrenceUnitName('tr', 'month', 3)).toBe('ay')
    expect(recurrenceUnitName('ru', 'day', 1)).toBe('день')
    expect(recurrenceUnitName('ru', 'day', 3)).toBe('дня')
    expect(recurrenceUnitName('ru', 'day', 5)).toBe('дней')
    expect(recurrenceUnitName('ru', 'day', 11)).toBe('дней')
    expect(recurrenceUnitName('ru', 'day', 21)).toBe('день')
  })

  it('recurrenceLabel: ↻ · ↻ 3d · ↻ 2w Mon·Wed · ↻ Mon·Wed·Fri · ↻ yearly', () => {
    expect(recurrenceLabel('none', null, 'en')).toBe('')
    expect(recurrenceLabel('daily', null, 'en')).toBe('↻')
    expect(recurrenceLabel('weekdays', null, 'en')).toBe('↻')
    expect(recurrenceLabel('yearly', null, 'en')).toBe('↻ yearly')
    expect(recurrenceLabel('custom', { every: 3, unit: 'day' }, 'en')).toBe('↻ 3d')
    expect(recurrenceLabel('custom', { every: 2, unit: 'week', weekdays: [3, 1] }, 'en')).toBe('↻ 2w Mon·Wed')
    expect(recurrenceLabel('custom', { every: 1, unit: 'week', weekdays: [1, 3, 5] }, 'en')).toBe('↻ Mon·Wed·Fri')
    expect(recurrenceLabel('custom', { every: 2, unit: 'month' }, 'en')).toBe('↻ 2mo')
    expect(recurrenceLabel('custom', { every: 3, unit: 'day' }, 'tr')).toBe('↻ 3g')
    expect(recurrenceLabel('custom', { every: 3, unit: 'day' }, 'ru')).toBe('↻ 3д')
    expect(recurrenceLabel('custom', null, 'en')).toBe('↻ 1w') // missing rule → default
  })

  it('recurrenceText: long form for tooltips and the quick-add preview', () => {
    expect(recurrenceText('daily', null, 'en')).toBe('Daily')
    expect(recurrenceText('yearly', null, 'tr')).toBe('Her yıl')
    expect(recurrenceText('custom', { every: 2, unit: 'week', weekdays: [1, 3], afterCompletion: true }, 'en')).toBe('Every 2 weeks · Mon, Wed · Repeat after completion')
    expect(recurrenceText('custom', { every: 3, unit: 'day' }, 'ru')).toBe('Каждые 3 дня')
    expect(recurrenceText('none', null, 'en')).toBe('')
  })
})

describe('formatDue', () => {
  const time = (ts: number, loc: string) => new Date(ts).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })

  it('returns an empty string for no due date', () => {
    expect(formatDue(null, 'en', NOW)).toBe('')
  })

  it('today / tomorrow / yesterday labels (TR, 24-hour clock)', () => {
    expect(formatDue(d(13, 18, 0), 'tr', NOW)).toBe('Bugün 18:00')
    expect(formatDue(d(14, 18, 0), 'tr', NOW)).toBe('Yarın 18:00')
    expect(formatDue(d(12, 18, 0), 'tr', NOW)).toBe('Dün 18:00')
    expect(formatDue(d(13, 18, 0), 'ru', NOW)).toBe('Сегодня 18:00')
  })

  it('EN labels use the locale time format', () => {
    expect(formatDue(d(13, 18, 0), 'en', NOW)).toBe(`Today ${time(d(13, 18, 0), 'en-US')}`)
    expect(formatDue(d(14, 18, 0), 'en', NOW)).toBe(`Tomorrow ${time(d(14, 18, 0), 'en-US')}`)
    expect(formatDue(d(12, 18, 0), 'en', NOW)).toBe(`Yesterday ${time(d(12, 18, 0), 'en-US')}`)
  })

  it('more than one day late → "N days overdue"', () => {
    expect(formatDue(d(10, 18, 0), 'en', NOW)).toBe('3 days overdue')
    expect(formatDue(d(10, 18, 0), 'tr', NOW)).toBe('3 gün gecikti')
    expect(formatDue(d(10, 18, 0), 'ru', NOW)).toBe('просрочено на 3 дн.')
  })

  it('within 6 days → weekday name; 7 days or more → day and short month', () => {
    expect(formatDue(d(16, 18, 0), 'tr', NOW)).toBe('Cuma 18:00')
    expect(formatDue(d(19, 18, 0), 'tr', NOW)).toBe('Pazartesi 18:00')
    expect(formatDue(d(20, 18, 0), 'tr', NOW)).toBe('20 Eki 18:00')
    expect(formatDue(d(25, 18, 0), 'tr', NOW)).toBe('25 Eki 18:00')
  })
})

describe('relativeMinutes', () => {
  it('rounds to minutes, hours and days', () => {
    expect(relativeMinutes(20_000, 'en')).toBe('just now')
    expect(relativeMinutes(5 * MIN, 'en')).toBe('5 min')
    expect(relativeMinutes(90 * MIN, 'en')).toBe('1 h')
    expect(relativeMinutes(25 * H, 'en')).toBe('1 d')
    expect(relativeMinutes(3 * DAY, 'en')).toBe('3 d')
    expect(relativeMinutes(5 * MIN, 'tr')).toBe('5 dk')
    expect(relativeMinutes(5 * MIN, 'ru')).toBe('5 мин')
  })
})

describe('datetime-local input helpers', () => {
  it('toLocalInput renders local wall time; fromLocalInput reads it back', () => {
    const ts = d(13, 18, 5)
    expect(toLocalInput(ts)).toBe('2026-10-13T18:05')
    expect(fromLocalInput('2026-10-13T18:05')).toBe(ts)
    expect(toLocalInput(d(1, 9, 7, 0))).toBe('2026-01-01T09:07')
  })

  it('empty and invalid input', () => {
    expect(toLocalInput(null)).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('not a date')).toBeNull()
  })
})
