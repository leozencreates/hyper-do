import type { Lang } from './i18n'

export type Priority = 'high' | 'medium' | 'low'
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
/** Pano (Kanban) sütunu; "bitti" sütunu completedAt ile belirlenir. */
export type Status = 'todo' | 'doing' | 'waiting'
export type SortMode = 'smart' | 'due' | 'priority' | 'created' | 'alpha' | 'manual'
export type Theme = 'dark' | 'light' | 'system'
/** Web/Android: bildirim izni durumu. Electron: her zaman 'granted'. */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

// Seçenek listeleri (arayüzdeki sıra ile)
export const PRIORITIES: Priority[] = ['high', 'medium', 'low']
export const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly']
export const STATUSES: Status[] = ['todo', 'doing', 'waiting']
export const SORT_MODES: SortMode[] = ['smart', 'due', 'priority', 'created', 'alpha', 'manual']
export const THEMES: Theme[] = ['dark', 'light', 'system']

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
}

export interface GoogleCalendarSettings {
  /** OAuth 2.0 client created by the user in Google Cloud Console (same idea as the Telegram bot token). */
  clientId: string
  /** Google requires the secret at the token endpoint even for Desktop-app clients; it is not treated as confidential. */
  clientSecret: string
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
}

export interface AppData {
  tasks: Task[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'en',
  escalateOverdue: true,
  flashWindow: true,
  showWindowOnRemind: false,
  funTitles: true,
  defaultRemindEveryMin: 20,
  quietHours: { enabled: false, from: '23:00', to: '08:00' },
  telegram: { enabled: false, token: '', chatId: '' },
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
      pushTasks: false,
      hiddenCalendarIds: [],
    },
    feeds: [],
  },
}

/** Platform köprüsü: Electron preload veya tarayıcı uyarlaması bunu sağlar. */
export interface HyperDoApi {
  readonly kind: 'electron' | 'web' | 'capacitor'
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  notifyTest(): Promise<void>
  permission(): NotifyPermission
  requestPermission(): Promise<NotifyPermission>
  onFocusTask(cb: (taskId: string) => void): () => void
  onReminded(cb: (taskId: string) => void): () => void
  /** Platform veriyi kendisi değiştirdiyse (Telegram komutu, takvimden içe aktarma) arayüzü günceller. */
  onDataChanged?(cb: (data: AppData) => void): () => void
  /** Telegram'a test mesajı gönderir; hata varsa metnini döndürür. */
  telegramTest?(): Promise<{ ok: boolean; error?: string }>
  /** Takvim bağlantıları (Google + ICS). Yoksa takvim özellikleri gizlenir. */
  calendar?: CalendarApi
}

declare global {
  interface Window {
    tidi?: HyperDoApi
  }
}
