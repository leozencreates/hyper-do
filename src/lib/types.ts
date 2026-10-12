import type { Lang } from './i18n'

export type Priority = 'high' | 'medium' | 'low'
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
/** Pano (Kanban) sütunu; "bitti" sütunu completedAt ile belirlenir. */
export type Status = 'todo' | 'doing' | 'waiting'
export type SortMode = 'smart' | 'due' | 'priority' | 'created' | 'alpha' | 'manual'
export type Theme = 'dark' | 'light' | 'system'

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
  language: 'tr',
  escalateOverdue: true,
  flashWindow: true,
  showWindowOnRemind: false,
  funTitles: true,
  defaultRemindEveryMin: 20,
  quietHours: { enabled: false, from: '23:00', to: '08:00' },
  telegram: { enabled: false, token: '', chatId: '' },
  theme: 'dark',
  sort: 'smart',
}

/** Platform köprüsü: Electron preload veya tarayıcı uyarlaması bunu sağlar. */
export interface HyperDoApi {
  readonly kind: 'electron' | 'web' | 'capacitor'
  load(): Promise<AppData>
  save(data: AppData): Promise<void>
  notifyTest(): Promise<void>
  /** Web: bildirim izni durumu. Electron: her zaman 'granted'. */
  permission(): 'granted' | 'denied' | 'default' | 'unsupported'
  requestPermission(): Promise<'granted' | 'denied' | 'default' | 'unsupported'>
  onFocusTask(cb: (taskId: string) => void): () => void
  onReminded(cb: (taskId: string) => void): () => void
  /** Ana süreç veriyi kendisi değiştirdiyse (Telegram komutu vb.) arayüzü günceller. */
  onDataChanged?(cb: (data: AppData) => void): () => void
  /** Telegram'a test mesajı gönderir; hata varsa metnini döndürür. */
  telegramTest?(): Promise<{ ok: boolean; error?: string }>
}

declare global {
  interface Window {
    tidi?: HyperDoApi
  }
}
