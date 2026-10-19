import { describe, it, expect, vi } from 'vitest'
import { SNOOZE_NUDGE, completeTask, duplicateTask, isStuck, matchesQuery, newTask, normalizeRecurrenceRule, normalizeTask, openTasksSorted, pickEasyTask, priorityIcon, reorderTasks, snoozeTask, sortTasks, startBy, stuckDates, taskFromQuickAdd } from './tasks'
import { DEFAULT_SETTINGS, type Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const H = 3_600_000

const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, ...o })

/** Runs `fn` with Date.now() frozen at `ms` (completeTask / duplicateTask read the clock themselves). */
function withClock<T>(ms: number, fn: () => T): T {
  vi.useFakeTimers()
  vi.setSystemTime(ms)
  try {
    return fn()
  } finally {
    vi.useRealTimers()
  }
}

describe('priorityIcon', () => {
  it('returns the real emoji for each priority', () => {
    expect(priorityIcon('high')).toBe('🔴')
    expect(priorityIcon('medium')).toBe('🟠')
    expect(priorityIcon('low')).toBe('🟢')
  })
})

describe('normalizeTask', () => {
  it('fills every missing field with its default', () => {
    const t = normalizeTask({ id: 'a', createdAt: 123 })
    expect(t).toEqual({
      id: 'a',
      title: '',
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
      order: 123,
      completedAt: null,
      createdAt: 123,
      nagCount: 0,
      estimateMin: null,
      energy: null,
      snoozeCount: 0,
      updatedAt: 123,
    })
    expect('calendarEventId' in t).toBe(false)
  })

  it('Batch 2 fields: keeps valid values, repairs invalid ones', () => {
    expect(normalizeTask({ id: 'a', nagCount: 3, estimateMin: 45, energy: 'high', createdAt: 1 })).toMatchObject({ nagCount: 3, estimateMin: 45, energy: 'high' })
    expect(normalizeTask({ id: 'a', nagCount: -2, estimateMin: 0, energy: 'tired' as never, createdAt: 1 })).toMatchObject({ nagCount: 0, estimateMin: null, energy: null })
    expect(normalizeTask({ id: 'a', nagCount: 2.7, estimateMin: 29.6, createdAt: 1 })).toMatchObject({ nagCount: 2, estimateMin: 30 })
  })

  it('invents createdAt (and order from it) when missing', () => {
    const before = Date.now()
    const t = normalizeTask({ id: 'a' })
    expect(t.createdAt).toBeGreaterThanOrEqual(before)
    expect(t.order).toBe(t.createdAt)
  })

  it('repairs invalid values: unknown status, non-array tags/subtasks, non-numeric order', () => {
    const t = normalizeTask({ id: 'a', status: 'bogus' as never, tags: 'x' as never, subtasks: {} as never, order: '5' as never, createdAt: 7 })
    expect(t.status).toBe('todo')
    expect(t.tags).toEqual([])
    expect(t.subtasks).toEqual([])
    expect(t.order).toBe(7)
  })

  it('recurrence: unknown values become none; the rule is kept only for custom', () => {
    expect(normalizeTask({ id: 'a', recurrence: 'bogus' as never, createdAt: 1 }).recurrence).toBe('none')
    expect(normalizeTask({ id: 'a', recurrence: 'yearly', createdAt: 1 }).recurrence).toBe('yearly')
    const weekly = normalizeTask({ id: 'a', recurrence: 'weekly', recurrenceRule: { every: 3, unit: 'day' }, createdAt: 1 })
    expect('recurrenceRule' in weekly).toBe(false)
    const custom = normalizeTask({ id: 'a', recurrence: 'custom', recurrenceRule: { every: 2.9, unit: 'week', weekdays: [5, 1, 1, 9, -1, 3.5] as number[], afterCompletion: false }, createdAt: 1 })
    expect(custom.recurrenceRule).toEqual({ every: 2, unit: 'week', weekdays: [1, 5] })
    expect(normalizeTask({ id: 'a', recurrence: 'custom', createdAt: 1 }).recurrenceRule).toEqual({ every: 1, unit: 'week' }) // unreadable rule → default
    expect(normalizeTask({ id: 'a', recurrence: 'custom', recurrenceRule: { every: 2, unit: 'fortnight' as never }, createdAt: 1 }).recurrenceRule).toEqual({ every: 1, unit: 'week' })
  })

  it('keeps provided values, including calendarEventId', () => {
    const t = normalizeTask({ id: 'a', title: 'T', priority: 'high', status: 'waiting', dueAt: 5, remindEveryMin: 15, calendarEventId: 'ev1', createdAt: 1 })
    expect(t.title).toBe('T')
    expect(t.priority).toBe('high')
    expect(t.status).toBe('waiting')
    expect(t.dueAt).toBe(5)
    expect(t.remindEveryMin).toBe(15)
    expect(t.calendarEventId).toBe('ev1')
  })
})

describe('normalizeRecurrenceRule', () => {
  it('rejects garbage and unknown units', () => {
    expect(normalizeRecurrenceRule(null)).toBeNull()
    expect(normalizeRecurrenceRule('weekly')).toBeNull()
    expect(normalizeRecurrenceRule({ every: 2 })).toBeNull()
    expect(normalizeRecurrenceRule({ every: 2, unit: 'hour' })).toBeNull()
  })

  it('every ≥ 1 whole number; weekdays unique, sorted, 0–6, only for weeks; afterCompletion only when true', () => {
    expect(normalizeRecurrenceRule({ every: 0, unit: 'day' })).toEqual({ every: 1, unit: 'day' })
    expect(normalizeRecurrenceRule({ every: '3', unit: 'day' })).toEqual({ every: 1, unit: 'day' })
    expect(normalizeRecurrenceRule({ every: 3.7, unit: 'month', afterCompletion: true })).toEqual({ every: 3, unit: 'month', afterCompletion: true })
    expect(normalizeRecurrenceRule({ every: 1, unit: 'week', weekdays: [3, 1, 3, 7, 0] })).toEqual({ every: 1, unit: 'week', weekdays: [0, 1, 3] })
    expect(normalizeRecurrenceRule({ every: 1, unit: 'week', weekdays: [] })).toEqual({ every: 1, unit: 'week' })
    expect(normalizeRecurrenceRule({ every: 1, unit: 'day', weekdays: [1, 2] })).toEqual({ every: 1, unit: 'day' })
    expect(normalizeRecurrenceRule({ every: 1, unit: 'day', afterCompletion: 'yes' })).toEqual({ every: 1, unit: 'day' })
  })
})

describe('newTask', () => {
  it('uses the default reminder interval from settings and applies the partial', () => {
    const t = newTask({ title: 'Call mom', priority: 'high' }, { ...DEFAULT_SETTINGS, defaultRemindEveryMin: 45 })
    expect(t.title).toBe('Call mom')
    expect(t.priority).toBe('high')
    expect(t.remindEveryMin).toBe(45)
    expect(t.status).toBe('todo')
    expect(t.recurrence).toBe('none')
    expect(t.completedAt).toBeNull()
    expect(t.order).toBe(t.createdAt)
    expect(t.id.length).toBeGreaterThan(0)
  })
})

describe('taskFromQuickAdd', () => {
  const settings = { ...DEFAULT_SETTINGS, defaultRemindEveryMin: 25 }

  it('parses the text and fills the rest from settings', () => {
    const t = taskFromQuickAdd('tomorrow 18:00 pay the bill #home !1 @30m', settings, { now: NOW })!
    expect(t.title).toBe('pay the bill')
    expect(t.dueAt).toBe(new Date(2026, 9, 14, 18, 0).getTime())
    expect(t.priority).toBe('high')
    expect(t.tags).toEqual(['home'])
    expect(t.remindEveryMin).toBe(30)
    expect(t.status).toBe('todo')
    expect(t.completedAt).toBeNull()
  })

  it('defaults: medium priority, settings interval, given status and fallback due date', () => {
    const t = taskFromQuickAdd('call mom', settings, { now: NOW, status: 'doing', defaultDueAt: NOW + H })!
    expect(t).toMatchObject({ title: 'call mom', priority: 'medium', remindEveryMin: 25, status: 'doing', dueAt: NOW + H, tags: [] })
  })

  it('carries the estimate and energy tokens into the task', () => {
    expect(taskFromQuickAdd('tidy desk ~30m ^low', settings, { now: NOW })).toMatchObject({ title: 'tidy desk', estimateMin: 30, energy: 'low', nagCount: 0 })
    expect(taskFromQuickAdd('tidy desk', settings, { now: NOW })).toMatchObject({ estimateMin: null, energy: null })
  })

  it('carries the recurrence tokens into the task; the rule only exists for custom', () => {
    const custom = taskFromQuickAdd('water plants *every 3d', settings, { now: NOW })!
    expect(custom).toMatchObject({ title: 'water plants', recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, dueAt: new Date(2026, 9, 13, 23, 59).getTime() })
    const weekly = taskFromQuickAdd('report *weekly', settings, { now: NOW })!
    expect(weekly.recurrence).toBe('weekly')
    expect('recurrenceRule' in weekly).toBe(false)
    expect(taskFromQuickAdd('plain', settings, { now: NOW })!.recurrence).toBe('none')
  })

  it('a date in the text wins over defaultDueAt', () => {
    const t = taskFromQuickAdd('today report', settings, { now: NOW, defaultDueAt: NOW + H })!
    expect(t.dueAt).toBe(new Date(2026, 9, 13, 23, 59).getTime())
  })

  it('orders the new task above every existing one (never above 0 - 1000)', () => {
    const tasks = [task({ id: 'a', order: 1000 }), task({ id: 'b', order: -5000 })]
    expect(taskFromQuickAdd('x', settings, { tasks })!.order).toBe(-6000)
    expect(taskFromQuickAdd('x', settings, { tasks: [task({ id: 'a', order: 1000 })] })!.order).toBe(-1000)
    expect(taskFromQuickAdd('x', settings)!.order).toBe(-1000)
  })

  it('returns null when nothing is left for a title', () => {
    expect(taskFromQuickAdd('', settings)).toBeNull()
    expect(taskFromQuickAdd('   ', settings)).toBeNull()
    expect(taskFromQuickAdd('#home !1', settings)).toBeNull()
  })
})

describe('completeTask', () => {
  it('marks a one-off task done, drops focus, snooze and the nag counter, and does not add a task', () => {
    const tasks = [task({ id: 'a', focused: true, snoozedUntil: NOW + H, nagCount: 6 }), task({ id: 'b' })]
    const out = withClock(NOW, () => completeTask(tasks, 'a'))
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ id: 'a', completedAt: NOW, focused: false, snoozedUntil: null, nagCount: 0 })
    expect(out[1]).toBe(tasks[1])
  })

  it('the spawned recurring copy starts with a clean nag counter', () => {
    const out = withClock(NOW, () => completeTask([task({ id: 'a', recurrence: 'daily', nagCount: 4 })], 'a'))
    expect(out[0].nagCount).toBe(0)
    expect(out[1].nagCount).toBe(0)
  })

  it('returns the same array for an unknown id', () => {
    const tasks = [task({ id: 'a' })]
    expect(completeTask(tasks, 'zzz')).toBe(tasks)
  })

  it('spawns the next occurrence of a recurring task at the front, with subtasks reset', () => {
    const due = new Date(2026, 9, 12, 18, 0).getTime() // yesterday 18:00
    const tasks = [
      task({
        id: 'a',
        title: 'Water plants',
        recurrence: 'daily',
        dueAt: due,
        tags: ['home'],
        status: 'doing',
        focused: true,
        subtasks: [{ id: 's1', title: 'front', done: true }],
      }),
    ]
    const out = withClock(NOW, () => completeTask(tasks, 'a'))
    expect(out).toHaveLength(2)
    const next = out[0]
    expect(next.id).not.toBe('a')
    expect(next.title).toBe('Water plants')
    expect(next.tags).toEqual(['home'])
    expect(next.recurrence).toBe('daily')
    expect(next.dueAt).toBe(new Date(2026, 9, 13, 18, 0).getTime())
    expect(next.subtasks).toEqual([{ id: 's1', title: 'front', done: false }])
    expect(next).toMatchObject({ completedAt: null, snoozedUntil: null, focused: false, status: 'todo', order: NOW, createdAt: NOW })
    expect(out[1]).toMatchObject({ id: 'a', completedAt: NOW })
  })

  it('a recurring task without a due date recurs from the completion time', () => {
    const out = withClock(NOW, () => completeTask([task({ id: 'a', recurrence: 'weekly' })], 'a'))
    expect(out[0].dueAt).toBe(new Date(2026, 9, 20, 10, 0).getTime())
  })

  it('custom rules are applied and carried over to the spawned copy', () => {
    const rule = { every: 3, unit: 'day' as const }
    const out = withClock(NOW, () => completeTask([task({ id: 'a', recurrence: 'custom', recurrenceRule: rule, dueAt: new Date(2026, 9, 12, 18, 0).getTime() })], 'a'))
    expect(out[0]).toMatchObject({ recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' }, dueAt: new Date(2026, 9, 15, 18, 0).getTime(), completedAt: null })
    expect(out[1]).toMatchObject({ id: 'a', completedAt: NOW, recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day' } })
  })

  it('afterCompletion counts from the completion time; yearly keeps the date', () => {
    const after = withClock(NOW, () => completeTask([task({ id: 'a', recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day', afterCompletion: true }, dueAt: new Date(2026, 9, 1, 18, 0).getTime() })], 'a'))
    expect(after[0].dueAt).toBe(new Date(2026, 9, 16, 18, 0).getTime())
    const yearly = withClock(NOW, () => completeTask([task({ id: 'b', recurrence: 'yearly', dueAt: new Date(2026, 9, 12, 9, 0).getTime() })], 'b'))
    expect(yearly[0]).toMatchObject({ recurrence: 'yearly', dueAt: new Date(2027, 9, 12, 9, 0).getTime() })
  })
})

describe('duplicateTask', () => {
  it('inserts a fresh copy right after the original', () => {
    const tasks = [
      task({ id: 'a', title: 'Report', order: 1000, subtasks: [{ id: 's1', title: 'draft', done: true }], completedAt: NOW, focused: true, snoozedUntil: NOW }),
      task({ id: 'b', order: 2000 }),
    ]
    const out = duplicateTask(tasks, 'a', '(copy)')
    expect(out.map((t) => t.id)).toEqual(['a', out[1].id, 'b'])
    const copy = out[1]
    expect(copy.id).not.toBe('a')
    expect(copy.title).toBe('Report (copy)')
    expect(copy.order).toBe(1000.5)
    expect(copy.subtasks).toHaveLength(1)
    expect(copy.subtasks[0].done).toBe(false)
    expect(copy.subtasks[0].id).not.toBe('s1')
    expect(copy).toMatchObject({ completedAt: null, snoozedUntil: null, focused: false })
    expect(tasks).toHaveLength(2) // input untouched
  })

  it('an empty suffix leaves the title unchanged; unknown id returns the same array', () => {
    const tasks = [task({ id: 'a', title: 'Report' })]
    expect(duplicateTask(tasks, 'a', '')[1].title).toBe('Report')
    expect(duplicateTask(tasks, 'nope', 'x')).toBe(tasks)
  })
})

describe('reorderTasks', () => {
  const base = () => [task({ id: 'a', order: 1000 }), task({ id: 'b', order: 2000 }), task({ id: 'c', order: 3000 })]
  const orders = (ts: Task[]) => Object.fromEntries(ts.map((t) => [t.id, t.order]))

  it('moves the dragged task before the target and renumbers in steps of 1000', () => {
    const out = reorderTasks(base(), 'c', 'a')
    expect(out.map((t) => t.id)).toEqual(['a', 'b', 'c']) // array positions untouched; only `order` changes
    expect(orders(out)).toEqual({ c: 1000, a: 2000, b: 3000 })
  })

  it('beforeId null moves the task to the end', () => {
    expect(orders(reorderTasks(base(), 'a', null))).toEqual({ b: 1000, c: 2000, a: 3000 })
  })

  it('changes the status when dropping into another column', () => {
    const out = reorderTasks(base(), 'a', 'c', 'doing')
    expect(orders(out)).toEqual({ b: 1000, a: 2000, c: 3000 })
    expect(out.find((t) => t.id === 'a')!.status).toBe('doing')
    expect(out.find((t) => t.id === 'b')!.status).toBe('todo')
  })

  it('keeps object identity for tasks whose order did not change', () => {
    const tasks = base()
    const out = reorderTasks(tasks, 'c', null)
    expect(out[0]).toBe(tasks[0])
    expect(out[1]).toBe(tasks[1])
    expect(out[2]).toBe(tasks[2])
  })

  it('is a no-op for self-drop or an unknown task', () => {
    const tasks = base()
    expect(reorderTasks(tasks, 'a', 'a')).toBe(tasks)
    expect(reorderTasks(tasks, 'zzz', 'a')).toBe(tasks)
  })
})

describe('sortTasks', () => {
  const a = task({ id: 'a', title: 'banana', priority: 'low', dueAt: NOW + 2 * H, order: 3, createdAt: 4 })
  const b = task({ id: 'b', title: 'Apple', priority: 'high', dueAt: null, order: 1, createdAt: 3 })
  const c = task({ id: 'c', title: 'cherry', priority: 'medium', dueAt: NOW - H, order: 2, createdAt: 2 }) // overdue
  const d = task({ id: 'd', title: 'date', priority: 'high', dueAt: NOW + H, order: 4, createdAt: 1, focused: true })
  const all = [a, b, c, d]
  const ids = (ts: Task[]) => ts.map((t) => t.id)

  it('manual: by order', () => {
    expect(ids(sortTasks(all, 'manual', NOW))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('due: earliest first, no due date last', () => {
    expect(ids(sortTasks(all, 'due', NOW))).toEqual(['c', 'd', 'a', 'b'])
  })

  it('priority: high → low, ties by due date', () => {
    expect(ids(sortTasks(all, 'priority', NOW))).toEqual(['d', 'b', 'c', 'a'])
  })

  it('created: newest first', () => {
    expect(ids(sortTasks(all, 'created', NOW))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('alpha: case-insensitive title', () => {
    expect(ids(sortTasks(all, 'alpha', NOW))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('smart: focused, then overdue, then priority, then due, then order', () => {
    expect(ids(sortTasks(all, 'smart', NOW))).toEqual(['d', 'c', 'b', 'a'])
    const e = task({ id: 'e', priority: 'high', dueAt: null, order: 1 })
    const f = task({ id: 'f', priority: 'high', dueAt: NOW + H, order: 2 })
    const g = task({ id: 'g', priority: 'high', dueAt: null, order: 0 })
    expect(ids(sortTasks([e, f, g], 'smart', NOW))).toEqual(['f', 'g', 'e'])
  })

  it('does not mutate the input', () => {
    const copy = [...all]
    sortTasks(all, 'alpha', NOW)
    expect(all).toEqual(copy)
  })
})

describe('openTasksSorted', () => {
  it('drops completed tasks and applies smart order', () => {
    const open = task({ id: 'o', priority: 'low', order: 2 })
    const done = task({ id: 'x', priority: 'high', completedAt: NOW })
    const hi = task({ id: 'h', priority: 'high', order: 3 })
    expect(openTasksSorted([open, done, hi]).map((t) => t.id)).toEqual(['h', 'o'])
  })
})

describe('pickEasyTask', () => {
  /** Deterministic rng: returns the given values in order (then 0). */
  const seq = (...vals: number[]) => {
    let i = 0
    return () => vals[i++] ?? 0
  }

  it('returns null when nothing is open or everything is snoozed', () => {
    expect(pickEasyTask([], seq(0), NOW)).toBeNull()
    expect(pickEasyTask([task({ id: 'x', completedAt: NOW })], seq(0), NOW)).toBeNull()
    expect(pickEasyTask([task({ id: 'x', snoozedUntil: NOW + H })], seq(0), NOW)).toBeNull()
    expect(pickEasyTask([task({ id: 'x', snoozedUntil: NOW - 1 })], seq(0), NOW)?.id).toBe('x')
  })

  it('prefers low energy, then a short estimate, then low priority', () => {
    const low = task({ id: 'low', energy: 'low', priority: 'high' }) // 3
    const short = task({ id: 'short', estimateMin: 10 }) // 2
    const mid = task({ id: 'mid', energy: 'medium', estimateMin: 45 }) // 1
    const plain = task({ id: 'plain' }) // 0
    expect(pickEasyTask([plain, mid, short, low], seq(0), NOW)?.id).toBe('low')
    expect(pickEasyTask([plain, mid, short], seq(0), NOW)?.id).toBe('short')
    expect(pickEasyTask([plain, mid], seq(0), NOW)?.id).toBe('mid')
    expect(pickEasyTask([plain], seq(0), NOW)?.id).toBe('plain')
  })

  it('a low-energy short low-priority task beats everything; medium energy alone loses to a 15-minute estimate', () => {
    const star = task({ id: 'star', energy: 'low', estimateMin: 15, priority: 'low' }) // 6
    const strong = task({ id: 'strong', energy: 'low', estimateMin: 15 }) // 5
    expect(pickEasyTask([strong, star], seq(0), NOW)?.id).toBe('star')
    expect(pickEasyTask([task({ id: 'm', energy: 'medium' }), task({ id: 'e', estimateMin: 15 })], seq(0), NOW)?.id).toBe('e')
  })

  it('draws among the top-scoring tasks with the rng, never outside the pool', () => {
    const a = task({ id: 'a', energy: 'low' })
    const b = task({ id: 'b', energy: 'low' })
    const c = task({ id: 'c' })
    expect(pickEasyTask([a, b, c], seq(0), NOW)?.id).toBe('a')
    expect(pickEasyTask([a, b, c], seq(0.99), NOW)?.id).toBe('b')
    expect(pickEasyTask([a, b, c], seq(1), NOW)?.id).toBe('b') // rng() === 1 is clamped
    expect(pickEasyTask([a, b, c], () => Math.random(), NOW)?.id).not.toBe('c')
  })
})

describe('matchesQuery', () => {
  const t = task({ id: 'a', title: 'Pay the Bill', notes: 'Electricity invoice', tags: ['Home'], subtasks: [{ id: 's', title: 'Find the IBAN', done: false }] })

  it('matches title, notes, tags and subtask titles case-insensitively', () => {
    expect(matchesQuery(t, 'bill')).toBe(true)
    expect(matchesQuery(t, 'INVOICE')).toBe(true)
    expect(matchesQuery(t, 'home')).toBe(true)
    expect(matchesQuery(t, 'iban')).toBe(true)
  })

  it('empty or whitespace query matches everything; unrelated text does not', () => {
    expect(matchesQuery(t, '')).toBe(true)
    expect(matchesQuery(t, '   ')).toBe(true)
    expect(matchesQuery(t, 'groceries')).toBe(false)
  })
})

describe('snooze counter (stuck?)', () => {
  it('snoozeTask applies the patch, counts, resets the nag ladder and bumps updatedAt', () => {
    const t = task({ id: 'a', nagCount: 4, updatedAt: NOW - H })
    const s1 = snoozeTask(t, { snoozedUntil: NOW + H }, NOW)
    expect(s1).toMatchObject({ snoozedUntil: NOW + H, nagCount: 0, snoozeCount: 1, updatedAt: NOW })
    const s2 = snoozeTask(s1, { dueAt: NOW + 24 * H, snoozedUntil: null }, NOW + 1)
    expect(s2).toMatchObject({ dueAt: NOW + 24 * H, snoozedUntil: null, snoozeCount: 2 })
    expect(t.snoozeCount).toBe(0) // not mutated
  })

  it('isStuck from SNOOZE_NUDGE on, never for finished tasks; normalizeTask repairs bad counts', () => {
    expect(SNOOZE_NUDGE).toBe(3)
    expect(isStuck(task({ id: 'a', snoozeCount: 2 }))).toBe(false)
    expect(isStuck(task({ id: 'a', snoozeCount: 3 }))).toBe(true)
    expect(isStuck(task({ id: 'a', snoozeCount: 9, completedAt: NOW }))).toBe(false)
    expect(normalizeTask({ id: 'a', snoozeCount: -1, createdAt: 1 }).snoozeCount).toBe(0)
    expect(normalizeTask({ id: 'a', snoozeCount: 4.8, createdAt: 1 }).snoozeCount).toBe(4)
  })

  it('completion and duplicate start the count over (the recurring copy too)', () => {
    const ts = [task({ id: 'r', recurrence: 'daily', dueAt: NOW, snoozeCount: 5 })]
    const out = completeTask(ts, 'r')
    expect(out.every((x) => x.snoozeCount === 0)).toBe(true)
    expect(duplicateTask([task({ id: 'd', snoozeCount: 4 })], 'd', '(copy)')[1].snoozeCount).toBe(0)
  })

  it('stuckDates: tomorrow / next Monday, keeping the time of day of timed tasks (09:00 otherwise)', () => {
    // NOW = Tuesday 13 Oct 2026 10:00
    expect(stuckDates({ dueAt: null }, NOW)).toEqual({ tomorrow: new Date(2026, 9, 14, 9, 0).getTime(), nextWeek: new Date(2026, 9, 19, 9, 0).getTime() })
    expect(stuckDates({ dueAt: new Date(2026, 9, 10, 17, 30).getTime() }, NOW)).toEqual({ tomorrow: new Date(2026, 9, 14, 17, 30).getTime(), nextWeek: new Date(2026, 9, 19, 17, 30).getTime() })
    expect(stuckDates({ dueAt: new Date(2026, 9, 12, 23, 59).getTime() }, NOW).tomorrow).toBe(new Date(2026, 9, 14, 9, 0).getTime()) // all-day → 09:00
    // on a Monday "next Monday" is a week away
    const monday = new Date(2026, 9, 19, 8, 0).getTime()
    expect(stuckDates({ dueAt: null }, monday).nextWeek).toBe(new Date(2026, 9, 26, 9, 0).getTime())
    // Sunday → the next day
    expect(stuckDates({ dueAt: null }, new Date(2026, 9, 18, 8, 0).getTime()).nextWeek).toBe(monday + H)
  })
})

describe('startBy (time blindness)', () => {
  const due = NOW + 3 * H // 13:00
  it('due − estimate; late once that moment passed', () => {
    expect(startBy(task({ id: 'a', dueAt: due, estimateMin: 60 }), NOW)).toEqual({ at: due - H, late: false })
    expect(startBy(task({ id: 'a', dueAt: due, estimateMin: 240 }), NOW)).toEqual({ at: due - 4 * H, late: true })
  })
  it('null without estimate / due date, for overdue, all-day, finished tasks and starts more than 12 h ahead', () => {
    expect(startBy(task({ id: 'a', dueAt: due }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', estimateMin: 30 }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', dueAt: NOW - H, estimateMin: 30 }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', dueAt: new Date(2026, 9, 13, 23, 59).getTime(), estimateMin: 30 }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', dueAt: due, estimateMin: 30, completedAt: NOW }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', dueAt: NOW + 14 * H, estimateMin: 60 }), NOW)).toBeNull()
    expect(startBy(task({ id: 'a', dueAt: NOW + 13 * H, estimateMin: 60 }), NOW)).toEqual({ at: NOW + 12 * H, late: false })
  })
})
