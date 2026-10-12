/**
 * Loading and normalising persisted app data (platform independent, no React).
 * Every storage backend (localStorage, Capacitor Preferences, the Electron JSON file) and every
 * in-memory replacement (backup import, platform-side changes) goes through `normalizeData`,
 * so old records and missing fields are completed in exactly one place.
 */
import { DEFAULT_SETTINGS, type AppData, type CalendarSettings, type Settings } from './types'
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

/** Completes partial / outdated data: missing task fields, missing or nested settings. */
export function normalizeData(d: Partial<AppData> | null | undefined, base: Settings = DEFAULT_SETTINGS): AppData {
  const s = d?.settings
  return {
    tasks: Array.isArray(d?.tasks) ? d.tasks.map(normalizeTask) : [],
    settings: {
      ...base,
      ...s,
      quietHours: { ...base.quietHours, ...s?.quietHours },
      telegram: { ...base.telegram, ...s?.telegram },
      pomodoro: { ...base.pomodoro, ...s?.pomodoro },
      calendar: normalizeCalendarSettings(s?.calendar),
    },
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
