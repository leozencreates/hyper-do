/**
 * Loading and normalising persisted app data (platform independent, no React).
 * Every storage backend (localStorage, Capacitor Preferences, the Electron JSON file) and every
 * in-memory replacement (backup import, platform-side changes) goes through `normalizeData`,
 * so old records and missing fields are completed in exactly one place.
 */
import { DEFAULT_SETTINGS, FOCUS_LOG_MAX, MINI_APP_MODES, SYNC_MODES, TOMBSTONE_TTL_MS, type AppData, type CalendarSettings, type DigestSettings, type FocusEntry, type HfSession, type MiniAppMode, type MiniAppSettings, type Settings, type SyncMode, type SyncSettings, type Tombstone } from './types'
import { normalizeTask, uid } from './tasks'
import { detectLang } from './i18n'

/** Key under which the browser-based platforms (web / PWA / Android) store the app data. */
export const DATA_STORAGE_KEY = 'hyperdo-data'

/** Browser platforms start in the device language; Electron keeps the plain defaults. */
export const browserDefaultSettings = (): Settings => ({ ...DEFAULT_SETTINGS, language: detectLang() })

export function normalizeCalendarSettings(c?: Partial<CalendarSettings> | null): CalendarSettings {
  const d = DEFAULT_SETTINGS.calendar
  const g: Partial<CalendarSettings['google']> = c?.google ?? {}
  return {
    showEvents: c?.showEvents ?? d.showEvents,
    autoImport: c?.autoImport ?? d.autoImport,
    google: {
      // an empty stored value falls back to a client baked into the build (VITE_GOOGLE_CLIENT_ID)
      clientId: typeof g.clientId === 'string' && g.clientId ? g.clientId : d.google.clientId,
      clientSecret: typeof g.clientSecret === 'string' && g.clientSecret ? g.clientSecret : d.google.clientSecret,
      androidClientId: typeof g.androidClientId === 'string' ? g.androidClientId : d.google.androidClientId,
      pushTasks: g.pushTasks ?? false,
      hiddenCalendarIds: Array.isArray(g.hiddenCalendarIds) ? g.hiddenCalendarIds.filter((x): x is string => typeof x === 'string') : [],
    },
    feeds: Array.isArray(c?.feeds)
      ? c.feeds
          .filter((f) => f && typeof f.url === 'string')
          .map((f) => ({ id: f.id || uid(), name: f.name ?? '', url: f.url, color: f.color || '#38bdf8', enabled: f.enabled ?? true }))
      : [],
  }
}

/**
 * A stored Hyper Focus session, or null when the value is missing or malformed.
 * Sessions saved before the focus log existed have no `startedAt`; it is reconstructed as
 * `endsAt − phase length` from `pomodoro`.
 */
export function normalizeHfSession(s: unknown, pomodoro: Settings['pomodoro'] = DEFAULT_SETTINGS.pomodoro): HfSession | null {
  if (!s || typeof s !== 'object') return null
  const o = s as Partial<HfSession>
  if (o.phase !== 'work' && o.phase !== 'break') return null
  if (typeof o.endsAt !== 'number' || !Number.isFinite(o.endsAt)) return null
  const totalMs = (o.phase === 'work' ? pomodoro.workMin : pomodoro.breakMin) * 60_000
  return {
    phase: o.phase,
    round: typeof o.round === 'number' && o.round >= 1 ? Math.floor(o.round) : 1,
    endsAt: o.endsAt,
    pausedRemaining: typeof o.pausedRemaining === 'number' ? Math.max(0, o.pausedRemaining) : null,
    taskId: typeof o.taskId === 'string' && o.taskId ? o.taskId : null,
    startedAt: typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? o.startedAt : o.endsAt - totalMs,
  }
}

/** Keeps well-formed focus-log entries (newest `FOCUS_LOG_MAX`); anything else becomes an empty log. */
export function normalizeFocusLog(log: unknown): FocusEntry[] {
  if (!Array.isArray(log)) return []
  const out = log.filter((e): e is FocusEntry => {
    if (!e || typeof e !== 'object') return false
    const o = e as Partial<FocusEntry>
    return (
      typeof o.id === 'string' &&
      (o.phase === 'work' || o.phase === 'break') &&
      typeof o.startedAt === 'number' &&
      typeof o.endedAt === 'number' &&
      o.endedAt >= o.startedAt &&
      (o.taskId === null || typeof o.taskId === 'string')
    )
  })
  return out.length > FOCUS_LOG_MAX ? out.slice(out.length - FOCUS_LOG_MAX) : out
}

/** `YYYY-MM-DD` → positive integer; everything else is dropped. */
export function normalizeDailyDone(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = Math.floor(n)
  }
  return out
}

/**
 * Tombstones (#16): well-formed `{ id, at }` entries younger than `TOMBSTONE_TTL_MS`, one per id (the newest
 * `at` wins), sorted by id so two devices produce the same list. Everything else is dropped.
 */
export function normalizeDeleted(v: unknown, nowMs = Date.now()): Tombstone[] {
  if (!Array.isArray(v)) return []
  const byId = new Map<string, number>()
  const cutoff = nowMs - TOMBSTONE_TTL_MS
  for (const e of v) {
    if (!e || typeof e !== 'object') continue
    const o = e as Partial<Tombstone>
    if (typeof o.id !== 'string' || !o.id || typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < cutoff) continue
    byId.set(o.id, Math.max(byId.get(o.id) ?? 0, o.at))
  }
  return [...byId.entries()].map(([id, at]) => ({ id, at })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Sync settings (#16): a known mode and plain strings; anything else falls back to the defaults (sync off). */
export function normalizeSyncSettings(s: Partial<SyncSettings> | null | undefined, base: SyncSettings = DEFAULT_SETTINGS.sync): SyncSettings {
  return {
    mode: SYNC_MODES.includes(s?.mode as SyncMode) ? (s!.mode as SyncMode) : base.mode,
    webdavUrl: typeof s?.webdavUrl === 'string' ? s.webdavUrl : base.webdavUrl,
    folder: typeof s?.folder === 'string' ? s.folder : base.folder,
  }
}

/** Public URL of the Mini App as stored: trimmed, without trailing slashes ('' when it is not an https:// address). */
export function normalizeMiniAppUrl(url: unknown): string {
  if (typeof url !== 'string') return ''
  const u = url.trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s/]+/i.test(u) ? u : ''
}

/** Mini App settings (Phase D): a known mode and an https URL; anything else falls back to the defaults (off). */
export function normalizeMiniAppSettings(m: Partial<MiniAppSettings> | null | undefined, base: MiniAppSettings = DEFAULT_SETTINGS.miniApp): MiniAppSettings {
  return {
    mode: MINI_APP_MODES.includes(m?.mode as MiniAppMode) ? (m!.mode as MiniAppMode) : base.mode,
    publicUrl: typeof m?.publicUrl === 'string' ? normalizeMiniAppUrl(m.publicUrl) : base.publicUrl,
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Digest settings (#17): booleans and `HH:MM` strings, anything else falls back to the defaults. */
export function normalizeDigestSettings(d: Partial<DigestSettings> | null | undefined, base: DigestSettings = DEFAULT_SETTINGS.digest): DigestSettings {
  return {
    enabled: typeof d?.enabled === 'boolean' ? d.enabled : base.enabled,
    time: typeof d?.time === 'string' && HHMM.test(d.time) ? d.time : base.time,
    evening: typeof d?.evening === 'boolean' ? d.evening : base.evening,
    eveningTime: typeof d?.eveningTime === 'string' && HHMM.test(d.eveningTime) ? d.eveningTime : base.eveningTime,
  }
}

/** Completes partial / outdated data: missing task fields, missing or nested settings. Tombstones older than 30 days (relative to `nowMs`) are pruned here. */
export function normalizeData(d: Partial<AppData> | null | undefined, base: Settings = DEFAULT_SETTINGS, nowMs = Date.now()): AppData {
  const s = d?.settings
  const settings: Settings = {
    ...base,
    ...s,
    quietHours: { ...base.quietHours, ...s?.quietHours },
    telegram: {
      ...base.telegram,
      ...s?.telegram,
      // v2 bot fields (botUsername, pairCode): plain strings, '' when missing or malformed — never generated here
      botUsername: typeof s?.telegram?.botUsername === 'string' ? s.telegram.botUsername : base.telegram.botUsername,
      pairCode: typeof s?.telegram?.pairCode === 'string' ? s.telegram.pairCode : base.telegram.pairCode,
      // Phase B fields: booleans / a positive whole number of minutes, defaults otherwise
      tidy: typeof s?.telegram?.tidy === 'boolean' ? s.telegram.tidy : base.telegram.tidy,
      onlyWhenIdle: typeof s?.telegram?.onlyWhenIdle === 'boolean' ? s.telegram.onlyWhenIdle : base.telegram.onlyWhenIdle,
      idleMinutes: typeof s?.telegram?.idleMinutes === 'number' && s.telegram.idleMinutes >= 1 ? Math.floor(s.telegram.idleMinutes) : base.telegram.idleMinutes,
    },
    pomodoro: { ...base.pomodoro, ...s?.pomodoro },
    calendar: normalizeCalendarSettings(s?.calendar),
    quickAddShortcut: typeof s?.quickAddShortcut === 'string' ? s.quickAddShortcut : base.quickAddShortcut,
    escalation: { ...base.escalation, ...s?.escalation },
    celebrate: typeof s?.celebrate === 'boolean' ? s.celebrate : base.celebrate,
    sounds: typeof s?.sounds === 'boolean' ? s.sounds : base.sounds,
    autoUpdate: typeof s?.autoUpdate === 'boolean' ? s.autoUpdate : base.autoUpdate,
    // B5 / #17: a finite positive timestamp or null; digest times must look like HH:MM
    mutedUntil: typeof s?.mutedUntil === 'number' && Number.isFinite(s.mutedUntil) && s.mutedUntil > 0 ? s.mutedUntil : base.mutedUntil,
    digest: normalizeDigestSettings(s?.digest, base.digest),
    sync: normalizeSyncSettings(s?.sync, base.sync),
    miniApp: normalizeMiniAppSettings(s?.miniApp, base.miniApp),
  }
  return {
    tasks: Array.isArray(d?.tasks) ? d.tasks.map(normalizeTask) : [],
    settings,
    hyperFocus: normalizeHfSession(d?.hyperFocus, settings.pomodoro),
    focusLog: normalizeFocusLog(d?.focusLog),
    dailyDone: normalizeDailyDone(d?.dailyDone),
    deleted: normalizeDeleted(d?.deleted, nowMs),
  }
}

/** Parses a stored JSON document; unreadable or missing input yields empty data with `base` settings. */
export function parseAppData(raw: string | null | undefined, base: Settings = DEFAULT_SETTINGS): AppData {
  if (!raw) return normalizeData(null, base)
  try {
    return normalizeData(JSON.parse(raw) as Partial<AppData>, base)
  } catch {
    return normalizeData(null, base)
  }
}
