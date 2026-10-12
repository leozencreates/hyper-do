/** Browser-only "save as file" helpers (JSON backup, .ics export). */
import type { Task } from './types'
import { buildIcs, type IcsOutEvent } from './ics'
import { taskToIcsEvent, tasksToIcs } from './calendar-links'

/** YYYY-MM-DD, for file names. */
export const dateStamp = () => new Date().toISOString().slice(0, 10)

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function downloadJson(filename: string, value: unknown) {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json')
}

const ICS_MIME = 'text/calendar;charset=utf-8'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task'

export function downloadTaskIcs(task: Task) {
  const ev: IcsOutEvent | null = taskToIcsEvent(task)
  if (ev) downloadText(`${slug(task.title)}.ics`, buildIcs([ev]), ICS_MIME)
}

export function downloadAllTasksIcs(tasks: Task[]) {
  downloadText(`hyperdo-tasks-${dateStamp()}.ics`, tasksToIcs(tasks.filter((t) => t.completedAt === null && t.dueAt !== null)), ICS_MIME)
}
