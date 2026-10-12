/**
 * "Add to calendar" without any account connection: deep links for Google / Outlook.com / Office 365 / Yahoo
 * and a downloadable .ics file. Also the task → calendar-event mapping shared with the Google sync.
 */
import type { Task } from './types'
import { buildIcs, icsUtc, type IcsOutEvent } from './ics'

const DAY = 86_400_000
export const TASK_EVENT_MIN = 30

/** A task due at 23:59 (quick-add "today") is treated as an all-day event; otherwise a 30-minute block at the due time. */
export function taskEventWindow(task: Task): { start: number; end: number; allDay: boolean } | null {
  if (task.dueAt === null) return null
  const d = new Date(task.dueAt)
  if (d.getHours() === 23 && d.getMinutes() === 59) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    return { start, end: start + DAY, allDay: true }
  }
  return { start: task.dueAt, end: task.dueAt + TASK_EVENT_MIN * 60_000, allDay: false }
}

export function taskDescription(task: Task): string {
  const parts: string[] = []
  if (task.notes.trim()) parts.push(task.notes.trim())
  const open = task.subtasks.filter((s) => !s.done)
  if (open.length) parts.push(open.map((s) => `☐ ${s.title}`).join('\n'))
  if (task.tags.length) parts.push(task.tags.map((x) => `#${x}`).join(' '))
  parts.push('— Hyper Do')
  return parts.join('\n\n')
}

export type LinkKind = 'google' | 'outlook' | 'office' | 'yahoo'

export function calendarLink(kind: LinkKind, task: Task): string | null {
  const w = taskEventWindow(task)
  if (!w) return null
  const title = task.title
  const details = taskDescription(task)
  const pad = (n: number) => String(n).padStart(2, '0')
  const localDate = (ts: number) => {
    const d = new Date(ts)
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
  }
  switch (kind) {
    case 'google': {
      const dates = w.allDay ? `${localDate(w.start)}/${localDate(w.end)}` : `${icsUtc(w.start)}/${icsUtc(w.end)}`
      return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details })}`
    }
    case 'outlook':
    case 'office': {
      const host = kind === 'outlook' ? 'https://outlook.live.com' : 'https://outlook.office.com'
      const q = new URLSearchParams({
        path: '/calendar/action/compose',
        rru: 'addevent',
        subject: title,
        body: details,
        startdt: new Date(w.start).toISOString(),
        enddt: new Date(w.end).toISOString(),
        ...(w.allDay ? { allday: 'true' } : {}),
      })
      return `${host}/calendar/0/deeplink/compose?${q}`
    }
    case 'yahoo': {
      const q = new URLSearchParams({ v: '60', title, st: icsUtc(w.start), et: icsUtc(w.end), desc: details })
      if (w.allDay) q.set('dur', 'allday')
      return `https://calendar.yahoo.com/?${q}`
    }
  }
}

export function taskToIcsEvent(task: Task): IcsOutEvent | null {
  const w = taskEventWindow(task)
  if (!w) return null
  return { uid: `hyperdo-${task.id}@hyperdo.app`, title: task.title, start: w.start, end: w.end, allDay: w.allDay, description: taskDescription(task) }
}

export function tasksToIcs(tasks: Task[]): string {
  return buildIcs(tasks.map(taskToIcsEvent).filter((x): x is IcsOutEvent => x !== null))
}

export function downloadText(filename: string, text: string, mime = 'text/calendar;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'task'

export function downloadTaskIcs(task: Task) {
  const ev = taskToIcsEvent(task)
  if (ev) downloadText(`${slug(task.title)}.ics`, buildIcs([ev]))
}

export function downloadAllTasksIcs(tasks: Task[]) {
  downloadText(`hyperdo-tasks-${new Date().toISOString().slice(0, 10)}.ics`, tasksToIcs(tasks.filter((t) => t.completedAt === null && t.dueAt !== null)))
}
