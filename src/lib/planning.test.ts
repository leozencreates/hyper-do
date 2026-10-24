import { describe, expect, it } from 'vitest'
import { normalizeTask, bumpChanged } from './tasks'
import { estimateSuggestion, isBlocked, reviewTasks, wouldCycle } from './planning'
import { rankNext } from './whatnow'
import { collectDueReminders, planReminderTimes, reminderInterval } from './reminder'
import { DEFAULT_SETTINGS, type FocusEntry, type Task } from './types'
import { emptySyncDoc, mergeData } from './sync'

const now = new Date(2026, 9, 24, 12).getTime()
const task = (id: string, patch: Partial<Task> = {}) => normalizeTask({ id, title: id, createdAt: now - 1000, remindEveryMin: 10, ...patch })

describe('dependencies and review', () => {
  it('normalizes invalid dependencies and follow-up dates', () => {
    expect(normalizeTask({ id: 'bad', dependsOn: ['bad', 'a', 'a'], followUpAt: NaN })).toMatchObject({ dependsOn: ['a'], followUpAt: null })
  })
  it('blocks unresolved and missing prerequisites but releases completed ones', () => {
    const a = task('a', { dependsOn: ['b'] })
    expect(isBlocked(a, [a])).toBe(true)
    expect(rankNext([a, task('b')], undefined, now).map((p) => p.task.id)).toEqual(['b'])
    expect(isBlocked(a, [a, task('b', { completedAt: now })])).toBe(false)
  })
  it('rejects transitive cycles', () => {
    const tasks = [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['c'] }), task('c')]
    expect(wouldCycle(tasks, 'c', 'a')).toBe(true)
    expect(wouldCycle(tasks, 'a', 'c')).toBe(false)
  })
  it('reviews overdue and snoozed work, excluding archived or completed work', () => {
    expect(reviewTasks([task('old', { dueAt: now - 1 }), task('stuck', { snoozeCount: 4 }), task('done', { snoozeCount: 5, completedAt: now }), task('archived', { snoozeCount: 8, archived: true })], now).map((t) => t.id)).toEqual(['stuck', 'old'])
  })
  it('suggests a median from at least three similar tracked tasks', () => {
    const tasks = [15, 30, 120].map((n) => task(String(n), { tags: ['work'], completedAt: now }))
    const log: FocusEntry[] = [15, 30, 120].map((n) => ({ id: String(n), taskId: String(n), phase: 'work', startedAt: now - n * 60000, endedAt: now }))
    expect(estimateSuggestion(task('next', { tags: ['work'] }), tasks, log)).toEqual({ minutes: 30, samples: 3 })
    expect(estimateSuggestion(task('other', { tags: ['home'] }), tasks, log)).toBeNull()
  })
})

describe('history and conflict recovery', () => {
  it('records previous content and restores it as a new change', () => {
    const a = task('a', { notes: 'old' })
    const b = bumpChanged([a], [{ ...a, notes: 'new' }], now)[0]
    expect(b.history[0].content.notes).toBe('old')
    const restored = bumpChanged([b], [{ ...b, ...b.history[0].content }], now + 1)[0]
    expect(restored.notes).toBe('old')
    expect(restored.history[0].content.notes).toBe('new')
    expect(restored.updatedAt).toBeGreaterThan(b.updatedAt)
  })
  it('does not create content history for reminder counters', () => {
    const a = task('a')
    expect(bumpChanged([a], [{ ...a, nagCount: 2 }], now)[0].history).toEqual([])
  })
  it('preserves the losing sync version and remains idempotent', () => {
    const l = { ...emptySyncDoc('a', now), tasks: [task('x', { notes: 'local', updatedAt: now })] }
    const r = { ...emptySyncDoc('b', now), tasks: [task('x', { notes: 'remote', updatedAt: now + 1 })] }
    const first = mergeData(l, r, now).merged
    expect(first.tasks[0].notes).toBe('remote')
    expect(first.tasks[0].history[0].content.notes).toBe('local')
    const again = mergeData(first, l, now)
    expect(again.changedLocal).toBe(false)
    expect(again.merged.tasks).toEqual(first.tasks)
    expect(mergeData(first, first, now).changedRemote).toBe(false)
  })
  it('bounds history even after many edits and import', () => {
    let current = task('x')
    for (let i = 0; i < 80; i++) current = bumpChanged([current], [{ ...current, notes: String(i) }], now + i)[0]
    expect(normalizeTask(current).history).toHaveLength(30)
  })
})

describe('reminder controls', () => {
  it('applies profile intervals consistently to scheduling', () => {
    expect(reminderInterval(task('a'), { ...DEFAULT_SETTINGS, reminderProfile: 'gentle' }, false)).toBe(20 * 60000)
    expect(reminderInterval(task('a'), { ...DEFAULT_SETTINGS, reminderProfile: 'persistent' }, false)).toBe(5 * 60000)
    expect(planReminderTimes(task('a'), { ...DEFAULT_SETTINGS, reminderProfile: 'gentle' }, now, 1, 86400000)[0].at).toBe(now + 20 * 60000)
  })
  it('enforces a rolling quota and eventually serves waiting tasks', () => {
    const settings = { ...DEFAULT_SETTINGS, reminderHourlyLimit: 1 }
    const counters = new Map<string, number>()
    const tasks = [task('a'), task('b')]
    expect(collectDueReminders(tasks, settings, counters, now).map((h) => h.task.id)).toEqual(['a'])
    expect(collectDueReminders(tasks, settings, counters, now + 30 * 60000)).toEqual([])
    expect(collectDueReminders(tasks, settings, counters, now + 60 * 60000).map((h) => h.task.id)).toEqual(['b'])
  })
  it('counts a grouped batch once', () => {
    const settings = { ...DEFAULT_SETTINGS, reminderHourlyLimit: 1, groupReminders: true }
    const counters = new Map<string, number>()
    expect(collectDueReminders([task('a'), task('b')], settings, counters, now)).toHaveLength(2)
    expect(collectDueReminders([task('c')], settings, counters, now + 60000)).toHaveLength(0)
  })
  it('suppresses archived and blocked tasks and respects follow-up dates', () => {
    const tasks = [task('a', { archived: true }), task('b', { dependsOn: ['missing'] }), task('c', { status: 'waiting', followUpAt: now + 60000 }), task('d', { status: 'waiting', followUpAt: now - 1 })]
    expect(collectDueReminders(tasks, DEFAULT_SETTINGS, new Map(), now).map((h) => h.task.id)).toEqual(['d'])
    expect(planReminderTimes(tasks[0], DEFAULT_SETTINGS, now, 3, 86400000)).toEqual([])
  })
})
