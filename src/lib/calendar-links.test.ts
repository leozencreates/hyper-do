import { describe, it, expect } from 'vitest'
import { calendarLink, recurrenceRrule, taskToIcsEvent, tasksToIcs } from './calendar-links'
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
