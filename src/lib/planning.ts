import type { FocusEntry, Task } from './types'

export function isBlocked(task: Task, tasks: Task[]): boolean {
  return task.dependsOn.some((id) => !tasks.some((t) => t.id === id && t.completedAt !== null))
}

/** Missing prerequisites stay blocked until the user removes the reference. */
export function wouldCycle(tasks: Task[], taskId: string, dependencyId: string): boolean {
  const seen = new Set<string>()
  const visit = (id: string): boolean => {
    if (id === taskId) return true
    if (seen.has(id)) return false
    seen.add(id)
    return tasks.find((t) => t.id === id)?.dependsOn.some(visit) ?? false
  }
  return visit(dependencyId)
}

/** Completed, similarly tagged tasks with actual work logs; no inference from untracked time. */
export function estimateSuggestion(task: Task, tasks: Task[], log: FocusEntry[]): { minutes: number; samples: number } | null {
  const totals = new Map<string, number>()
  for (const e of log) if (e.phase === 'work' && e.taskId) totals.set(e.taskId, (totals.get(e.taskId) ?? 0) + Math.max(0, e.endedAt - e.startedAt) / 60_000)
  const samples = tasks.filter((t) => t.id !== task.id && t.completedAt !== null && t.tags.some((tag) => task.tags.includes(tag)))
    .map((t) => totals.get(t.id) ?? 0).filter((n) => n >= 1).sort((a, b) => a - b)
  if (samples.length < 3) return null
  const middle = Math.floor(samples.length / 2)
  const median = samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2
  return { minutes: Math.max(5, Math.round(median / 5) * 5), samples: samples.length }
}

export function reviewTasks(tasks: Task[], now = Date.now()): Task[] {
  return tasks.filter((t) => !t.archived && t.completedAt === null && (t.snoozeCount >= 3 || (t.dueAt !== null && t.dueAt < now)))
    .sort((a, b) => b.snoozeCount - a.snoozeCount || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity))
}
