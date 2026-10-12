import { useEffect, useState } from 'react'
import { platform } from './platform'
import type { CalendarApi, CalendarEvent, CalendarStatus } from './types'

export interface CalendarState {
  /** false when the platform has no calendar bridge → hide all calendar UI */
  available: boolean
  api: CalendarApi | undefined
  events: CalendarEvent[]
  status: CalendarStatus | null
}

/** Subscribes to the platform's calendar bridge (events + connection status). */
export function useCalendar(): CalendarState {
  const api = platform.calendar
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [status, setStatus] = useState<CalendarStatus | null>(null)

  useEffect(() => {
    if (!api) return
    let alive = true
    void api.events().then((e) => alive && setEvents(e))
    void api.status().then((s) => alive && setStatus(s))
    const offE = api.onEvents(setEvents)
    const offS = api.onStatus(setStatus)
    return () => {
      alive = false
      offE()
      offS()
    }
  }, [api])

  return { available: !!api, api, events, status }
}
