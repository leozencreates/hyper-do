import type { Recurrence } from './types'
import { LOCALE, translate, type Lang } from './i18n'

export const DAY = 86_400_000

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function isToday(ts: number, now = Date.now()): boolean {
  return startOfDay(ts) === startOfDay(now)
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

/** Tekrarlayan görev için bir sonraki son tarihi hesaplar (asla geçmişte kalmaz). */
export function nextOccurrence(dueAt: number, rec: Recurrence, now = Date.now()): number {
  const d = new Date(dueAt)
  const step = () => {
    switch (rec) {
      case 'daily':
        d.setDate(d.getDate() + 1)
        break
      case 'weekdays':
        do d.setDate(d.getDate() + 1)
        while (d.getDay() === 0 || d.getDay() === 6)
        break
      case 'weekly':
        d.setDate(d.getDate() + 7)
        break
      case 'monthly':
        d.setMonth(d.getMonth() + 1)
        break
    }
  }
  step()
  while (d.getTime() <= now) step()
  return d.getTime()
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
