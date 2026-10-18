import { describe, it, expect } from 'vitest'
import { calendarLink, googleEventBody, recurrenceRrule, taskToIcsEvent, tasksToIcs } from './calendar-links'
import { normalizeTask } from './tasks'
import type { Task } from './types'

const local = (day: number, h = 0, m = 0, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime()
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: 1, order: 1, dueAt: local(14, 18, 0), ...o })

describe('recurrenceRrule', () => {
  it('built-in recurrences', () => {
    expect(recurrenceRrule('none')).toBeNull()
    expect(recurrenceRrule('daily')).toBe('FREQ=DAILY')
    expect(recurrenceRrule('weekdays')).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')
    expect(recurrenceRrule('weekly')).toBe('FREQ=WEEKLY')
    expect(recurrenceRrule('monthly')).toBe('FREQ=MONTHLY')
    expect(recurrenceRrule('yearly')).toBe('FREQ=YEARLY')
  })

  it('custom rules: FREQ + INTERVAL + BYDAY; INTERVAL omitted for 1', () => {
    expect(recurrenceRrule('custom', { every: 3, unit: 'day' })).toBe('FREQ=DAILY;INTERVAL=3')
    expect(recurrenceRrule('custom', { every: 1, unit: 'month' })).toBe('FREQ=MONTHLY')
    expect(recurrenceRrule('custom', { every: 2, unit: 'year' })).toBe('FREQ=YEARLY;INTERVAL=2')
    expect(recurrenceRrule('custom', { every: 2, unit: 'week', weekdays: [3, 1, 0] })).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,WE')
    expect(recurrenceRrule('custom', { every: 1, unit: 'week', weekdays: [1, 3, 5] })).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR')
  })

  it('afterCompletion rules and a missing custom rule are not representable → null', () => {
    expect(recurrenceRrule('custom', { every: 3, unit: 'day', afterCompletion: true })).toBeNull()
    expect(recurrenceRrule('custom')).toBeNull()
  })
})

describe('task → ICS with recurrence', () => {
  it('taskToIcsEvent carries the rule; tasksToIcs writes RRULE lines only for recurring tasks', () => {
    const plain = task({ id: 'p' })
    const daily = task({ id: 'd', recurrence: 'daily' })
    const custom = task({ id: 'c', recurrence: 'custom', recurrenceRule: { every: 2, unit: 'week', weekdays: [1, 3] } })
    const after = task({ id: 'a', recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day', afterCompletion: true } })
    expect('rrule' in taskToIcsEvent(plain)!).toBe(false)
    expect(taskToIcsEvent(daily)!.rrule).toBe('FREQ=DAILY')
    expect(taskToIcsEvent(after)!.rrule).toBeUndefined()

    const text = tasksToIcs([plain, daily, custom, after])
    const lines = text.split('\r\n')
    expect(lines.filter((l) => l.startsWith('RRULE:'))).toEqual(['RRULE:FREQ=DAILY', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'])
    expect(lines.indexOf('RRULE:FREQ=DAILY')).toBe(lines.indexOf('UID:hyperdo-d@hyperdo.app') + 4) // UID, DTSTAMP, DTSTART, DTEND, RRULE
  })

  it('the Google "add to calendar" link carries the rule as recur=RRULE:…', () => {
    expect(calendarLink('google', task({ id: 'w', recurrence: 'weekly' }))).toContain('recur=RRULE%3AFREQ%3DWEEKLY')
    expect(calendarLink('google', task({ id: 'p' }))).not.toContain('recur=')
  })
})

describe('month-end clamp for monthly rules (anchor on the 29th-31st)', () => {
  it('BYMONTHDAY=28..d;BYSETPOS=-1 only when the anchor day is 29 or later', () => {
    expect(recurrenceRrule('monthly', null, local(31, 9, 0, 0))).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
    expect(recurrenceRrule('monthly', null, local(30, 9, 0, 3))).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1')
    expect(recurrenceRrule('monthly', null, local(29, 9, 0, 3))).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1')
    expect(recurrenceRrule('monthly', null, local(28, 9, 0, 3))).toBe('FREQ=MONTHLY')
    expect(recurrenceRrule('monthly', null, null)).toBe('FREQ=MONTHLY')
    expect(recurrenceRrule('custom', { every: 2, unit: 'month' }, local(31, 9, 0, 0))).toBe('FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
    // other units ignore the anchor
    expect(recurrenceRrule('weekly', null, local(31, 9, 0, 0))).toBe('FREQ=WEEKLY')
    expect(recurrenceRrule('custom', { every: 1, unit: 'day' }, local(31, 9, 0, 0))).toBe('FREQ=DAILY')
  })

  it('the .ics export uses the task due date as the anchor', () => {
    expect(taskToIcsEvent(task({ id: 'm', recurrence: 'monthly', dueAt: local(31, 9, 0, 0) }))!.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1')
  })
})

describe('googleEventBody (push to the Hyper Do calendar)', () => {
  const TZ = 'Europe/Istanbul'
  it('single timed task: dateTime without timeZone, no recurrence, hyperdoId and priority colour', () => {
    const b = googleEventBody(task({ id: 'p', priority: 'high' }), TZ)!
    expect(b.start).toEqual({ dateTime: new Date(local(14, 18, 0)).toISOString() })
    expect(b.end).toEqual({ dateTime: new Date(local(14, 18, 30)).toISOString() })
    expect('recurrence' in b).toBe(false)
    expect(b.colorId).toBe('11')
    expect(b.extendedProperties).toEqual({ private: { hyperdoId: 'p' } })
    expect(b.description.endsWith('— Hyper Do')).toBe(true)
  })

  it('recurring timed task: RRULE line and timeZone on start and end (Google needs it to expand the series)', () => {
    const b = googleEventBody(task({ id: 'w', recurrence: 'custom', recurrenceRule: { every: 2, unit: 'week', weekdays: [1, 3] } }), TZ)!
    expect(b.recurrence).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE'])
    expect(b.start).toEqual({ dateTime: new Date(local(14, 18, 0)).toISOString(), timeZone: TZ })
    expect(b.end).toMatchObject({ timeZone: TZ })
  })

  it('recurring all-day task (due 23:59) uses dates; "repeat after completion" stays a single event; no due date → null', () => {
    const b = googleEventBody(task({ id: 'd', recurrence: 'daily', dueAt: local(14, 23, 59) }), TZ)!
    expect(b.start).toEqual({ date: '2026-10-14' })
    expect(b.end).toEqual({ date: '2026-10-15' })
    expect(b.recurrence).toEqual(['RRULE:FREQ=DAILY'])
    const after = googleEventBody(task({ id: 'a', recurrence: 'custom', recurrenceRule: { every: 3, unit: 'day', afterCompletion: true } }), TZ)!
    expect('recurrence' in after).toBe(false)
    expect(after.start).not.toHaveProperty('timeZone')
    expect(googleEventBody(task({ id: 'n', dueAt: null }), TZ)).toBeNull()
  })
})

