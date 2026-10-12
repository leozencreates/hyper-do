/**
 * Calendar sync engine (platform independent, no React).
 *
 *  Pull: Google Calendar events (OAuth) + ICS/webcal feeds → CalendarEvent[] for Today / This week.
 *  Push: open tasks with a due date → a dedicated "Hyper Do" calendar on Google (optional).
 *
 * Runs in the Electron main process (keeps working while the window is closed) and in the browser.
 * Tokens and the task→event map live in the platform's state store, NOT in the backup-able app data.
 */
import type { AppData, CalendarEvent, CalendarSettings, CalendarStatus, GoogleCalendarInfo, Task } from './types'
import { GoogleAuthError, GoogleCalendarClient, emailFromIdToken, refreshAccessToken, revokeToken, type GCalendar, type GEvent, type GoogleTokens } from './gcal'
import { parseIcs } from './ics'
import { taskDescription, taskEventWindow } from './calendar-links'
import { startOfDay, endOfDay, DAY } from './dates'
import { newTask } from './tasks'
import { translate } from './i18n'

export const TASK_CALENDAR_NAME = 'Hyper Do'
const SYNC_INTERVAL_MS = 10 * 60_000
const MAX_CALENDARS = 15
/** Events this far ahead become tasks automatically (rolling window). */
const IMPORT_DAYS = 7

export interface CalendarSyncHost {
  getData(): AppData
  /** Replaces the app data (saves it and refreshes the UI). Used to add/update imported tasks. */
  mutate(fn: (d: AppData) => AppData): void
  loadState(): string | null
  saveState(json: string): void
  onEvents(events: CalendarEvent[]): void
  onStatus(status: CalendarStatus): void
  googleSupported: boolean
}

interface PushedEntry {
  eventId: string
  fp: string
}

interface GoogleState {
  refreshToken: string
  email: string
  taskCalendarId: string
  pushed: Record<string, PushedEntry>
}

interface ImportedEntry {
  taskId: string
  start: number
  title: string
}

interface PersistedState {
  google: GoogleState
  events: CalendarEvent[]
  syncedAt: number | null
  /** event importKey → task created from it (kept even if the user deletes the task, so it is not re-imported) */
  imported: Record<string, ImportedEntry>
}

const emptyGoogle = (): GoogleState => ({ refreshToken: '', email: '', taskCalendarId: '', pushed: {} })

/** Fingerprint of the parts of a task that are mirrored to the calendar. */
function taskFp(t: Task): string {
  return JSON.stringify([t.title, t.dueAt, t.priority, taskDescription(t)])
}

function settingsFp(s: CalendarSettings): string {
  return JSON.stringify([s.feeds.map((f) => [f.id, f.url, f.enabled, f.name, f.color]), s.google.hiddenCalendarIds, s.google.pushTasks, s.autoImport])
}

function localDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function parseGDate(v?: { date?: string; dateTime?: string }): { t: number; allDay: boolean } | null {
  if (!v) return null
  if (v.date) {
    const [y, m, d] = v.date.split('-').map(Number)
    return { t: new Date(y, m - 1, d).getTime(), allDay: true }
  }
  if (v.dateTime) {
    const t = Date.parse(v.dateTime)
    return Number.isNaN(t) ? null : { t, allDay: false }
  }
  return null
}

const hostname = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export class CalendarSync {
  private state: PersistedState
  private access: { token: string; expiresAt: number } | null = null
  private rawCalendars: GCalendar[] = []
  private calendars: GoogleCalendarInfo[] = []
  private googleError: string | null = null
  private feedStatus: CalendarStatus['feeds'] = {}
  private syncing = false
  private timer: ReturnType<typeof setInterval> | null = null
  private pending: ReturnType<typeof setTimeout> | null = null
  private queue: Promise<void> = Promise.resolve()
  private lastSettingsFp = ''
  private lastTasksFp = ''
  private importing = false

  constructor(private host: CalendarSyncHost) {
    this.state = this.load()
  }

  // ---------- state ----------

  private load(): PersistedState {
    const base: PersistedState = { google: emptyGoogle(), events: [], syncedAt: null, imported: {} }
    try {
      const raw = this.host.loadState()
      if (!raw) return base
      const p = JSON.parse(raw) as Partial<PersistedState>
      return {
        google: { ...emptyGoogle(), ...(p.google ?? {}), pushed: p.google?.pushed ?? {} },
        events: Array.isArray(p.events) ? p.events.filter((e) => typeof e.importKey === 'string') : [],
        syncedAt: p.syncedAt ?? null,
        imported: p.imported ?? {},
      }
    } catch {
      return base
    }
  }

  private persist() {
    try {
      this.host.saveState(JSON.stringify(this.state))
    } catch {
      /* ignore */
    }
  }

  private get settings(): CalendarSettings {
    return this.host.getData().settings.calendar
  }

  get connected(): boolean {
    return this.state.google.refreshToken.length > 0
  }

  status(): CalendarStatus {
    return {
      googleSupported: this.host.googleSupported,
      google: { connected: this.connected, email: this.state.google.email, calendars: this.calendars, error: this.googleError },
      feeds: this.feedStatus,
      syncedAt: this.state.syncedAt,
      syncing: this.syncing,
    }
  }

  events(): CalendarEvent[] {
    return this.state.events
  }

  private emitStatus() {
    this.host.onStatus(this.status())
  }

  private emitEvents() {
    this.host.onEvents(this.state.events)
  }

  setGoogleError(msg: string | null) {
    this.googleError = msg
    this.emitStatus()
  }

  // ---------- lifecycle ----------

  start() {
    this.stop()
    this.lastSettingsFp = settingsFp(this.settings)
    this.lastTasksFp = this.tasksFp()
    this.timer = setInterval(() => void this.sync(), SYNC_INTERVAL_MS)
    if (this.hasWork()) setTimeout(() => void this.sync(), 2500)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    if (this.pending) clearTimeout(this.pending)
    this.timer = null
    this.pending = null
  }

  private hasWork(): boolean {
    return this.connected || this.settings.feeds.some((f) => f.enabled && f.url.trim())
  }

  private tasksFp(): string {
    return this.host
      .getData()
      .tasks.filter((t) => t.dueAt !== null)
      .map((t) => `${t.id}|${t.completedAt}|${taskFp(t)}`)
      .join(';')
  }

  /** Call after every data save. Settings change → full sync, task change → push only (both debounced). */
  onDataSaved() {
    if (this.importing) return
    const sfp = settingsFp(this.settings)
    const tfp = this.tasksFp()
    if (sfp !== this.lastSettingsFp) {
      this.lastSettingsFp = sfp
      this.lastTasksFp = tfp
      this.schedule(800, () => this.sync())
    } else if (tfp !== this.lastTasksFp) {
      this.lastTasksFp = tfp
      this.schedule(1500, () => this.run(() => this.pushTasks()))
    }
  }

  private schedule(ms: number, fn: () => Promise<void>) {
    if (this.pending) clearTimeout(this.pending)
    this.pending = setTimeout(() => {
      this.pending = null
      void fn()
    }, ms)
  }

  /** Serializes sync/push runs so they never overlap. */
  private run(fn: () => Promise<void>): Promise<void> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => {})
    return p
  }

  // ---------- Google auth ----------

  async completeGoogleLogin(tokens: GoogleTokens) {
    if (!tokens.refreshToken) throw new GoogleAuthError('no_refresh_token', 'Google did not return a refresh token. Remove Hyper Do from your Google account permissions and connect again.')
    this.state.google = { ...this.state.google, refreshToken: tokens.refreshToken, email: emailFromIdToken(tokens.idToken) || this.state.google.email }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    this.googleError = null
    this.persist()
    this.emitStatus()
    await this.sync()
  }

  async disconnectGoogle() {
    const g = this.state.google
    if (g.refreshToken) {
      // Best effort: remove mirrored tasks from the Google calendar, then revoke the token.
      try {
        if (g.taskCalendarId && Object.keys(g.pushed).length) await this.deleteAllPushed(this.client())
      } catch {
        /* ignore */
      }
      await revokeToken(g.refreshToken)
    }
    this.state.google = emptyGoogle()
    this.access = null
    this.calendars = []
    this.rawCalendars = []
    this.googleError = null
    this.state.events = this.state.events.filter((e) => e.source !== 'google')
    for (const k of Object.keys(this.state.imported)) if (k.startsWith('google:')) delete this.state.imported[k]
    this.persist()
    this.emitStatus()
    this.emitEvents()
  }

  private async token(force = false): Promise<string> {
    if (!force && this.access && this.access.expiresAt - Date.now() > 60_000) return this.access.token
    const { clientId, clientSecret } = this.settings.google
    const t = await refreshAccessToken({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), refreshToken: this.state.google.refreshToken })
    this.access = { token: t.accessToken, expiresAt: t.expiresAt }
    return t.accessToken
  }

  private client() {
    return new GoogleCalendarClient((force) => this.token(force))
  }

  private handleGoogleError(e: unknown) {
    if (e instanceof GoogleAuthError && (e.code === 'invalid_grant' || e.code === 'unauthorized' || e.code === 'invalid_client')) {
      // Refresh token revoked or expired (OAuth apps left in "Testing" mode expire after 7 days).
      this.state.google.refreshToken = ''
      this.access = null
      this.googleError = 'reconnect'
    } else {
      this.googleError = (e as Error)?.message || String(e)
    }
  }

  // ---------- sync ----------

  private range() {
    const start = startOfDay(Date.now()) - DAY
    return { start, end: start + 16 * DAY }
  }

  sync(): Promise<void> {
    return this.run(async () => {
      this.syncing = true
      this.emitStatus()
      try {
        await this.pullGoogle()
        await this.pullFeeds()
        this.importEvents()
        await this.pushTasks()
      } finally {
        this.state.syncedAt = Date.now()
        this.state.events.sort((a, b) => a.start - b.start || a.end - b.end)
        this.syncing = false
        this.persist()
        this.emitEvents()
        this.emitStatus()
      }
    })
  }

  private async pullGoogle() {
    if (!this.connected) {
      this.state.events = this.state.events.filter((e) => e.source !== 'google')
      this.calendars = []
      return
    }
    try {
      const api = this.client()
      this.rawCalendars = await api.listCalendars()
      this.calendars = this.rawCalendars.map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor ?? '#4285f4', primary: !!c.primary }))
      const g = this.state.google
      if (!g.taskCalendarId) {
        const existing = this.rawCalendars.find((c) => c.summary === TASK_CALENDAR_NAME && c.accessRole === 'owner')
        if (existing) g.taskCalendarId = existing.id
      } else if (!this.rawCalendars.some((c) => c.id === g.taskCalendarId)) {
        g.taskCalendarId = '' // user deleted the calendar in Google → mirrored events are gone too
        g.pushed = {}
      }

      const hidden = new Set(this.settings.google.hiddenCalendarIds)
      const visible = this.calendars.filter((c) => c.id !== g.taskCalendarId && !hidden.has(c.id)).slice(0, MAX_CALENDARS)
      const { start, end } = this.range()
      const results = await Promise.allSettled(visible.map((c) => api.listEvents(c.id, start, end)))
      const events: CalendarEvent[] = []
      let firstError: unknown = null
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') for (const ev of r.value) {
          const mapped = this.mapGoogleEvent(ev, visible[i])
          if (mapped) events.push(mapped)
        } else firstError ??= r.reason
      })
      if (firstError) throw firstError
      this.state.events = [...this.state.events.filter((e) => e.source !== 'google'), ...events]
      this.googleError = null
    } catch (e) {
      this.handleGoogleError(e)
    }
  }

  private mapGoogleEvent(ev: GEvent, cal: GoogleCalendarInfo): CalendarEvent | null {
    if (ev.status === 'cancelled') return null
    if (ev.extendedProperties?.private?.hyperdoId) return null // our own mirrored task
    if (ev.eventType === 'workingLocation') return null
    if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null
    const s = parseGDate(ev.start)
    if (!s) return null
    const e = parseGDate(ev.end)
    return {
      id: `google:${cal.id}:${ev.id}`,
      importKey: `google:${cal.id}:${ev.id}`, // recurring instances already have unique ids on Google
      source: 'google',
      calendarId: cal.id,
      calendarName: cal.name,
      color: cal.color,
      title: ev.summary || '(untitled)',
      start: s.t,
      end: e?.t ?? s.t,
      allDay: s.allDay,
      location: ev.location || undefined,
      url: ev.htmlLink,
    }
  }

  private async pullFeeds() {
    const feeds = this.settings.feeds.filter((f) => f.enabled && f.url.trim())
    const { start, end } = this.range()
    const out: CalendarEvent[] = []
    const status: CalendarStatus['feeds'] = {}
    await Promise.allSettled(
      feeds.map(async (f) => {
        const url = f.url.trim().replace(/^webcal:\/\//i, 'https://')
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' } })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const text = await res.text()
          if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not an ICS file')
          const evs = parseIcs(text, start, end)
          const name = f.name.trim() || hostname(url)
          for (const e of evs) {
            if (e.description?.includes('— Hyper Do')) continue // our own mirrored task coming back through a feed
            out.push({
              id: `feed:${f.id}:${e.uid}:${e.start}`,
              importKey: e.recurring ? `feed:${f.id}:${e.uid}:${e.start}` : `feed:${f.id}:${e.uid}`,
              source: 'feed',
              calendarId: f.id,
              calendarName: name,
              color: f.color,
              title: e.title,
              start: e.start,
              end: e.end,
              allDay: e.allDay,
              location: e.location,
              url: e.url,
            })
          }
          status[f.id] = { error: null, count: evs.length }
        } catch (e) {
          // keep the last successful result of this feed so a transient network error does not wipe its events/tasks
          const cached = this.state.events.filter((x) => x.source === 'feed' && x.calendarId === f.id)
          out.push(...cached)
          status[f.id] = { error: (e as Error)?.message || String(e), count: cached.length }
        }
      }),
    )
    this.feedStatus = status
    this.state.events = [...this.state.events.filter((e) => e.source !== 'feed'), ...out]
  }

  // ---------- import events → tasks ----------

  /** Due time of an imported task: all-day events are due at 23:59 of that day (same convention as quick add "today"). */
  private static importDue(e: CalendarEvent): number {
    return e.allDay ? endOfDay(e.start) : e.start
  }

  private importEvents() {
    const data = this.host.getData()
    if (!data.settings.calendar.autoImport) return
    const now = Date.now()
    const windowStart = startOfDay(now)
    const windowEnd = windowStart + IMPORT_DAYS * DAY
    const lang = data.settings.language
    const tag = translate(lang, 'cal_tag')
    const imported = this.state.imported

    // forget old entries (events long gone) so the map does not grow forever
    for (const [k, v] of Object.entries(imported)) if (v.start < now - 60 * DAY) delete imported[k]

    const candidates = this.state.events.filter((e) => e.start >= windowStart && e.start < windowEnd && e.end > now)
    const byId = new Map(data.tasks.map((t) => [t.id, t]))
    const added: Task[] = []
    const updates = new Map<string, Partial<Task>>()

    for (const e of candidates) {
      const prev = imported[e.importKey]
      if (!prev) {
        const notes = [e.location, e.calendarName, e.url].filter(Boolean).join('\n')
        const task = newTask(
          { title: e.title, dueAt: CalendarSync.importDue(e), notes, tags: [tag], calendarEventId: e.importKey, order: now + added.length },
          data.settings,
        )
        added.push(task)
        imported[e.importKey] = { taskId: task.id, start: e.start, title: e.title }
        continue
      }
      // Event moved or renamed → follow it, unless the user already finished or renamed the task.
      const task = byId.get(prev.taskId)
      if (!task || task.completedAt !== null) continue
      const patch: Partial<Task> = {}
      if (prev.start !== e.start) patch.dueAt = CalendarSync.importDue(e)
      if (prev.title !== e.title && task.title === prev.title) patch.title = e.title
      if (Object.keys(patch).length) {
        updates.set(task.id, patch)
        imported[e.importKey] = { taskId: task.id, start: e.start, title: e.title }
      }
    }

    if (!added.length && !updates.size) return
    this.persist()
    this.importing = true // the save triggered by mutate() is ours, not a user change that needs a push
    try {
      this.host.mutate((d) => ({
        ...d,
        tasks: [...added, ...d.tasks.map((t) => (updates.has(t.id) ? { ...t, ...updates.get(t.id), snoozedUntil: null } : t))],
      }))
    } finally {
      this.importing = false
      this.lastTasksFp = this.tasksFp()
    }
  }

  // ---------- push tasks → Google ----------

  private async ensureTaskCalendar(api: GoogleCalendarClient): Promise<string> {
    const g = this.state.google
    if (g.taskCalendarId) return g.taskCalendarId
    const cals = this.rawCalendars.length ? this.rawCalendars : await api.listCalendars()
    const existing = cals.find((c) => c.summary === TASK_CALENDAR_NAME && c.accessRole === 'owner')
    const id = existing?.id ?? (await api.insertCalendar(TASK_CALENDAR_NAME, 'Tasks with a due date, mirrored from Hyper Do. Finished tasks are removed automatically.')).id
    g.taskCalendarId = id
    g.pushed = {}
    this.persist()
    return id
  }

  private async deleteAllPushed(api: GoogleCalendarClient) {
    const g = this.state.google
    const entries = Object.entries(g.pushed)
    for (let i = 0; i < entries.length; i += 5) {
      await Promise.allSettled(entries.slice(i, i + 5).map(([, p]) => api.deleteEvent(g.taskCalendarId, p.eventId)))
    }
    g.pushed = {}
    this.persist()
  }

  private eventBody(task: Task) {
    const w = taskEventWindow(task)!
    return {
      summary: task.title,
      description: taskDescription(task),
      start: w.allDay ? { date: localDate(w.start) } : { dateTime: new Date(w.start).toISOString() },
      end: w.allDay ? { date: localDate(w.end) } : { dateTime: new Date(w.end).toISOString() },
      colorId: task.priority === 'high' ? '11' : task.priority === 'medium' ? '6' : '7',
      extendedProperties: { private: { hyperdoId: task.id } },
      reminders: { useDefault: true },
    }
  }

  private async pushTasks() {
    const g = this.state.google
    if (!this.connected) {
      g.pushed = {}
      return
    }
    try {
      const api = this.client()
      if (!this.settings.google.pushTasks) {
        if (g.taskCalendarId && Object.keys(g.pushed).length) await this.deleteAllPushed(api)
        return
      }
      const calId = await this.ensureTaskCalendar(api)
      const desired = new Map<string, Task>()
      // tasks that came from a calendar are not mirrored back (they already exist as events)
      for (const t of this.host.getData().tasks) if (t.completedAt === null && t.dueAt !== null && t.title.trim() && !t.calendarEventId) desired.set(t.id, t)

      for (const [taskId, p] of Object.entries(g.pushed)) {
        if (desired.has(taskId)) continue
        await api.deleteEvent(calId, p.eventId)
        delete g.pushed[taskId]
        this.persist()
      }

      for (const [taskId, task] of desired) {
        const fp = taskFp(task)
        const p = g.pushed[taskId]
        if (p && p.fp === fp) continue
        const body = this.eventBody(task)
        let eventId = p?.eventId ?? ''
        if (eventId) {
          try {
            await api.patchEvent(calId, eventId, body)
          } catch (e) {
            if (e instanceof GoogleAuthError && e.code === 'not_found') eventId = ''
            else throw e
          }
        }
        if (!eventId) {
          // Re-link after a reinstall instead of creating a duplicate.
          const existing = (await api.findByHyperdoId(calId, taskId)).find((x) => x.status !== 'cancelled')
          if (existing) {
            await api.patchEvent(calId, existing.id, body)
            eventId = existing.id
          } else {
            eventId = (await api.insertEvent(calId, body)).id
          }
        }
        g.pushed[taskId] = { eventId, fp }
        this.persist()
      }
      this.googleError = null
    } catch (e) {
      this.handleGoogleError(e)
    } finally {
      this.persist()
      this.emitStatus()
    }
  }
}
