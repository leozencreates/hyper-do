import type { Task, TaskRevision } from './types'

export const HISTORY_LIMIT = 30
export const revisionFields = ['title', 'notes', 'priority', 'tags', 'dueAt', 'subtasks', 'estimateMin', 'energy', 'firstStep', 'dependsOn', 'followUpAt', 'archived', 'status', 'remindEveryMin'] as const

export function revisionContent(task: Task): TaskRevision['content'] {
  return Object.fromEntries(revisionFields.map((k) => [k, task[k]])) as TaskRevision['content']
}
export function revisionOf(task: Task): TaskRevision {
  const content = revisionContent(task)
  // Content participates in the key: two concurrent edits can have the same timestamp.
  return { at: task.updatedAt, content }
}
export function mergeHistory(...lists: TaskRevision[][]): TaskRevision[] {
  const entries = new Map<string, TaskRevision>()
  for (const e of lists.flat()) entries.set(JSON.stringify([e.at, e.content]), e)
  return [...entries.values()].sort((a, b) => b.at - a.at || JSON.stringify(a.content).localeCompare(JSON.stringify(b.content))).slice(0, HISTORY_LIMIT)
}
export function rememberChange(previous: Task, next: Task): Task {
  if (JSON.stringify(revisionContent(previous)) === JSON.stringify(revisionContent(next))) return next
  return { ...next, history: mergeHistory(next.history, previous.history, [revisionOf(previous)]) }
}
export function preserveVersions(winner: Task, loser: Task): Task {
  const different = JSON.stringify(revisionContent(winner)) !== JSON.stringify(revisionContent(loser))
  return { ...winner, history: mergeHistory(winner.history, loser.history, different ? [revisionOf(loser)] : []) }
}
