import { describe, it, expect } from 'vitest'
import { FOCUS_NO_TASK, activeFocusTaskId, buildNotification, collectDueReminders, escalationLevel, focusSuppressedUntil, inQuietHours, deliveredNags, isMuted, markNagged, markNaggedBy, parseNagPlan, planReminderTimes, resetNag, syncCounters } from './reminder'
import { normalizeTask } from './tasks'
import { DEFAULT_SETTINGS, type HfSession, type Settings, type Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN

const settings = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, funTitles: false, ...o })
const quiet = (from: string, to: string): Settings => settings({ quietHours: { enabled: true, from, to } })
const task = (o: Partial<Task> = {}): Task => normalizeTask({ id: 't1', title: 'Pay bill', remindEveryMin: 20, createdAt: NOW, ...o })

describe('inQuietHours', () => {
  it('is false when quiet hours are disabled', () => {
    expect(inQuietHours(settings(), new Date(2026, 9, 13, 23, 30))).toBe(false)
  })

  it('handles a range across midnight (23:00–08:00)', () => {
    const s = quiet('23:00', '08:00')
    expect(inQuietHours(s, new Date(2026, 9, 13, 23, 0))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 13, 23, 30))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 14, 2, 0))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 14, 7, 59))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 14, 8, 0))).toBe(false)
    expect(inQuietHours(s, new Date(2026, 9, 14, 12, 0))).toBe(false)
    expect(inQuietHours(s, new Date(2026, 9, 14, 22, 59))).toBe(false)
  })

  it('handles a same-day range (13:00–14:00), end exclusive', () => {
    const s = quiet('13:00', '14:00')
    expect(inQuietHours(s, new Date(2026, 9, 13, 12, 59))).toBe(false)
    expect(inQuietHours(s, new Date(2026, 9, 13, 13, 0))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 13, 13, 59))).toBe(true)
    expect(inQuietHours(s, new Date(2026, 9, 13, 14, 0))).toBe(false)
  })
})

describe('collectDueReminders', () => {
  it('fires right away for a never-notified task, then waits one full interval', () => {
    const ln = new Map<string, number>()
    const t = task()
    expect(collectDueReminders([t], settings(), ln, NOW).map((h) => h.task.id)).toEqual(['t1'])
    expect(ln.get('t1')).toBe(NOW)
    expect(collectDueReminders([t], settings(), ln, NOW + 19 * MIN)).toEqual([])
    const hits = collectDueReminders([t], settings(), ln, NOW + 20 * MIN)
    expect(hits).toHaveLength(1)
    expect(hits[0].overdue).toBe(false)
    expect(ln.get('t1')).toBe(NOW + 20 * MIN)
  })

  it('halves the interval for overdue tasks when escalateOverdue is on', () => {
    const ln = new Map([['t1', NOW]])
    const t = task({ dueAt: NOW - H })
    expect(collectDueReminders([t], settings(), ln, NOW + 9 * MIN)).toEqual([])
    const hits = collectDueReminders([t], settings(), ln, NOW + 10 * MIN)
    expect(hits).toHaveLength(1)
    expect(hits[0].overdue).toBe(true)
  })

  it('keeps the full interval for overdue tasks when escalateOverdue is off', () => {
    const ln = new Map([['t1', NOW]])
    const t = task({ dueAt: NOW - H })
    const s = settings({ escalateOverdue: false })
    expect(collectDueReminders([t], s, ln, NOW + 10 * MIN)).toEqual([])
    expect(collectDueReminders([t], s, ln, NOW + 20 * MIN)).toHaveLength(1)
  })

  it('never halves below the 5-minute floor', () => {
    const ln = new Map([['t1', NOW]])
    const t = task({ remindEveryMin: 6, dueAt: NOW - H }) // 6 / 2 = 3 → floored to 5
    expect(collectDueReminders([t], settings(), ln, NOW + 4 * MIN)).toEqual([])
    expect(collectDueReminders([t], settings(), ln, NOW + 5 * MIN)).toHaveLength(1)
  })

  it('a task due in the future is not overdue', () => {
    const hits = collectDueReminders([task({ dueAt: NOW + H })], settings(), new Map(), NOW)
    expect(hits).toHaveLength(1)
    expect(hits[0].overdue).toBe(false)
  })

  it('skips snoozed tasks until snoozedUntil', () => {
    const ln = new Map<string, number>()
    const t = task({ snoozedUntil: NOW + 30 * MIN })
    expect(collectDueReminders([t], settings(), ln, NOW)).toEqual([])
    expect(collectDueReminders([t], settings(), ln, NOW + 29 * MIN)).toEqual([])
    expect(collectDueReminders([t], settings(), ln, NOW + 30 * MIN)).toHaveLength(1)
  })

  it('skips completed tasks and forgets their counter', () => {
    const ln = new Map([['t1', NOW - H]])
    expect(collectDueReminders([task({ completedAt: NOW - MIN })], settings(), ln, NOW)).toEqual([])
    expect(ln.has('t1')).toBe(false)
  })

  it('skips tasks with reminders turned off (0)', () => {
    expect(collectDueReminders([task({ remindEveryMin: 0 })], settings(), new Map(), NOW)).toEqual([])
  })

  it('returns nothing during quiet hours and leaves counters untouched', () => {
    const ln = new Map<string, number>()
    const late = new Date(2026, 9, 13, 23, 30).getTime()
    expect(collectDueReminders([task()], quiet('23:00', '08:00'), ln, late)).toEqual([])
    expect(ln.size).toBe(0)
  })

  it('only returns the tasks whose interval has elapsed', () => {
    const ln = new Map([
      ['a', NOW - 25 * MIN],
      ['b', NOW - 5 * MIN],
    ])
    const hits = collectDueReminders([task({ id: 'a' }), task({ id: 'b' })], settings(), ln, NOW)
    expect(hits.map((h) => h.task.id)).toEqual(['a'])
  })

  it('with an active focus task, only that task reminds; the others keep their counters', () => {
    const ln = new Map([
      ['a', NOW - H],
      ['b', NOW - H],
    ])
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    expect(collectDueReminders(tasks, settings(), ln, NOW, 'b').map((h) => h.task.id)).toEqual(['b'])
    expect(ln.get('a')).toBe(NOW - H) // untouched → fires on the first tick after the round
    expect(ln.get('b')).toBe(NOW)
    // round over: a fires immediately
    expect(collectDueReminders(tasks, settings(), ln, NOW + MIN, null).map((h) => h.task.id)).toEqual(['a'])
  })

  it('FOCUS_NO_TASK suppresses every task', () => {
    const ln = new Map<string, number>()
    expect(collectDueReminders([task({ id: 'a' }), task({ id: 'b' })], settings(), ln, NOW, FOCUS_NO_TASK)).toEqual([])
    expect(ln.size).toBe(0)
  })

  it('a suppressed completed task still has its counter cleared', () => {
    const ln = new Map([['a', NOW]])
    collectDueReminders([task({ id: 'a', completedAt: NOW })], settings(), ln, NOW, 'b')
    expect(ln.has('a')).toBe(false)
  })

  it('returns nothing while the global mute is active (B5) and resumes right after it, counters untouched', () => {
    const ln = new Map<string, number>()
    const muted = settings({ mutedUntil: NOW + 30 * MIN })
    expect(collectDueReminders([task()], muted, ln, NOW)).toEqual([])
    expect(collectDueReminders([task()], muted, ln, NOW + 29 * MIN)).toEqual([])
    expect(ln.size).toBe(0)
    expect(collectDueReminders([task()], muted, ln, NOW + 30 * MIN)).toHaveLength(1)
    expect(isMuted(muted, NOW)).toBe(true)
    expect(isMuted(muted, NOW + 30 * MIN)).toBe(false)
    expect(isMuted(settings({ mutedUntil: null }), NOW)).toBe(false)
    expect(isMuted({ mutedUntil: undefined as unknown as null }, NOW)).toBe(false) // pre-B5 settings objects
  })
})

describe('activeFocusTaskId', () => {
  const session = (o: Partial<HfSession> = {}): HfSession => ({ phase: 'work', round: 1, endsAt: NOW + 30 * MIN, pausedRemaining: null, taskId: 't1', startedAt: NOW - 10 * MIN, ...o })
  const data = (hf: HfSession | null, s: Partial<Settings> = {}) => ({ hyperFocus: hf, settings: settings(s) })

  it('returns the session task during a running work phase', () => {
    expect(activeFocusTaskId(data(session()), NOW)).toBe('t1')
  })

  it('is null without a session, during a break, when paused, or once the phase has ended', () => {
    expect(activeFocusTaskId(data(null), NOW)).toBeNull()
    expect(activeFocusTaskId(data(session({ phase: 'break' })), NOW)).toBeNull()
    expect(activeFocusTaskId(data(session({ pausedRemaining: 10 * MIN })), NOW)).toBeNull()
    expect(activeFocusTaskId(data(session()), NOW + 30 * MIN)).toBeNull()
    expect(activeFocusTaskId(data(session()), NOW + 29 * MIN)).toBe('t1')
  })

  it('is null when the setting is off', () => {
    expect(activeFocusTaskId(data(session(), { focusSuppressOthers: false }), NOW)).toBeNull()
  })

  it('a session without a task suppresses everything (FOCUS_NO_TASK)', () => {
    expect(activeFocusTaskId(data(session({ taskId: null })), NOW)).toBe(FOCUS_NO_TASK)
    expect(FOCUS_NO_TASK).toBe('')
  })

  it('focusSuppressedUntil: end of the work phase for other tasks, null for the focus task', () => {
    expect(focusSuppressedUntil(data(session()), 'other', NOW)).toBe(NOW + 30 * MIN)
    expect(focusSuppressedUntil(data(session()), 't1', NOW)).toBeNull()
    expect(focusSuppressedUntil(data(session({ taskId: null })), 't1', NOW)).toBe(NOW + 30 * MIN)
    expect(focusSuppressedUntil(data(session({ phase: 'break' })), 'other', NOW)).toBeNull()
    expect(focusSuppressedUntil(data(null), 'other', NOW)).toBeNull()
  })
})

describe('syncCounters', () => {
  it('resets the counter when snooze changes and starts new tasks at now', () => {
    const ln = new Map([
      ['a', NOW - 5 * MIN],
      ['c', NOW - 7 * MIN],
    ])
    const prev = [task({ id: 'a' }), task({ id: 'c' })]
    const next = [task({ id: 'a', snoozedUntil: NOW + 30 * MIN }), task({ id: 'b' }), task({ id: 'c' })]
    syncCounters(prev, next, ln, NOW)
    expect(ln.has('a')).toBe(false)
    expect(ln.get('b')).toBe(NOW)
    expect(ln.get('c')).toBe(NOW - 7 * MIN)
  })
})

describe('planReminderTimes', () => {
  it('produces evenly spaced times up to maxCount', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30 }), settings(), NOW, 3, 24 * H)
    expect(plan).toEqual([
      { at: NOW + 30 * MIN, overdue: false },
      { at: NOW + 60 * MIN, overdue: false },
      { at: NOW + 90 * MIN, overdue: false },
    ])
  })

  it('stops at the horizon (inclusive)', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30 }), settings(), NOW, 10, 60 * MIN)
    expect(plan.map((p) => p.at)).toEqual([NOW + 30 * MIN, NOW + 60 * MIN])
  })

  it('skips times that fall into quiet hours', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30 }), quiet('11:00', '12:00'), NOW, 2, 6 * H)
    expect(plan.map((p) => p.at)).toEqual([new Date(2026, 9, 13, 10, 30).getTime(), new Date(2026, 9, 13, 12, 0).getTime()])
  })

  it('halves the interval once the due time has passed', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 40, dueAt: NOW + 60 * MIN }), settings(), NOW, 3, 24 * H)
    expect(plan).toEqual([
      { at: NOW + 40 * MIN, overdue: false },
      { at: NOW + 80 * MIN, overdue: true },
      { at: NOW + 100 * MIN, overdue: true },
    ])
  })

  it('starts counting from snoozedUntil', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30, snoozedUntil: NOW + 2 * H }), settings(), NOW, 1, 24 * H)
    expect(plan).toEqual([{ at: NOW + 150 * MIN, overdue: false }])
  })

  it('returns nothing for completed tasks or reminders turned off', () => {
    expect(planReminderTimes(task({ completedAt: NOW }), settings(), NOW, 5, 24 * H)).toEqual([])
    expect(planReminderTimes(task({ remindEveryMin: 0 }), settings(), NOW, 5, 24 * H)).toEqual([])
  })

  it('skips times inside the global mute (B5), keeps the rhythm afterwards', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30 }), settings({ mutedUntil: NOW + 70 * MIN }), NOW, 3, 24 * H)
    expect(plan.map((p) => p.at)).toEqual([NOW + 90 * MIN, NOW + 120 * MIN, NOW + 150 * MIN])
    // a time exactly at the end of the mute is allowed
    expect(planReminderTimes(task({ remindEveryMin: 30 }), settings({ mutedUntil: NOW + 60 * MIN }), NOW, 1, 24 * H)[0].at).toBe(NOW + 60 * MIN)
  })

  it('skips times before suppressUntilMs (Hyper Focus work phase), keeps the rhythm afterwards', () => {
    const plan = planReminderTimes(task({ remindEveryMin: 30 }), settings(), NOW, 3, 24 * H, NOW + 70 * MIN)
    expect(plan.map((p) => p.at)).toEqual([NOW + 90 * MIN, NOW + 120 * MIN, NOW + 150 * MIN])
    // a time exactly at the end of the phase is allowed
    expect(planReminderTimes(task({ remindEveryMin: 30 }), settings(), NOW, 1, 24 * H, NOW + 60 * MIN)[0].at).toBe(NOW + 60 * MIN)
  })
})

describe('buildNotification', () => {
  const NAG = 'Mark it done, or I’ll keep reminding you.'

  it('plain title carries the priority icon and the focus marker', () => {
    expect(buildNotification(task({ priority: 'high' }), false, settings(), NOW).title).toBe('🔴 Pay bill')
    expect(buildNotification(task({ priority: 'medium', focused: true }), false, settings(), NOW).title).toBe('🟠 🎯 Pay bill')
    expect(buildNotification(task({ priority: 'low' }), false, settings(), NOW).title).toBe('🟢 Pay bill')
  })

  it('fun titles keep the icon and the task title', () => {
    const { title } = buildNotification(task({ priority: 'high' }), false, settings({ funTitles: true }), NOW)
    expect(title.startsWith('🔴 ')).toBe(true)
    expect(title).toContain('Pay bill')
  })

  it('body: time left in minutes / hours, then the nag line', () => {
    expect(buildNotification(task({ dueAt: NOW + 30 * MIN }), false, settings(), NOW).body).toBe(`30 min left · ${NAG}`)
    expect(buildNotification(task({ dueAt: NOW + 2 * H }), false, settings(), NOW).body).toBe(`2 h left · ${NAG}`)
  })

  it('body: overdue in minutes / hours', () => {
    expect(buildNotification(task({ dueAt: NOW - 45 * MIN }), true, settings(), NOW).body).toBe(`45 min overdue! · ${NAG}`)
    expect(buildNotification(task({ dueAt: NOW - 3 * H }), true, settings(), NOW).body).toBe(`3 h overdue! · ${NAG}`)
  })

  it('body: counts open subtasks; no due date → nag line only', () => {
    const subtasks = [
      { id: 's1', title: 'a', done: false },
      { id: 's2', title: 'b', done: true },
      { id: 's3', title: 'c', done: false },
    ]
    expect(buildNotification(task({ dueAt: NOW + 30 * MIN, subtasks }), false, settings(), NOW).body).toBe(`30 min left · 2 subtasks open · ${NAG}`)
    expect(buildNotification(task(), false, settings(), NOW).body).toBe(NAG)
  })

  it('body follows the settings language', () => {
    const tr = settings({ language: 'tr' })
    expect(buildNotification(task({ dueAt: NOW + 30 * MIN }), false, tr, NOW).body).toBe('30 dk kaldı · Bitirince işaretle, yoksa hatırlatmaya devam edeceğim.')
    const ru = settings({ language: 'ru' })
    expect(buildNotification(task({ dueAt: NOW - 3 * H }), true, ru, NOW).body).toBe('просрочено на 3 ч! · Отметь как сделанное, иначе я продолжу напоминать.')
  })

  it('escalation line leads the body from telegramAfter ignored reminders on (defaults: 3)', () => {
    expect(buildNotification(task({ nagCount: 2, dueAt: NOW + 30 * MIN }), false, settings(), NOW).body).toBe(`30 min left · ${NAG}`)
    expect(buildNotification(task({ nagCount: 3, dueAt: NOW + 30 * MIN }), false, settings(), NOW).body).toBe(`Ignored 3× — still not done? · 30 min left · ${NAG}`)
    expect(buildNotification(task({ nagCount: 7 }), false, settings(), NOW).body).toBe(`Ignored 7× — still not done? · ${NAG}`)
    expect(buildNotification(task({ nagCount: 7 }), false, settings({ language: 'tr' }), NOW).body).toBe('7 kez görmezden geldin — hâlâ bitmedi mi? · Bitirince işaretle, yoksa hatırlatmaya devam edeceğim.')
  })

  it('no escalation line when the ladder is disabled', () => {
    const off = settings({ escalation: { enabled: false, telegramAfter: 3, popupAfter: 5 } })
    expect(buildNotification(task({ nagCount: 9 }), false, off, NOW).body).toBe(NAG)
  })
})

describe('escalation ladder', () => {
  it('markNagged increments only the given tasks and keeps the others by identity', () => {
    const a = task({ id: 'a', nagCount: 2 })
    const b = task({ id: 'b' })
    const out = markNagged([a, b], ['a'])
    expect(out[0].nagCount).toBe(3)
    expect(out[1]).toBe(b)
    expect(a.nagCount).toBe(2) // input untouched
    expect(markNagged([a, b], [])).toEqual([a, b])
    expect(markNagged([a, b], ['a', 'b']).map((t) => t.nagCount)).toEqual([3, 1])
  })

  it('resetNag zeroes the counter and returns the same object when already 0', () => {
    const fresh = task({ id: 'a' })
    expect(resetNag(fresh)).toBe(fresh)
    const nagged = task({ id: 'b', nagCount: 4, snoozedUntil: NOW })
    expect(resetNag(nagged, NOW + 1000)).toEqual({ ...nagged, nagCount: 0, updatedAt: NOW + 1000 }) // a reaction is a change → updatedAt (#16)
    expect(nagged.nagCount).toBe(4)
  })

  it('escalationLevel: 0 below telegramAfter, 1 from telegramAfter, 2 from popupAfter', () => {
    const s = settings()
    expect(escalationLevel(task({ nagCount: 0 }), s)).toBe(0)
    expect(escalationLevel(task({ nagCount: 2 }), s)).toBe(0)
    expect(escalationLevel(task({ nagCount: 3 }), s)).toBe(1)
    expect(escalationLevel(task({ nagCount: 4 }), s)).toBe(1)
    expect(escalationLevel(task({ nagCount: 5 }), s)).toBe(2)
    expect(escalationLevel(task({ nagCount: 50 }), s)).toBe(2)
  })

  it('escalationLevel respects custom thresholds, the enabled flag and clamps thresholds to ≥ 1', () => {
    expect(escalationLevel(task({ nagCount: 1 }), settings({ escalation: { enabled: true, telegramAfter: 1, popupAfter: 2 } }))).toBe(1)
    expect(escalationLevel(task({ nagCount: 2 }), settings({ escalation: { enabled: true, telegramAfter: 1, popupAfter: 2 } }))).toBe(2)
    expect(escalationLevel(task({ nagCount: 99 }), settings({ escalation: { enabled: false, telegramAfter: 1, popupAfter: 2 } }))).toBe(0)
    expect(escalationLevel(task({ nagCount: 0 }), settings({ escalation: { enabled: true, telegramAfter: 0, popupAfter: 0 } }))).toBe(0)
    expect(escalationLevel(task({ nagCount: 1 }), settings({ escalation: { enabled: true, telegramAfter: 0, popupAfter: 0 } }))).toBe(2)
  })
})

describe('Android nag counting (deliveredNags / markNaggedBy / parseNagPlan)', () => {
  it('counts the planned reminders that fired after the last reaction, per open task', () => {
    const tasks = [
      task({ id: 'a', updatedAt: NOW - H }),
      task({ id: 'b', updatedAt: NOW - 10 * MIN }), // reacted (snooze / edit) after two of its reminders fired
      task({ id: 'c', updatedAt: NOW - H, completedAt: NOW - 5 * MIN }),
    ]
    const plan = {
      a: [NOW - 40 * MIN, NOW - 20 * MIN, NOW, NOW + 20 * MIN],
      b: [NOW - 40 * MIN, NOW - 20 * MIN, NOW - 5 * MIN, NOW + 15 * MIN],
      c: [NOW - 40 * MIN],
      gone: [NOW - 40 * MIN],
    }
    expect([...deliveredNags(plan, tasks, NOW)]).toEqual([
      ['a', 3],
      ['b', 1],
    ])
    expect(deliveredNags({}, tasks, NOW).size).toBe(0)
  })

  it('markNaggedBy adds the counts without bumping updatedAt and keeps untouched tasks', () => {
    const a = task({ id: 'a', nagCount: 2, updatedAt: NOW - H })
    const b = task({ id: 'b' })
    const next = markNaggedBy([a, b], new Map([['a', 3]]))
    expect(next[0]).toMatchObject({ nagCount: 5, updatedAt: NOW - H })
    expect(next[1]).toBe(b)
    const same = [a, b]
    expect(markNaggedBy(same, new Map())).toBe(same)
  })

  it('parseNagPlan tolerates garbage', () => {
    expect(parseNagPlan(null)).toEqual({})
    expect(parseNagPlan('{oops')).toEqual({})
    expect(parseNagPlan('[1,2]')).toEqual({})
    expect(parseNagPlan(JSON.stringify({ a: [1, 'x', 2], b: 'no' }))).toEqual({ a: [1, 2] })
  })
})
