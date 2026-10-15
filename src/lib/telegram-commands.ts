/**
 * Telegram bot — pure command layer (no Electron, no React, no network).
 *
 * Everything that decides *what* to answer lives here; `electron/telegram.ts` only transports
 * (long polling, HTTP, message-id bookkeeping). Reply texts are Telegram HTML (`parse_mode: 'HTML'`):
 * every user-provided string (titles, tags, notes, parser output) goes through `escapeHtml`. Callback toasts
 * (`answerCallbackQuery`) are plain text and are NOT escaped.
 *
 * Commands (see `COMMANDS`; `/help` and the "/" menu both come from `botCommands()`):
 *   Tasks      /add … (/a) · /done N [N…] (/d) · /snooze N [M | date] (/s) · /focus N (/f) · /due N <date> · /prio N 1|2|3 ·
 *              /every N <min>|off · /sub N <text> · /note N <text> · /rename N <text> · /del N · /undo
 *   Views      /list (/l) · /today · /week · /overdue · /search <text> · /stats
 *   Reminders  /mute [2h|45m|off] · /quiet [on|off]
 *   Other      /backup · /help · /start [code]
 * Plain text is a quick add; a reply to a known message attaches a subtask (or a note with `note:`);
 * forwarded messages and links become tasks with the text in the notes (C5).
 *
 * Callbacks: done:<id> · snooze:<id>:<min|tomorrow> · focus:<id> · pick:<id> (task card) · sub:<taskId>:<subId> ·
 * prio:<id> · del:<id>[:yes|:no].
 */
import type { AppData, Priority, Settings, Task } from './types'
import { LOCALE, translate, type Key, type Lang } from './i18n'
import { matchesQuery, openTasksSorted, priorityIcon, taskFromQuickAdd, uid } from './tasks'
import { parseQuickAdd } from './parse'
import { addDays, dayKey, endOfDay, formatDue, formatMinutes, isThisWeek, isToday, recurrenceText, startOfDay } from './dates'
import { escalationLevel, resetNag } from './reminder'
import { completeInData, doneInLastDays, focusMinutes, recordReopen, streak } from './stats'
import { buildDigest, type DigestKind } from './digest'

/** One inline button: either a callback (`callback_data`) or a Mini App launcher (`web_app`, Phase D). */
export interface TgInlineButton {
  text: string
  callback_data?: string
  web_app?: { url: string }
}

/** One outgoing message; `text` is HTML. `taskId` registers the message as that task's live card/confirmation (replies attach to it). */
export interface TgReply {
  text: string
  buttons?: TgInlineButton[][]
  taskId?: string
}

/** A file to send with `sendDocument` (C7 `/backup`). */
export interface TgDocument {
  filename: string
  content: string
  mime: string
  /** Plain text caption. */
  caption: string
}

export interface TgEffect {
  /** Data change to apply through `TelegramHost.mutate` (before the replies are sent). */
  mutate?: (d: AppData) => AppData
  /** 0..n messages to send (long lists are split, see `chunkText`). */
  replies: TgReply[]
  /** New /list numbering (index → task id) when a list was produced. */
  listIndex?: string[]
  /** Documents to send after the replies. */
  documents?: TgDocument[]
}

export interface TgContext {
  data: AppData
  now: number
  /** Chat the update came from (Telegram chat id as a string). */
  chatId: string
  /** Numbering of the last /list: index → task id (may be stale, see `byIndex`). */
  listIndex: string[]
  /** C4: the task of the message this one replies to (resolved by the transport), or null / absent. */
  replyToTaskId?: string | null
  /** C5: the message was forwarded (`forward_origin` / `forward_date`). */
  forwarded?: boolean
  /** D4: public origin of the Mini App while a tunnel is up; keyboards then get the "📱 Open in app" row. */
  appUrl?: string
}

export interface TgCallbackResult {
  effect: TgEffect
  /** Plain text for `answerCallbackQuery` ('' = silent acknowledgement). */
  toast: string
  /** Keep the task buttons under the original message (false after "done" / delete; with no `append`/`edit` only the keyboard is removed). */
  keepButtons: boolean
  /** HTML appended to the original message; undefined = leave the text untouched. */
  append?: string
  /** Full replacement of the original message (task cards re-render in place). Takes precedence over `append`. */
  edit?: { text: string; buttons?: TgInlineButton[][] }
}

export interface TgCommand {
  command: string
  description: string
}

/** Messages longer than this are split at line boundaries (Telegram's hard limit is 4096). */
export const TG_CHUNK = 3800
/** Number buttons under lists: the first `PICK_MAX` tasks, `PICK_ROW` per row. */
export const PICK_MAX = 20
export const PICK_ROW = 5
/** Card: notes are cut after this many characters. */
export const CARD_NOTES_MAX = 300
const BUTTON_TEXT_MAX = 40
const LINK_TITLE_MAX = 80

/** Escapes `& < >` for Telegram HTML; apply to every user-provided string. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Splits `text` into pieces of at most `max` characters, only ever at line boundaries.
 * A single line longer than `max` is kept whole (it becomes its own piece). Empty input → no pieces.
 */
export function chunkText(text: string, max = TG_CHUNK): string[] {
  if (!text) return []
  const out: string[] = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur)
      cur = line
    } else {
      cur = cur ? `${cur}\n${line}` : line
    }
  }
  out.push(cur)
  return out
}

// ---- Commands & help ----

type Group = 'tasks' | 'views' | 'reminders' | 'other'
const GROUPS: { group: Group; key: Key }[] = [
  { group: 'tasks', key: 'tg_help_tasks' },
  { group: 'views', key: 'tg_help_views' },
  { group: 'reminders', key: 'tg_help_reminders' },
  { group: 'other', key: 'tg_help_other' },
]

const COMMANDS: { command: string; alias: string; args: string; key: Key; group: Group }[] = [
  { command: 'add', alias: 'a', args: '…', key: 'tg_cmd_add', group: 'tasks' },
  { command: 'done', alias: 'd', args: 'N [N…]', key: 'tg_cmd_done', group: 'tasks' },
  { command: 'snooze', alias: 's', args: 'N [M | date]', key: 'tg_cmd_snooze', group: 'tasks' },
  { command: 'focus', alias: 'f', args: 'N', key: 'tg_cmd_focus', group: 'tasks' },
  { command: 'due', alias: '', args: 'N <date>', key: 'tg_cmd_due', group: 'tasks' },
  { command: 'prio', alias: '', args: 'N 1|2|3', key: 'tg_cmd_prio', group: 'tasks' },
  { command: 'every', alias: '', args: 'N <min>|off', key: 'tg_cmd_every', group: 'tasks' },
  { command: 'sub', alias: '', args: 'N <text>', key: 'tg_cmd_sub', group: 'tasks' },
  { command: 'note', alias: '', args: 'N <text>', key: 'tg_cmd_note', group: 'tasks' },
  { command: 'rename', alias: '', args: 'N <text>', key: 'tg_cmd_rename', group: 'tasks' },
  { command: 'del', alias: '', args: 'N', key: 'tg_cmd_del', group: 'tasks' },
  { command: 'undo', alias: '', args: '', key: 'tg_cmd_undo', group: 'tasks' },
  { command: 'list', alias: 'l', args: '', key: 'tg_cmd_list', group: 'views' },
  { command: 'today', alias: '', args: '', key: 'tg_cmd_today', group: 'views' },
  { command: 'week', alias: '', args: '', key: 'tg_cmd_week', group: 'views' },
  { command: 'overdue', alias: '', args: '', key: 'tg_cmd_overdue', group: 'views' },
  { command: 'search', alias: '', args: '<text>', key: 'tg_cmd_search', group: 'views' },
  { command: 'stats', alias: '', args: '', key: 'tg_cmd_stats', group: 'views' },
  { command: 'mute', alias: '', args: '[2h|45m|off]', key: 'tg_cmd_mute', group: 'reminders' },
  { command: 'quiet', alias: '', args: '[on|off]', key: 'tg_cmd_quiet', group: 'reminders' },
  { command: 'backup', alias: '', args: '', key: 'tg_cmd_backup', group: 'other' },
  { command: 'help', alias: '', args: '', key: 'tg_cmd_help', group: 'other' },
]

/** Feeds `setMyCommands` (exactly the fields Telegram accepts) and `/help`, so menu and help never drift apart. */
export function botCommands(lang: Lang): TgCommand[] {
  return COMMANDS.map((c) => ({ command: c.command, description: translate(lang, c.key) }))
}

/** `/help` text (HTML): commands grouped Tasks · Views · Reminders · Other, aliases in brackets, plain-text hints at the end. */
export function helpText(lang: Lang): string {
  const lines: string[] = [translate(lang, 'tg_help')]
  for (const g of GROUPS) {
    lines.push('', `<b>${escapeHtml(translate(lang, g.key))}</b>`)
    for (const c of COMMANDS.filter((x) => x.group === g.group)) {
      const usage = `/${c.command}${c.args ? ` ${c.args}` : ''}${c.alias ? ` (/${c.alias})` : ''}`
      lines.push(`${escapeHtml(usage)} – ${escapeHtml(translate(lang, c.key))}`)
    }
  }
  lines.push('', escapeHtml(translate(lang, 'tg_help_plain')), escapeHtml(translate(lang, 'tg_help_reply')))
  return lines.join('\n')
}

// ---- Buttons & reminder text ----

/** Mini App page for a public origin: `<origin>/tg.html`, with `?task=<id>` when a task should open right away (D4). */
export function miniAppLink(appUrl: string, taskId?: string): string {
  const base = `${appUrl.replace(/\/+$/, '')}/tg.html`
  return taskId ? `${base}?task=${encodeURIComponent(taskId)}` : base
}

/** The `📱 Open in app` row (a `web_app` button) for keyboards while the Mini App is reachable. */
export function openAppRow(lang: Lang, appUrl: string, taskId?: string): TgInlineButton[] {
  return [{ text: translate(lang, 'tg_btn_open_app'), web_app: { url: miniAppLink(appUrl, taskId) } }]
}

/**
 * Inline buttons under reminders, cards and confirmations: `[Done, Focus]` / `[30 min, 1 h, Tomorrow]` (B4),
 * plus `[📱 Open in app]` when `appUrl` is given (D4).
 */
export function taskButtons(taskId: string, lang: Lang, appUrl?: string): TgInlineButton[][] {
  const rows: TgInlineButton[][] = [
    [
      { text: translate(lang, 'tg_btn_done'), callback_data: `done:${taskId}` },
      { text: translate(lang, 'tg_btn_focus'), callback_data: `focus:${taskId}` },
    ],
    [
      { text: translate(lang, 'tg_btn_30'), callback_data: `snooze:${taskId}:30` },
      { text: translate(lang, 'tg_btn_60'), callback_data: `snooze:${taskId}:60` },
      { text: translate(lang, 'tg_btn_tomorrow'), callback_data: `snooze:${taskId}:tomorrow` },
    ],
  ]
  if (appUrl) rows.push(openAppRow(lang, appUrl, taskId))
  return rows
}

/** Number buttons under a list (C3): `pick:<id>` for the first `PICK_MAX` tasks, `PICK_ROW` per row. */
export function numberButtons(ids: string[]): TgInlineButton[][] {
  const rows: TgInlineButton[][] = []
  ids.slice(0, PICK_MAX).forEach((id, i) => {
    if (i % PICK_ROW === 0) rows.push([])
    rows[rows.length - 1].push({ text: String(i + 1), callback_data: `pick:${id}` })
  })
  return rows
}

/**
 * Reminder message (HTML): bold title, body below. With `settings`, the escalation ladder (B6) adds
 * `👀 Ignored N× — still not done?` on its own line above the title once `escalationLevel ≥ 1`; the same line
 * that `buildNotification` put at the start of the body is removed there so it appears once.
 */
export function reminderText(task: Task, title: string, body: string, settings?: Pick<Settings, 'escalation' | 'language'>): string {
  const lines: string[] = []
  let rest = body
  if (settings?.escalation?.enabled && escalationLevel(task, settings) >= 1) {
    const n = task.nagCount ?? 0
    const dup = translate(settings.language, 'escalation_line', { n })
    if (rest.startsWith(`${dup} · `)) rest = rest.slice(dup.length + 3)
    else if (rest === dup) rest = ''
    lines.push(escapeHtml(translate(settings.language, 'tg_escalation', { n })))
  }
  lines.push(`<b>${escapeHtml(title)}</b>`)
  if (rest) lines.push(escapeHtml(rest))
  return lines.join('\n')
}

/** B2: the stored HTML of a live message after its task was completed on the desktop: `<s>title</s> ✓`, body kept. */
export function completedHtml(html: string, title: string): string {
  const bold = `<b>${escapeHtml(title)}</b>`
  const struck = `<s>${escapeHtml(title)}</s> ✓`
  return html.includes(bold) ? html.replace(bold, struck) : `${html}\n\n${struck}`
}

// ---- Pure decisions (B3, B4, B5) ----

/** B3: the Telegram copy of a reminder goes out unless "only when idle" is on and the PC was used recently. */
export function shouldSendToTelegram(settings: Pick<Settings, 'telegram'>, idleSeconds: number): boolean {
  const tg = settings.telegram
  if (!tg.onlyWhenIdle) return true
  return idleSeconds >= Math.max(1, tg.idleMinutes ?? 5) * 60
}

/** B4: next calendar day at `quietHours.to` when quiet hours are on, else 09:00 (local; DST handled by `Date`). */
export function tomorrowMorning(nowMs: number, settings: Pick<Settings, 'quietHours'>): number {
  const d = new Date(nowMs)
  let h = 9
  let m = 0
  if (settings.quietHours.enabled) {
    const [th, tm] = settings.quietHours.to.split(':').map(Number)
    if (Number.isFinite(th) && Number.isFinite(tm)) {
      h = th
      m = tm
    }
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m, 0, 0).getTime()
}

const OFF_WORDS = new Set(['off', 'kapat', 'kapalı', 'kapali', 'выкл', 'выключить', 'stop', 'no', 'none', 'yok', 'нет', '0', '-'])
const ON_WORDS = new Set(['on', 'aç', 'ac', 'açık', 'acik', 'вкл', 'включить', 'yes'])
const HOUR_UNITS = /^(h|hr|hrs|hour|hours|sa|saat|s|ч|час|часа|часов)$/
const MIN_UNITS = /^(m|min|mins|minute|minutes|dk|dak|dakika|мин|минут|минута|минуты|минуту)$/
const DURATION = /^(\d+(?:[.,]\d+)?)\s*([a-zçğıöşüа-яё]*)$/i

/** `2h 90m 2sa 45dk 2ч 45мин 1.5h 90` → minutes; bare → 60; `off` → 'off'; unreadable → null. */
export function parseMuteArg(arg: string): { minutes: number } | 'off' | null {
  const s = arg.trim().toLowerCase()
  if (!s) return { minutes: 60 }
  if (OFF_WORDS.has(s)) return 'off'
  const m = DURATION.exec(s)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return null
  const unit = m[2]
  if (unit && !HOUR_UNITS.test(unit) && !MIN_UNITS.test(unit)) return null
  return { minutes: Math.max(1, Math.round(HOUR_UNITS.test(unit) ? n * 60 : n)) }
}

/** `/every N 30 | 2h | off` → minutes (0 = off); unreadable → null. */
export function parseEveryArg(arg: string): number | null {
  const s = arg.trim().toLowerCase()
  if (!s) return null
  if (OFF_WORDS.has(s)) return 0
  const r = parseMuteArg(s)
  return r && r !== 'off' ? r.minutes : null
}

const PRIORITY_WORDS: Record<string, Priority> = {
  '1': 'high', '2': 'medium', '3': 'low',
  high: 'high', hi: 'high', h: 'high', medium: 'medium', med: 'medium', m: 'medium', normal: 'medium', low: 'low', l: 'low',
  yüksek: 'high', yuksek: 'high', orta: 'medium', düşük: 'low', dusuk: 'low',
  высокий: 'high', высокая: 'high', средний: 'medium', средняя: 'medium', низкий: 'low', низкая: 'low',
}

/** `1 | 2 | 3 | high | yüksek | !1 …` → priority, or null. */
export function parsePriorityWord(word: string): Priority | null {
  const w = word.trim().toLowerCase().replace(/^!/, '')
  return PRIORITY_WORDS[w] ?? null
}

const URL_RE = /https?:\/\/[^\s<>]+/gi

/**
 * C5: title for a forwarded message or a text with a link — the first line without URLs, at most 80 characters;
 * empty → '' (the caller falls back to the "Link" label).
 */
export function linkTitle(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.replace(URL_RE, '').trim().length > 0) ?? ''
  const cleaned = first.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length > LINK_TITLE_MAX ? `${cleaned.slice(0, LINK_TITLE_MAX - 1).trimEnd()}…` : cleaned
}

export const hasUrl = (text: string) => {
  URL_RE.lastIndex = 0
  return URL_RE.test(text)
}

// ---- Lists & views (C1) ----

export interface TgListSection {
  key: Key
  tasks: Task[]
}

export type TgView = 'list' | 'today' | 'week' | 'overdue' | 'search'

/** Open tasks grouped Overdue · Today · Later · No date (empty sections omitted), smart order inside each. */
export function listSections(tasks: Task[], now: number): TgListSection[] {
  const open = openTasksSorted(tasks)
  const sections: TgListSection[] = [
    { key: 'tg_sec_overdue', tasks: open.filter((t) => t.dueAt !== null && t.dueAt < now) },
    { key: 'tg_sec_today', tasks: open.filter((t) => t.dueAt !== null && t.dueAt >= now && isToday(t.dueAt, now)) },
    { key: 'tg_sec_later', tasks: open.filter((t) => t.dueAt !== null && t.dueAt >= now && !isToday(t.dueAt, now)) },
    { key: 'tg_sec_nodate', tasks: open.filter((t) => t.dueAt === null) },
  ]
  return sections.filter((s) => s.tasks.length > 0)
}

/** The open tasks a view shows: `/today` = due today or overdue, `/week` = this week or overdue, `/overdue`, `/search`. */
export function viewTasks(tasks: Task[], now: number, view: TgView, query = ''): Task[] {
  const open = tasks.filter((t) => t.completedAt === null)
  switch (view) {
    case 'today':
      return open.filter((t) => t.dueAt !== null && t.dueAt <= endOfDay(now))
    case 'week':
      return open.filter((t) => t.dueAt !== null && (t.dueAt < now || isThisWeek(t.dueAt, now)))
    case 'overdue':
      return open.filter((t) => t.dueAt !== null && t.dueAt < now)
    case 'search':
      return open.filter((t) => matchesQuery(t, query))
    default:
      return open
  }
}

/** Task ids in /list order: what `/done N` refers to when the stored numbering is stale. */
export function listTaskIds(tasks: Task[], now: number): string[] {
  return listSections(tasks, now).flatMap((s) => s.tasks.map((t) => t.id))
}

const VIEW_TITLE: Record<TgView, Key> = { list: 'tg_list_title', today: 'tg_today_title', week: 'tg_week_title', overdue: 'tg_overdue_title', search: 'tg_search_title' }

/** Shared renderer of every view: sections, continuous numbering, `listIndex`, number buttons under the last chunk. */
function renderView(data: AppData, now: number, view: TgView, query = ''): TgEffect {
  const lang = data.settings.language
  const sections = listSections(viewTasks(data.tasks, now, view, query), now)
  const listIndex = sections.flatMap((s) => s.tasks.map((t) => t.id))
  if (listIndex.length === 0) return { replies: [{ text: translate(lang, view === 'list' ? 'tg_list_empty' : 'tg_view_empty') }], listIndex }
  const lines: string[] = [translate(lang, VIEW_TITLE[view], { n: listIndex.length, q: escapeHtml(query) })]
  let n = 0
  for (const s of sections) {
    lines.push('', `<b>${translate(lang, s.key)}</b>`)
    for (const t of s.tasks) {
      n++
      const due = t.dueAt !== null ? ` · ${escapeHtml(formatDue(t.dueAt, lang, now))}` : ''
      const subs = t.subtasks.filter((x) => !x.done).length
      lines.push(`${n}. ${priorityIcon(t.priority)}${t.focused ? ' 🎯' : ''} <b>${escapeHtml(t.title)}</b>${due}${subs ? ` · ${translate(lang, 'open_subs', { n: subs })}` : ''}`)
    }
  }
  const replies: TgReply[] = chunkText(lines.join('\n')).map((text) => ({ text }))
  replies[replies.length - 1].buttons = numberButtons(listIndex)
  return { replies, listIndex }
}

/** `/stats`: done today / 7 days always; streak and focus minutes only when there is something to show. */
function renderStats(data: AppData, now: number): TgEffect {
  const lang = data.settings.language
  const t = (k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars)
  const dayStart = startOfDay(now)
  const lines = [t('tg_stats_title'), t('tg_stats_done', { today: data.dailyDone[dayKey(now)] ?? 0, week: doneInLastDays(data.dailyDone, 7, now) })]
  const s = streak(data.dailyDone, dayKey(now))
  if (s > 0) lines.push(t('tg_stats_streak', { n: s }))
  const focusWeek = focusMinutes(data.focusLog, addDays(dayStart, -6), Number.MAX_SAFE_INTEGER)
  if (focusWeek > 0) {
    const focusToday = focusMinutes(data.focusLog, dayStart, Number.MAX_SAFE_INTEGER)
    lines.push(t('tg_stats_focus', { today: formatMinutes(focusToday, lang), week: formatMinutes(focusWeek, lang) }))
  }
  return { replies: [{ text: lines.join('\n') }] }
}

// ---- Task card (C3) ----

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

/** Card HTML: bold title, due, priority, tags, interval, recurrence, subtask count, first 300 characters of notes. */
export function renderCard(task: Task, lang: Lang, now: number): string {
  const t = (k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars)
  const lines = [`<b>${escapeHtml(task.title)}</b>`]
  if (task.dueAt !== null) lines.push(t('tg_added_due', { due: escapeHtml(formatDue(task.dueAt, lang, now)) }))
  lines.push(t('tg_added_prio', { icon: priorityIcon(task.priority), prio: t(`p_${task.priority}` as const) }))
  if (task.tags.length) lines.push(t('tg_added_tags', { tags: escapeHtml(task.tags.map((x) => `#${x}`).join(' ')) }))
  if (task.remindEveryMin > 0) lines.push(t('tg_added_every', { n: task.remindEveryMin }))
  if (task.recurrence !== 'none') lines.push(`↻ ${escapeHtml(recurrenceText(task.recurrence, task.recurrenceRule, lang))}`)
  if (task.subtasks.length) lines.push(`☐ ${t('tg_card_subs', { done: task.subtasks.filter((s) => s.done).length, n: task.subtasks.length })}`)
  if (task.notes.trim()) lines.push(`📝 ${escapeHtml(cut(task.notes.trim(), CARD_NOTES_MAX))}`)
  return lines.join('\n')
}

/** Card keyboard: one row per subtask (toggle), the B4 action rows, `🗑 Delete · ✏ Priority`, then `📱 Open in app` (D4) when the Mini App is up. */
export function cardButtons(task: Task, lang: Lang, appUrl?: string): TgInlineButton[][] {
  const subs = task.subtasks.slice(0, PICK_MAX).map((s) => [{ text: `${s.done ? '☑' : '☐'} ${cut(s.title, BUTTON_TEXT_MAX)}`, callback_data: `sub:${task.id}:${s.id}` }])
  return [
    ...subs,
    ...taskButtons(task.id, lang),
    [
      { text: translate(lang, 'tg_btn_delete'), callback_data: `del:${task.id}` },
      { text: translate(lang, 'tg_btn_prio'), callback_data: `prio:${task.id}` },
    ],
    ...(appUrl ? [openAppRow(lang, appUrl, task.id)] : []),
  ]
}

const cardReply = (task: Task, lang: Lang, now: number, appUrl?: string): TgReply => ({ text: renderCard(task, lang, now), buttons: cardButtons(task, lang, appUrl), taskId: task.id })

// ---- Digest (C6) & backup (C7) ----

/**
 * Telegram digest message: HTML from `buildDigest` plus `pick:` buttons for the listed tasks (which also become
 * the numbering) and, while the Mini App is up, an `📱 Open in app` row without `?task` (D4).
 */
export function digestReply(data: AppData, now: number, kind: DigestKind, appUrl?: string): TgEffect {
  const d = buildDigest(data, now, data.settings.language, kind)
  const ids = d.tasks.map((x) => x.id)
  const buttons = [...numberButtons(ids), ...(appUrl ? [openAppRow(data.settings.language, appUrl)] : [])]
  return { replies: [{ text: d.html, ...(buttons.length ? { buttons } : {}) }], ...(ids.length ? { listIndex: ids } : {}) }
}

/** `/backup`: the data file as JSON with the bot token blanked, named `hyperdo-backup-YYYY-MM-DD.json`. */
export function backupDocument(data: AppData, now: number): TgDocument {
  const safe: AppData = { ...data, settings: { ...data.settings, telegram: { ...data.settings.telegram, token: '' } } }
  return {
    filename: `hyperdo-backup-${dayKey(now)}.json`,
    content: JSON.stringify(safe, null, 2),
    mime: 'application/json',
    caption: translate(data.settings.language, 'tg_backup_caption', { n: data.tasks.length }),
  }
}

// ---- Helpers ----

const bold = (s: string) => `<b>${escapeHtml(s)}</b>`

/** `16:30` for today, otherwise the relative date (`Tomorrow 09:00`). */
function clock(ts: number, lang: Lang, now: number): string {
  return isToday(ts, now) ? new Date(ts).toLocaleTimeString(LOCALE[lang], { hour: '2-digit', minute: '2-digit' }) : formatDue(ts, lang, now)
}

/** Task number `arg` (1-based) from the last /list; a stale or missing numbering falls back to the live list order. */
function byIndex(arg: string, ctx: TgContext): Task | undefined {
  const n = Number(arg)
  if (!Number.isInteger(n) || n < 1) return undefined
  const id = ctx.listIndex[n - 1]
  const task = id ? ctx.data.tasks.find((x) => x.id === id) : undefined
  if (task && task.completedAt === null) return task
  const liveId = listTaskIds(ctx.data.tasks, ctx.now)[n - 1]
  return liveId ? ctx.data.tasks.find((x) => x.id === liveId) : undefined
}

/** Snooze / focus from the bot are reactions: the escalation ladder starts over for that task. */
export function snoozeIn(d: AppData, id: string, until: number): AppData {
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? resetNag({ ...x, snoozedUntil: until }) : x)) }
}

export function focusIn(d: AppData, id: string): AppData {
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? resetNag({ ...x, focused: true }) : x.focused ? { ...x, focused: false } : x)) }
}

/** Patch one task (a reaction: nag reset). */
function patchIn(d: AppData, id: string, patch: Partial<Task>): AppData {
  return { ...d, tasks: d.tasks.map((x) => (x.id === id ? resetNag({ ...x, ...patch }) : x)) }
}

const reply = (text: string, buttons?: TgInlineButton[][], taskId?: string): TgEffect => ({ replies: [{ text, ...(buttons ? { buttons } : {}), ...(taskId ? { taskId } : {}) }] })
const silent: TgEffect = { replies: [] }

/** Pairing: `/start <code>` links the chat while nothing is linked; afterwards only the owner chat is greeted. */
function handleStart(arg: string, ctx: TgContext): TgEffect {
  const { settings } = ctx.data
  const lang = settings.language
  const tg = settings.telegram
  const greeting = `${translate(lang, 'tg_hello')}\n\n${helpText(lang)}`
  if (tg.chatId) return reply(ctx.chatId === tg.chatId ? greeting : translate(lang, 'tg_not_linked'))
  const code = arg.trim()
  if (tg.pairCode && code === tg.pairCode) {
    return {
      mutate: (d) => ({ ...d, settings: { ...d.settings, telegram: { ...d.settings.telegram, chatId: ctx.chatId, pairCode: '' } } }),
      replies: [{ text: greeting }],
    }
  }
  return reply(translate(lang, 'tg_need_code'))
}

/**
 * `/add …` and plain text: quick-add parser, then a confirmation listing what was understood (one line each).
 * Forwarded messages and texts with a link (C5): the first line without URLs becomes the title (≤ 80 chars,
 * fallback "Link"), the whole text goes to the notes; the title line still runs through the parser.
 */
function add(text: string, ctx: TgContext): TgEffect {
  const { settings, tasks } = ctx.data
  const lang = settings.language
  const t = (k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars)
  if (!text.trim()) return reply(helpText(lang))
  const link = Boolean(ctx.forwarded) || hasUrl(text)
  const line = link ? linkTitle(text) || t('tg_link_title') : text
  const p = parseQuickAdd(line, lang, ctx.now)
  let task = taskFromQuickAdd(line, settings, { tasks, now: ctx.now, fallbackTitle: true })
  if (!task) return reply(helpText(lang))
  if (link) task = { ...task, title: cut(task.title, LINK_TITLE_MAX), notes: text.trim() }
  const lines = [t('tg_added', { title: bold(task.title) })]
  if (p.dueAt !== null) lines.push(t('tg_added_due', { due: escapeHtml(formatDue(p.dueAt, lang, ctx.now)) }))
  if (p.priority) lines.push(t('tg_added_prio', { icon: priorityIcon(p.priority), prio: t(`p_${p.priority}` as const) }))
  if (p.tags.length) lines.push(t('tg_added_tags', { tags: escapeHtml(p.tags.map((x) => `#${x}`).join(' ')) }))
  if (p.remindEveryMin !== null && p.remindEveryMin > 0) lines.push(t('tg_added_every', { n: p.remindEveryMin }))
  if (p.recurrence) lines.push(`↻ ${escapeHtml(recurrenceText(p.recurrence, p.recurrenceRule, lang))}`)
  if (link) lines.push(t('tg_added_notes'))
  const created = task
  return {
    mutate: (d) => ({ ...d, tasks: [created, ...d.tasks] }),
    replies: [{ text: lines.join('\n'), buttons: taskButtons(created.id, lang, ctx.appUrl), taskId: created.id }],
  }
}

const NOTE_PREFIX = /^(not|note|заметка)\s*:\s*/i

/** C4: a reply to a known task message adds a subtask, or appends to the notes when the text starts with `note:` / `not:` / `заметка:`. */
function attach(text: string, task: Task, ctx: TgContext): TgEffect {
  const lang = ctx.data.settings.language
  const m = NOTE_PREFIX.exec(text)
  if (m) {
    const note = text.slice(m[0].length).trim()
    if (!note) return reply(translate(lang, 'tg_need_text'))
    return {
      mutate: (d) => patchIn(d, task.id, { notes: d.tasks.find((x) => x.id === task.id)?.notes ? `${d.tasks.find((x) => x.id === task.id)!.notes}\n${note}` : note }),
      replies: [{ text: translate(lang, 'tg_note_added', { title: bold(task.title) }), taskId: task.id }],
    }
  }
  const sub = { id: uid(), title: text, done: false }
  return {
    mutate: (d) => patchIn(d, task.id, { subtasks: [...(d.tasks.find((x) => x.id === task.id)?.subtasks ?? []), sub] }),
    replies: [{ text: translate(lang, 'tg_sub_added', { title: bold(task.title) }), taskId: task.id }],
  }
}

// ---- Entry points ----

/**
 * A text message from `ctx.chatId`. `/start` is answered for every chat (pairing); everything else is ignored
 * unless the chat is the linked one. Unknown `/commands` get the help text; plain text is a quick add
 * (or an attachment when it replies to a known task message, C4).
 */
export function handleMessage(text: string, ctx: TgContext): TgEffect {
  const { data } = ctx
  const { settings } = data
  const lang = settings.language
  const t = (k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars)
  const trimmed = text.trim()
  const [cmdRaw = '', ...rest] = trimmed.split(/\s+/)
  const cmd = cmdRaw.toLowerCase().replace(/@\w+$/, '') // "/list@botname" → "/list"
  const arg = rest.join(' ')
  const linked = settings.telegram.chatId
  const now = ctx.now

  if (cmd === '/start') return handleStart(arg, ctx)
  if (!linked || ctx.chatId !== linked) return silent // foreign chats are ignored

  /** `N <text>` arguments: the task and the remainder. */
  const withTask = (): { task: Task | undefined; text: string } => {
    const [idx = '', ...r] = arg.split(/\s+/)
    return { task: byIndex(idx, ctx), text: r.join(' ').trim() }
  }

  switch (cmd) {
    case '/help':
      return reply(helpText(lang))
    case '/list':
    case '/l':
      return renderView(data, now, 'list')
    case '/today':
      return renderView(data, now, 'today')
    case '/week':
      return renderView(data, now, 'week')
    case '/overdue':
      return renderView(data, now, 'overdue')
    case '/search':
      if (!arg.trim()) return reply(t('tg_need_text'))
      return renderView(data, now, 'search', arg.trim())
    case '/stats':
      return renderStats(data, now)
    case '/done':
    case '/d': {
      const tasks: Task[] = []
      for (const num of arg.split(/\s+/).filter(Boolean)) {
        const task = byIndex(num, ctx)
        if (task && !tasks.some((x) => x.id === task.id)) tasks.push(task)
      }
      if (tasks.length === 0) return reply(t('tg_bad_index'))
      const ids = tasks.map((x) => x.id)
      const text = tasks.length === 1 ? t('tg_done_ok', { title: bold(tasks[0].title) }) : [t('tg_done_many', { n: tasks.length }), ...tasks.map((x) => `• ${bold(x.title)}`)].join('\n')
      return { mutate: (d) => ids.reduce((acc, id) => completeInData(acc, id, now), d), replies: [{ text }] }
    }
    case '/snooze':
    case '/s': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      // C2: a date text ("yarın 09:00") snoozes until then; otherwise minutes (default 30)
      if (text && !/^\d+$/.test(text)) {
        const p = parseQuickAdd(text, lang, now)
        if (p.dueAt !== null && p.dueAt > now) {
          const until = p.dueAt
          return { mutate: (d) => snoozeIn(d, task.id, until), replies: [{ text: t('tg_snoozed_until', { t: escapeHtml(formatDue(until, lang, now)), title: bold(task.title) }), taskId: task.id }] }
        }
      }
      const mins = Math.max(1, Math.floor(Number(text)) || 30)
      const until = now + mins * 60_000
      return { mutate: (d) => snoozeIn(d, task.id, until), replies: [{ text: t('tg_snoozed', { n: mins, title: bold(task.title) }), taskId: task.id }] }
    }
    case '/focus':
    case '/f': {
      const task = byIndex(arg, ctx)
      if (!task) return reply(t('tg_bad_index'))
      return { mutate: (d) => focusIn(d, task.id), replies: [{ text: t('tg_focused', { title: bold(task.title) }), taskId: task.id }] }
    }
    case '/due': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      if (OFF_WORDS.has(text.toLowerCase())) {
        return { mutate: (d) => patchIn(d, task.id, { dueAt: null, snoozedUntil: null }), replies: [{ text: t('tg_due_cleared', { title: bold(task.title) }), taskId: task.id }] }
      }
      const p = text ? parseQuickAdd(text, lang, now) : null
      if (!p || p.dueAt === null) return reply(t('tg_bad_date'))
      const due = p.dueAt
      return { mutate: (d) => patchIn(d, task.id, { dueAt: due, snoozedUntil: null }), replies: [{ text: t('tg_due_set', { title: bold(task.title), due: escapeHtml(formatDue(due, lang, now)) }), taskId: task.id }] }
    }
    case '/prio': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      const prio = parsePriorityWord(text)
      if (!prio) return reply(t('tg_bad_prio'))
      return { mutate: (d) => patchIn(d, task.id, { priority: prio }), replies: [{ text: t('tg_prio_set', { icon: priorityIcon(prio), title: bold(task.title), prio: t(`p_${prio}` as const) }), taskId: task.id }] }
    }
    case '/every': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      const mins = parseEveryArg(text)
      if (mins === null) return reply(escapeHtml(t('tg_cmd_every')))
      return {
        mutate: (d) => patchIn(d, task.id, { remindEveryMin: mins }),
        replies: [{ text: mins > 0 ? t('tg_every_set', { title: bold(task.title), n: mins }) : t('tg_every_off', { title: bold(task.title) }), taskId: task.id }],
      }
    }
    case '/sub':
    case '/note': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      if (!text) return reply(t('tg_need_text'))
      return attach(cmd === '/note' ? `note: ${text}` : text, task, ctx)
    }
    case '/rename': {
      const { task, text } = withTask()
      if (!task) return reply(t('tg_bad_index'))
      if (!text) return reply(t('tg_need_text'))
      return { mutate: (d) => patchIn(d, task.id, { title: text }), replies: [{ text: t('tg_renamed', { title: bold(text) }), taskId: task.id }] }
    }
    case '/del': {
      const task = byIndex(arg, ctx)
      if (!task) return reply(t('tg_bad_index'))
      return reply(t('tg_del_confirm', { title: bold(task.title) }), deleteButtons(task.id, lang), task.id)
    }
    case '/undo': {
      const last = data.tasks.filter((x) => x.completedAt !== null).sort((a, b) => b.completedAt! - a.completedAt!)[0]
      if (!last) return reply(t('tg_undo_none'))
      const text = `${t('tg_undo_ok', { title: bold(last.title) })}${last.recurrence !== 'none' ? ` ${escapeHtml(t('tg_undo_recurring'))}` : ''}`
      return {
        mutate: (d) => {
          const cur = d.tasks.find((x) => x.id === last.id)
          if (!cur || cur.completedAt === null) return d
          return recordReopen({ ...d, tasks: d.tasks.map((x) => (x.id === last.id ? { ...x, completedAt: null } : x)) }, cur.completedAt)
        },
        replies: [{ text, buttons: taskButtons(last.id, lang, ctx.appUrl), taskId: last.id }],
      }
    }
    case '/mute': {
      const r = parseMuteArg(arg)
      if (r === null) return reply(escapeHtml(t('tg_cmd_mute')))
      if (r === 'off') return { mutate: (d) => ({ ...d, settings: { ...d.settings, mutedUntil: null } }), replies: [{ text: t('tg_unmuted') }] }
      const until = now + r.minutes * 60_000
      return { mutate: (d) => ({ ...d, settings: { ...d.settings, mutedUntil: until } }), replies: [{ text: t('tg_muted', { t: escapeHtml(clock(until, lang, now)) }) }] }
    }
    case '/quiet': {
      const w = arg.trim().toLowerCase()
      const on = ON_WORDS.has(w) ? true : OFF_WORDS.has(w) ? false : !settings.quietHours.enabled
      return {
        mutate: (d) => ({ ...d, settings: { ...d.settings, quietHours: { ...d.settings.quietHours, enabled: on } } }),
        replies: [{ text: t('tg_quiet_state', { state: t(on ? 'tg_on' : 'tg_off'), from: escapeHtml(settings.quietHours.from), to: escapeHtml(settings.quietHours.to) }) }],
      }
    }
    case '/backup':
      return { replies: [], documents: [backupDocument(data, now)] }
    case '/add':
    case '/a':
      return add(arg, ctx)
    default: {
      if (trimmed.startsWith('/')) return reply(helpText(lang))
      // C4: a reply to a known task message attaches to that task
      const target = ctx.replyToTaskId ? data.tasks.find((x) => x.id === ctx.replyToTaskId && x.completedAt === null) : undefined
      if (target) return attach(trimmed, target, ctx)
      return add(trimmed, ctx) // plain text = quick add
    }
  }
}

function deleteButtons(taskId: string, lang: Lang): TgInlineButton[][] {
  return [
    [
      { text: translate(lang, 'tg_btn_del_yes'), callback_data: `del:${taskId}:yes` },
      { text: translate(lang, 'tg_btn_del_no'), callback_data: `del:${taskId}:no` },
    ],
  ]
}

const NEXT_PRIO: Record<Priority, Priority> = { high: 'medium', medium: 'low', low: 'high' }

/**
 * Inline-button press. The toast is plain text; `append` (HTML) is added under the original message, whose
 * buttons stay unless `keepButtons` is false; `edit` replaces the message (cards re-render in place).
 */
export function handleCallback(cbData: string, ctx: TgContext): TgCallbackResult {
  const { data } = ctx
  const lang = data.settings.language
  const t = (k: Key, vars?: Record<string, string | number>) => translate(lang, k, vars)
  const none: TgCallbackResult = { effect: silent, toast: '', keepButtons: true }
  const linked = data.settings.telegram.chatId
  if (!linked || ctx.chatId !== linked) return none

  const [action, id, extra] = cbData.split(':')
  const task = data.tasks.find((x) => x.id === id)
  if (!task) return { ...none, toast: t('tg_bad_index') }
  const now = ctx.now

  switch (action) {
    case 'done':
      return {
        effect: { mutate: (d) => completeInData(d, id, now), replies: [] },
        toast: t('tg_done_ok', { title: task.title }),
        keepButtons: false,
        append: t('tg_done_ok', { title: bold(task.title) }),
      }
    case 'snooze': {
      if (extra === 'tomorrow') {
        const until = tomorrowMorning(now, data.settings)
        const when = formatDue(until, lang, now)
        return {
          effect: { mutate: (d) => snoozeIn(d, id, until), replies: [] },
          toast: t('tg_snoozed_until', { t: when, title: task.title }),
          keepButtons: true,
          append: t('tg_snoozed_until', { t: escapeHtml(when), title: bold(task.title) }),
        }
      }
      const mins = Math.max(1, Math.floor(Number(extra)) || 30)
      const until = now + mins * 60_000
      return {
        effect: { mutate: (d) => snoozeIn(d, id, until), replies: [] },
        toast: t('tg_snoozed', { n: mins, title: task.title }),
        keepButtons: true,
        append: t('tg_snoozed', { n: mins, title: bold(task.title) }),
      }
    }
    case 'focus':
      return {
        effect: { mutate: (d) => focusIn(d, id), replies: [] },
        toast: t('tg_focused', { title: task.title }),
        keepButtons: true,
        append: t('tg_focused', { title: bold(task.title) }),
      }
    case 'pick':
      return { effect: { replies: [cardReply(task, lang, now, ctx.appUrl)] }, toast: '', keepButtons: true }
    case 'sub': {
      if (!task.subtasks.some((s) => s.id === extra)) return { ...none, toast: t('tg_bad_index') }
      const toggled: Task = resetNag({ ...task, subtasks: task.subtasks.map((s) => (s.id === extra ? { ...s, done: !s.done } : s)) })
      return {
        effect: { mutate: (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === id ? toggled : x)) }), replies: [] },
        toast: '',
        keepButtons: true,
        edit: { text: renderCard(toggled, lang, now), buttons: cardButtons(toggled, lang, ctx.appUrl) },
      }
    }
    case 'prio': {
      const next: Task = resetNag({ ...task, priority: NEXT_PRIO[task.priority] })
      return {
        effect: { mutate: (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === id ? next : x)) }), replies: [] },
        toast: t('tg_prio_set', { icon: priorityIcon(next.priority), title: task.title, prio: t(`p_${next.priority}` as const) }),
        keepButtons: true,
        edit: { text: renderCard(next, lang, now), buttons: cardButtons(next, lang, ctx.appUrl) },
      }
    }
    case 'del': {
      if (extra === 'yes') {
        return {
          effect: { mutate: (d) => ({ ...d, tasks: d.tasks.filter((x) => x.id !== id) }), replies: [] },
          toast: t('tg_del_ok', { title: task.title }),
          keepButtons: false,
          append: t('tg_del_ok', { title: bold(task.title) }),
        }
      }
      if (extra === 'no') return { effect: silent, toast: t('tg_del_cancel'), keepButtons: false }
      // from a card: ask first, in a new message
      return { effect: reply(t('tg_del_confirm', { title: bold(task.title) }), deleteButtons(id, lang), id), toast: '', keepButtons: true }
    }
    default:
      return none
  }
}
