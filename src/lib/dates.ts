import { DEFAULT_RECURRENCE_RULE, type Recurrence, type RecurrenceRule, type RecurrenceUnit } from './types'
import { LOCALE, translate, type Lang } from './i18n'

export const DAY = 86_400_000

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 23:59 of the day containing `ts`: the due time of "whole day" tasks
 * (quick add "today", imported all-day events). See also `isEndOfDay`.
 */
export function endOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(23, 59, 0, 0)
  return d.getTime()
}

/** True for a due time produced by `endOfDay`; such tasks are mirrored to calendars as all-day events. */
export function isEndOfDay(ts: number): boolean {
  const d = new Date(ts)
  return d.getHours() === 23 && d.getMinutes() === 59
}

export function isToday(ts: number, now = Date.now()): boolean {
  return startOfDay(ts) === startOfDay(now)
}

/** Local calendar day as `YYYY-MM-DD`: the key of `AppData.dailyDone`. */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Inverse of `dayKey`: local midnight of that day (NaN-free: a malformed key yields today). */
export function dayKeyToDate(key: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return new Date(startOfDay(Date.now()))
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** Local midnight `n` days after `ts` (DST-safe: steps by calendar days, not by 24 h). */
export function addDays(ts: number, n: number): number {
  const d = new Date(startOfDay(ts))
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Compact duration for chips: 30m · 1h · 1h 10m (localised units). */
export function formatMinutes(min: number, lang: Lang): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return translate(lang, 'dur_m', { n: m })
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? translate(lang, 'dur_h', { n: h }) : translate(lang, 'dur_hm', { h, m: r })
}

export function isOverdue(ts: number | null, now = Date.now()): boolean {
  return ts !== null && ts < now
}

export function isThisWeek(ts: number, now = Date.now()): boolean {
  const start = startOfDay(now)
  return ts >= start && ts < start + 7 * DAY
}

export function formatDue(ts: number | null, lang: Lang, now = Date.now()): string {
  if (ts === null) return ''
  const d = new Date(ts)
  const loc = LOCALE[lang]
  const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
  const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / DAY)
  if (dayDiff === 0) return translate(lang, 'd_today', { t: time })
  if (dayDiff === 1) return translate(lang, 'd_tomorrow', { t: time })
  if (dayDiff === -1) return translate(lang, 'd_yesterday', { t: time })
  if (dayDiff < 0) return translate(lang, 'd_days_late', { n: -dayDiff })
  if (dayDiff < 7) return d.toLocaleDateString(loc, { weekday: 'long' }) + ` ${time}`
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) + ` ${time}`
}

export function relativeMinutes(ms: number, lang: Lang): string {
  const m = Math.round(ms / 60_000)
  if (m < 1) return translate(lang, 'rel_now')
  if (m < 60) return translate(lang, 'rel_min', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return translate(lang, 'rel_hour', { n: h })
  return translate(lang, 'rel_day', { n: Math.floor(h / 24) })
}

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate()

/** Local midnight of the Monday starting the week that contains `d` (weeks run Monday → Sunday, as in ISO 8601 and RRULE WKST=MO). */
function mondayOf(d: Date): Date {
  const m = new Date(d)
  m.setHours(0, 0, 0, 0)
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7))
  return m
}

/** The built-in recurrences expressed as rules; `custom` uses the stored rule (or the default when it is missing). */
export function effectiveRule(rec: Recurrence, rule?: RecurrenceRule | null): RecurrenceRule | null {
  switch (rec) {
    case 'daily':
      return { every: 1, unit: 'day' }
    case 'weekdays':
      return { every: 1, unit: 'week', weekdays: [1, 2, 3, 4, 5] }
    case 'weekly':
      return { every: 1, unit: 'week' }
    case 'monthly':
      return { every: 1, unit: 'month' }
    case 'yearly':
      return { every: 1, unit: 'year' }
    case 'custom':
      return rule ?? DEFAULT_RECURRENCE_RULE
    default:
      return null
  }
}

/**
 * Next due time of a recurring task: the first slot of the series strictly after `now`.
 *
 * - The series is anchored at `dueAt`: a monthly task keeps its day-of-month (31 Jan → 28 Feb → 31 Mar, clamped to
 *   the month's last day, never drifting), a yearly one its month and day (29 Feb → 28 Feb in common years).
 * - `unit: 'week'` with `weekdays` (also `weekdays` recurrence = Mon–Fri) picks the next listed weekday; `every` is
 *   counted in Monday-first weeks from the anchor's week (every 2 weeks Mon/Wed: after Wed → Mon two weeks later).
 * - `afterCompletion`: the base is `now` (the completion time) at the task's original time of day, so the next
 *   due date is "completion + interval"; the week/day-of-month anchor is the completion day as well.
 * - `rec === 'none'` returns `dueAt` unchanged.
 */
export function nextOccurrence(dueAt: number, rec: Recurrence, now = Date.now(), rule?: RecurrenceRule | null): number {
  const r = effectiveRule(rec, rule)
  if (!r) return dueAt
  const every = Math.max(1, Math.floor(r.every) || 1)
  const due = new Date(dueAt)
  const anchor = new Date(dueAt)
  if (r.afterCompletion) {
    anchor.setTime(now)
    anchor.setHours(due.getHours(), due.getMinutes(), 0, 0)
  }
  const anchorDay = anchor.getDate()
  const anchorMonth = anchor.getMonth()
  const anchorWeek = mondayOf(anchor).getTime()
  const weekdays = r.unit === 'week' && r.weekdays?.length ? [...new Set(r.weekdays.filter((x) => x >= 0 && x <= 6))].sort((a, b) => a - b) : null
  const d = new Date(anchor)

  const step = () => {
    switch (r.unit) {
      case 'day':
        d.setDate(d.getDate() + every)
        break
      case 'week': {
        if (!weekdays) {
          d.setDate(d.getDate() + 7 * every)
          break
        }
        const week = mondayOf(d)
        const h = d.getHours()
        const mi = d.getMinutes()
        // later listed weekday in the current week?
        for (const wd of weekdays) {
          const c = new Date(week)
          c.setDate(week.getDate() + ((wd + 6) % 7))
          c.setHours(h, mi, 0, 0)
          if (c.getTime() > d.getTime()) {
            d.setTime(c.getTime())
            return
          }
        }
        // otherwise the first listed weekday of the next "on" week
        const weeksSince = Math.round((week.getTime() - anchorWeek) / (7 * DAY))
        const next = new Date(week)
        next.setDate(week.getDate() + 7 * (every - (((weeksSince % every) + every) % every)) + ((weekdays[0] + 6) % 7))
        next.setHours(h, mi, 0, 0)
        d.setTime(next.getTime())
        break
      }
      case 'month': {
        const h = d.getHours()
        const mi = d.getMinutes()
        d.setDate(1)
        d.setMonth(d.getMonth() + every)
        d.setDate(Math.min(anchorDay, daysInMonth(d.getFullYear(), d.getMonth())))
        d.setHours(h, mi, 0, 0)
        break
      }
      case 'year': {
        const h = d.getHours()
        const mi = d.getMinutes()
        const y = d.getFullYear() + every
        d.setFullYear(y, anchorMonth, 1)
        d.setDate(Math.min(anchorDay, daysInMonth(y, anchorMonth)))
        d.setHours(h, mi, 0, 0)
        break
      }
    }
  }
  step()
  while (d.getTime() <= now) step()
  return d.getTime()
}

/** Short weekday name in the UI language via Intl (`Mon`, `Pzt`, `пн`); 0 = Sunday … 6 = Saturday. */
export function weekdayShort(lang: Lang, weekday: number): string {
  // 11 October 2026 is a Sunday
  return new Intl.DateTimeFormat(LOCALE[lang], { weekday: 'short' }).format(new Date(2026, 9, 11 + (((weekday % 7) + 7) % 7)))
}

/** `day` / `days` (EN, TR) or день / дня / дней (RU) for a count; the dictionary holds the forms separated by `|`. */
export function recurrenceUnitName(lang: Lang, unit: RecurrenceUnit, n: number): string {
  const forms = translate(lang, `rec_unit_${unit}` as const).split('|')
  if (forms.length === 1) return forms[0]
  if (lang === 'ru' && forms.length >= 3) {
    const a = Math.abs(n) % 100
    const b = a % 10
    if (a > 10 && a < 20) return forms[2]
    if (b === 1) return forms[0]
    if (b >= 2 && b <= 4) return forms[1]
    return forms[2]
  }
  return n === 1 ? forms[0] : forms[1]
}

/**
 * Chip label of a recurrence: `↻` for the built-in daily / weekdays / weekly / monthly, `↻ yearly`,
 * and for custom rules `↻ 3d`, `↻ 2w Mon·Wed`, `↻ Mon·Wed·Fri` (the count is dropped for "every 1 week" with weekdays).
 * Empty string for `'none'`.
 */
export function recurrenceLabel(rec: Recurrence, rule: RecurrenceRule | null | undefined, lang: Lang): string {
  if (rec === 'none') return ''
  if (rec === 'yearly') return `↻ ${translate(lang, 'rec_yearly_short')}`
  if (rec !== 'custom') return '↻'
  const r = rule ?? DEFAULT_RECURRENCE_RULE
  const days = r.unit === 'week' && r.weekdays?.length ? [...r.weekdays].sort((a, b) => a - b).map((wd) => weekdayShort(lang, wd)).join('·') : ''
  const count = r.every === 1 && days ? '' : `${r.every}${translate(lang, `rec_abbr_${r.unit}` as const)}`
  return `↻ ${[count, days].filter(Boolean).join(' ')}`
}

/** Long description for tooltips and the quick-add preview: "Daily", "Every 2 weeks · Mon, Wed · Repeat after completion". */
export function recurrenceText(rec: Recurrence, rule: RecurrenceRule | null | undefined, lang: Lang): string {
  if (rec === 'none') return ''
  if (rec !== 'custom') return translate(lang, `r_${rec}` as const)
  const r = rule ?? DEFAULT_RECURRENCE_RULE
  const parts = [`${translate(lang, 'rec_every')} ${r.every} ${recurrenceUnitName(lang, r.unit, r.every)}`]
  if (r.unit === 'week' && r.weekdays?.length) parts.push([...r.weekdays].sort((a, b) => a - b).map((wd) => weekdayShort(lang, wd)).join(', '))
  if (r.afterCompletion) parts.push(translate(lang, 'rec_after_completion'))
  return parts.join(' · ')
}

/** <input type="datetime-local"> için yerel saatli değer */
export function toLocalInput(ts: number | null): string {
  if (ts === null) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(v: string): number | null {
  if (!v) return null
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? null : t
}
