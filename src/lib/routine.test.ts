import { describe, it, expect } from 'vitest'
import { ROUTINE_TEMPLATES, advance, currentStep, isRunnable, nextTimeOfDay, routineFromTemplate, runFinished, runProgress, startRun, type RunState } from './routine'
import { completeTask, normalizeTask } from './tasks'
import { translate } from './i18n'
import type { Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const steps = (...titles: string[]) => titles.map((title, i) => ({ id: `s${i + 1}`, title, done: false }))
const routine = (o: Partial<Task> = {}): Task => normalizeTask({ id: 'r', title: 'Morning', createdAt: NOW, routine: true, recurrence: 'daily', subtasks: steps('water', 'meds', 'dress'), ...o })

describe('templates', () => {
  it('nextTimeOfDay: later today, or tomorrow once passed', () => {
    expect(nextTimeOfDay('21:30', NOW)).toBe(new Date(2026, 9, 13, 21, 30).getTime())
    expect(nextTimeOfDay('07:30', NOW)).toBe(new Date(2026, 9, 14, 7, 30).getTime())
    expect(nextTimeOfDay('10:00', NOW)).toBe(new Date(2026, 9, 14, 10, 0).getTime()) // exactly now → tomorrow
  })

  it('routineFromTemplate: translated title and steps, daily, routine flag, next template time', () => {
    for (const lang of ['en', 'tr', 'ru'] as const) {
      const r = routineFromTemplate('morning', lang, NOW)
      expect(r.title).toBe(translate(lang, 'rt_morning'))
      expect(r).toMatchObject({ routine: true, recurrence: 'daily', dueAt: new Date(2026, 9, 14, 7, 30).getTime() })
      expect(r.subtasks.map((s) => s.title)).toEqual(ROUTINE_TEMPLATES.morning.steps.map((k) => translate(lang, k)))
      expect(r.subtasks.every((s) => !s.done && s.id.length > 0)).toBe(true)
      expect(new Set(r.subtasks.map((s) => s.id)).size).toBe(r.subtasks.length)
    }
    expect(routineFromTemplate('evening', 'en', NOW).dueAt).toBe(new Date(2026, 9, 13, 21, 30).getTime())
  })

  it('the routine flag survives normalizeTask; old tasks load as non-routines; runnable needs steps', () => {
    expect(normalizeTask({ id: 'a', createdAt: 1 }).routine).toBe(false)
    expect(normalizeTask({ id: 'a', createdAt: 1, routine: 'yes' as never }).routine).toBe(false)
    expect(isRunnable(routine())).toBe(true)
    expect(isRunnable(routine({ subtasks: [] }))).toBe(false)
    expect(isRunnable(routine({ routine: false }))).toBe(false)
    expect(isRunnable(routine({ completedAt: NOW }))).toBe(false)
  })

  it('completing a routine spawns the next day with every step unchecked', () => {
    const done = routine({ dueAt: NOW, subtasks: steps('a', 'b').map((s) => ({ ...s, done: true })) })
    const [next] = completeTask([done], 'r')
    expect(next).toMatchObject({ routine: true, completedAt: null })
    expect(next.subtasks.every((s) => !s.done)).toBe(true)
  })
})

describe('run state', () => {
  /** Runs one action and returns the task with the new steps applied (what the UI does through onSteps). */
  const step = (task: Task, st: RunState, action: 'done' | 'skip' | 'back', at = NOW) => {
    const r = advance(task, st, action, at)
    return { task: { ...task, subtasks: r.subtasks }, st: r.state, same: r.subtasks === task.subtasks }
  }

  it('starts at the first unchecked step; done checks and moves on; finished when all are done', () => {
    let task = routine({ subtasks: steps('water', 'meds', 'dress').map((s, i) => ({ ...s, done: i === 0 })) })
    let st = startRun(task, NOW)
    expect(currentStep(task, st)?.title).toBe('meds')
    ;({ task, st } = step(task, st, 'done', NOW + 60_000))
    expect(currentStep(task, st)?.title).toBe('dress')
    expect(st.stepStartedAt).toBe(NOW + 60_000)
    expect(runProgress(task, st)).toEqual({ done: 2, total: 3, skipped: 0 })
    ;({ task, st } = step(task, st, 'done'))
    expect(runFinished(st)).toBe(true)
    expect(task.subtasks.every((s) => s.done)).toBe(true)
  })

  it('skip leaves the step unchecked, it is not shown again in this run; the summary counts it', () => {
    let task = routine()
    let st = startRun(task, NOW)
    let same: boolean
    ;({ task, st, same } = step(task, st, 'skip'))
    expect(same).toBe(true) // nothing to write
    expect(currentStep(task, st)?.title).toBe('meds')
    ;({ task, st } = step(task, st, 'done'))
    ;({ task, st } = step(task, st, 'done'))
    expect(runFinished(st)).toBe(true)
    expect(runProgress(task, st)).toEqual({ done: 2, total: 3, skipped: 1 })
    expect(task.subtasks.find((s) => s.id === 's1')!.done).toBe(false)
  })

  it('back undoes the last action: unchecks a done step / brings a skipped one back', () => {
    let task = routine()
    let st = startRun(task, NOW)
    ;({ task, st } = step(task, st, 'done'))
    ;({ task, st } = step(task, st, 'skip'))
    expect(currentStep(task, st)?.title).toBe('dress')
    ;({ task, st } = step(task, st, 'back'))
    expect(currentStep(task, st)?.title).toBe('meds')
    expect(st.skipped).toEqual([])
    ;({ task, st } = step(task, st, 'back'))
    expect(currentStep(task, st)?.title).toBe('water')
    expect(task.subtasks.find((s) => s.id === 's1')!.done).toBe(false)
    // nothing left to undo
    const r = advance(task, st, 'back', NOW)
    expect(r.state).toBe(st)
    expect(r.subtasks).toBe(task.subtasks)
  })

  it('wraps around to earlier unchecked steps; a run on a fully checked routine is finished at once', () => {
    let task = routine({ subtasks: steps('a', 'b', 'c').map((s, i) => ({ ...s, done: i === 1 })) })
    let st: RunState = { ...startRun(task, NOW), current: 's3' } // e.g. the user started at the last step
    ;({ task, st } = step(task, st, 'done'))
    expect(currentStep(task, st)?.title).toBe('a')
    expect(runFinished(startRun(routine({ subtasks: steps('a').map((s) => ({ ...s, done: true })) }), NOW))).toBe(true)
  })

  it('a step deleted elsewhere while running: the runner jumps to the next open one', () => {
    const task = routine()
    const st = startRun(task, NOW)
    const edited = { ...task, subtasks: task.subtasks.filter((s) => s.id !== 's1') }
    const r = advance(edited, st, 'done', NOW)
    expect(r.state.current).toBe('s2')
    expect(r.subtasks).toBe(edited.subtasks)
  })
})
