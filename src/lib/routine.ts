/**
 * Routines (spec docs/2026-10-20-routines-design.md) — pure, no React.
 *
 * A routine is a normal task with `routine: true` whose subtasks are its steps. This module holds the templates and
 * the step-by-step run state used by RoutineRunner.tsx: one step at a time, done / skip / back.
 */
import type { Subtask, Task } from './types'
import { translate, type Key, type Lang } from './i18n'
import { uid } from './tasks'

export type RoutineTemplate = 'morning' | 'evening'

export const ROUTINE_TEMPLATES: Record<RoutineTemplate, { title: Key; time: string; steps: Key[] }> = {
  morning: {
    title: 'rt_morning',
    time: '07:30',
    steps: ['rt_m_water', 'rt_m_meds', 'rt_m_wash', 'rt_m_dress', 'rt_m_breakfast', 'rt_m_plan', 'rt_m_bag'],
  },
  evening: {
    title: 'rt_evening',
    time: '21:30',
    steps: ['rt_e_tidy', 'rt_e_plan', 'rt_e_prepare', 'rt_e_charge', 'rt_e_screens'],
  },
}

/** Next occurrence of `HH:MM` local time strictly after `nowMs` (today if still ahead, else tomorrow). */
export function nextTimeOfDay(hhmm: string, nowMs: number): number {
  const [h, m] = hhmm.split(':').map(Number)
  const now = new Date(nowMs)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime()
  return today > nowMs ? today : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, h, m).getTime()
}

/** Task fields for a new routine from a template, in `lang` (the editor opens with them; nothing is saved yet). */
export function routineFromTemplate(kind: RoutineTemplate, lang: Lang, nowMs: number): Pick<Task, 'title' | 'routine' | 'recurrence' | 'dueAt' | 'subtasks'> {
  const tpl = ROUTINE_TEMPLATES[kind]
  return {
    title: translate(lang, tpl.title),
    routine: true,
    recurrence: 'daily',
    dueAt: nextTimeOfDay(tpl.time, nowMs),
    subtasks: tpl.steps.map((k) => ({ id: uid(), title: translate(lang, k), done: false })),
  }
}

/** Whether a task can be run step by step. */
export const isRunnable = (t: Task) => !t.archived && t.routine && t.completedAt === null && t.subtasks.length > 0

export interface RunState {
  taskId: string
  /** Step being shown (subtask id), null when nothing is left. */
  current: string | null
  startedAt: number
  stepStartedAt: number
  /** Steps skipped in this run (left unchecked). */
  skipped: string[]
  /** Actions of this run, newest last, for `back`. */
  history: { id: string; action: 'done' | 'skip' }[]
}

/** First unchecked step that was not skipped in this run, starting after `afterId` and wrapping around (null = none left). */
function nextOpen(steps: Subtask[], skipped: string[], afterId: string | null): string | null {
  const start = afterId === null ? 0 : steps.findIndex((s) => s.id === afterId) + 1
  for (let k = 0; k < steps.length; k++) {
    const s = steps[(start + k) % steps.length]
    if (!s.done && !skipped.includes(s.id)) return s.id
  }
  return null
}

export function startRun(task: Task, nowMs: number): RunState {
  return { taskId: task.id, current: nextOpen(task.subtasks, [], null), startedAt: nowMs, stepStartedAt: nowMs, skipped: [], history: [] }
}

export function currentStep(task: Task, st: RunState): Subtask | null {
  return st.current === null ? null : (task.subtasks.find((s) => s.id === st.current) ?? null)
}

/**
 * One runner action. `done` checks the current step, `skip` leaves it unchecked, both move to the next open step;
 * `back` undoes the last action of this run (unchecks / unskips it and shows it again). Returns the new state and
 * the task's subtasks (the same array when nothing changed).
 */
export function advance(task: Task, st: RunState, action: 'done' | 'skip' | 'back', nowMs: number): { state: RunState; subtasks: Subtask[] } {
  const steps = task.subtasks
  if (action === 'back') {
    const last = st.history[st.history.length - 1]
    if (!last) return { state: st, subtasks: steps }
    const subtasks = last.action === 'done' ? steps.map((s) => (s.id === last.id ? { ...s, done: false } : s)) : steps
    return {
      state: { ...st, current: last.id, stepStartedAt: nowMs, skipped: st.skipped.filter((x) => x !== last.id), history: st.history.slice(0, -1) },
      subtasks,
    }
  }
  const id = st.current
  if (id === null || !steps.some((s) => s.id === id)) return { state: { ...st, current: nextOpen(steps, st.skipped, null) }, subtasks: steps }
  const subtasks = action === 'done' ? steps.map((s) => (s.id === id ? { ...s, done: true } : s)) : steps
  const skipped = action === 'skip' ? [...st.skipped, id] : st.skipped
  return {
    state: { ...st, current: nextOpen(subtasks, skipped, id), stepStartedAt: nowMs, skipped, history: [...st.history, { id, action }] },
    subtasks,
  }
}

/** Counts for the progress bar: checked steps, all steps, skipped in this run (still unchecked). */
export function runProgress(task: Task, st: RunState): { done: number; total: number; skipped: number } {
  const skipped = st.skipped.filter((id) => task.subtasks.some((s) => s.id === id && !s.done)).length
  return { done: task.subtasks.filter((s) => s.done).length, total: task.subtasks.length, skipped }
}

/** No open step left to show: either everything is checked or the rest was skipped. */
export const runFinished = (st: RunState) => st.current === null
