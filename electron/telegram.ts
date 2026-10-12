/**
 * Telegram botu (Electron ana süreci).
 *
 * - Hatırlatmaları chat'e gönderir; mesajın altında "Bitirdim / 30 dk / 1 sa / Odak" butonları vardır.
 * - Long-polling (getUpdates) ile komutları dinler: /start /list /done /snooze /focus /add /help.
 * - İlk /start yazan sohbet bağlanır (chatId kaydedilir); sonra yalnızca o sohbet dinlenir.
 *
 * Harici kütüphane yok; Node 18+ global fetch yeter.
 */
import type { AppData, Task } from '../src/lib/types'
import { completeTask, newTask, openTasksSorted, priorityIcon } from '../src/lib/tasks'
import { translate, type Key } from '../src/lib/i18n'
import { formatDue } from '../src/lib/dates'

export interface TelegramHost {
  getData(): AppData
  /** Veriyi değiştirip kaydeder ve arayüzü günceller. */
  mutate(fn: (d: AppData) => AppData): void
}

interface TgUpdate {
  update_id: number
  message?: { message_id: number; chat: { id: number }; text?: string }
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number }; text?: string } }
}

interface InlineButton {
  text: string
  callback_data: string
}

export class TelegramBot {
  private host: TelegramHost
  private abort: AbortController | null = null
  private offset = 0
  private running = false
  private activeToken = ''
  /** /list çıktısındaki numara → görev id (komutlarda /done 2 gibi kullanılır) */
  private listIndex: string[] = []

  constructor(host: TelegramHost) {
    this.host = host
  }

  private get settings() {
    return this.host.getData().settings
  }

  private t(key: Key, vars?: Record<string, string | number>) {
    return translate(this.settings.language, key, vars)
  }

  /** Ayarlar değiştiğinde çağır: token/enabled durumuna göre dinlemeyi başlatır veya durdurur. */
  sync() {
    const { enabled, token } = this.settings.telegram
    const shouldRun = enabled && token.trim().length > 0
    if (shouldRun && (!this.running || this.activeToken !== token)) {
      this.stop()
      this.start(token)
    } else if (!shouldRun && this.running) {
      this.stop()
    }
  }

  private start(token: string) {
    this.running = true
    this.activeToken = token
    this.abort = new AbortController()
    void this.pollLoop(this.abort.signal)
  }

  stop() {
    this.running = false
    this.abort?.abort()
    this.abort = null
  }

  // ---- HTTP ----
  private async api<T = unknown>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.activeToken || this.settings.telegram.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`)
    return json.result as T
  }

  private async send(chatId: string | number, text: string, buttons?: InlineButton[][]) {
    const body: Record<string, unknown> = { chat_id: chatId, text }
    if (buttons) body.reply_markup = { inline_keyboard: buttons }
    return this.api<{ message_id: number }>('sendMessage', body)
  }

  private get linkedChat(): string {
    return this.settings.telegram.chatId
  }

  // ---- Dışa açık işlemler ----
  /** Hatırlatma gönder (tick'ten çağrılır). Bağlı sohbet yoksa sessizce geçer. */
  async remind(task: Task, title: string, body: string) {
    if (!this.running || !this.linkedChat) return
    try {
      await this.send(this.linkedChat, `${title}\n${body}`, this.taskButtons(task.id))
    } catch (e) {
      console.error('[telegram] remind failed:', (e as Error).message)
    }
  }

  /** Ayarlar panelindeki test düğmesi. */
  async test(): Promise<{ ok: boolean; error?: string }> {
    const { token, chatId } = this.settings.telegram
    if (!token.trim()) return { ok: false, error: 'token' }
    if (!chatId) return { ok: false, error: this.t('tg_waiting') }
    try {
      this.activeToken = token
      await this.send(chatId, `${this.t('notif_test_title')}\n${this.t('notif_test_body')}`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  private taskButtons(id: string): InlineButton[][] {
    return [
      [
        { text: this.t('tg_btn_done'), callback_data: `done:${id}` },
        { text: this.t('tg_btn_30'), callback_data: `snooze:${id}:30` },
        { text: this.t('tg_btn_60'), callback_data: `snooze:${id}:60` },
        { text: this.t('tg_btn_focus'), callback_data: `focus:${id}` },
      ],
    ]
  }

  // ---- Long polling ----
  private async pollLoop(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const updates = await this.api<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, signal)
        for (const u of updates) {
          this.offset = u.update_id + 1
          try {
            await this.handle(u)
          } catch (e) {
            console.error('[telegram] handle failed:', (e as Error).message)
          }
        }
      } catch (e) {
        if (signal.aborted) return
        console.error('[telegram] poll failed:', (e as Error).message)
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  }

  private async handle(u: TgUpdate) {
    if (u.callback_query) return this.handleCallback(u.callback_query)
    const m = u.message
    if (!m?.text) return
    const chat = String(m.chat.id)
    const text = m.text.trim()
    const [cmdRaw, ...rest] = text.split(/\s+/)
    const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '') // "/list@botname" → "/list"
    const arg = rest.join(' ')

    // Bağlanma: ilk /start yazan sohbet sahibi olur.
    if (cmd === '/start') {
      if (!this.linkedChat || this.linkedChat === chat) {
        if (!this.linkedChat) {
          this.host.mutate((d) => ({ ...d, settings: { ...d.settings, telegram: { ...d.settings.telegram, chatId: chat } } }))
        }
        await this.send(chat, `${this.t('tg_hello')}\n\n${this.t('tg_help')}`)
      } else {
        await this.send(chat, this.t('tg_not_linked'))
      }
      return
    }
    if (chat !== this.linkedChat) return // yabancı sohbetleri yoksay

    switch (cmd) {
      case '/help':
        return this.send(chat, this.t('tg_help'))
      case '/list':
      case '/l':
        return this.sendList(chat)
      case '/done':
      case '/d': {
        const task = this.byIndex(arg)
        if (!task) return this.send(chat, this.t('tg_bad_index'))
        this.host.mutate((d) => ({ ...d, tasks: completeTask(d.tasks, task.id) }))
        return this.send(chat, this.t('tg_done_ok', { title: task.title }))
      }
      case '/snooze':
      case '/s': {
        const [idx, minStr] = arg.split(/\s+/)
        const task = this.byIndex(idx)
        if (!task) return this.send(chat, this.t('tg_bad_index'))
        const mins = Math.max(1, Number(minStr) || 30)
        this.snooze(task.id, mins)
        return this.send(chat, this.t('tg_snoozed', { n: mins, title: task.title }))
      }
      case '/focus':
      case '/f': {
        const task = this.byIndex(arg)
        if (!task) return this.send(chat, this.t('tg_bad_index'))
        this.focus(task.id)
        return this.send(chat, this.t('tg_focused', { title: task.title }))
      }
      case '/add':
      case '/a':
        return this.add(chat, arg)
      default:
        if (text.startsWith('/')) return this.send(chat, this.t('tg_help'))
        return this.add(chat, text) // düz metin = hızlı ekle
    }
  }

  private async handleCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const chat = q.message ? String(q.message.chat.id) : ''
    const ack = (text?: string) => this.api('answerCallbackQuery', { callback_query_id: q.id, text }).catch(() => {})
    if (!q.data || chat !== this.linkedChat) {
      await ack()
      return
    }

    const [action, id, extra] = q.data.split(':')
    const task = this.host.getData().tasks.find((x) => x.id === id)
    if (!task) {
      await ack(this.t('tg_bad_index'))
      return
    }

    let result = ''
    if (action === 'done') {
      this.host.mutate((d) => ({ ...d, tasks: completeTask(d.tasks, id) }))
      result = this.t('tg_done_ok', { title: task.title })
    } else if (action === 'snooze') {
      const mins = Math.max(1, Number(extra) || 30)
      this.snooze(id, mins)
      result = this.t('tg_snoozed', { n: mins, title: task.title })
    } else if (action === 'focus') {
      this.focus(id)
      result = this.t('tg_focused', { title: task.title })
    }
    await ack(result)
    // Hatırlatma mesajını sonuçla güncelle, butonları kaldır (bitti ise) ya da bırak
    if (q.message && result) {
      const original = q.message.text ?? ''
      const keep = action === 'done' ? undefined : { inline_keyboard: this.taskButtons(id) }
      await this.api('editMessageText', {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        text: `${original}\n\n${result}`,
        reply_markup: keep,
      }).catch(() => {})
    }
  }

  // ---- Yardımcılar ----
  private byIndex(arg: string): Task | undefined {
    const n = Number(arg)
    if (!Number.isInteger(n) || n < 1) return undefined
    const id = this.listIndex[n - 1]
    const task = id ? this.host.getData().tasks.find((x) => x.id === id) : undefined
    if (task && task.completedAt === null) return task
    // Liste eskimişse güncel sıradan dene
    return openTasksSorted(this.host.getData().tasks)[n - 1]
  }

  private snooze(id: string, mins: number) {
    const until = Date.now() + mins * 60_000
    this.host.mutate((d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === id ? { ...x, snoozedUntil: until } : x)) }))
  }

  private focus(id: string) {
    this.host.mutate((d) => ({ ...d, tasks: d.tasks.map((x) => ({ ...x, focused: x.id === id })) }))
  }

  private async add(chat: string, title: string) {
    const clean = title.trim()
    if (!clean) return this.send(chat, this.t('tg_help'))
    const task = newTask({ title: clean }, this.settings)
    this.host.mutate((d) => ({ ...d, tasks: [task, ...d.tasks] }))
    return this.send(chat, this.t('tg_added', { title: clean, n: task.remindEveryMin }), this.taskButtons(task.id))
  }

  private async sendList(chat: string) {
    const open = openTasksSorted(this.host.getData().tasks)
    this.listIndex = open.map((x) => x.id)
    if (open.length === 0) return this.send(chat, this.t('tg_list_empty'))
    const lang = this.settings.language
    const lines = open.map((x, i) => {
      const due = x.dueAt !== null ? ` · ${formatDue(x.dueAt, lang)}` : ''
      const subs = x.subtasks.filter((s) => !s.done).length
      return `${i + 1}. ${priorityIcon(x.priority)}${x.focused ? ' 🎯' : ''} ${x.title}${due}${subs ? ` · ${this.t('open_subs', { n: subs })}` : ''}`
    })
    return this.send(chat, `${this.t('tg_list_title', { n: open.length })}\n${lines.join('\n')}`)
  }
}
