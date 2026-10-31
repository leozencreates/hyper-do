/**
 * Task → calendar-event mapping (platform independent, shared with the Google sync) and
 * "add to calendar" deep links for Google / Outlook.com / Office 365 / Yahoo plus .ics text.
 * Browser-only download helpers live in download.ts.
 */
import type { Recurrence, RecurrenceRule, Task } from './types'
import { buildIcs, icsUtc, type IcsOutEvent } from './ics'
import { DAY, isEndOfDay, startOfDay } from './dates'

export const TASK_EVENT_MIN = 30

/** Default Google reminders on pushed task events: 1 hour, 1 day and 3 days before (minutes). */
export const DEFAULT_EVENT_REMINDERS = [60, 1440, 4320]
/** Offsets offered in Settings → Calendar (minutes before the event). */
export const EVENT_REMINDER_PRESETS = [10, 30, 60, 120, 1440, 2880, 4320, 10080]
/** Google accepts at most 5 reminder overrides per event, each 0…40320 minutes (4 weeks). */
export const MAX_EVENT_REMINDERS = 5
const MAX_REMINDER_MIN = 40320

/** Unique, sorted, in-range minute offsets (at most 5); garbage → []. */
export function normalizeEventReminders(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  const ok = v.filter((m): m is number => typeof m === 'number' && Number.isFinite(m) && m >= 0 && m <= MAX_REMINDER_MIN).map(Math.round)
  return [...new Set(ok)].sort((a, b) => a - b).slice(0, MAX_EVENT_REMINDERS)
}

/** "1 hour" style parts for a reminder offset: the largest unit that divides it evenly. */
export function reminderUnit(min: number): { n: number; unit: 'min' | 'hour' | 'day' | 'week' } {
  if (min >= 10080 && min % 10080 === 0) return { n: min / 10080, unit: 'week' }
  if (min >= 1440 && min % 1440 === 0) return { n: min / 1440, unit: 'day' }
  if (min >= 60 && min % 60 === 0) return { n: min / 60, unit: 'hour' }
  return { n: min, unit: 'min' }
}

/**
 * Google `reminders` for a pushed event. Timed events use the offsets as they are. All-day events count from
 * midnight, so "1 day before" would ring at 00:00: whole-day offsets ring at 09:00 that many days before, shorter
 * ones at 20:00 the evening before. No offsets → the calendar's own defaults.
 */
export function eventReminders(minutes: number[], allDay: boolean): { useDefault: boolean; overrides?: { method: 'popup'; minutes: number }[] } {
  const list = normalizeEventReminders(minutes)
  if (!list.length) return { useDefault: true }
  const mapped = allDay ? list.map((m) => (m >= 1440 ? Math.ceil(m / 1440) * 1440 - 9 * 60 : 4 * 60)) : list
  const unique = [...new Set(mapped.map((m) => Math.min(MAX_REMINDER_MIN, Math.max(0, m))))].sort((a, b) => a - b)
  return { useDefault: false, overrides: unique.map((m) => ({ method: 'popup' as const, minutes: m })) }
}

const RRULE_FREQ: Record<RecurrenceRule['unit'], string> = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * Monthly anchors on the 29th–31st: Hyper Do clamps them to the month end (`nextOccurrence`), while a plain
 * `FREQ=MONTHLY` would skip the shorter months. `BYMONTHDAY=28..d;BYSETPOS=-1` picks the last existing day of
 * 28..d in each month, i.e. min(d, month length).
 */
function monthEndClamp(anchor: number | null | undefined): string | null {
  if (anchor === null || anchor === undefined) return null
  const d = new Date(anchor).getDate()
  if (d < 29) return null
  return `BYMONTHDAY=${Array.from({ length: d - 27 }, (_, i) => 28 + i).join(',')};BYSETPOS=-1`
}

/**
 * RFC 5545 RRULE body (without `RRULE:`) for a task's recurrence, or null when there is nothing to export:
 * `none`, and custom rules with `afterCompletion` (the next date depends on when the task is finished,
 * which no calendar can express). `anchor` (the due date) adds the month-end clamp for monthly rules.
 */
export function recurrenceRrule(rec: Recurrence, rule?: RecurrenceRule | null, anchor?: number | null): string | null {
  switch (rec) {
    case 'daily':
      return 'FREQ=DAILY'
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
    case 'weekly':
      return 'FREQ=WEEKLY'
    case 'monthly': {
      const clamp = monthEndClamp(anchor)
      return clamp ? `FREQ=MONTHLY;${clamp}` : 'FREQ=MONTHLY'
    }
    case 'yearly':
      return 'FREQ=YEARLY'
    case 'custom': {
      if (!rule || rule.afterCompletion) return null
      const parts = [`FREQ=${RRULE_FREQ[rule.unit]}`]
      if (rule.every > 1) parts.push(`INTERVAL=${Math.floor(rule.every)}`)
      if (rule.unit === 'week' && rule.weekdays?.length) parts.push(`BYDAY=${[...new Set(rule.weekdays)].sort((a, b) => a - b).map((d) => RRULE_DAY[d]).join(',')}`)
      const clamp = rule.unit === 'month' ? monthEndClamp(anchor) : null
      if (clamp) parts.push(clamp)
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

/** `localDate` for Google all-day events: `YYYY-MM-DD` in local time. */
function isoLocalDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Google Calendar event body for a mirrored task (push to the "Hyper Do" calendar). Recurring tasks carry
 * `recurrence: ['RRULE:…']` (same mapping as the .ics export; "repeat after completion" stays a single event), and
 * timed recurring events name `timeZone`, which Google requires to expand a series. Null without a due date.
 */
export function googleEventBody(task: Task, timeZone: string, reminderMinutes?: number[]) {
  const w = taskEventWindow(task)
  if (!w) return null
  const rrule = recurrenceRrule(task.recurrence, task.recurrenceRule, task.dueAt)
  const at = (ts: number) => (w.allDay ? { date: isoLocalDate(ts) } : { dateTime: new Date(ts).toISOString(), ...(rrule ? { timeZone } : {}) })
  return {
    summary: task.title,
    description: taskDescription(task),
    start: at(w.start),
    end: at(w.end),
    ...(rrule ? { recurrence: [`RRULE:${rrule}`] } : {}),
    colorId: task.priority === 'high' ? '11' : task.priority === 'medium' ? '6' : '7',
    extendedProperties: { private: { hyperdoId: task.id } },
    reminders: reminderMinutes ? eventReminders(reminderMinutes, w.allDay) : { useDefault: true },
  }
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
      const rrule = recurrenceRrule(task.recurrence, task.recurrenceRule, task.dueAt)
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
  const rrule = recurrenceRrule(task.recurrence, task.recurrenceRule, task.dueAt)
  return { uid: `hyperdo-${task.id}@hyperdo.app`, title: task.title, start: w.start, end: w.end, allDay: w.allDay, description: taskDescription(task), ...(rrule ? { rrule } : {}) }
}

export function tasksToIcs(tasks: Task[]): string {
  return buildIcs(tasks.map(taskToIcsEvent).filter((x): x is IcsOutEvent => x !== null))
}
