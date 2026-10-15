/**
 * Telegram bot — transport (Electron main process).
 *
 * Long polling (`getUpdates`), HTTP, status for the Settings panel, the "/" commands menu, the pairing
 * code and the message bookkeeping (one live reminder / card per task, reply → task resolution).
 * *What* to answer is decided by the pure layer `src/lib/telegram-commands.ts`.
 * No `electron` import on purpose: the fake-API test (`electron/telegram.test.ts`) runs this under Vitest.
 * Electron-only facts (system idle time) reach the bot through `TelegramHost`.
 *
 * Harici kütüphane yok; Node 18+ global fetch / FormData / Blob yeter.
 */
import { randomInt } from 'node:crypto'
import type { AppData, Task, TelegramStatus } from '../src/lib/types'
import { translate, type Lang } from '../src/lib/i18n'
import {
  botCommands,
  completedHtml,
  digestReply,
  escapeHtml,
  handleCallback,
  handleMessage,
  miniAppLink,
  reminderText,
  shouldSendToTelegram,
  taskButtons,
  type TgDocument,
  type TgEffect,
  type TgContext,
  type TgInlineButton,
} from '../src/lib/telegram-commands'
import type { DigestKind } from '../src/lib/digest'

export interface TelegramHost {
  getData(): AppData
  /** Veriyi değiştirip kaydeder ve arayüzü günceller. */
  mutate(fn: (d: AppData) => AppData): void
  /** Status changes (off / starting / running / error) → Settings panel. */
  onStatus?(s: TelegramStatus): void
  /** B3: seconds since the last input on the PC; `Infinity` while the session is locked. Absent = always "idle". */
  idleSeconds?(): number
}

export interface TelegramBotOptions {
  /** Bot API origin; tests point it at a local fake server. Default `https://api.telegram.org`. */
  apiBase?: string
  /** `getUpdates` long-poll timeout in seconds (default 25; 0 in tests). */
  pollTimeoutSec?: number
}

interface TgMessage {
  message_id: number
  chat: { id: number }
  text?: string
  /** C4: the message this one replies to. */
  reply_to_message?: { message_id: number }
  /** C5: forwarded message markers (Bot API 7+ / legacy). */
  forward_origin?: unknown
  forward_date?: number
}

interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: { id: string; data?: string; message?: TgMessage }
}

/** A message the bot sent about one task: the live reminder / card (buttons) or a confirmation (replies attach). */
interface LiveMessage {
  chatId: string
  messageId: number
  /** The HTML we sent (Telegram returns plain text + entities, so edits rebuild from this). */
  html: string
  sentAt: number
  kind: 'reminder' | 'card'
  buttons?: TgInlineButton[][]
}

/** A Bot API failure with the HTTP status / `error_code` (401 bad token, 409 another poller, …). */
export class TgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'TgApiError'
  }
}

const BACKOFF_MIN = 5_000
const BACKOFF_MAX = 60_000
const CONFLICT_RETRY = 30_000
/** Telegram lets bots delete their own messages for 48 h; stay below it. */
const DELETE_MAX_AGE = 47 * 3_600_000
/** The reverse map (message id → task id) keeps this many newest entries. */
const MESSAGE_MAP_MAX = 500

/** Resolves after `ms` or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/** Six digits, never starting with 0 (so it survives being typed as a number). */
export const newPairCode = () => String(randomInt(100_000, 1_000_000))

export class TelegramBot {
  private host: TelegramHost
  private apiBase: string
  private pollTimeoutSec: number
  private abort: AbortController | null = null
  private offset = 0
  private running = false
  /** Polling halted after a rejected token (401/404); stays halted until the token changes. */
  private halted = false
  private activeToken = ''
  /** Language the "/" menu was last pushed with (`setMyCommands`), so `sync()` does not spam the API. */
  private appliedLang: Lang | null = null
  private backoff = BACKOFF_MIN
  /** /list çıktısındaki numara → görev id (komutlarda /done 2 gibi kullanılır) */
  private listIndex: string[] = []
  private st: TelegramStatus = { state: 'off', error: null, username: '', lastPollAt: null }
  /** B1/C3: the one message with live buttons per task (restart loses it — acceptable). */
  private live = new Map<string, LiveMessage>()
  /** C4: every message id the bot sent about a task → task id (newest `MESSAGE_MAP_MAX`). */
  private byMessage = new Map<number, string>()
  /** Task whose callback is being handled: `onDataChanged` leaves its message to the callback path. */
  private handling: string | null = null
  /** D4: public origin of the Mini App while a tunnel is up (keyboards get the "📱 Open in app" row), else null. */
  private miniAppUrl: string | null = null
  /** `<chat>|<url or default>` last pushed with `setChatMenuButton`, so saves / URL changes only call the API on change. */
  private appliedMenu: string | null = null

  constructor(host: TelegramHost, opts: TelegramBotOptions = {}) {
    this.host = host
    this.apiBase = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/+$/, '')
    this.pollTimeoutSec = opts.pollTimeoutSec ?? 25
  }

  private get settings() {
    return this.host.getData().settings
  }

  private get linkedChat(): string {
    return this.settings.telegram.chatId
  }

  // ---- Status ----
  status(): TelegramStatus {
    return { ...this.st }
  }

  private setStatus(patch: Partial<TelegramStatus>) {
    this.st = { ...this.st, ...patch }
    this.host.onStatus?.(this.status())
  }

  // ---- Lifecycle ----
  /**
   * Ayarlar değiştiğinde çağır (her kayıttan sonra): token/enabled durumuna göre dinlemeyi başlatır veya
   * durdurur, dil değiştiyse menüyü günceller, bağlı sohbet yokken eşleştirme kodu üretir.
   */
  sync() {
    const { enabled, token, chatId, pairCode } = this.settings.telegram
    const shouldRun = enabled && token.trim().length > 0
    if (shouldRun && (!this.running || this.activeToken !== token)) {
      this.stop()
      this.start(token)
    } else if (!shouldRun && this.running) {
      this.stop()
    }
    if (this.running && !this.halted && this.appliedLang !== null && this.appliedLang !== this.settings.language) void this.applyCommands()
    // D4: the chat menu button follows the linked chat (re-applied after pairing) and the Mini App URL
    if (this.running && !this.halted && this.appliedLang !== null) void this.applyMenuButton()
    // Pairing (A5): a fresh 6-digit code whenever the bot is on but nothing is linked and no code exists.
    // `mutate` re-enters `sync()` through the host's save path; by then the code is set, so this is a one-off.
    if (shouldRun && !chatId && !pairCode) {
      const code = newPairCode()
      this.host.mutate((d) => ({ ...d, settings: { ...d.settings, telegram: { ...d.settings.telegram, pairCode: code } } }))
    }
  }

  private start(token: string) {
    if (token !== this.activeToken) this.offset = 0
    this.running = true
    this.halted = false
    this.activeToken = token
    this.appliedLang = null
    this.appliedMenu = null
    this.backoff = BACKOFF_MIN
    const ac = new AbortController()
    this.abort = ac
    this.setStatus({ state: 'starting', error: null, username: this.settings.telegram.botUsername, lastPollAt: null })
    void this.run(ac.signal)
  }

  stop() {
    const was = this.running
    this.running = false
    this.halted = false
    this.abort?.abort()
    this.abort = null
    if (was || this.st.state !== 'off') this.setStatus({ state: 'off', error: null, lastPollAt: null })
  }

  // ---- HTTP ----
  private async api<T = unknown>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    return this.request<T>(method, { 'content-type': 'application/json' }, JSON.stringify(body), signal)
  }

  /** Multipart call (`sendDocument`): the runtime sets the boundary header itself. */
  private async apiForm<T = unknown>(method: string, form: FormData): Promise<T> {
    return this.request<T>(method, {}, form)
  }

  private async request<T>(method: string, headers: Record<string, string>, body: string | FormData, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.apiBase}/bot${this.activeToken || this.settings.telegram.token}/${method}`, { method: 'POST', headers, body, signal })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string; error_code?: number } | null
    if (!res.ok || !json?.ok) throw new TgApiError(json?.description ?? `HTTP ${res.status}`, json?.error_code ?? res.status)
    return json.result as T
  }

  private async send(chatId: string | number, text: string, buttons?: TgInlineButton[][]) {
    const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' }
    if (buttons) body.reply_markup = { inline_keyboard: buttons }
    return this.api<{ message_id: number }>('sendMessage', body)
  }

  private async edit(msg: Pick<LiveMessage, 'chatId' | 'messageId'>, text: string, buttons?: TgInlineButton[][]) {
    await this.api('editMessageText', {
      chat_id: msg.chatId,
      message_id: msg.messageId,
      text,
      parse_mode: 'HTML',
      ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
    })
  }

  private async removeButtons(msg: Pick<LiveMessage, 'chatId' | 'messageId'>) {
    await this.api('editMessageReplyMarkup', { chat_id: msg.chatId, message_id: msg.messageId, reply_markup: { inline_keyboard: [] } })
  }

  private async sendDocument(chatId: string, doc: TgDocument) {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', doc.caption)
    form.append('document', new Blob([doc.content], { type: doc.mime }), doc.filename)
    return this.apiForm<{ message_id: number }>('sendDocument', form)
  }

  // ---- Message bookkeeping (B1 / C3 / C4) ----
  private remember(messageId: number, taskId: string) {
    this.byMessage.delete(messageId)
    this.byMessage.set(messageId, taskId)
    while (this.byMessage.size > MESSAGE_MAP_MAX) {
      const oldest = this.byMessage.keys().next().value
      if (oldest === undefined) break
      this.byMessage.delete(oldest)
    }
  }

  /**
   * Makes `msg` the live message of its task. The previous one is tidied first: when a new *reminder* replaces an
   * older reminder younger than 47 h and `settings.telegram.tidy` is on, the old one is deleted (fallback: buttons
   * removed); in every other case (cards, confirmations) the previous message only loses its buttons.
   */
  private async setLive(taskId: string, msg: LiveMessage) {
    const prev = this.live.get(taskId)
    this.live.set(taskId, msg)
    this.remember(msg.messageId, taskId)
    if (!prev || prev.messageId === msg.messageId) return
    if (msg.kind === 'reminder' && prev.kind === 'reminder' && this.settings.telegram.tidy && msg.sentAt - prev.sentAt < DELETE_MAX_AGE) {
      try {
        await this.api('deleteMessage', { chat_id: prev.chatId, message_id: prev.messageId })
        this.byMessage.delete(prev.messageId)
        return
      } catch {
        /* too old or already gone: fall back to removing the keyboard */
      }
    }
    await this.removeButtons(prev).catch(() => {})
  }

  /** Message ids known for a task (test / diagnostics). */
  liveMessage(taskId: string): { chatId: string; messageId: number } | null {
    const m = this.live.get(taskId)
    return m ? { chatId: m.chatId, messageId: m.messageId } : null
  }

  // ---- Mini App (D4) ----
  /** Current Mini App origin (null = none); keyboards built from now on include / omit the "Open in app" row. */
  get appUrl(): string | undefined {
    return this.miniAppUrl ?? undefined
  }

  /**
   * Called by the host when the tunnel URL changes (null when the Mini App is off). Remembers the origin for every
   * keyboard built later and sets the linked chat's ☰ menu button to the Mini App (`web_app`) or back to default.
   */
  setMiniAppUrl(url: string | null) {
    const next = url ? url.trim().replace(/\/+$/, '') || null : null
    if (next === this.miniAppUrl) return
    this.miniAppUrl = next
    if (this.running && !this.halted) void this.applyMenuButton()
  }

  /** `setChatMenuButton` for the linked chat, only when the (chat, url) pair differs from the last successful call. */
  private async applyMenuButton(signal?: AbortSignal) {
    const chat = this.linkedChat
    if (!chat) return
    const want = `${chat}|${this.miniAppUrl ?? 'default'}`
    if (want === this.appliedMenu) return
    const menu_button = this.miniAppUrl ? { type: 'web_app', text: 'Hyper Do', web_app: { url: miniAppLink(this.miniAppUrl) } } : { type: 'default' }
    try {
      await this.api('setChatMenuButton', { chat_id: chat, menu_button }, signal)
      this.appliedMenu = want
    } catch (e) {
      if (!signal?.aborted) console.error('[telegram] setChatMenuButton failed:', (e as Error).message)
    }
  }

  // ---- Dışa açık işlemler ----
  /**
   * Hatırlatma gönder (tick'ten çağrılır). Bağlı sohbet yoksa, bot duruyorsa ya da (B3) bilgisayar kullanımdaysa
   * sessizce geçer. B1: the task's previous reminder is tidied before the new one goes out.
   */
  async remind(task: Task, title: string, body: string) {
    if (!this.running || this.halted || !this.linkedChat) return
    if (!shouldSendToTelegram(this.settings, this.host.idleSeconds?.() ?? Infinity)) return
    try {
      const chat = this.linkedChat
      const html = reminderText(task, title, body, this.settings)
      const buttons = taskButtons(task.id, this.settings.language, this.appUrl)
      const sent = await this.send(chat, html, buttons)
      await this.setLive(task.id, { chatId: chat, messageId: sent.message_id, html, sentAt: Date.now(), kind: 'reminder', buttons })
    } catch (e) {
      console.error('[telegram] remind failed:', (e as Error).message)
    }
  }

  /**
   * B2: called by the host after every commit (any source). Tasks with a live message that were completed get
   * `<s>title</s> ✓` without buttons; tasks that disappeared lose their buttons. Never mutates the data.
   */
  onDataChanged(prev: AppData, next: AppData) {
    if (this.live.size === 0) return
    for (const [taskId, msg] of [...this.live]) {
      if (taskId === this.handling) continue
      const before = prev.tasks.find((t) => t.id === taskId)
      const after = next.tasks.find((t) => t.id === taskId)
      if (after && after.completedAt !== null && (!before || before.completedAt === null)) {
        this.live.delete(taskId)
        void this.edit(msg, completedHtml(msg.html, after.title)).catch(() => {})
      } else if (!after && before) {
        this.live.delete(taskId)
        void this.removeButtons(msg).catch(() => {})
      }
    }
  }

  /** C6: the daily digest to the linked chat, with number buttons for the listed tasks. */
  async sendDigest(kind: DigestKind) {
    if (!this.running || this.halted || !this.linkedChat) return
    try {
      await this.apply(this.linkedChat, digestReply(this.host.getData(), Date.now(), kind, this.appUrl))
    } catch (e) {
      console.error('[telegram] digest failed:', (e as Error).message)
    }
  }

  /** Ayarlar panelindeki test düğmesi. */
  async test(): Promise<{ ok: boolean; error?: string }> {
    const { token, chatId } = this.settings.telegram
    const lang = this.settings.language
    if (!token.trim()) return { ok: false, error: 'token' }
    if (!chatId) return { ok: false, error: translate(lang, 'tg_waiting') }
    try {
      this.activeToken = token
      await this.send(chatId, `<b>${escapeHtml(translate(lang, 'notif_test_title'))}</b>\n${escapeHtml(translate(lang, 'notif_test_body'))}`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---- Bootstrap: getMe (username for the pairing link) → setMyCommands → long polling ----
  private async run(signal: AbortSignal) {
    try {
      const me = await this.api<{ username?: string }>('getMe', {}, signal)
      const username = me.username ?? ''
      this.setStatus({ username })
      if (username && username !== this.settings.telegram.botUsername) {
        this.host.mutate((d) => ({ ...d, settings: { ...d.settings, telegram: { ...d.settings.telegram, botUsername: username } } }))
      }
    } catch (e) {
      if (signal.aborted) return
      const delay = this.onFailure(e)
      if (delay === null) return // token rejected: halted
      await sleep(delay, signal)
    }
    await this.applyCommands(signal)
    await this.applyMenuButton(signal)
    await this.pollLoop(signal)
  }

  /** Pushes `botCommands(lang)` to the "/" menu; remembers the language so `sync()` only repeats it on change. */
  private async applyCommands(signal?: AbortSignal) {
    const lang = this.settings.language
    try {
      await this.api('setMyCommands', { commands: botCommands(lang) }, signal)
      this.appliedLang = lang
    } catch (e) {
      if (!signal?.aborted) console.error('[telegram] setMyCommands failed:', (e as Error).message)
    }
  }

  /**
   * Status + retry policy for a failed API call. Returns the delay before the next attempt, or null when polling
   * must stop: 401/404 = bad token (until the token changes); 409 = another instance polls this bot (retry 30 s);
   * anything else (network) = exponential backoff 5 s → 60 s.
   */
  private onFailure(e: unknown): number | null {
    const status = e instanceof TgApiError ? e.status : 0
    const lang = this.settings.language
    if (status === 401 || status === 404) {
      this.halted = true
      this.setStatus({ state: 'error', error: translate(lang, 'tg_err_token') })
      return null
    }
    if (status === 409) {
      this.setStatus({ state: 'error', error: translate(lang, 'tg_err_conflict') })
      return CONFLICT_RETRY
    }
    this.setStatus({ state: 'error', error: (e as Error).message || String(e) })
    const delay = this.backoff
    this.backoff = Math.min(BACKOFF_MAX, this.backoff * 2)
    return delay
  }

  // ---- Long polling ----
  private async pollLoop(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const updates = await this.api<TgUpdate[]>('getUpdates', { offset: this.offset, timeout: this.pollTimeoutSec, allowed_updates: ['message', 'callback_query'] }, signal)
        this.backoff = BACKOFF_MIN
        this.setStatus({ state: 'running', error: null, lastPollAt: Date.now() })
        for (const u of updates) {
          this.offset = u.update_id + 1
          try {
            await this.handle(u)
          } catch (e) {
            console.error('[telegram] handle failed:', (e as Error).message)
          }
        }
        // Without a long-poll timeout the loop would hammer the API; breathe between empty polls.
        if (updates.length === 0 && this.pollTimeoutSec === 0) await sleep(25, signal)
      } catch (e) {
        if (signal.aborted) return
        const delay = this.onFailure(e)
        if (delay === null) return
        await sleep(delay, signal)
      }
    }
  }

  private ctx(chatId: string, extra: Partial<TgContext> = {}): TgContext {
    return { data: this.host.getData(), now: Date.now(), chatId, listIndex: this.listIndex, appUrl: this.appUrl, ...extra }
  }

  /** Applies an effect from the pure layer: numbering, data change (first), then the replies and documents. */
  private async apply(chat: string, effect: TgEffect) {
    if (effect.listIndex) this.listIndex = effect.listIndex
    if (effect.mutate) this.host.mutate(effect.mutate)
    for (const r of effect.replies) {
      const sent = await this.send(chat, r.text, r.buttons)
      if (r.taskId) {
        // a reply about one task becomes its live message when it carries buttons (card / confirmation), otherwise it is only remembered for replies
        if (r.buttons) await this.setLive(r.taskId, { chatId: chat, messageId: sent.message_id, html: r.text, sentAt: Date.now(), kind: 'card', buttons: r.buttons })
        else this.remember(sent.message_id, r.taskId)
      }
    }
    for (const doc of effect.documents ?? []) await this.sendDocument(chat, doc)
  }

  private async handle(u: TgUpdate) {
    if (u.callback_query) return this.onCallback(u.callback_query)
    const m = u.message
    if (!m?.text) return
    const chat = String(m.chat.id)
    const replyTo = m.reply_to_message ? (this.byMessage.get(m.reply_to_message.message_id) ?? null) : null
    const forwarded = m.forward_origin !== undefined || typeof m.forward_date === 'number'
    await this.apply(chat, handleMessage(m.text, this.ctx(chat, { replyToTaskId: replyTo, forwarded })))
  }

  private async onCallback(q: NonNullable<TgUpdate['callback_query']>) {
    const chat = q.message ? String(q.message.chat.id) : ''
    const taskId = q.data?.split(':')[1] ?? ''
    const r = q.data ? handleCallback(q.data, this.ctx(chat)) : null
    await this.api('answerCallbackQuery', { callback_query_id: q.id, ...(r?.toast ? { text: r.toast } : {}) }).catch(() => {})
    if (!r) return
    this.handling = taskId
    try {
      await this.apply(chat, r.effect)
    } finally {
      this.handling = null
    }
    if (!q.message) return
    const ref = { chatId: chat, messageId: q.message.message_id }
    const known = this.live.get(taskId)
    const stored = known && known.messageId === q.message.message_id ? known : null
    if (r.edit) {
      // C3: cards re-render in place and (re)register as the task's live message
      await this.edit(ref, r.edit.text, r.edit.buttons).catch(() => {})
      if (stored) {
        stored.html = r.edit.text
        stored.buttons = r.edit.buttons
      } else if (taskId) {
        await this.setLive(taskId, { ...ref, html: r.edit.text, sentAt: Date.now(), kind: 'card', buttons: r.edit.buttons })
      }
      return
    }
    if (r.append) {
      // Rebuild from the HTML we sent (Telegram hands the original back as plain text); unknown messages are re-escaped.
      const base = stored?.html ?? escapeHtml(q.message.text ?? '')
      const text = `${base}\n\n${r.append}`
      const buttons = r.keepButtons ? (stored?.buttons ?? taskButtons(taskId, this.settings.language, this.appUrl)) : undefined
      await this.edit(ref, text, buttons).catch(() => {})
      if (stored) stored.html = text
      if (!r.keepButtons) this.live.delete(taskId)
      return
    }
    if (!r.keepButtons) {
      await this.removeButtons(ref).catch(() => {})
      if (stored) this.live.delete(taskId)
    }
  }
}
