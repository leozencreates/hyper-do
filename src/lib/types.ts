import type { Lang } from './i18n'

export type Priority = 'high' | 'medium' | 'low'
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'
/**
 * Details of a `'custom'` recurrence: "every N units", optional weekday set for weeks
 * (0 = Sunday … 6 = Saturday) and "repeat after completion" (the next due date is counted from the
 * completion time instead of the planned date). Only stored when `recurrence === 'custom'`.
 */
export interface RecurrenceRule {
  every: number
  unit: RecurrenceUnit
  weekdays?: number[]
  afterCompletion?: boolean
}
/** Pano (Kanban) sütunu; "bitti" sütunu completedAt ile belirlenir. */
export type Status = 'todo' | 'doing' | 'waiting'
export type SortMode = 'smart' | 'due' | 'priority' | 'created' | 'alpha' | 'manual'
export type Theme = 'dark' | 'light' | 'system'
/** Web/Android: bildirim izni durumu. Electron: her zaman 'granted'. */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'
/** How much energy a task needs: 🪫 low / 🔋 medium / ⚡ high (null = not set). */
export type Energy = 'low' | 'medium' | 'high'

// Seçenek listeleri (arayüzdeki sıra ile)
export const PRIORITIES: Priority[] = ['high', 'medium', 'low']
export const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom']
export const RECURRENCE_UNITS: RecurrenceUnit[] = ['day', 'week', 'month', 'year']
/** Rule used when a task is switched to `'custom'` (editor) or a stored custom rule is unreadable. */
export const DEFAULT_RECURRENCE_RULE: RecurrenceRule = { every: 1, unit: 'week' }
export const STATUSES: Status[] = ['todo', 'doing', 'waiting']
export const SORT_MODES: SortMode[] = ['smart', 'due', 'priority', 'created', 'alpha', 'manual']
export const THEMES: Theme[] = ['dark', 'light', 'system']
export const ENERGIES: Energy[] = ['low', 'medium', 'high']
export const ENERGY_ICON: Record<Energy, string> = { low: '🪫', medium: '🔋', high: '⚡' }
/** Estimate presets offered in the editor (minutes). */
export const ESTIMATE_PRESETS = [5, 15, 30, 60, 120]

export interface Subtask {
  id: string
  title: string
  done: boolean
}

export interface Task {
  id: string
  title: string
  notes: string
  priority: Priority
  tags: string[]
  dueAt: number | null // epoch ms, son tarih
  recurrence: Recurrence
  /** Present only when `recurrence === 'custom'` (see `RecurrenceRule`). */
  recurrenceRule?: RecurrenceRule
  subtasks: Subtask[]
  /** Hatırlatma aralığı (dakika). 0 = kapalı. Görev bitene kadar bu aralıkla dürter. */
  remindEveryMin: number
  /** Hatırlatmalar bu zamana kadar susturulur (snooze). */
  snoozedUntil: number | null
  /** "Şu an odak" görevi */
  focused: boolean
  /** Pano sütunu */
  status: Status
  /** Elle sıralama anahtarı (küçük önce). Varsayılan: createdAt. */
  order: number
  completedAt: number | null
  createdAt: number
  /** Takvimden otomatik eklenen görev: kaynak etkinliğin anahtarı (Google'a geri gönderilmez). */
  calendarEventId?: string
  /**
   * Escalation ladder: reminders delivered without any reaction. Incremented by whoever delivers a
   * reminder (Electron main, web adapter; Android cannot count, its notifications are pre-scheduled),
   * reset by `resetNag` on complete / snooze / postpone / focus / editor save / Telegram / deep link.
   */
  nagCount: number
  /** Time estimate in minutes (null = none). Quick add: `~30m`, `~2h`. */
  estimateMin: number | null
  /** Energy needed (null = not set). Quick add: `^low ^med ^high`. */
  energy: Energy | null
  /**
   * Snoozes and postpones since the last fresh start (`snoozeTask`); from `SNOOZE_NUDGE` on the row offers the
   * "stuck?" dialog and reminders carry a nudge line. Reset on completion, duplicate and any choice in that dialog.
   */
  snoozeCount: number
  /**
   * Last change (epoch ms), bumped by every mutation path (#16): the newer copy wins when two devices
   * sync. `touchTask` keeps it strictly increasing even when another device's clock runs ahead. Default: `createdAt`.
   */
  updatedAt: number
}

/** A deleted task (#16): other devices drop their copy unless they edited it after `at`. Pruned after `TOMBSTONE_TTL_MS`. */
export interface Tombstone {
  id: string
  at: number
}

/** Tombstones older than this are forgotten (30 days). */
export const TOMBSTONE_TTL_MS = 30 * 24 * 3_600_000

export type SyncMode = 'off' | 'folder' | 'webdav'
export const SYNC_MODES: SyncMode[] = ['off', 'folder', 'webdav']

/**
 * Cross-device sync (#16). Only the location lives here; the WebDAV username/password are kept in the
 * platform state store (never in AppData, never in backups).
 */
export interface SyncSettings {
  mode: SyncMode
  /** WebDAV: full URL of the JSON file inside an existing folder, e.g. `https://cloud.example.com/remote.php/dav/files/me/HyperDo/hyperdo-sync.json`. */
  webdavUrl: string
  /** Folder (Electron only): a directory such as a OneDrive / Dropbox / Syncthing folder; the file is `<folder>/hyperdo-sync.json`. */
  folder: string
}

/** Escalation ladder thresholds (number of ignored reminders). */
export interface EscalationSettings {
  enabled: boolean
  /** From this many ignored reminders on, notifications and Telegram get the "Ignored N×" line. */
  telegramAfter: number
  /** From this many on, the Electron app shows the mini window and the toast is critical. */
  popupAfter: number
}

export interface Settings {
  language: Lang
  /** Gecikmiş görevlerde aralık ikiye bölünür */
  escalateOverdue: boolean
  /** Hatırlatmada pencereyi görev çubuğunda titret (Electron) */
  flashWindow: boolean
  /** Bildirimle birlikte pencereyi göster (Electron) */
  showWindowOnRemind: boolean
  /** "Yine unuttun dimi? 😏" tarzı başlıklar */
  funTitles: boolean
  defaultRemindEveryMin: number
  quietHours: { enabled: boolean; from: string; to: string } // "23:00" - "08:00"
  /** Telegram botu üzerinden hatırlatma (Electron). chatId bota /start yazılınca otomatik dolar. */
  telegram: TelegramSettings
  theme: Theme
  sort: SortMode
  /** Hyper Focus (Pomodoro): work / break lengths in minutes */
  pomodoro: { workMin: number; breakMin: number }
  /** Calendar connections: Google Calendar (OAuth) + ICS/webcal feeds */
  calendar: CalendarSettings
  /** Start Hyper Do with the OS session, hidden in the tray (Electron). */
  launchAtLogin: boolean
  /** While a Hyper Focus work phase runs, reminders of every other task are held back. */
  focusSuppressOthers: boolean
  /** Global shortcut that opens the quick-add popup (Electron accelerator syntax). Empty = off. */
  quickAddShortcut: string
  /** Copy the data file into userData/backups once per day (Electron). */
  autoBackup: boolean
  /** Escalation ladder (#6): nag harder the longer a task is ignored. */
  escalation: EscalationSettings
  /** Chime + confetti when a task is completed. */
  celebrate: boolean
  /** Sound effects (add / done / delete / undo / snooze / focus, Hyper Focus chimes). Off = silent everywhere; the header button toggles it. */
  sounds: boolean
  /** Check GitHub Releases for new versions and download them in the background (Electron, packaged builds). */
  autoUpdate: boolean
  /** Global mute (B5): no reminders on any channel until this time; null = not muted. `/mute 2h` in Telegram, chip in the header. */
  mutedUntil: number | null
  /** Morning digest + optional evening review (#17): desktop toast + Telegram, once per local day. */
  digest: DigestSettings
  /** Cross-device sync (#16): off / shared folder / WebDAV. Settings themselves are never synced. */
  sync: SyncSettings
  /** Telegram Mini App (Phase D, Electron): how the phone reaches the local Mini App server. */
  miniApp: MiniAppSettings
}

export type MiniAppMode = 'off' | 'cloudflare' | 'manual'
export const MINI_APP_MODES: MiniAppMode[] = ['off', 'cloudflare', 'manual']

/**
 * Telegram Mini App (Phase D). `cloudflare` = the desktop app downloads / runs `cloudflared` and opens a quick
 * tunnel to its local server; `manual` = the user runs any tunnel to the shown port and pastes its public URL.
 */
export interface MiniAppSettings {
  mode: MiniAppMode
  /** Public `https://` origin for `manual` mode (no trailing slash); ignored otherwise. */
  publicUrl: string
}

/** Live state of the Mini App server + tunnel (Electron main → Settings → Telegram → Mini App). */
export interface MiniAppStatus {
  state: 'off' | 'downloading' | 'starting' | 'up' | 'error'
  /** Public origin the phone uses ('' until known). */
  url: string
  /** Local port of the server on 127.0.0.1 (0 while off). */
  port: number
  /** cloudflared download progress 0–100, or null when unknown / not downloading. */
  progress: number | null
  error: string | null
}

/** Daily digest times (`HH:MM` local). Sunday's evening review becomes the weekly one. */
export interface DigestSettings {
  enabled: boolean
  time: string
  evening: boolean
  eveningTime: string
}

export type HfPhase = 'work' | 'break'

/** A running Hyper Focus (Pomodoro) session. Lives in AppData so every platform's reminder engine can see it. */
export interface HfSession {
  phase: HfPhase
  round: number
  endsAt: number
  /** When paused: remaining ms at the moment of pausing. */
  pausedRemaining: number | null
  taskId: string | null
  /** Start of the current phase (pause time excluded: moved forward on resume). Feeds the focus log. */
  startedAt: number
}

/** One finished Hyper Focus phase (timer, skip or stop); only phases of at least a minute are logged. */
export interface FocusEntry {
  id: string
  taskId: string | null
  phase: HfPhase
  startedAt: number
  endedAt: number
}

export interface GoogleCalendarSettings {
  /** OAuth 2.0 client created by the user in Google Cloud Console (same idea as the Telegram bot token). */
  clientId: string
  /** Google requires the secret at the token endpoint even for Desktop-app clients; it is not treated as confidential. */
  clientSecret: string
  /**
   * OAuth client of type **Android** (package `com.hyperdo.app` + SHA-1 of the signing key, no secret).
   * Used by the Android app only; empty = Google sign-in is not offered there.
   */
  androidClientId: string
  /** Mirror open tasks with a due date into a dedicated "Hyper Do" calendar on Google. */
  pushTasks: boolean
  /** Google calendars the user does NOT want to see in Today / This week (default: show all). */
  hiddenCalendarIds: string[]
}

/** Read-only calendar subscription (ICS / webcal link): Outlook, iCloud, Nextcloud, Fastmail… */
export interface CalendarFeed {
  id: string
  name: string
  url: string
  color: string
  enabled: boolean
}

export interface CalendarSettings {
  /** Show calendar events above the task list in Today / This week */
  showEvents: boolean
  /** Automatically turn upcoming events (next 7 days) of connected calendars into tasks */
  autoImport: boolean
  google: GoogleCalendarSettings
  feeds: CalendarFeed[]
}

/** A calendar event as shown in the UI (from Google or an ICS feed). */
export interface CalendarEvent {
  id: string
  /** Stable key used for task import: survives time changes of a single event, unique per recurring instance. */
  importKey: string
  source: 'google' | 'feed'
  calendarId: string
  calendarName: string
  color: string
  title: string
  start: number
  end: number
  allDay: boolean
  location?: string
  url?: string
}

export interface GoogleCalendarInfo {
  id: string
  name: string
  color: string
  primary: boolean
}

export interface CalendarStatus {
  /** false on platforms where the Google login flow is not available (Android WebView) */
  googleSupported: boolean
  google: { connected: boolean; email: string; calendars: GoogleCalendarInfo[]; error: string | null }
  feeds: Record<string, { error: string | null; count: number }>
  syncedAt: number | null
  syncing: boolean
}

/** Calendar bridge provided by the platform (Electron main process or the browser sync engine). */
export interface CalendarApi {
  status(): Promise<CalendarStatus>
  events(): Promise<CalendarEvent[]>
  /** Starts the Google login. Electron: opens the system browser and resolves when done. Web: navigates away. */
  connectGoogle(): Promise<{ ok: boolean; error?: string }>
  disconnectGoogle(): Promise<void>
  syncNow(): Promise<void>
  onEvents(cb: (events: CalendarEvent[]) => void): () => void
  onStatus(cb: (s: CalendarStatus) => void): () => void
}

export interface TelegramSettings {
  enabled: boolean
  /** @BotFather'dan alınan bot token'ı */
  token: string
  /** Hatırlatmaların gideceği sohbet; boşsa bot henüz bağlanmamış */
  chatId: string
  /** Bot username from `getMe` (no `@`), so Settings can render the t.me link before the status arrives. Not secret. */
  botUsername: string
  /**
   * Pairing code: linking requires `/start <code>` while `chatId` is empty. Generated by the Electron main process
   * when the bot is enabled and nothing is linked; cleared on a successful link. Old files with `chatId` set need none.
   */
  pairCode: string
  /** B1: delete a task's previous reminder message when a new one is sent (otherwise only its buttons are removed). */
  tidy: boolean
  /** B3: send reminders to Telegram only while the PC has been idle (or locked) for `idleMinutes`. */
  onlyWhenIdle: boolean
  idleMinutes: number
}

/** Live state of the Telegram bot (Electron main → Settings panel). */
export interface TelegramStatus {
  state: 'off' | 'starting' | 'running' | 'error'
  error: string | null
  /** Bot username without `@` (from `getMe`), '' until known. */
  username: string
  /** Time of the last successful `getUpdates`, or null. */
  lastPollAt: number | null
}

export interface AppData {
  tasks: Task[]
  settings: Settings
  /** Active Hyper Focus session, or null. */
  hyperFocus: HfSession | null
  /** Finished Hyper Focus phases, newest last; capped at `FOCUS_LOG_MAX` entries. */
  focusLog: FocusEntry[]
  /** Completions per local day (`YYYY-MM-DD` → count). Survives "clear done"; feeds streaks and the heatmap. */
  dailyDone: Record<string, number>
  /** Tombstones of deleted tasks (#16), newest 30 days, so a delete reaches the other devices. */
  deleted: Tombstone[]
}

/** The focus log keeps only this many newest entries. */
export const FOCUS_LOG_MAX = 5000

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  escalateOverdue: true,
  flashWindow: true,
  showWindowOnRemind: false,
  funTitles: true,
  defaultRemindEveryMin: 20,
  quietHours: { enabled: false, from: '23:00', to: '08:00' },
  telegram: { enabled: false, token: '', chatId: '', botUsername: '', pairCode: '', tidy: true, onlyWhenIdle: false, idleMinutes: 5 },
  theme: 'dark',
  sort: 'smart',
  pomodoro: { workMin: 40, breakMin: 5 },
  calendar: {
    showEvents: true,
    autoImport: true,
    google: {
      // A distributor can bake a default OAuth client into the build via .env (VITE_GOOGLE_CLIENT_ID / _SECRET).
      clientId: import.meta.env?.VITE_GOOGLE_CLIENT_ID ?? '',
      clientSecret: import.meta.env?.VITE_GOOGLE_CLIENT_SECRET ?? '',
      androidClientId: '',
      pushTasks: false,
      hiddenCalendarIds: [],
    },
    feeds: [],
  },
  launchAtLogin: false,
  focusSuppressOthers: true,
  quickAddShortcut: 'CommandOrControl+Shift+Space',
  autoBackup: true,
  escalation: { enabled: true, telegramAfter: 3, popupAfter: 5 },
  celebrate: true,
  sounds: true,
  autoUpdate: true,
  mutedUntil: null,
  digest: { enabled: true, time: '08:00', evening: false, eveningTime: '20:00' },
  sync: { mode: 'off', webdavUrl: '', folder: '' },
  miniApp: { mode: 'off', publicUrl: '' },
}

/** Result of registering the global quick-add shortcut (Electron main → Settings). */
export interface ShortcutStatus {
  ok: boolean
  accelerator: string
  error?: string
}

export interface BackupInfo {
  /** Folder holding the daily copies. */
  dir: string
  /** Time of the newest automatic backup, or null if none exists yet. */
  lastAt: number | null
}

/** Text shared into the app from another app (Android "Share → Hyper Do"). */
export interface SharePayload {
  text: string
  subject?: string
}

/** Auto-update state (Electron main → Settings "About" + the in-app toast). */
export type UpdateState = 'idle' | 'unavailable' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

export interface UpdateStatus {
  status: UpdateState
  /** Version found / being downloaded / ready to install. */
  version?: string
  /** Download progress 0–100 while `downloading`. */
  percent?: number
  error?: string
}

/** Electron-only capabilities: quick-add popup, global shortcut, automatic backups, mini window, updater. */
export interface DesktopApi {
  shortcutStatus(): Promise<ShortcutStatus>
  onShortcutStatus(cb: (s: ShortcutStatus) => void): () => void
  backupInfo(): Promise<BackupInfo>
  openBackups(): Promise<void>
  /** Quick-add popup: parse + create the task(s) in the main process; resolves with the created title. */
  quickAdd(text: string): Promise<{ ok: boolean; title?: string }>
  hideQuick(): Promise<void>
  /** Fired in the popup window each time it is shown (reset + focus the input). */
  onQuickShown(cb: () => void): () => void
  /** Mini window (#7): the small always-on-top card. */
  toggleMini(): Promise<void>
  hideMini(): Promise<void>
  miniVisible(): Promise<boolean>
  onMiniVisible(cb: (visible: boolean) => void): () => void
  /** Brings the main window to the front (mini window "expand"). */
  showMain(): Promise<void>
  /** Auto-update (#18): current state, manual check, install the downloaded update (quits + restarts). */
  updateStatus(): Promise<UpdateStatus>
  checkForUpdates(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void
  appVersion(): Promise<string>
  /** Telegram Mini App (Phase D): server + tunnel state, push on change, restart the tunnel (same mode). */
  miniAppStatus(): Promise<MiniAppStatus>
  onMiniAppStatus(cb: (s: MiniAppStatus) => void): () => void
  miniAppRestart(): Promise<void>
}

/** Connection to the data owner for adapters that do not hold the data themselves (the Telegram Mini App talks to the PC). */
export interface ConnectionStatus {
  /** `forbidden` = the server answered 401/403 (not the linked account / bot not configured). */
  state: 'connecting' | 'ok' | 'unreachable' | 'forbidden'
  /** false while a save could not be delivered (the local copy is kept and retried). */
  saved: boolean
  error: string | null
}

export interface ConnectionApi {
  status(): ConnectionStatus
  onStatus(cb: (s: ConnectionStatus) => void): () => void
  /** Retries the load / the pending save right away. */
  retry(): void
}

/** Live state of the sync engine (#16) for Settings → Sync. */
export interface SyncStatus {
  /** `settings.sync.mode !== 'off'` */
  enabled: boolean
  transport: 'folder' | 'webdav' | null
  lastSyncAt: number | null
  /** Error code (`not_configured`, `unauthorized`, `conflict`, `invalid_file`) or a raw message; null when the last cycle succeeded. */
  lastError: string | null
  syncing: boolean
  /** WebDAV username/password are stored in the platform state store (the UI shows "saved" instead of the password). */
  credentialsSaved: boolean
}

/** Sync bridge provided by the platform (Electron main process or the browser engine). */
export interface SyncApi {
  status(): Promise<SyncStatus>
  syncNow(): Promise<void>
  /** Stores the WebDAV username/password in the platform state store (not in AppData). */
  setCredentials(username: string, password: string): Promise<void>
  /** Electron only: directory picker for the folder transport; resolves with the path or null when cancelled. */
  pickFolder?(): Promise<string | null>
  onStatus(cb: (s: SyncStatus) => void): () => void
}

/** Platform köprüsü: Electron preload veya tarayıcı uyarlaması bunu sağlar. */
export interface HyperDoApi {
  /** `telegram` = the Mini App inside the Telegram client: the data lives on the PC, reached over HTTP. */
  readonly kind: 'electron' | 'web' | 'capacitor' | 'telegram'
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  notifyTest(): Promise<void>
  permission(): NotifyPermission
  requestPermission(): Promise<NotifyPermission>
  /** Android 12+: can reminders use exact alarms? `false` = the system may delay them by minutes (banner in the UI). */
  exactAlarms?(): Promise<boolean>
  /** Android 12+: opens the system "Alarms & reminders" screen; resolves with the state after the user returns. */
  requestExactAlarms?(): Promise<boolean>
  onFocusTask(cb: (taskId: string) => void): () => void
  onReminded(cb: (taskId: string) => void): () => void
  /** Platform veriyi kendisi değiştirdiyse (Telegram komutu, takvimden içe aktarma) arayüzü günceller. */
  onDataChanged?(cb: (data: AppData) => void): () => void
  /** Telegram'a test mesajı gönderir; hata varsa metnini döndürür. */
  telegramTest?(): Promise<{ ok: boolean; error?: string }>
  /** Bot state for the Settings status line (Electron only; absent → no bot on this platform). */
  telegramStatus?(): Promise<TelegramStatus>
  onTelegramStatus?(cb: (s: TelegramStatus) => void): () => void
  /** Takvim bağlantıları (Google + ICS). Yoksa takvim özellikleri gizlenir. */
  calendar?: CalendarApi
  /** Cross-device sync (#16). Missing → Settings hides the Sync group. */
  sync?: SyncApi
  /** Electron-only features; Settings shows the "Desktop" group only when present. */
  desktop?: DesktopApi
  /** Text shared from another app (Android share target); the UI opens a prefilled task editor. */
  onShare?(cb: (payload: SharePayload) => void): () => void
  /** Remote data connection (Telegram Mini App). Missing → the data is local and always available. */
  connection?: ConnectionApi
}

declare global {
  interface Window {
    tidi?: HyperDoApi
  }
}
