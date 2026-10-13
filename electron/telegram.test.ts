/**
 * Transport test: `TelegramBot` against a fake Bot API on 127.0.0.1 (port 0). The server implements
 * getUpdates (queued updates, honours `offset`), sendMessage, editMessageText, editMessageReplyMarkup,
 * deleteMessage, answerCallbackQuery, setMyCommands, getMe and sendDocument (multipart), and records every call.
 */
import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { TelegramBot } from './telegram'
import { normalizeData } from '../src/lib/data'
import { normalizeTask } from '../src/lib/tasks'
import { completeInData } from '../src/lib/stats'
import { translate } from '../src/lib/i18n'
import { cardButtons, renderCard, taskButtons } from '../src/lib/telegram-commands'
import { DEFAULT_SETTINGS, type AppData, type Task, type TelegramSettings, type TelegramStatus } from '../src/lib/types'

interface Call {
  method: string
  token: string
  body: Record<string, unknown>
  /** Raw body of multipart requests (sendDocument). */
  raw?: string
}

function fakeApi() {
  const calls: Call[] = []
  const queue: { update_id: number }[] = []
  /** method → HTTP status to fail with (e.g. getUpdates: 401) */
  const fail: Record<string, number> = {}
  let nextUpdateId = 1
  /** Ids of messages the bot sends (sendMessage / sendDocument results). */
  let nextMessageId = 100
  /** Ids of incoming user messages (kept apart so tests can predict the bot's ids). */
  let nextIncomingId = 5000

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c: Buffer) => (raw += c))
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? '')
      const method = m?.[2] ?? ''
      const multipart = String(req.headers['content-type'] ?? '').startsWith('multipart/form-data')
      const body = !multipart && raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      calls.push({ method, token: m?.[1] ?? '', body, ...(multipart ? { raw } : {}) })
      const reply = (status: number, json: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(json))
      }
      if (fail[method]) return reply(fail[method], { ok: false, error_code: fail[method], description: `Fake ${fail[method]}` })
      switch (method) {
        case 'getUpdates': {
          const offset = Number(body.offset ?? 0)
          return reply(200, { ok: true, result: queue.filter((u) => u.update_id >= offset) })
        }
        case 'getMe':
          return reply(200, { ok: true, result: { id: 1, is_bot: true, username: 'hyperdo_test_bot' } })
        case 'sendMessage':
        case 'sendDocument':
          return reply(200, { ok: true, result: { message_id: nextMessageId++ } })
        case 'editMessageText':
        case 'editMessageReplyMarkup':
        case 'deleteMessage':
        case 'answerCallbackQuery':
        case 'setMyCommands':
          return reply(200, { ok: true, result: true })
        default:
          return reply(404, { ok: false, error_code: 404, description: 'Not Found' })
      }
    })
  })

  return {
    calls,
    fail,
    of: (method: string) => calls.filter((c) => c.method === method),
    /** Queues an update; the next getUpdates with a low enough offset delivers it. */
    push(update: Record<string, unknown>) {
      queue.push({ update_id: nextUpdateId++, ...update })
    },
    message(chatId: number, text: string, extra: Record<string, unknown> = {}) {
      this.push({ message: { message_id: nextIncomingId++, chat: { id: chatId }, text, ...extra } })
    },
    callback(id: string, data: string, messageId: number, chatId = 42, text = 'x') {
      this.push({ callback_query: { id, data, message: { message_id: messageId, chat: { id: chatId }, text } } })
    },
    listen: () =>
      new Promise<string>((resolve) => {
        server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

async function waitFor(cond: () => boolean, what = 'condition', ms = 2000) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, remindEveryMin: 20, ...o })
type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] }
const keyboard = (body: Record<string, unknown>) => (body.reply_markup as Keyboard | undefined)?.inline_keyboard

/** Bot + host with the same save path as the Electron main process: `mutate` commits, reflects (B2) and re-syncs. */
function harness(base: string, tg: Partial<TelegramSettings> = {}, tasks: Task[] = [], idle?: () => number) {
  let data: AppData = normalizeData({
    tasks,
    settings: { ...DEFAULT_SETTINGS, telegram: { ...DEFAULT_SETTINGS.telegram, enabled: true, token: 'TOKEN', chatId: '42', ...tg } },
  })
  const statuses: TelegramStatus[] = []
  const mutate = (fn: (d: AppData) => AppData) => {
    const prev = data
    data = fn(data)
    bot.onDataChanged(prev, data)
    bot.sync()
  }
  const bot: TelegramBot = new TelegramBot(
    {
      getData: () => data,
      mutate,
      onStatus: (s) => statuses.push(s),
      ...(idle ? { idleSeconds: idle } : {}),
    },
    { apiBase: base, pollTimeoutSec: 0 },
  )
  return {
    bot,
    statuses,
    /** A function on purpose: `setup()` spreads this object, a getter would freeze a snapshot. */
    data: () => data,
    /** "Desktop" change: what the renderer / deep links do through commit(). */
    mutate,
    status: () => bot.status(),
  }
}

let api: ReturnType<typeof fakeApi> | null = null
let bot: TelegramBot | null = null

afterEach(async () => {
  bot?.stop()
  bot = null
  await api?.close()
  api = null
})

async function setup(tg: Partial<TelegramSettings> = {}, tasks: Task[] = [], idle?: () => number) {
  api = fakeApi()
  const base = await api.listen()
  const h = harness(base, tg, tasks, idle)
  bot = h.bot
  return { api, ...h }
}

/** Starts the bot and waits until it polls. */
async function running(tg: Partial<TelegramSettings> = {}, tasks: Task[] = [], idle?: () => number) {
  const h = await setup(tg, tasks, idle)
  h.bot.sync()
  await waitFor(() => h.status().state === 'running', 'running')
  return h
}

describe('TelegramBot transport (fake API)', () => {
  it('start: getMe and setMyCommands once, username stored, status starting → running, polling with the token', async () => {
    const h = await setup()
    h.bot.sync()
    await waitFor(() => h.api.of('getUpdates').length >= 3, 'three polls')
    expect(h.api.of('getMe')).toHaveLength(1)
    expect(h.api.of('setMyCommands')).toHaveLength(1)
    expect(h.api.of('setMyCommands')[0].body.commands).toEqual(expect.arrayContaining([{ command: 'list', description: translate('en', 'tg_cmd_list') }]))
    expect(h.api.calls.every((c) => c.token === 'TOKEN')).toBe(true)
    expect(h.data().settings.telegram.botUsername).toBe('hyperdo_test_bot')
    expect(h.statuses.map((s) => s.state)).toContain('starting')
    expect(h.status()).toMatchObject({ state: 'running', error: null, username: 'hyperdo_test_bot' })
    expect(h.status().lastPollAt).not.toBeNull()
    // a repeated sync() (every save) does not push the menu again; a language change does
    h.bot.sync()
    await pause(60)
    expect(h.api.of('setMyCommands')).toHaveLength(1)
  })

  it('stop(): status off and no further requests', async () => {
    const h = await setup()
    h.bot.sync()
    await waitFor(() => h.api.of('getUpdates').length >= 2, 'polls')
    h.bot.stop()
    await pause(30)
    const n = h.api.calls.length
    await pause(150)
    expect(h.api.calls.length).toBe(n)
    expect(h.status().state).toBe('off')
  })

  it('sync() generates a 6-digit pairing code when the bot is on and nothing is linked', async () => {
    const h = await setup({ chatId: '', pairCode: '' })
    h.bot.sync()
    expect(h.data().settings.telegram.pairCode).toMatch(/^\d{6}$/)
    const code = h.data().settings.telegram.pairCode
    h.bot.sync()
    expect(h.data().settings.telegram.pairCode).toBe(code) // stable across saves
  })

  it('/start <code> pairs the chat (wrong code refused) and writes chatId through host.mutate', async () => {
    const h = await setup({ chatId: '', pairCode: '123456' })
    h.bot.sync()
    h.api.message(777, '/start 000000')
    await waitFor(() => h.api.of('sendMessage').length >= 1, 'refusal')
    expect(h.api.of('sendMessage')[0].body).toMatchObject({ chat_id: '777', text: translate('en', 'tg_need_code'), parse_mode: 'HTML' })
    expect(h.data().settings.telegram.chatId).toBe('')
    h.api.message(777, '/start 123456')
    await waitFor(() => h.data().settings.telegram.chatId === '777', 'pairing')
    expect(h.data().settings.telegram.pairCode).toBe('')
    await waitFor(() => h.api.of('sendMessage').length >= 2, 'greeting')
    expect(String(h.api.of('sendMessage')[1].body.text).startsWith(translate('en', 'tg_hello'))).toBe(true)
  })

  it('/list then /done 1 completes the task through host.mutate, with HTML replies and number buttons', async () => {
    const h = await setup({}, [task({ id: 'a', title: 'Pay bill' }), task({ id: 'b', title: 'Call mom' })])
    h.bot.sync()
    h.api.message(42, '/list')
    await waitFor(() => h.api.of('sendMessage').length >= 1, 'list')
    const list = h.api.of('sendMessage')[0].body
    expect(String(list.text)).toContain('<b>Pay bill</b>')
    expect(String(list.text)).toContain(`<b>${translate('en', 'tg_sec_nodate')}</b>`)
    expect(keyboard(list)).toEqual([[{ text: '1', callback_data: 'pick:a' }, { text: '2', callback_data: 'pick:b' }]])
    h.api.message(42, '/done 1')
    await waitFor(() => h.data().tasks.find((t) => t.id === 'a')!.completedAt !== null, 'completion')
    expect(h.data().tasks.find((t) => t.id === 'b')!.completedAt).toBeNull()
    await waitFor(() => h.api.of('sendMessage').length >= 2, 'confirmation')
    expect(h.api.of('sendMessage')[1].body).toMatchObject({ chat_id: '42', text: translate('en', 'tg_done_ok', { title: '<b>Pay bill</b>' }), parse_mode: 'HTML' })
    // a stranger is ignored
    h.api.message(999, '/list')
    await pause(100)
    expect(h.api.of('sendMessage')).toHaveLength(2)
  })

  it('a done: callback on an unknown message answers the query and edits the re-escaped original without buttons', async () => {
    const h = await setup({}, [task({ id: 'a', title: 'Pay bill' })])
    h.bot.sync()
    h.api.push({ callback_query: { id: 'cb1', data: 'done:a', message: { message_id: 7, chat: { id: 42 }, text: 'Pay bill\n5 min left <now>' } } })
    await waitFor(() => h.api.of('editMessageText').length >= 1, 'edit')
    expect(h.api.of('answerCallbackQuery')).toHaveLength(1)
    expect(h.api.of('answerCallbackQuery')[0].body).toEqual({ callback_query_id: 'cb1', text: translate('en', 'tg_done_ok', { title: 'Pay bill' }) })
    const edit = h.api.of('editMessageText')[0].body
    expect(edit).toMatchObject({ chat_id: '42', message_id: 7, parse_mode: 'HTML' })
    expect(edit.text).toBe(`Pay bill\n5 min left &lt;now&gt;\n\n${translate('en', 'tg_done_ok', { title: '<b>Pay bill</b>' })}`)
    expect('reply_markup' in edit).toBe(false)
    expect(h.data().tasks[0].completedAt).not.toBeNull()
    // snooze keeps the (two-row) keyboard
    h.api.push({ callback_query: { id: 'cb2', data: 'snooze:a:30', message: { message_id: 8, chat: { id: 42 }, text: 'Pay bill' } } })
    await waitFor(() => h.api.of('editMessageText').length >= 2, 'second edit')
    const rows = keyboard(h.api.of('editMessageText')[1].body)!
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveLength(2)
    expect(rows[1]).toHaveLength(3)
  })

  it('getUpdates answering 401 stops polling and the status becomes error (until the token changes)', async () => {
    const h = await setup()
    h.api.fail.getUpdates = 401
    h.bot.sync()
    await waitFor(() => h.status().state === 'error', 'error status')
    expect(h.status().error).toBe(translate('en', 'tg_err_token'))
    await pause(30)
    const n = h.api.calls.length
    await pause(300)
    expect(h.api.calls.length).toBe(n)
    expect(h.api.of('getUpdates')).toHaveLength(1)
    // same token: sync() does not retry; remind() is silent
    h.bot.sync()
    await h.bot.remind(task({ id: 'a' }), 'T', 'B')
    await pause(50)
    expect(h.api.calls.length).toBe(n)
  })

  it('409 Conflict is reported as "another instance" and keeps the loop alive', async () => {
    const h = await setup()
    h.api.fail.getUpdates = 409
    h.bot.sync()
    await waitFor(() => h.status().state === 'error', 'error status')
    expect(h.status().error).toBe(translate('en', 'tg_err_conflict'))
  })

  it('remind() sends bold HTML with the two button rows to the linked chat only', async () => {
    const h = await running({}, [task({ id: 'a', title: 'Pay bill' })])
    await h.bot.remind(task({ id: 'a' }), 'Pay <bill>', 'due & late')
    const sent = h.api.of('sendMessage')
    expect(sent).toHaveLength(1)
    expect(sent[0].body).toMatchObject({ chat_id: '42', parse_mode: 'HTML', text: '<b>Pay &lt;bill&gt;</b>\ndue &amp; late' })
    const rows = keyboard(sent[0].body)!
    expect(rows).toHaveLength(2)
    expect(rows[0].map((b) => b.callback_data)).toEqual(['done:a', 'focus:a'])
    expect(rows[1].map((b) => b.callback_data)).toEqual(['snooze:a:30', 'snooze:a:60', 'snooze:a:tomorrow'])
  })
})

describe('Phase B: one live reminder, desktop reflection, idle rule, tomorrow button', () => {
  it('B1: a second reminder for the same task deletes the first (tidy on); a delete failure falls back to removing its buttons', async () => {
    const h = await running({}, [task({ id: 'a', title: 'Pay bill' })])
    await h.bot.remind(task({ id: 'a' }), 'Pay bill', 'first')
    await h.bot.remind(task({ id: 'a' }), 'Pay bill', 'second')
    expect(h.api.of('sendMessage')).toHaveLength(2)
    expect(h.api.of('deleteMessage')).toHaveLength(1)
    expect(h.api.of('deleteMessage')[0].body).toEqual({ chat_id: '42', message_id: 100 })
    expect(h.api.of('editMessageReplyMarkup')).toHaveLength(0)
    expect(h.bot.liveMessage('a')).toEqual({ chatId: '42', messageId: 101 })
    // the delete fails (message too old / already gone) → buttons removed instead
    h.api.fail.deleteMessage = 400
    await h.bot.remind(task({ id: 'a' }), 'Pay bill', 'third')
    expect(h.api.of('deleteMessage')).toHaveLength(2)
    expect(h.api.of('editMessageReplyMarkup')).toHaveLength(1)
    expect(h.api.of('editMessageReplyMarkup')[0].body).toEqual({ chat_id: '42', message_id: 101, reply_markup: { inline_keyboard: [] } })
    expect(h.bot.liveMessage('a')).toEqual({ chatId: '42', messageId: 102 })
  })

  it('B1: with tidy off the previous reminder only loses its buttons; different tasks do not touch each other', async () => {
    const h = await running({ tidy: false }, [task({ id: 'a' }), task({ id: 'b' })])
    await h.bot.remind(task({ id: 'a' }), 'A', '1')
    await h.bot.remind(task({ id: 'b' }), 'B', '1')
    await h.bot.remind(task({ id: 'a' }), 'A', '2')
    expect(h.api.of('deleteMessage')).toHaveLength(0)
    expect(h.api.of('editMessageReplyMarkup').map((c) => c.body.message_id)).toEqual([100])
    expect(h.bot.liveMessage('b')).toEqual({ chatId: '42', messageId: 101 })
  })

  it('B2: completing a task on the desktop turns its live message into <s>title</s> ✓ without buttons; a deleted task loses its buttons; nothing is mutated', async () => {
    const h = await running({}, [task({ id: 'a', title: 'Pay <bill>' }), task({ id: 'b', title: 'Call mom' }), task({ id: 'c', title: 'Quiet' })])
    await h.bot.remind(task({ id: 'a', title: 'Pay <bill>' }), 'Pay <bill>', 'due soon')
    await h.bot.remind(task({ id: 'b', title: 'Call mom' }), 'Call mom', 'today')
    const nonPoll = () => h.api.calls.filter((c) => c.method !== 'getUpdates').length
    const before = nonPoll()
    h.mutate((d) => completeInData(d, 'a', NOW))
    await waitFor(() => h.api.of('editMessageText').length >= 1, 'strike-through edit')
    const edit = h.api.of('editMessageText')[0].body
    expect(edit).toMatchObject({ chat_id: '42', message_id: 100, parse_mode: 'HTML', text: '<s>Pay &lt;bill&gt;</s> ✓\ndue soon' })
    expect('reply_markup' in edit).toBe(false)
    expect(h.bot.liveMessage('a')).toBeNull()
    expect(h.bot.liveMessage('b')).toEqual({ chatId: '42', messageId: 101 })
    // deleting b: buttons removed only
    h.mutate((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== 'b') }))
    await waitFor(() => h.api.of('editMessageReplyMarkup').length >= 1, 'buttons removed')
    expect(h.api.of('editMessageReplyMarkup')[0].body).toEqual({ chat_id: '42', message_id: 101, reply_markup: { inline_keyboard: [] } })
    expect(h.bot.liveMessage('b')).toBeNull()
    // completing a task without a live message, or saving unrelated changes, does nothing
    h.mutate((d) => completeInData(d, 'c', NOW))
    h.mutate((d) => ({ ...d, settings: { ...d.settings, theme: 'light' } }))
    await pause(80)
    expect(nonPoll() - before).toBe(2)
    expect(h.data().tasks.find((t) => t.id === 'a')!.completedAt).not.toBeNull()
  })

  it('B3: with onlyWhenIdle the reminder is skipped while the PC is in use (idle 0 s) and sent once idle (600 s / locked)', async () => {
    let idle = 0
    const h = await running({ onlyWhenIdle: true, idleMinutes: 5 }, [task({ id: 'a' })], () => idle)
    await h.bot.remind(task({ id: 'a' }), 'A', 'B')
    expect(h.api.of('sendMessage')).toHaveLength(0)
    idle = 600
    await h.bot.remind(task({ id: 'a' }), 'A', 'B')
    expect(h.api.of('sendMessage')).toHaveLength(1)
    idle = Infinity // locked session
    await h.bot.remind(task({ id: 'a' }), 'A', 'B')
    expect(h.api.of('sendMessage')).toHaveLength(2)
    // the rule off: always sent, whatever the host reports
    h.mutate((d) => ({ ...d, settings: { ...d.settings, telegram: { ...d.settings.telegram, onlyWhenIdle: false } } }))
    idle = 0
    await h.bot.remind(task({ id: 'a' }), 'A', 'B')
    expect(h.api.of('sendMessage')).toHaveLength(3)
  })

  it('B4 + stored HTML: a callback on a known reminder edits from the HTML we sent (bold kept) and "Tomorrow" snoozes until tomorrow morning', async () => {
    const h = await running({}, [task({ id: 'a', title: 'Pay <bill>' })])
    await h.bot.remind(task({ id: 'a', title: 'Pay <bill>' }), 'Pay <bill>', 'due & late')
    h.api.callback('cb1', 'snooze:a:tomorrow', 100, 42, 'Pay <bill>\ndue & late')
    await waitFor(() => h.api.of('editMessageText').length >= 1, 'edit')
    const until = h.data().tasks[0].snoozedUntil!
    const d = new Date(until)
    const tomorrow = new Date(Date.now() + 86_400_000)
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 0])
    expect(d.getDate()).toBe(tomorrow.getDate())
    const edit = h.api.of('editMessageText')[0].body
    expect(String(edit.text).startsWith('<b>Pay &lt;bill&gt;</b>\ndue &amp; late\n\n⏰ ')).toBe(true)
    expect(String(edit.text)).toContain(': <b>Pay &lt;bill&gt;</b>')
    expect(keyboard(edit)).toEqual(taskButtons('a', 'en'))
    expect(h.api.of('answerCallbackQuery')[0].body.text).toContain('Pay <bill>')
    // a second reaction appends to the already appended text, still from stored HTML
    h.api.callback('cb2', 'focus:a', 100, 42, 'plain text telegram gives back')
    await waitFor(() => h.api.of('editMessageText').length >= 2, 'second edit')
    expect(String(h.api.of('editMessageText')[1].body.text).startsWith(String(edit.text))).toBe(true)
    // done: edited once by the callback path (not again by B2) and the message is no longer live
    h.api.callback('cb3', 'done:a', 100)
    await waitFor(() => h.api.of('editMessageText').length >= 3, 'done edit')
    await pause(60)
    expect(h.api.of('editMessageText')).toHaveLength(3)
    expect('reply_markup' in h.api.of('editMessageText')[2].body).toBe(false)
    expect(h.bot.liveMessage('a')).toBeNull()
  })
})

describe('Phase C: cards, replies, backup, digest', () => {
  it('C3: a number button sends the task card; a subtask button toggles it and re-renders the card in place', async () => {
    const t = task({ id: 'a', title: 'Trip', subtasks: [{ id: 's1', title: 'Book', done: false }] })
    const h = await running({}, [t])
    h.api.callback('cb1', 'pick:a', 50)
    await waitFor(() => h.api.of('sendMessage').length >= 1, 'card')
    const card = h.api.of('sendMessage')[0].body
    expect(card.text).toBe(renderCard(t, 'en', NOW))
    expect(keyboard(card)).toEqual(cardButtons(t, 'en'))
    expect(h.bot.liveMessage('a')).toEqual({ chatId: '42', messageId: 100 })
    h.api.callback('cb2', 'sub:a:s1', 100)
    await waitFor(() => h.api.of('editMessageText').length >= 1, 'card edit')
    const toggled = h.data().tasks[0]
    expect(toggled.subtasks[0].done).toBe(true)
    const edit = h.api.of('editMessageText')[0].body
    expect(edit).toMatchObject({ chat_id: '42', message_id: 100, text: renderCard(toggled, 'en', NOW) })
    expect(keyboard(edit)![0][0].text).toBe('☑ Book')
    // Priority cycles and re-renders as well
    h.api.callback('cb3', 'prio:a', 100)
    await waitFor(() => h.api.of('editMessageText').length >= 2, 'prio edit')
    expect(h.data().tasks[0].priority).toBe('low')
    expect(h.api.of('editMessageText')[1].body.text).toBe(renderCard(h.data().tasks[0], 'en', NOW))
  })

  it('C4: replying to a reminder adds a subtask; replying to an unknown message is a quick add; del:no only drops the keyboard', async () => {
    const h = await running({}, [task({ id: 'a', title: 'Trip' })])
    await h.bot.remind(task({ id: 'a' }), 'Trip', 'soon')
    h.api.message(42, 'pack socks', { reply_to_message: { message_id: 100 } })
    await waitFor(() => h.data().tasks[0].subtasks.length === 1, 'subtask')
    expect(h.data().tasks[0].subtasks[0].title).toBe('pack socks')
    expect(h.data().tasks).toHaveLength(1)
    await waitFor(() => h.api.of('sendMessage').length >= 2, 'confirmation')
    expect(h.api.of('sendMessage')[1].body.text).toBe(translate('en', 'tg_sub_added', { title: '<b>Trip</b>' }))
    // the confirmation is remembered too: replying to it attaches a note
    h.api.message(42, 'note: hotel booked', { reply_to_message: { message_id: 101 } })
    await waitFor(() => h.data().tasks[0].notes === 'hotel booked', 'note')
    h.api.message(42, 'buy milk', { reply_to_message: { message_id: 9999 } })
    await waitFor(() => h.data().tasks.length === 2, 'quick add')
    expect(h.data().tasks[0].title).toBe('buy milk')
    // forwarded message → link-style task
    h.api.message(42, 'Read later https://example.com/a', { forward_date: 1 })
    await waitFor(() => h.data().tasks.length === 3, 'forward')
    expect(h.data().tasks[0]).toMatchObject({ title: 'Read later', notes: 'Read later https://example.com/a' })
    h.api.callback('cb1', 'del:a:no', 100)
    await waitFor(() => h.api.of('editMessageReplyMarkup').length >= 1, 'keyboard removed')
    expect(h.api.of('editMessageReplyMarkup')[0].body).toEqual({ chat_id: '42', message_id: 100, reply_markup: { inline_keyboard: [] } })
    expect(h.api.of('editMessageText')).toHaveLength(0)
  })

  it('C7: /backup sends the data file as a multipart document, named by date, without the token', async () => {
    const h = await running({ token: 'TOKEN' }, [task({ id: 'a', title: 'Secret task' })])
    h.api.message(42, '/backup')
    await waitFor(() => h.api.of('sendDocument').length >= 1, 'document')
    const call = h.api.of('sendDocument')[0]
    expect(call.token).toBe('TOKEN')
    expect(call.raw).toMatch(/filename="hyperdo-backup-\d{4}-\d{2}-\d{2}\.json"/)
    expect(call.raw).toContain('name="chat_id"')
    expect(call.raw).toContain('Secret task')
    expect(call.raw).toContain(translate('en', 'tg_backup_caption', { n: 1 }))
    expect(call.raw).toContain('"token": ""')
    expect(call.raw!.replace(/\/botTOKEN\//g, '')).not.toContain('TOKEN')
    expect(h.api.of('sendMessage')).toHaveLength(0)
  })

  it('C6: sendDigest() posts the morning digest with pick buttons for the top 3 and makes them the numbering', async () => {
    const h = await running({}, [task({ id: 'a', title: 'A', priority: 'high' }), task({ id: 'b', title: 'B' }), task({ id: 'c', title: 'C', priority: 'low' }), task({ id: 'd', title: 'D', priority: 'low' })])
    await h.bot.sendDigest('morning')
    const sent = h.api.of('sendMessage')
    expect(sent).toHaveLength(1)
    expect(String(sent[0].body.text).startsWith(`<b>${translate('en', 'digest_morning_title')}</b>`)).toBe(true)
    expect(keyboard(sent[0].body)).toEqual([[{ text: '1', callback_data: 'pick:a' }, { text: '2', callback_data: 'pick:b' }, { text: '3', callback_data: 'pick:c' }]])
    h.api.message(42, '/done 3')
    await waitFor(() => h.data().tasks.find((t) => t.id === 'c')!.completedAt !== null, 'done by digest number')
    // not linked / stopped: silent
    h.bot.stop()
    await h.bot.sendDigest('evening')
    expect(h.api.of('sendMessage')).toHaveLength(2)
  })
})
