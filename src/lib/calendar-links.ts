/**
 * Task → calendar-event mapping (platform independent, shared with the Google sync) and
 * "add to calendar" deep links for Google / Outlook.com / Office 365 / Yahoo plus .ics text.
 * Browser-only download helpers live in download.ts.
 */
import type { Recurrence, RecurrenceRule, Task } from './types'
import { buildIcs, icsUtc, type IcsOutEvent } from './ics'
import { DAY, isEndOfDay, startOfDay } from './dates'

export const TASK_EVENT_MIN = 30

const RRULE_FREQ: Record<RecurrenceRule['unit'], string> = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * RFC 5545 RRULE body (without `RRULE:`) for a task's recurrence, or null when there is nothing to export:
 * `none`, and custom rules with `afterCompletion` (the next date depends on when the task is finished,
 * which no calendar can express).
 */
export function recurrenceRrule(rec: Recurrence, rule?: RecurrenceRule | null): string | null {
  switch (rec) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly':
      return 'FREQ=WEEKLY'
    case 'monthly':
      return 'FREQ=MONTHLY'
    case 'yearly':
      return 'FREQ=YEARLY'
    case 'custom': {
      if (!rule || rule.afterCompletion) return null
      const parts = [`FREQ=${RRULE_FREQ[rule.unit]}`]
      if (rule.every > 1) parts.push(`INTERVAL=${Math.floor(rule.every)}`)
      if (rule.unit === 'week' && rule.weekdays?.length) parts.push(`BYDAY=${[...new Set(rule.weekdays)].sort((a, b) => a - b).map((d) => RRULE_DAY[d]).join(',')}`)
      return parts.join(';')
    }
    default:
      return null
  }
}

/** A task due at 23:59 (quick-add "today") is treated as an all-day event; otherwise a 30-minute block at the due time. */
export function taskEventWindow(task: Task): { start: number; end: number; allDay: boolean } | null {
  if (task.dueAt === null) return null
  if (isEndOfDay(task.dueAt)) {
    const start = startOfDay(task.dueAt)
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
      const rrule = recurrenceRrule(task.recurrence, task.recurrenceRule)
      return `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: title, dates, details, ...(rrule ? { recur: `RRULE:${rrule}` } : {}) })}`
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
  const rrule = recurrenceRrule(task.recurrence, task.recurrenceRule)
  return { uid: `hyperdo-${task.id}@hyperdo.app`, title: task.title, start: w.start, end: w.end, allDay: w.allDay, description: taskDescription(task), ...(rrule ? { rrule } : {}) }
}

export function tasksToIcs(tasks: Task[]): string {
  return buildIcs(tasks.map(taskToIcsEvent).filter((x): x is IcsOutEvent => x !== null))
}
