import type { NoteEvent, NoteEventKind, Task, TaskRevision } from './types'

export const HISTORY_LIMIT = 30
/** Note events kept per task (newest first). */
export const NOTE_LOG_LIMIT = 50
const NOTE_KINDS: NoteEventKind[] = ['added', 'edited', 'removed']
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
  return { ...winner, history: mergeHistory(winner.history, loser.history, different ? [revisionOf(loser)] : []), noteLog: mergeNoteLog(winner.noteLog ?? [], loser.noteLog ?? []) }
}

/** What a notes change from `before` to `after` is, or null when the (trimmed) text did not change. */
export function noteChangeKind(before: string, after: string): NoteEventKind | null {
  const a = (before ?? '').trim()
  const b = (after ?? '').trim()
  if (a === b) return null
  return !a ? 'added' : !b ? 'removed' : 'edited'
}

/** Union of note logs (same time + kind counted once), newest first, capped at `NOTE_LOG_LIMIT`. */
export function mergeNoteLog(...lists: NoteEvent[][]): NoteEvent[] {
  const entries = new Map<string, NoteEvent>()
  for (const e of lists.flat()) entries.set(`${e.at}|${e.kind}`, e)
  return [...entries.values()].sort((a, b) => b.at - a.at || NOTE_KINDS.indexOf(a.kind) - NOTE_KINDS.indexOf(b.kind)).slice(0, NOTE_LOG_LIMIT)
}

/** Readable note log from stored JSON (unknown shapes dropped). */
export function normalizeNoteLog(raw: unknown): NoteEvent[] {
  if (!Array.isArray(raw)) return []
  const valid = raw
    .slice(0, NOTE_LOG_LIMIT * 2)
    .filter((e): e is NoteEvent => !!e && typeof e === 'object' && typeof e.at === 'number' && Number.isFinite(e.at) && NOTE_KINDS.includes(e.kind))
    .map((e) => ({ at: e.at, kind: e.kind }))
  return mergeNoteLog(valid)
}

/**
 * Records a notes change on `next` at `at`. `previous` undefined = a new task: non-empty notes count as added.
 * Returns `next` itself when the notes did not change.
 */
export function logNoteChange(previous: Task | undefined, next: Task, at: number): Task {
  const kind = noteChangeKind(previous?.notes ?? '', next.notes)
  if (!kind) return next
  return { ...next, noteLog: mergeNoteLog([{ at, kind }], next.noteLog ?? []) }
}
