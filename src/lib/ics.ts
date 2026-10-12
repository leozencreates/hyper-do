/**
 * Minimal iCalendar (RFC 5545) support, no dependencies.
 *
 *  - parseIcs(): reads VEVENTs from an ICS/webcal feed (Outlook, iCloud, Nextcloud, Google secret address…)
 *    with basic recurrence (RRULE FREQ/INTERVAL/COUNT/UNTIL/BYDAY, EXDATE, RECURRENCE-ID overrides)
 *    and TZID → UTC conversion through Intl.
 *  - buildIcs(): writes an ICS file (export tasks / "add to calendar").
 */

export interface IcsEvent {
  uid: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  url?: string
  description?: string
  /** instance of a recurring event (UID is shared with its siblings) */
  recurring: boolean
}

interface Prop {
  name: string
  params: Record<string, string>
  value: string
}

interface VEvent {
  uid: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  url?: string
  description?: string
  rrule?: string
  exdates: Set<number>
  recurrenceId?: number
  cancelled: boolean
}

const DAY = 86_400_000

// Outlook / Exchange feeds often use Windows time-zone names instead of IANA ids.
const WINDOWS_TZ: Record<string, string> = {
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'GTB Standard Time': 'Europe/Athens',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Russian Standard Time': 'Europe/Moscow',
  'Arabian Standard Time': 'Asia/Dubai',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax',
  'E. South America Standard Time': 'America/Sao_Paulo',
}

// ---------- line level ----------

function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
}

function parseLine(line: string): Prop | null {
  let colon = -1
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') quoted = !quoted
    else if (c === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null
  const [name, ...rawParams] = line.slice(0, colon).split(';')
  const params: Record<string, string> = {}
  for (const p of rawParams) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

const unescapeText = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

// ---------- dates ----------

const dtfCache = new Map<string, Intl.DateTimeFormat | null>()
function zoneFormatter(tz: string): Intl.DateTimeFormat | null {
  const key = WINDOWS_TZ[tz] ?? tz
  if (!dtfCache.has(key)) {
    try {
      dtfCache.set(
        key,
        new Intl.DateTimeFormat('en-US', { timeZone: key, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      )
    } catch {
      dtfCache.set(key, null)
    }
  }
  return dtfCache.get(key) ?? null
}

/** Offset (ms) of `tz` at the given UTC instant. */
function zoneOffset(f: Intl.DateTimeFormat, utcMs: number): number {
  const p: Record<string, string> = {}
  for (const part of f.formatToParts(new Date(utcMs))) p[part.type] = part.value
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second)
  return wall - utcMs
}

/** Wall-clock time in `tz` → UTC epoch ms. Returns null for unknown zones. */
export function zonedToUtc(y: number, mo: number, d: number, hh: number, mm: number, ss: number, tz: string): number | null {
  const f = zoneFormatter(tz)
  if (!f) return null
  const wall = Date.UTC(y, mo, d, hh, mm, ss)
  let utc = wall - zoneOffset(f, wall)
  utc = wall - zoneOffset(f, utc) // second pass fixes DST boundaries
  return utc
}

function parseDate(value: string, params: Record<string, string>): { t: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim())
  if (!m) return null
  const y = +m[1]
  const mo = +m[2] - 1
  const d = +m[3]
  if (params.VALUE === 'DATE' || m[4] === undefined) return { t: new Date(y, mo, d).getTime(), allDay: true }
  const hh = +m[4]
  const mm = +m[5]
  const ss = +(m[6] ?? 0)
  if (m[7]) return { t: Date.UTC(y, mo, d, hh, mm, ss), allDay: false }
  if (params.TZID) {
    const t = zonedToUtc(y, mo, d, hh, mm, ss, params.TZID)
    if (t !== null) return { t, allDay: false }
  }
  return { t: new Date(y, mo, d, hh, mm, ss).getTime(), allDay: false } // floating → local
}

function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const ms = (+(m[2] ?? 0) * 7 + +(m[3] ?? 0)) * DAY + +(m[4] ?? 0) * 3_600_000 + +(m[5] ?? 0) * 60_000 + +(m[6] ?? 0) * 1000
  return m[1] === '-' ? -ms : ms
}

// ---------- recurrence ----------

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval: number
  count: number | null
  until: number | null
  byday: number[] | null
}

const DAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRule(v: string): Rule | null {
  const parts: Record<string, string> = {}
  for (const kv of v.split(';')) {
    const eq = kv.indexOf('=')
    if (eq > 0) parts[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1)
  }
  const freq = parts.FREQ as Rule['freq'] | undefined
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const until = parts.UNTIL ? parseDate(parts.UNTIL, {}) : null
  const byday =
    freq === 'WEEKLY' && parts.BYDAY
      ? parts.BYDAY.split(',')
          .map((x) => DAY_INDEX[x.replace(/^[+-]?\d+/, '')])
          .filter((x) => x !== undefined)
      : null
  return {
    freq,
    interval: Math.max(1, +(parts.INTERVAL ?? 1) || 1),
    count: parts.COUNT ? +parts.COUNT : null,
    until: until ? (until.allDay ? until.t + DAY - 1 : until.t) : null,
    byday: byday && byday.length ? byday : null,
  }
}

/** Occurrence start times of a recurring event that overlap [rangeStart, rangeEnd). Wall time is preserved across DST. */
function expandRule(start: number, durationMs: number, rule: Rule, rangeStart: number, rangeEnd: number): number[] {
  const out: number[] = []
  const first = new Date(start)
  let produced = 0
  for (let i = 0; i < 1500; i++) {
    const base = new Date(start)
    if (rule.freq === 'DAILY') base.setDate(first.getDate() + i * rule.interval)
    else if (rule.freq === 'WEEKLY') base.setDate(first.getDate() + 7 * i * rule.interval)
    else if (rule.freq === 'MONTHLY') {
      base.setDate(1)
      base.setMonth(first.getMonth() + i * rule.interval)
      base.setDate(first.getDate())
      if (base.getDate() !== first.getDate()) continue // e.g. 31st in a short month
    } else base.setFullYear(first.getFullYear() + i * rule.interval)

    const candidates: number[] = []
    if (rule.byday) {
      const weekStart = new Date(base)
      weekStart.setDate(base.getDate() - base.getDay())
      for (const wd of [...rule.byday].sort()) {
        const c = new Date(weekStart)
        c.setDate(weekStart.getDate() + wd)
        if (c.getTime() >= start) candidates.push(c.getTime())
      }
    } else candidates.push(base.getTime())

    for (const c of candidates) {
      if (rule.until !== null && c > rule.until) return out
      if (rule.count !== null && produced >= rule.count) return out
      produced++
      if (c >= rangeEnd) return out
      if (c + durationMs > rangeStart) out.push(c)
    }
    if (candidates.length && candidates[0] >= rangeEnd) return out
  }
  return out
}

// ---------- public API ----------

/** Parses an ICS document and returns the event instances overlapping [rangeStart, rangeEnd). */
export function parseIcs(text: string, rangeStart: number, rangeEnd: number): IcsEvent[] {
  const events: VEvent[] = []
  let cur: VEvent | null = null
  let depth = 0 // nested components inside VEVENT (VALARM) are skipped

  for (const line of unfold(text)) {
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      if (p.value.toUpperCase() === 'VEVENT' && !cur) {
        cur = { uid: '', title: '', start: NaN, end: NaN, allDay: false, exdates: new Set(), cancelled: false }
      } else if (cur) depth++
      continue
    }
    if (p.name === 'END') {
      if (cur && depth > 0) depth--
      else if (cur && p.value.toUpperCase() === 'VEVENT') {
        if (!Number.isNaN(cur.start)) events.push(cur)
        cur = null
      }
      continue
    }
    if (!cur || depth > 0) continue

    switch (p.name) {
      case 'UID':
        cur.uid = p.value
        break
      case 'SUMMARY':
        cur.title = unescapeText(p.value)
        break
      case 'DESCRIPTION':
        cur.description = unescapeText(p.value)
        break
      case 'LOCATION':
        cur.location = unescapeText(p.value)
        break
      case 'URL':
        cur.url = p.value
        break
      case 'STATUS':
        cur.cancelled = p.value.toUpperCase() === 'CANCELLED'
        break
      case 'DTSTART': {
        const d = parseDate(p.value, p.params)
        if (d) {
          cur.start = d.t
          cur.allDay = d.allDay
        }
        break
      }
      case 'DTEND': {
        const d = parseDate(p.value, p.params)
        if (d) cur.end = d.t
        break
      }
      case 'DURATION': {
        const ms = parseDuration(p.value)
        if (ms !== null && Number.isNaN(cur.end)) cur.end = cur.start + ms
        break
      }
      case 'RRULE':
        cur.rrule = p.value
        break
      case 'EXDATE':
        for (const v of p.value.split(',')) {
          const d = parseDate(v, p.params)
          if (d) cur.exdates.add(d.t)
        }
        break
      case 'RECURRENCE-ID': {
        const d = parseDate(p.value, p.params)
        if (d) cur.recurrenceId = d.t
        break
      }
    }
  }

  // Overrides (RECURRENCE-ID) replace the matching occurrence of their master event.
  const overridden = new Map<string, Set<number>>()
  for (const e of events) {
    if (e.recurrenceId === undefined) continue
    if (!overridden.has(e.uid)) overridden.set(e.uid, new Set())
    overridden.get(e.uid)!.add(e.recurrenceId)
  }

  const out: IcsEvent[] = []
  for (const e of events) {
    if (e.cancelled) continue
    const end = Number.isNaN(e.end) ? e.start + (e.allDay ? DAY : 0) : e.end
    const duration = Math.max(0, end - e.start)
    const recurring = !!e.rrule || e.recurrenceId !== undefined
    const base = { uid: e.uid, title: e.title || '(untitled)', allDay: e.allDay, location: e.location, url: e.url, description: e.description, recurring }

    if (e.rrule && e.recurrenceId === undefined) {
      const rule = parseRule(e.rrule)
      const starts = rule ? expandRule(e.start, duration, rule, rangeStart, rangeEnd) : [e.start]
      const skip = overridden.get(e.uid)
      for (const s of starts) {
        if (e.exdates.has(s) || skip?.has(s)) continue
        out.push({ ...base, start: s, end: s + duration })
      }
    } else if (e.start < rangeEnd && end > rangeStart) {
      out.push({ ...base, start: e.start, end })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// ---------- writer ----------

export interface IcsOutEvent {
  uid: string
  title: string
  start: number
  end: number
  allDay?: boolean
  description?: string
  location?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
export function icsUtc(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}
function icsDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}
const escapeText = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** RFC 5545 content lines must be folded at 75 octets; we fold at 70 chars to stay safe with multi-byte text. */
function fold(line: string): string {
  const parts: string[] = []
  for (let i = 0; i < line.length; i += 70) parts.push((i ? ' ' : '') + line.slice(i, i + 70))
  return parts.join('\r\n')
}

export function buildIcs(events: IcsOutEvent[], calendarName = 'Hyper Do'): string {
  const now = icsUtc(Date.now())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hyper Do//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escapeText(calendarName)}`]
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`)
    if (e.allDay) lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end)}`)
    else lines.push(`DTSTART:${icsUtc(e.start)}`, `DTEND:${icsUtc(e.end)}`)
    lines.push(`SUMMARY:${escapeText(e.title)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
