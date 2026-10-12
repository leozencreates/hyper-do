import { useMemo, useState } from 'react'
import type { CalendarEvent } from '../lib/types'
import { DAY, startOfDay } from '../lib/dates'
import { LOCALE } from '../lib/i18n'
import { useLang, useT } from '../lib/useT'

interface Props {
  events: CalendarEvent[]
  view: 'today' | 'week'
  onMakeTask(e: CalendarEvent): void
}

/** Read-only calendar events above the task list (Today: today's events, Week: next 7 days grouped by day). */
export default function CalendarStrip({ events, view, onMakeTask }: Props) {
  const t = useT()
  const lang = useLang()
  const [collapsed, setCollapsed] = useState(false)
  const now = Date.now()
  const dayStart = startOfDay(now)
  const horizon = view === 'today' ? dayStart + DAY : dayStart + 7 * DAY

  const days = useMemo(() => {
    const list = events.filter((e) => e.end > dayStart && e.start < horizon)
    const groups = new Map<number, CalendarEvent[]>()
    for (const e of list) {
      // multi-day events are listed on every day they cover
      let d = Math.max(startOfDay(e.start), dayStart)
      const last = Math.min(startOfDay(Math.max(e.start, e.end - 1)), horizon - 1)
      while (d <= last) {
        if (!groups.has(d)) groups.set(d, [])
        groups.get(d)!.push(e)
        d += DAY
      }
    }
    return [...groups.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, evs]) => [day, evs.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start)] as const)
  }, [events, dayStart, horizon])

  const total = days.reduce((n, [, evs]) => n + evs.length, 0)
  if (total === 0) return null

  const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' })
  const dayLabel = (day: number) => {
    const diff = Math.round((day - dayStart) / DAY)
    if (diff === 0) return t('day_today')
    if (diff === 1) return t('day_tomorrow')
    return new Date(day).toLocaleDateString(LOCALE[lang], { weekday: 'long', day: 'numeric', month: 'short' })
  }

  return (
    <section className={collapsed ? 'cal-strip collapsed' : 'cal-strip'}>
      <button className="cal-head" onClick={() => setCollapsed((c) => !c)}>
        <span className="cal-head-title">📅 {view === 'today' ? t('cal_today_title') : t('cal_title')}</span>
        <span className="badge">{total}</span>
        <span className="cal-caret">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed &&
        days.map(([day, evs]) => (
          <div key={day} className="cal-day">
            {view === 'week' && <div className="cal-day-label">{dayLabel(day)}</div>}
            {evs.map((e) => {
              const past = e.end <= now
              const ongoing = e.start <= now && e.end > now
              return (
                <div key={e.id + day} className={['cal-event', past && 'past', ongoing && 'now'].filter(Boolean).join(' ')} style={{ ['--c' as string]: e.color }}>
                  <span className="cal-dot" title={e.calendarName} />
                  <span className="cal-time">{e.allDay ? t('cal_all_day') : ongoing ? `${fmtTime(e.start)} · ${t('cal_now')}` : `${fmtTime(e.start)}–${fmtTime(e.end)}`}</span>
                  <span className="cal-title">
                    {e.url ? (
                      <a href={e.url} target="_blank" rel="noopener noreferrer">
                        {e.title}
                      </a>
                    ) : (
                      e.title
                    )}
                    {e.location && <span className="cal-loc"> · 📍 {e.location}</span>}
                  </span>
                  <span className="cal-cal">{e.calendarName}</span>
                  <button className="mini" title={t('cal_make_task')} onClick={() => onMakeTask(e)}>
                    {t('cal_make_task')}
                  </button>
                </div>
              )
            })}
          </div>
        ))}
    </section>
  )
}
