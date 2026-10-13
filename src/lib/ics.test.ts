import { describe, it, expect } from 'vitest'
import { buildIcs, icsUtc, parseIcs, zonedToUtc } from './ics'

const CRLF = '\r\n'
const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H
const local = (day: number, h = 0, m = 0, month = 9, year = 2026) => new Date(year, month, day, h, m).getTime()
const cal = (...body: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...body, 'END:VCALENDAR'].join(CRLF) + CRLF
const vevent = (...props: string[]) => ['BEGIN:VEVENT', ...props, 'END:VEVENT']

// Window: October 2026 (local time)
const FROM = local(1)
const TO = local(1, 0, 0, 10)

/**
 * Mixed feed: a TZID event with a folded SUMMARY and a nested VALARM, an all-day event,
 * a weekly BYDAY series with COUNT + EXDATE + a RECURRENCE-ID override, and a cancelled event.
 * Recurring events use floating (local) times so the expected values can be built with local constructors.
 */
const FEED = cal(
  ...vevent(
    'UID:a@test',
    'DTSTART;TZID=Europe/Istanbul:20261013T180000',
    'DTEND;TZID=Europe/Istanbul:20261013T190000',
    'SUMMARY:Team sync with a very long title that keeps go',
    ' ing on and on',
    'LOCATION:Room 1\\, Floor 2',
    'DESCRIPTION:Agenda:\\nitem one\\; item two',
    'URL:https://example.com/meet',
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
  ),
  ...vevent('UID:b@test', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261021', 'SUMMARY:Holiday'),
  ...vevent('UID:c@test', 'DTSTART:20261005T090000', 'DTEND:20261005T093000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6', 'EXDATE:20261012T090000', 'SUMMARY:Standup'),
  ...vevent('UID:c@test', 'RECURRENCE-ID:20261014T090000', 'DTSTART:20261015T100000', 'DTEND:20261015T103000', 'SUMMARY:Standup (moved)'),
  ...vevent('UID:x@test', 'DTSTART:20261010T100000', 'DTEND:20261010T110000', 'SUMMARY:Cancelled', 'STATUS:CANCELLED'),
)

describe('parseIcs: single events', () => {
  const events = parseIcs(FEED, FROM, TO)
  const a = events.filter((e) => e.uid === 'a@test')
  const b = events.filter((e) => e.uid === 'b@test')

  it('TZID wall time is converted to UTC (Istanbul = UTC+3) and folded lines are joined', () => {
    expect(a).toHaveLength(1)
    expect(a[0].start).toBe(Date.UTC(2026, 9, 13, 15, 0))
    expect(a[0].end).toBe(Date.UTC(2026, 9, 13, 16, 0))
    expect(a[0].title).toBe('Team sync with a very long title that keeps going on and on')
    expect(a[0].allDay).toBe(false)
    expect(a[0].recurring).toBe(false)
  })

  it('unescapes text and ignores properties of the nested VALARM', () => {
    expect(a[0].location).toBe('Room 1, Floor 2')
    expect(a[0].description).toBe('Agenda:\nitem one; item two')
    expect(a[0].url).toBe('https://example.com/meet')
  })

  it('VALUE=DATE events are all-day at local midnight', () => {
    expect(b).toHaveLength(1)
    expect(b[0].allDay).toBe(true)
    expect(b[0].start).toBe(local(20))
    expect(b[0].end).toBe(local(21))
  })

  it('cancelled events are dropped', () => {
    expect(events.some((e) => e.uid === 'x@test')).toBe(false)
  })

  it('results are sorted by start', () => {
    expect(events.map((e) => e.uid)).toEqual(['c@test', 'c@test', 'a@test', 'c@test', 'c@test', 'b@test', 'c@test'])
  })
})

describe('parseIcs: weekly BYDAY series with EXDATE and RECURRENCE-ID override', () => {
  const c = parseIcs(FEED, FROM, TO).filter((e) => e.uid === 'c@test')

  it('expands MO/WE occurrences up to COUNT, removes the EXDATE and the overridden instance, adds the override', () => {
    expect(c.map((e) => [e.start, e.title])).toEqual([
      [local(5, 9, 0), 'Standup'],
      [local(7, 9, 0), 'Standup'],
      [local(15, 10, 0), 'Standup (moved)'], // override of 14 Oct 09:00
      [local(19, 9, 0), 'Standup'],
      [local(21, 9, 0), 'Standup'],
    ])
  })

  it('every instance keeps the 30-minute duration and is flagged recurring', () => {
    for (const e of c) {
      expect(e.end - e.start).toBe(30 * MIN)
      expect(e.recurring).toBe(true)
      expect(e.allDay).toBe(false)
    }
  })

  it('a narrower window only returns the overlapping instances', () => {
    const week = parseIcs(FEED, local(18), local(25)).filter((e) => e.uid === 'c@test')
    expect(week.map((e) => e.start)).toEqual([local(19, 9, 0), local(21, 9, 0)])
  })
})

describe('parseIcs: other recurrence rules', () => {
  it('DAILY with INTERVAL and UNTIL (inclusive)', () => {
    const text = cal(...vevent('UID:d', 'DTSTART:20261001T080000', 'DTEND:20261001T090000', 'RRULE:FREQ=DAILY;INTERVAL=2;UNTIL=20261007T080000', 'SUMMARY:Gym'))
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(1, 8), local(3, 8), local(5, 8), local(7, 8)])
  })

  it('UNTIL given as a date covers the whole day', () => {
    const text = cal(...vevent('UID:d', 'DTSTART:20261001T080000', 'DTEND:20261001T090000', 'RRULE:FREQ=DAILY;UNTIL=20261003', 'SUMMARY:Gym'))
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(1, 8), local(2, 8), local(3, 8)])
  })

  it('DAILY with COUNT', () => {
    const text = cal(...vevent('UID:d', 'DTSTART:20261001T080000', 'DTEND:20261001T090000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Gym'))
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(1, 8), local(2, 8), local(3, 8)])
  })

  it('WEEKLY without BYDAY repeats on the start weekday', () => {
    const text = cal(...vevent('UID:w', 'DTSTART:20261006T140000', 'DTEND:20261006T150000', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Review'))
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(6, 14), local(20, 14)])
  })

  it('MONTHLY on the 31st skips months without a 31st and COUNT only counts real occurrences', () => {
    const text = cal(...vevent('UID:m', 'DTSTART:20260831T120000', 'DTEND:20260831T130000', 'RRULE:FREQ=MONTHLY;COUNT=4', 'SUMMARY:Rent'))
    const wide = parseIcs(text, local(1, 0, 0, 7), local(1, 0, 0, 1, 2027))
    expect(wide.map((e) => e.start)).toEqual([local(31, 12, 0, 7), local(31, 12, 0, 9), local(31, 12, 0, 11), local(31, 12, 0, 0, 2027)])
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(31, 12, 0, 9)])
  })

  it('YEARLY with COUNT', () => {
    const text = cal(...vevent('UID:y', 'DTSTART:20250315T100000', 'DTEND:20250315T110000', 'RRULE:FREQ=YEARLY;COUNT=3', 'SUMMARY:Anniversary'))
    const got = parseIcs(text, local(1, 0, 0, 0, 2026), local(1, 0, 0, 0, 2028))
    expect(got.map((e) => e.start)).toEqual([local(15, 10, 0, 2, 2026), local(15, 10, 0, 2, 2027)])
  })

  it('an unparseable RRULE falls back to the single start', () => {
    const text = cal(...vevent('UID:r', 'DTSTART:20261006T140000', 'DTEND:20261006T150000', 'RRULE:FREQ=HOURLY', 'SUMMARY:Odd'))
    expect(parseIcs(text, FROM, TO).map((e) => e.start)).toEqual([local(6, 14)])
  })
})

describe('parseIcs: dates, durations and windows', () => {
  it('UTC (Z) timestamps', () => {
    const text = cal(...vevent('UID:z', 'DTSTART:20261013T150000Z', 'DTEND:20261013T160000Z', 'SUMMARY:Z'))
    const [e] = parseIcs(text, FROM, TO)
    expect(e.start).toBe(Date.UTC(2026, 9, 13, 15, 0))
    expect(e.end).toBe(Date.UTC(2026, 9, 13, 16, 0))
  })

  it('Windows time-zone names (quoted TZID) are mapped to IANA zones; Berlin is UTC+2 in October', () => {
    const text = cal(...vevent('UID:w', 'DTSTART;TZID="W. Europe Standard Time":20261013T180000', 'DTEND;TZID="W. Europe Standard Time":20261013T190000', 'SUMMARY:W'))
    expect(parseIcs(text, FROM, TO)[0].start).toBe(Date.UTC(2026, 9, 13, 16, 0))
  })

  it('DURATION is used when DTEND is missing; all-day without DTEND lasts one day', () => {
    const text = cal(...vevent('UID:d', 'DTSTART:20261013T180000', 'DURATION:PT45M', 'SUMMARY:D'), ...vevent('UID:e', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:E'))
    const [d, e] = parseIcs(text, FROM, TO)
    expect(d.end).toBe(local(13, 18, 45))
    expect(e.start).toBe(local(20))
    expect(e.end).toBe(local(20) + DAY)
  })

  it('window overlap: an event counts while it is still running, not once the window ends at its start', () => {
    const text = cal(...vevent('UID:o', 'DTSTART:20261013T180000', 'DTEND:20261013T190000', 'SUMMARY:O'))
    expect(parseIcs(text, local(13, 18, 30), local(14))).toHaveLength(1)
    expect(parseIcs(text, local(13, 19, 0), local(14))).toHaveLength(0)
    expect(parseIcs(text, local(13), local(13, 18, 0))).toHaveLength(0)
  })

  it('events without DTSTART and lines outside VEVENT are ignored', () => {
    const text = cal('X-WR-CALNAME:Junk', ...vevent('UID:n', 'SUMMARY:No start'))
    expect(parseIcs(text, FROM, TO)).toEqual([])
  })
})

describe('zonedToUtc / icsUtc', () => {
  it('converts wall time in a zone to UTC, honouring DST', () => {
    expect(zonedToUtc(2026, 9, 13, 18, 0, 0, 'Europe/Istanbul')).toBe(Date.UTC(2026, 9, 13, 15, 0))
    expect(zonedToUtc(2026, 6, 1, 12, 0, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 6, 1, 10, 0)) // CEST
    expect(zonedToUtc(2026, 0, 1, 12, 0, 0, 'Europe/Berlin')).toBe(Date.UTC(2026, 0, 1, 11, 0)) // CET
    expect(zonedToUtc(2026, 0, 1, 12, 0, 0, 'UTC')).toBe(Date.UTC(2026, 0, 1, 12, 0))
  })

  it('returns null for unknown zones', () => {
    expect(zonedToUtc(2026, 0, 1, 12, 0, 0, 'Mars/Olympus')).toBeNull()
  })

  it('icsUtc formats basic ISO in UTC', () => {
    expect(icsUtc(Date.UTC(2026, 9, 13, 15, 4, 9))).toBe('20261013T150409Z')
  })
})

describe('buildIcs → parseIcs round-trip', () => {
  const start = local(14, 18, 0)
  const events = [
    { uid: 't1', title: 'Pay bill, now; really', start, end: start + 30 * MIN, description: 'line1\nline2', location: 'Bank; downtown' },
    { uid: 't2', title: 'All day', start: local(20), end: local(21), allDay: true },
  ]
  const text = buildIcs(events, 'My Cal')

  it('writes a VCALENDAR with CRLF line endings and the calendar name', () => {
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('X-WR-CALNAME:My Cal\r\n')
    expect(text).toContain('SUMMARY:Pay bill\\, now\\; really\r\n')
    expect(text).toContain('DESCRIPTION:line1\\nline2\r\n')
    expect(text).toContain('DTSTART;VALUE=DATE:20261020\r\n')
    expect(text).toContain(`DTSTART:${icsUtc(start)}\r\n`)
    expect(text.includes('\n') && !text.includes('\n\r') && text.split('\r\n').length === text.split('\n').length).toBe(true)
  })

  it('parses back to the same events', () => {
    const back = parseIcs(text, FROM, TO)
    expect(back).toHaveLength(2)
    expect(back[0]).toMatchObject({ uid: 't1', title: 'Pay bill, now; really', start, end: start + 30 * MIN, allDay: false, description: 'line1\nline2', location: 'Bank; downtown', recurring: false })
    expect(back[1]).toMatchObject({ uid: 't2', title: 'All day', start: local(20), end: local(21), allDay: true })
  })

  it('writes an RRULE line for recurring events, which parses back into instances', () => {
    const out = buildIcs([{ uid: 'r1', title: 'Standup', start: local(5, 9, 0), end: local(5, 9, 30), rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' }])
    expect(out).toContain(`DTEND:${icsUtc(local(5, 9, 30))}\r\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE\r\nSUMMARY:Standup\r\n`)
    expect(text).not.toContain('RRULE') // events without a rule get none
    const back = parseIcs(out, FROM, TO)
    expect(back.map((e) => e.start)).toEqual([local(5, 9, 0), local(7, 9, 0), local(19, 9, 0), local(21, 9, 0)])
    expect(back.every((e) => e.recurring)).toBe(true)
  })

  it('folds long lines at 70 characters and they unfold to the original text', () => {
    const title = 'x'.repeat(150) + ' end'
    const out = buildIcs([{ uid: 'long', title, start, end: start + H }])
    for (const line of out.split('\r\n')) expect(line.length).toBeLessThanOrEqual(71)
    expect(out).toContain('\r\n ') // at least one continuation line
    expect(parseIcs(out, FROM, TO)[0].title).toBe(title)
  })
})
