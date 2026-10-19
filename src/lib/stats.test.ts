import { describe, it, expect, vi } from 'vitest'
import { SNOOZE_ACTION_MIN, applyNotificationAction, bestStreak, completeInData, doneInLastDays, focusMinutes, heatLevel, heatmap, pushFocusEntry, recordDone, recordReopen, spentMinByTask, streak, topTags } from './stats'
import { normalizeData } from './data'
import { normalizeTask } from './tasks'
import { FOCUS_LOG_MAX, type FocusEntry, type Task } from './types'
import { dayKey } from './dates'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
const d = (day: number, h = 0, m = 0, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime()

const entry = (o: Partial<FocusEntry> = {}): FocusEntry => ({ id: 'e', taskId: 't1', phase: 'work', startedAt: NOW - 30 * MIN, endedAt: NOW, ...o })
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, ...o })

describe('focus log', () => {
  it('pushFocusEntry appends and keeps only the newest FOCUS_LOG_MAX', () => {
    expect(pushFocusEntry([], entry())).toEqual([entry()])
    const full = Array.from({ length: FOCUS_LOG_MAX }, (_, i) => entry({ id: 'e' + i }))
    const out = pushFocusEntry(full, entry({ id: 'new' }))
    expect(out).toHaveLength(FOCUS_LOG_MAX)
    expect(out[0].id).toBe('e1')
    expect(out[out.length - 1].id).toBe('new')
    expect(full).toHaveLength(FOCUS_LOG_MAX) // input untouched
  })

  it('spentMinByTask sums work phases per task and ignores breaks and task-less entries', () => {
    const log = [
      entry({ id: '1', taskId: 'a', startedAt: NOW, endedAt: NOW + 25 * MIN }),
      entry({ id: '2', taskId: 'a', startedAt: NOW, endedAt: NOW + 20 * MIN }),
      entry({ id: '3', taskId: 'b', startedAt: NOW, endedAt: NOW + 90 * 1000 }), // 1.5 min → 2
      entry({ id: '4', taskId: 'a', phase: 'break', startedAt: NOW, endedAt: NOW + 5 * MIN }),
      entry({ id: '5', taskId: null, startedAt: NOW, endedAt: NOW + 40 * MIN }),
    ]
    expect(spentMinByTask(log)).toEqual({ a: 45, b: 2 })
    expect(spentMinByTask([])).toEqual({})
  })

  it('focusMinutes counts only the part of work entries inside the window', () => {
    const log = [
      entry({ id: '1', startedAt: NOW - 40 * MIN, endedAt: NOW - 10 * MIN }), // 30 min, inside
      entry({ id: '2', startedAt: NOW - 70 * MIN, endedAt: NOW - 50 * MIN }), // crosses the start by 10 min
      entry({ id: '3', phase: 'break', startedAt: NOW - 9 * MIN, endedAt: NOW - 4 * MIN }),
      entry({ id: '4', startedAt: NOW + H, endedAt: NOW + 2 * H }), // after the window
    ]
    expect(focusMinutes(log, NOW - H, NOW)).toBe(40)
    expect(focusMinutes(log, NOW - H, Number.MAX_SAFE_INTEGER)).toBe(100)
    expect(focusMinutes(log, NOW + 3 * H, NOW + 4 * H)).toBe(0)
    expect(focusMinutes([], 0, NOW)).toBe(0)
  })
})

describe('recordDone / recordReopen / completeInData', () => {
  const base = () => normalizeData({ tasks: [task({ id: 'a' }), task({ id: 'b', completedAt: d(12, 18, 0) })], dailyDone: { '2026-10-12': 1 } })

  it('recordDone increments today, recordReopen takes it back from the completion day (never below 0)', () => {
    const once = recordDone(base(), NOW)
    expect(once.dailyDone).toEqual({ '2026-10-12': 1, '2026-10-13': 1 })
    expect(recordDone(once, NOW).dailyDone['2026-10-13']).toBe(2)
    expect(recordReopen(once, d(12, 18, 0)).dailyDone).toEqual({ '2026-10-13': 1 }) // key removed at 0
    expect(recordReopen(once, d(1, 0, 0)).dailyDone).toEqual(once.dailyDone) // nothing counted that day
    expect(recordReopen(once, null)).toBe(once)
  })

  it('completeInData completes an open task and counts it; unknown or done ids are no-ops', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    try {
      const out = completeInData(base(), 'a')
      expect(out.tasks.find((t) => t.id === 'a')!.completedAt).toBe(NOW)
      expect(out.dailyDone[dayKey(NOW)]).toBe(1)
      const same = base()
      expect(completeInData(same, 'b')).toBe(same)
      expect(completeInData(same, 'zzz')).toBe(same)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('applyNotificationAction (Android notification buttons)', () => {
  const base = () =>
    normalizeData({
      tasks: [task({ id: 'a', nagCount: 4, focused: false }), task({ id: 'f', focused: true }), task({ id: 'r', recurrence: 'daily', dueAt: d(13, 9, 0), nagCount: 2 }), task({ id: 'done', completedAt: d(12, 18, 0) })],
      dailyDone: { '2026-10-12': 1 },
    })

  it('done → completed like the UI: dailyDone counted, nag reset, recurring copy spawned', () => {
    vi.useFakeTimers() // completeTask reads the clock itself
    vi.setSystemTime(NOW)
    try {
      const out = applyNotificationAction(base(), 'r', 'done', NOW)
      const done = out.tasks.find((t) => t.id === 'r')!
      expect(done.completedAt).toBe(NOW)
      expect(done.nagCount).toBe(0)
      expect(out.dailyDone).toEqual({ '2026-10-12': 1, '2026-10-13': 1 })
      const next = out.tasks.find((t) => t.recurrence === 'daily' && t.completedAt === null)!
      expect(next).toBeDefined()
      expect(next.dueAt).toBe(d(14, 9, 0))
    } finally {
      vi.useRealTimers()
    }
  })

  it('snooze30 → quiet for 30 minutes from now and the escalation counter resets', () => {
    const out = applyNotificationAction(base(), 'a', 'snooze30', NOW)
    const a = out.tasks.find((t) => t.id === 'a')!
    expect(a.snoozedUntil).toBe(NOW + SNOOZE_ACTION_MIN * MIN)
    expect(a.nagCount).toBe(0)
    expect(a.completedAt).toBeNull()
    expect(out.dailyDone).toEqual({ '2026-10-12': 1 })
  })

  it('focus → only this task is focused, nag reset, the previous focus task is unfocused', () => {
    const out = applyNotificationAction(base(), 'a', 'focus', NOW)
    expect(out.tasks.filter((t) => t.focused).map((t) => t.id)).toEqual(['a'])
    expect(out.tasks.find((t) => t.id === 'a')!.nagCount).toBe(0)
  })

  it('tap, unknown actions, unknown ids and finished tasks leave the data untouched (same object)', () => {
    const b = base()
    expect(applyNotificationAction(b, 'a', 'tap', NOW)).toBe(b)
    expect(applyNotificationAction(b, 'a', 'bogus', NOW)).toBe(b)
    expect(applyNotificationAction(b, 'zzz', 'done', NOW)).toBe(b)
    expect(applyNotificationAction(b, 'done', 'done', NOW)).toBe(b)
    expect(applyNotificationAction(b, 'done', 'snooze30', NOW)).toBe(b)
  })
})

describe('streak', () => {
  const today = '2026-10-13'

  it('counts consecutive days ending today', () => {
    expect(streak({ '2026-10-13': 1, '2026-10-12': 2, '2026-10-11': 1 }, today)).toBe(3)
    expect(streak({ '2026-10-13': 1 }, today)).toBe(1)
  })

  it('a day not yet done today still counts the run ending yesterday', () => {
    expect(streak({ '2026-10-12': 1, '2026-10-11': 1 }, today)).toBe(2)
  })

  it('is 0 without a completion today or yesterday, and ignores gaps', () => {
    expect(streak({}, today)).toBe(0)
    expect(streak({ '2026-10-11': 5 }, today)).toBe(0)
    expect(streak({ '2026-10-13': 1, '2026-10-11': 1 }, today)).toBe(1)
    expect(streak({ '2026-10-13': 0, '2026-10-12': 1 }, today)).toBe(1)
  })

  it('crosses month boundaries', () => {
    expect(streak({ '2026-10-02': 1, '2026-10-01': 1, '2026-09-30': 1, '2026-09-29': 1 }, '2026-10-02')).toBe(4)
  })

  it('bestStreak finds the longest run anywhere in the history', () => {
    expect(bestStreak({})).toBe(0)
    expect(bestStreak({ '2026-10-13': 1 })).toBe(1)
    expect(bestStreak({ '2026-10-13': 1, '2026-10-12': 1, '2026-09-01': 1, '2026-09-02': 1, '2026-09-03': 1, '2026-09-05': 1 })).toBe(3)
    expect(bestStreak({ '2026-10-13': 0, '2026-10-12': 1 })).toBe(1)
  })
})

describe('heatmap', () => {
  it('heatLevel buckets: 0 · 1 · 2–3 · 4–6 · 7+', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 20].map(heatLevel)).toEqual([0, 1, 2, 2, 3, 3, 4, 4])
  })

  it('12 weeks = 84 cells, Monday-first, ending with the current week; later days flagged future', () => {
    const cells = heatmap({ '2026-10-13': 2, '2026-10-12': 1, '2026-07-27': 1, '2026-07-26': 9 }, 12, NOW)
    expect(cells).toHaveLength(84)
    expect(cells[0].key).toBe('2026-07-27') // Monday 11 weeks before this week's Monday (12 Oct)
    expect(cells[0].count).toBe(1)
    expect(cells[cells.length - 1].key).toBe('2026-10-18') // Sunday of the current week
    expect(cells.find((c) => c.key === '2026-07-26')).toBeUndefined() // before the grid
    const today = cells.find((c) => c.key === '2026-10-13')!
    expect(today).toMatchObject({ count: 2, level: 2, future: false })
    expect(cells.find((c) => c.key === '2026-10-12')).toMatchObject({ count: 1, level: 1, future: false })
    expect(cells.find((c) => c.key === '2026-10-14')).toMatchObject({ count: 0, level: 0, future: true })
    expect(cells.filter((c) => c.future)).toHaveLength(5) // Wed–Sun
    expect(cells.indexOf(today)).toBe(84 - 7 + 1) // second row of the last column (Tuesday)
  })

  it('a Sunday "now" still belongs to the week that started on the previous Monday', () => {
    const sunday = d(18, 12, 0)
    const cells = heatmap({}, 1, sunday)
    expect(cells.map((c) => c.key)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(cells.some((c) => c.future)).toBe(false)
  })

  it('doneInLastDays sums today and the previous days', () => {
    const dd = { '2026-10-13': 1, '2026-10-12': 2, '2026-10-07': 4, '2026-10-06': 8 }
    expect(doneInLastDays(dd, 7, NOW)).toBe(7)
    expect(doneInLastDays(dd, 1, NOW)).toBe(1)
    expect(doneInLastDays(dd, 30, NOW)).toBe(15)
  })
})

describe('topTags', () => {
  it('counts tags of tasks completed since fromMs, most used first, ties alphabetical, limited', () => {
    const tasks = [
      task({ id: 'a', tags: ['home', 'bills'], completedAt: NOW - H }),
      task({ id: 'b', tags: ['home', 'home'], completedAt: NOW - 2 * H }), // a duplicate tag counts once
      task({ id: 'c', tags: ['work'], completedAt: NOW - 2 * H }),
      task({ id: 'd', tags: ['old'], completedAt: NOW - 10 * 24 * H }),
      task({ id: 'e', tags: ['open'] }),
    ]
    expect(topTags(tasks, NOW - 7 * 24 * H)).toEqual([
      { tag: 'home', count: 2 },
      { tag: 'bills', count: 1 },
      { tag: 'work', count: 1 },
    ])
    expect(topTags(tasks, NOW - 7 * 24 * H, 1)).toEqual([{ tag: 'home', count: 2 }])
    expect(topTags(tasks, NOW)).toEqual([])
  })
})

describe('applyNotificationAction: snooze is counted', () => {
  it('snooze30 adds one to snoozeCount (stuck? nudge), focus does not', () => {
    const data = normalizeData({ tasks: [task({ id: 'a', snoozeCount: 2 })] })
    const out = applyNotificationAction(data, 'a', 'snooze30', NOW)
    expect(out.tasks[0]).toMatchObject({ snoozeCount: 3, snoozedUntil: NOW + SNOOZE_ACTION_MIN * MIN })
    expect(applyNotificationAction(data, 'a', 'focus', NOW).tasks[0].snoozeCount).toBe(2)
  })
})
