import { describe, it, expect } from 'vitest'
import { ANY_CONTEXT, isNextCandidate, rankNext, reasonText, suggestNext } from './whatnow'
import { normalizeTask } from './tasks'
import { translate } from './i18n'
import type { Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
let order = 0
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: ++order, priority: 'low', ...o })
const ids = (tasks: Task[], ctx = ANY_CONTEXT) => rankNext(tasks, ctx, NOW).map((p) => p.task.id)

describe('isNextCandidate', () => {
  it('leaves out completed, snoozed and waiting tasks', () => {
    expect(isNextCandidate(task({ id: 'a' }), NOW)).toBe(true)
    expect(isNextCandidate(task({ id: 'b', completedAt: NOW - H }), NOW)).toBe(false)
    expect(isNextCandidate(task({ id: 'c', snoozedUntil: NOW + H }), NOW)).toBe(false)
    expect(isNextCandidate(task({ id: 'd', snoozedUntil: NOW - H }), NOW)).toBe(true)
    expect(isNextCandidate(task({ id: 'e', status: 'waiting' }), NOW)).toBe(false)
  })
})

describe('rankNext', () => {
  it('urgency first: overdue > focused > due today > high priority > due soon > the rest', () => {
    const tasks = [
      task({ id: 'plain' }),
      task({ id: 'soon', dueAt: NOW + 30 * H }),
      task({ id: 'high', priority: 'high' }),
      task({ id: 'today', dueAt: NOW + 3 * H }),
      task({ id: 'focused', focused: true }),
      task({ id: 'overdue', dueAt: NOW - 2 * H }),
    ]
    expect(ids(tasks)).toEqual(['overdue', 'focused', 'today', 'high', 'soon', 'plain'])
  })

  it('the longer overdue, the higher (capped), and the reasons explain it', () => {
    const tasks = [task({ id: 'a', dueAt: NOW - 1 * H }), task({ id: 'b', dueAt: NOW - 5 * H, priority: 'high' })]
    const [first, second] = rankNext(tasks, ANY_CONTEXT, NOW)
    expect(first.task.id).toBe('b')
    expect(first.score).toBe(40 + 5 + 15)
    expect(first.reasons).toEqual([{ kind: 'overdue', min: 300 }, { kind: 'priority' }])
    expect(second.score).toBe(41)
    const capped = rankNext([task({ id: 'c', dueAt: NOW - 72 * H })], ANY_CONTEXT, NOW)[0]
    expect(capped.score).toBe(60)
  })

  it('momentum counts: board status doing, subtasks started, ignored reminders', () => {
    const tasks = [
      task({ id: 'plain' }),
      task({ id: 'doing', status: 'doing' }),
      task({ id: 'started', subtasks: [{ id: 's1', title: 'x', done: true }, { id: 's2', title: 'y', done: false }] }),
      task({ id: 'nagged', nagCount: 7 }),
    ]
    expect(ids(tasks)).toEqual(['doing', 'nagged', 'started', 'plain'])
    const nag = rankNext(tasks, ANY_CONTEXT, NOW).find((p) => p.task.id === 'nagged')!
    expect(nag.score).toBe(10) // capped at +10
    const started = rankNext(tasks, ANY_CONTEXT, NOW).find((p) => p.task.id === 'started')!
    expect(started.reasons).toEqual([{ kind: 'started', done: 1, total: 2 }])
    // all subtasks done is not "started" any more
    const all = task({ id: 'all', subtasks: [{ id: 's', title: 'x', done: true }] })
    expect(rankNext([all], ANY_CONTEXT, NOW)[0].reasons).toEqual([])
  })

  it('the energy chip pushes tasks above it far down and rewards those that fit', () => {
    const tasks = [task({ id: 'hard', energy: 'high', priority: 'high' }), task({ id: 'easy', energy: 'low' }), task({ id: 'unknown' })]
    expect(ids(tasks)).toEqual(['hard', 'easy', 'unknown'])
    expect(ids(tasks, { energy: 'low', minutes: null })).toEqual(['easy', 'unknown', 'hard'])
    expect(ids(tasks, { energy: 'high', minutes: null })).toEqual(['hard', 'easy', 'unknown'])
    expect(rankNext(tasks, { energy: 'low', minutes: null }, NOW)[0].reasons).toEqual([{ kind: 'energy' }])
  })

  it('the time chip keeps tasks that fit, punishes longer ones; without it short estimates are quick wins', () => {
    const tasks = [task({ id: 'long', estimateMin: 90, priority: 'high' }), task({ id: 'short', estimateMin: 10 }), task({ id: 'none' })]
    expect(ids(tasks)).toEqual(['long', 'short', 'none'])
    expect(rankNext(tasks, ANY_CONTEXT, NOW).find((p) => p.task.id === 'short')!.reasons).toEqual([{ kind: 'quick' }])
    expect(ids(tasks, { energy: null, minutes: 15 })).toEqual(['short', 'none', 'long'])
    const r15 = rankNext(tasks, { energy: null, minutes: 15 }, NOW)
    expect(r15.find((p) => p.task.id === 'none')!.score).toBe(-5)
    expect(r15[0].reasons).toEqual([{ kind: 'fits', min: 10 }])
    // 60 minutes: no penalty for the missing estimate, the long one still does not fit
    expect(ids(tasks, { energy: null, minutes: 60 })).toEqual(['short', 'none', 'long'])
  })

  it('ties: earlier due date first, undated last, then list order', () => {
    const tasks = [task({ id: 'b' }), task({ id: 'a' }), task({ id: 'later', dueAt: NOW + 10 * 24 * H }), task({ id: 'sooner', dueAt: NOW + 5 * 24 * H })]
    expect(ids(tasks)).toEqual(['sooner', 'later', 'b', 'a'])
  })
})

describe('suggestNext', () => {
  it('walks down the ranking and wraps around; null when nothing is a candidate', () => {
    const tasks = [task({ id: 'x', dueAt: NOW - H }), task({ id: 'y', priority: 'high' }), task({ id: 'z' })]
    expect(suggestNext(tasks, ANY_CONTEXT, NOW)?.task.id).toBe('x')
    expect(suggestNext(tasks, ANY_CONTEXT, NOW, 1)?.task.id).toBe('y')
    expect(suggestNext(tasks, ANY_CONTEXT, NOW, 2)?.task.id).toBe('z')
    expect(suggestNext(tasks, ANY_CONTEXT, NOW, 3)?.task.id).toBe('x')
    expect(suggestNext(tasks, ANY_CONTEXT, NOW, -1)?.task.id).toBe('z')
    expect(suggestNext([task({ id: 'w', status: 'waiting' })], ANY_CONTEXT, NOW)).toBeNull()
    expect(suggestNext([], ANY_CONTEXT, NOW)).toBeNull()
  })
})

describe('reasonText', () => {
  it('renders every reason kind in every language without leaking placeholders', () => {
    const all = [
      { kind: 'overdue', min: 125 },
      { kind: 'focused' },
      { kind: 'today' },
      { kind: 'soon' },
      { kind: 'priority' },
      { kind: 'doing' },
      { kind: 'started', done: 2, total: 5 },
      { kind: 'nagged', n: 4 },
      { kind: 'energy' },
      { kind: 'fits', min: 20 },
      { kind: 'quick' },
    ] as const
    for (const lang of ['en', 'tr', 'ru'] as const) {
      for (const r of all) {
        const s = reasonText(r, lang)
        expect(s.length).toBeGreaterThan(2)
        expect(s).not.toMatch(/[{}]/)
      }
    }
    expect(reasonText({ kind: 'overdue', min: 125 }, 'en')).toBe(`⏰ ${translate('en', 'dur_hm', { h: 2, m: 5 })} overdue`)
    expect(reasonText({ kind: 'started', done: 2, total: 5 }, 'en')).toBe('☑ 2/5 subtasks done')
  })
})

describe('rankNext: start-by', () => {
  it('a task whose start time has come gets +20 and the startby reason, above a plain "due today"', () => {
    const tasks = [task({ id: 'today', dueAt: NOW + 5 * H }), task({ id: 'start', dueAt: NOW + 5 * H, estimateMin: 360 })]
    const [first] = rankNext(tasks, ANY_CONTEXT, NOW)
    expect(first.task.id).toBe('start')
    expect(first.reasons[0]).toEqual({ kind: 'startby', min: 360 })
    expect(first.score).toBe(20 + 25)
    expect(reasonText({ kind: 'startby', min: 45 }, 'en')).toBe(`▶ Time to start (takes ${translate('en', 'dur_m', { n: 45 })})`)
  })
})
