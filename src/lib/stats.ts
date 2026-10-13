/**
 * Streaks, heatmap, focus log and completion counters (pure, no React / Electron).
 * Shared by the UI (Stats modal, task chips), the Electron main process (Telegram, deep links)
 * and the tests.
 */
import { FOCUS_LOG_MAX, type AppData, type FocusEntry, type Task } from './types'
import { DAY, addDays, dayKey, dayKeyToDate, startOfDay } from './dates'
import { completeTask, touchTask } from './tasks'
import { resetNag } from './reminder'

const MIN = 60_000

// ---- Focus log (#8) ----

/** Appends an entry and keeps only the newest `FOCUS_LOG_MAX`. */
export function pushFocusEntry(log: FocusEntry[], entry: FocusEntry): FocusEntry[] {
  const out = [...log, entry]
  return out.length > FOCUS_LOG_MAX ? out.slice(out.length - FOCUS_LOG_MAX) : out
}

/** Minutes of **work** phases per task id (rounded per task). Entries without a task are ignored. */
export function spentMinByTask(log: FocusEntry[]): Record<string, number> {
  const ms: Record<string, number> = {}
  for (const e of log) {
    if (e.phase !== 'work' || e.taskId === null) continue
    ms[e.taskId] = (ms[e.taskId] ?? 0) + Math.max(0, e.endedAt - e.startedAt)
  }
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(ms)) out[id] = Math.round(v / MIN)
  return out
}

/** Work minutes inside [fromMs, toMs): entries crossing the boundary count only their overlapping part. */
export function focusMinutes(log: FocusEntry[], fromMs: number, toMs: number): number {
  let ms = 0
  for (const e of log) {
    if (e.phase !== 'work') continue
    const a = Math.max(e.startedAt, fromMs)
    const b = Math.min(e.endedAt, toMs)
    if (b > a) ms += b - a
  }
  return Math.round(ms / MIN)
}

// ---- Daily completions, streaks, heatmap (#9) ----

/** Counts a completion on the day of `nowMs`. Call wherever `completeTask` is called. */
export function recordDone(data: AppData, nowMs = Date.now()): AppData {
  const key = dayKey(nowMs)
  return { ...data, dailyDone: { ...data.dailyDone, [key]: (data.dailyDone[key] ?? 0) + 1 } }
}

/** Reopening a task takes the completion back from the day it was completed on (never below 0). */
export function recordReopen(data: AppData, completedAt: number | null): AppData {
  if (completedAt === null) return data
  const key = dayKey(completedAt)
  const cur = data.dailyDone[key] ?? 0
  if (cur <= 0) return data
  const dailyDone = { ...data.dailyDone }
  if (cur === 1) delete dailyDone[key]
  else dailyDone[key] = cur - 1
  return { ...data, dailyDone }
}

/** `completeTask` + `recordDone` in one step for the main-process call sites; a no-op for unknown or done tasks. */
export function completeInData(data: AppData, id: string, nowMs = Date.now()): AppData {
  const task = data.tasks.find((t) => t.id === id)
  if (!task || task.completedAt !== null) return data
  return recordDone({ ...data, tasks: completeTask(data.tasks, id) }, nowMs)
}

/** Buttons on a reminder notification (Android action type `HYPERDO_TASK`; `tap` = the notification body). */
export type NotificationActionId = 'done' | 'snooze30' | 'focus' | 'tap'
export const SNOOZE_ACTION_MIN = 30

/**
 * Applies a notification button to the data exactly like the UI would: `done` → `completeInData`
 * (recurrence + `dailyDone`), `snooze30` → quiet for 30 minutes, `focus` → this task becomes the only focused one.
 * Every button is a reaction, so the escalation counter resets. `tap`, unknown actions, unknown or finished tasks
 * leave the data untouched (same object).
 */
export function applyNotificationAction(data: AppData, taskId: string, actionId: NotificationActionId | string, nowMs = Date.now()): AppData {
  const task = data.tasks.find((t) => t.id === taskId)
  if (!task || task.completedAt !== null) return data
  switch (actionId) {
    case 'done':
      return completeInData(data, taskId, nowMs)
    case 'snooze30':
      return { ...data, tasks: data.tasks.map((t) => (t.id === taskId ? touchTask(resetNag({ ...t, snoozedUntil: nowMs + SNOOZE_ACTION_MIN * 60_000 }, nowMs), nowMs) : t)) }
    case 'focus':
      return { ...data, tasks: data.tasks.map((t) => (t.id === taskId ? touchTask(resetNag({ ...t, focused: true }, nowMs), nowMs) : t.focused ? touchTask({ ...t, focused: false }, nowMs) : t)) }
    default:
      return data
  }
}

const hasDone = (dailyDone: Record<string, number>, key: string) => (dailyDone[key] ?? 0) > 0

/**
 * Consecutive days with at least one completion, ending today or yesterday
 * (today may still be in progress). 0 when neither today nor yesterday has a completion.
 */
export function streak(dailyDone: Record<string, number>, todayKey: string): number {
  let day = dayKeyToDate(todayKey).getTime()
  if (!hasDone(dailyDone, todayKey)) {
    day = addDays(day, -1)
    if (!hasDone(dailyDone, dayKey(day))) return 0
  }
  let n = 0
  while (hasDone(dailyDone, dayKey(day))) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/** Longest run of consecutive days with a completion, over the whole history. */
export function bestStreak(dailyDone: Record<string, number>): number {
  const days = Object.keys(dailyDone)
    .filter((k) => hasDone(dailyDone, k))
    .map((k) => dayKeyToDate(k).getTime())
    .sort((a, b) => a - b)
  let best = 0
  let run = 0
  let prev: number | null = null
  for (const d of days) {
    run = prev !== null && Math.round((d - prev) / DAY) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

export interface HeatCell {
  key: string
  count: number
  /** 0 … 4: none · 1 · 2–3 · 4–6 · 7+ completions */
  level: 0 | 1 | 2 | 3 | 4
  /** Later than today (the current week is shown whole). */
  future: boolean
}

export function heatLevel(count: number): HeatCell['level'] {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count <= 3) return 2
  if (count <= 6) return 3
  return 4
}

/**
 * GitHub-style grid: `weeks` × 7 cells, Monday-first weeks, the last week being the current one
 * (cells after today are flagged `future`). Oldest cell first; lay out column-major to get weeks as columns.
 */
export function heatmap(dailyDone: Record<string, number>, weeks: number, now = Date.now()): HeatCell[] {
  const today = startOfDay(now)
  const mondayOffset = (new Date(today).getDay() + 6) % 7
  const start = addDays(today, -mondayOffset - (weeks - 1) * 7)
  const cells: HeatCell[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i)
    const key = dayKey(day)
    const count = dailyDone[key] ?? 0
    cells.push({ key, count, level: heatLevel(count), future: day > today })
  }
  return cells
}

/** Tags of tasks completed since `fromMs`, most used first (ties alphabetical). */
export function topTags(tasks: Task[], fromMs: number, limit = 5): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of tasks) {
    if (t.completedAt === null || t.completedAt < fromMs) continue
    for (const tag of new Set(t.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, limit)
}

/** Sum of `dailyDone` over the last `days` days ending today (inclusive). */
export function doneInLastDays(dailyDone: Record<string, number>, days: number, now = Date.now()): number {
  const today = startOfDay(now)
  let n = 0
  for (let i = 0; i < days; i++) n += dailyDone[dayKey(addDays(today, -i))] ?? 0
  return n
}
