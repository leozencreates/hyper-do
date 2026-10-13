import { describe, it, expect } from 'vitest'
import {
  backupDocument,
  botCommands,
  cardButtons,
  chunkText,
  completedHtml,
  digestReply,
  escapeHtml,
  handleCallback,
  handleMessage,
  helpText,
  linkTitle,
  listTaskIds,
  numberButtons,
  parseEveryArg,
  parseMuteArg,
  parsePriorityWord,
  reminderText,
  renderCard,
  shouldSendToTelegram,
  taskButtons,
  tomorrowMorning,
  viewTasks,
  type TgContext,
} from './telegram-commands'
import { normalizeData } from './data'
import { normalizeTask } from './tasks'
import { buildNotification } from './reminder'
import { DEFAULT_SETTINGS, type AppData, type Settings, type Task, type TelegramSettings } from './types'
import { translate, type Lang } from './i18n'
import { dayKey, formatDue } from './dates'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const H = 60 * MIN
const OWNER = '42'

const settings = (o: Partial<Settings> = {}, tg: Partial<TelegramSettings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  ...o,
  telegram: { ...DEFAULT_SETTINGS.telegram, enabled: true, token: 'tok', chatId: OWNER, ...tg },
})
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW, order: NOW, remindEveryMin: 20, ...o })
const data = (tasks: Task[], s: Settings = settings()): AppData => normalizeData({ tasks, settings: s })
const ctx = (d: AppData, listIndex: string[] = [], chatId = OWNER): TgContext => ({ data: d, now: NOW, chatId, listIndex })
const apply = (d: AppData, effect: { mutate?: (x: AppData) => AppData }) => (effect.mutate ? effect.mutate(d) : d)
const find = (d: AppData, id: string) => d.tasks.find((t) => t.id === id)!

/** Four open tasks, one per /list section: a overdue · b today · c later · d no date (focused). */
const SAMPLE = () =>
  data([
    task({ id: 'a', title: 'Pay bill', dueAt: NOW - H, priority: 'high' }),
    task({ id: 'b', title: 'Call mom', dueAt: NOW + 2 * H }),
    task({ id: 'c', title: 'Dentist', dueAt: NOW + 26 * H, priority: 'low', subtasks: [{ id: 's1', title: 'book', done: false }] }),
    task({ id: 'd', title: 'Write report', focused: true }),
    task({ id: 'z', title: 'Old one', completedAt: NOW - H }),
  ])

describe('escapeHtml', () => {
  it('escapes & < > and leaves everything else alone', () => {
    expect(escapeHtml('a <b> & "c" ‘d’ 🔴')).toBe('a &lt;b&gt; &amp; "c" ‘d’ 🔴')
    expect(escapeHtml('')).toBe('')
  })
})

describe('chunkText', () => {
  it('never splits inside a line and keeps every line exactly once', () => {
    const lines = Array.from({ length: 60 }, (_, i) => `${i + 1}. ${'x'.repeat(90)}`)
    const text = lines.join('\n')
    const chunks = chunkText(text, 1000)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(1000)
      for (const l of c.split('\n')) expect(lines).toContain(l)
    }
    expect(chunks.join('\n')).toBe(text)
  })

  it('returns one piece for short text, keeps an over-long line whole and nothing for empty input', () => {
    expect(chunkText('a\nb', 100)).toEqual(['a\nb'])
    expect(chunkText('a\n' + 'y'.repeat(50) + '\nb', 20)).toEqual(['a', 'y'.repeat(50), 'b'])
    expect(chunkText('')).toEqual([])
  })
})

describe('botCommands / helpText', () => {
  it('lists the same commands in /help in all three languages, with Telegram-valid names and descriptions', () => {
    for (const lang of ['en', 'tr', 'ru'] as Lang[]) {
      const cmds = botCommands(lang)
      expect(cmds.map((c) => c.command)).toEqual(['add', 'done', 'snooze', 'focus', 'due', 'prio', 'every', 'sub', 'note', 'rename', 'del', 'undo', 'list', 'today', 'week', 'overdue', 'search', 'stats', 'mute', 'quiet', 'backup', 'help'])
      const help = helpText(lang)
      expect(help.startsWith(translate(lang, 'tg_help'))).toBe(true)
      // grouped Tasks · Views · Reminders · Other, in that order
      const groups = (['tg_help_tasks', 'tg_help_views', 'tg_help_reminders', 'tg_help_other'] as const).map((k) => help.indexOf(`<b>${escapeHtml(translate(lang, k))}</b>`))
      expect(groups.every((i) => i >= 0)).toBe(true)
      expect([...groups].sort((a, b) => a - b)).toEqual(groups)
      expect(help.indexOf('/backup')).toBeGreaterThan(groups[3])
      expect(help.indexOf('/mute')).toBeGreaterThan(groups[2])
      expect(help.indexOf('/mute')).toBeLessThan(groups[3])
      expect(help).toContain(escapeHtml(translate(lang, 'tg_help_reply')))
      for (const c of cmds) {
        expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/)
        expect(c.description.length).toBeGreaterThan(0)
        expect(c.description.length).toBeLessThanOrEqual(256)
        expect(Object.keys(c)).toEqual(['command', 'description'])
        expect(help).toContain(`/${c.command}`)
        expect(help).toContain(escapeHtml(c.description))
      }
      expect(help).toContain('(/l)')
      expect(help).toContain(escapeHtml(translate(lang, 'tg_help_plain')))
    }
  })
})

describe('taskButtons / reminderText', () => {
  it('builds two rows [Done, Focus] / [30 min, 1 h, Tomorrow] with the task id in the callback data (B4)', () => {
    const rows = taskButtons('t9', 'en')
    expect(rows).toHaveLength(2)
    expect(rows[0].map((b) => b.callback_data)).toEqual(['done:t9', 'focus:t9'])
    expect(rows[1].map((b) => b.callback_data)).toEqual(['snooze:t9:30', 'snooze:t9:60', 'snooze:t9:tomorrow'])
    expect(rows[0][0].text).toBe(translate('en', 'tg_btn_done'))
    expect(rows[1][2].text).toBe(translate('en', 'tg_btn_tomorrow'))
  })

  it('reminderText bolds the title and escapes both parts', () => {
    expect(reminderText(task({ id: 'a' }), 'Pay <bill>', 'due & late')).toBe('<b>Pay &lt;bill&gt;</b>\ndue &amp; late')
  })

  it('B6: the escalation line sits above the title once nagCount reaches telegramAfter, and is not repeated from the body', () => {
    const s = settings({ funTitles: false })
    const nagged = task({ id: 'a', title: 'Pay bill', nagCount: 3, dueAt: NOW + 30 * MIN })
    const { title, body } = buildNotification(nagged, false, s, NOW)
    expect(body.startsWith(translate('en', 'escalation_line', { n: 3 }))).toBe(true)
    const html = reminderText(nagged, title, body, s)
    const lines = html.split('\n')
    expect(lines[0]).toBe(translate('en', 'tg_escalation', { n: 3 }))
    expect(lines[1]).toBe('<b>🟠 Pay bill</b>')
    expect(lines[2]).toBe(escapeHtml(body.slice(translate('en', 'escalation_line', { n: 3 }).length + 3)))
    expect(html.match(/3×/g)).toHaveLength(1)
    // below the threshold or with the ladder off: no prefix line
    expect(reminderText(task({ id: 'b', nagCount: 2 }), 'T', 'B', s)).toBe('<b>T</b>\nB')
    const off = settings({ escalation: { enabled: false, telegramAfter: 3, popupAfter: 5 } })
    expect(reminderText(task({ id: 'c', nagCount: 9 }), 'T', 'B', off)).toBe('<b>T</b>\nB')
    // a body that is only the escalation line leaves just the title
    expect(reminderText(nagged, 'T', translate('en', 'escalation_line', { n: 3 }), s)).toBe(`${translate('en', 'tg_escalation', { n: 3 })}\n<b>T</b>`)
  })

  it('completedHtml strikes the bold title through and appends when the title is not bold in the message', () => {
    expect(completedHtml('<b>Pay &lt;bill&gt;</b>\ndue soon', 'Pay <bill>')).toBe('<s>Pay &lt;bill&gt;</s> ✓\ndue soon')
    expect(completedHtml('plain text', 'Pay bill')).toBe('plain text\n\n<s>Pay bill</s> ✓')
  })

  it('numberButtons: pick:<id> buttons, rows of 5, first 20 only', () => {
    const ids = Array.from({ length: 23 }, (_, i) => `t${i}`)
    const rows = numberButtons(ids)
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.length)).toEqual([5, 5, 5, 5])
    expect(rows[0][0]).toEqual({ text: '1', callback_data: 'pick:t0' })
    expect(rows[3][4]).toEqual({ text: '20', callback_data: 'pick:t19' })
    expect(numberButtons(['a', 'b'])).toEqual([[{ text: '1', callback_data: 'pick:a' }, { text: '2', callback_data: 'pick:b' }]])
    expect(numberButtons([])).toEqual([])
  })
})

describe('pure decisions (B3 / B4 / B5)', () => {
  it('shouldSendToTelegram: always when the idle rule is off; otherwise only after idleMinutes of inactivity', () => {
    expect(shouldSendToTelegram(settings({}, { onlyWhenIdle: false }), 0)).toBe(true)
    const idle = settings({}, { onlyWhenIdle: true, idleMinutes: 5 })
    expect(shouldSendToTelegram(idle, 0)).toBe(false)
    expect(shouldSendToTelegram(idle, 299)).toBe(false)
    expect(shouldSendToTelegram(idle, 300)).toBe(true)
    expect(shouldSendToTelegram(idle, Infinity)).toBe(true) // locked session
    expect(shouldSendToTelegram(settings({}, { onlyWhenIdle: true, idleMinutes: 0 }), 60)).toBe(true) // clamped to ≥ 1 min
  })

  it('tomorrowMorning: next calendar day at 09:00, or at quietHours.to when quiet hours are on; across midnight and DST', () => {
    expect(tomorrowMorning(NOW, settings())).toBe(new Date(2026, 9, 14, 9, 0).getTime())
    expect(tomorrowMorning(new Date(2026, 9, 13, 23, 59).getTime(), settings())).toBe(new Date(2026, 9, 14, 9, 0).getTime())
    expect(tomorrowMorning(new Date(2026, 9, 14, 0, 1).getTime(), settings())).toBe(new Date(2026, 9, 15, 9, 0).getTime())
    const quiet = settings({ quietHours: { enabled: true, from: '23:00', to: '07:30' } })
    expect(tomorrowMorning(NOW, quiet)).toBe(new Date(2026, 9, 14, 7, 30).getTime())
    // month / year boundaries and a DST switch day (last Sunday of October in Europe): calendar arithmetic, not +24 h
    expect(tomorrowMorning(new Date(2026, 11, 31, 22, 0).getTime(), settings())).toBe(new Date(2027, 0, 1, 9, 0).getTime())
    const dst = new Date(2026, 9, 24, 12, 0).getTime()
    const t = new Date(tomorrowMorning(dst, settings()))
    expect([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2026, 9, 25, 9, 0])
    // a malformed quiet-hours end falls back to 09:00
    expect(tomorrowMorning(NOW, settings({ quietHours: { enabled: true, from: '23:00', to: 'x' } }))).toBe(new Date(2026, 9, 14, 9, 0).getTime())
  })

  it('parseMuteArg understands hours / minutes in EN, TR and RU, bare = 60, off, garbage → null', () => {
    expect(parseMuteArg('')).toEqual({ minutes: 60 })
    expect(parseMuteArg('2h')).toEqual({ minutes: 120 })
    expect(parseMuteArg('90m')).toEqual({ minutes: 90 })
    expect(parseMuteArg('2sa')).toEqual({ minutes: 120 })
    expect(parseMuteArg('45dk')).toEqual({ minutes: 45 })
    expect(parseMuteArg('2ч')).toEqual({ minutes: 120 })
    expect(parseMuteArg('45мин')).toEqual({ minutes: 45 })
    expect(parseMuteArg('2 saat')).toEqual({ minutes: 120 })
    expect(parseMuteArg('1.5h')).toEqual({ minutes: 90 })
    expect(parseMuteArg('30')).toEqual({ minutes: 30 })
    expect(parseMuteArg('off')).toBe('off')
    expect(parseMuteArg('kapat')).toBe('off')
    expect(parseMuteArg('выкл')).toBe('off')
    expect(parseMuteArg('soon')).toBeNull()
    expect(parseMuteArg('0')).toBe('off')
    expect(parseMuteArg('5 parsecs')).toBeNull()
  })

  it('parseEveryArg and parsePriorityWord', () => {
    expect(parseEveryArg('30')).toBe(30)
    expect(parseEveryArg('2h')).toBe(120)
    expect(parseEveryArg('off')).toBe(0)
    expect(parseEveryArg('0')).toBe(0)
    expect(parseEveryArg('')).toBeNull()
    expect(parseEveryArg('lots')).toBeNull()
    expect(parsePriorityWord('1')).toBe('high')
    expect(parsePriorityWord('!2')).toBe('medium')
    expect(parsePriorityWord('low')).toBe('low')
    expect(parsePriorityWord('yüksek')).toBe('high')
    expect(parsePriorityWord('низкий')).toBe('low')
    expect(parsePriorityWord('7')).toBeNull()
  })
})

describe('/list', () => {
  it('groups Overdue · Today · Later · No date with continuous numbering and bold titles', () => {
    const d = SAMPLE()
    const r = handleMessage('/list', ctx(d))
    expect(r.mutate).toBeUndefined()
    expect(r.listIndex).toEqual(['a', 'b', 'c', 'd'])
    expect(listTaskIds(d.tasks, NOW)).toEqual(['a', 'b', 'c', 'd'])
    expect(r.replies).toHaveLength(1)
    const text = r.replies[0].text
    expect(text.startsWith(translate('en', 'tg_list_title', { n: 4 }))).toBe(true)
    const pos = (s: string) => {
      const i = text.indexOf(s)
      expect(i, s).toBeGreaterThanOrEqual(0)
      return i
    }
    expect(pos('<b>Overdue</b>')).toBeLessThan(pos('1. 🔴 <b>Pay bill</b>'))
    expect(pos('1. 🔴 <b>Pay bill</b>')).toBeLessThan(pos('<b>Today</b>'))
    expect(pos('<b>Today</b>')).toBeLessThan(pos('2. 🟠 <b>Call mom</b>'))
    expect(pos('2. 🟠 <b>Call mom</b>')).toBeLessThan(pos('<b>Later</b>'))
    expect(pos('<b>Later</b>')).toBeLessThan(pos('3. 🟢 <b>Dentist</b>'))
    expect(text).toContain(translate('en', 'open_subs', { n: 1 }))
    expect(pos('3. 🟢 <b>Dentist</b>')).toBeLessThan(pos('<b>No date</b>'))
    expect(pos('<b>No date</b>')).toBeLessThan(pos('4. 🟠 🎯 <b>Write report</b>'))
    expect(text).not.toContain('Old one')
  })

  it('escapes titles, answers the empty list and strips the @botname suffix', () => {
    const d = data([task({ id: 'a', title: 'a <b> & c' })])
    expect(handleMessage('/list@HyperDoBot', ctx(d)).replies[0].text).toContain('<b>a &lt;b&gt; &amp; c</b>')
    const empty = handleMessage('/L', ctx(data([])))
    expect(empty.replies).toEqual([{ text: translate('en', 'tg_list_empty') }])
    expect(empty.listIndex).toEqual([])
  })

  it('splits a long list into several messages at line boundaries', () => {
    const many = data(Array.from({ length: 120 }, (_, i) => task({ id: `t${i}`, title: `Task number ${i} ${'·'.repeat(40)}` })))
    const r = handleMessage('/list', ctx(many))
    expect(r.replies.length).toBeGreaterThan(1)
    for (const m of r.replies) expect(m.text.length).toBeLessThanOrEqual(3800)
    expect(r.replies.map((m) => m.text).join('\n')).toContain('120. 🟠 <b>Task number 119')
    expect(r.listIndex).toHaveLength(120)
  })
})

describe('/done', () => {
  it('/done 2 completes the second listed task and bumps dailyDone', () => {
    const d = SAMPLE()
    const r = handleMessage('/done 2', ctx(d, ['a', 'b', 'c', 'd']))
    expect(r.replies[0].text).toBe(translate('en', 'tg_done_ok', { title: '<b>Call mom</b>' }))
    const next = apply(d, r)
    expect(find(next, 'b').completedAt).not.toBeNull()
    expect(find(next, 'a').completedAt).toBeNull()
    expect(Object.values(next.dailyDone)).toEqual([1])
  })

  it('/done 1 3 4 completes several tasks in one go (duplicates and bad numbers skipped)', () => {
    const d = SAMPLE()
    const r = handleMessage('/d 1 3 4 3 99', ctx(d, ['a', 'b', 'c', 'd']))
    expect(r.replies[0].text).toContain(translate('en', 'tg_done_many', { n: 3 }))
    expect(r.replies[0].text).toContain('• <b>Dentist</b>')
    const next = apply(d, r)
    expect(['a', 'c', 'd'].map((id) => find(next, id).completedAt !== null)).toEqual([true, true, true])
    expect(find(next, 'b').completedAt).toBeNull()
    expect(Object.values(next.dailyDone)).toEqual([3])
  })

  it('answers "no such number" without a mutation for a missing or invalid argument', () => {
    for (const text of ['/done', '/done 0', '/done x', '/done 9']) {
      const r = handleMessage(text, ctx(SAMPLE(), ['a', 'b', 'c', 'd']))
      expect(r.mutate).toBeUndefined()
      expect(r.replies).toEqual([{ text: translate('en', 'tg_bad_index') }])
    }
  })

  it('a stale listIndex falls back to the live list order', () => {
    const d = SAMPLE()
    // entry 1 points at a task that no longer exists, entry 2 at a completed one → both resolve by the live order
    const stale = ['gone', 'z']
    const r1 = apply(d, handleMessage('/done 1', ctx(d, stale)))
    expect(find(r1, 'a').completedAt).not.toBeNull()
    const r2 = apply(d, handleMessage('/done 2', ctx(d, stale)))
    expect(find(r2, 'b').completedAt).not.toBeNull()
    // with no list ever requested the live order is used as well
    const r3 = apply(d, handleMessage('/done 4', ctx(d)))
    expect(find(r3, 'd').completedAt).not.toBeNull()
  })
})

describe('/snooze and /focus', () => {
  it('/snooze 2 45 snoozes 45 minutes from now and resets the nag counter', () => {
    const d = data([task({ id: 'a' }), task({ id: 'b', nagCount: 4 })])
    const r = handleMessage('/snooze 2 45', ctx(d, ['a', 'b']))
    expect(r.replies[0].text).toBe(translate('en', 'tg_snoozed', { n: 45, title: '<b>b</b>' }))
    const next = apply(d, r)
    expect(find(next, 'b').snoozedUntil).toBe(NOW + 45 * MIN)
    expect(find(next, 'b').nagCount).toBe(0)
    expect(find(next, 'a').snoozedUntil).toBeNull()
  })

  it('/snooze 2 defaults to 30 minutes; bad numbers are answered, not applied', () => {
    const d = data([task({ id: 'a' }), task({ id: 'b' })])
    expect(find(apply(d, handleMessage('/s 2', ctx(d, ['a', 'b']))), 'b').snoozedUntil).toBe(NOW + 30 * MIN)
    expect(find(apply(d, handleMessage('/snooze 2 abc', ctx(d, ['a', 'b']))), 'b').snoozedUntil).toBe(NOW + 30 * MIN)
    const bad = handleMessage('/snooze 7', ctx(d, ['a', 'b']))
    expect(bad.mutate).toBeUndefined()
    expect(bad.replies[0].text).toBe(translate('en', 'tg_bad_index'))
  })

  it('/focus 1 puts the task in focus and takes it from the previous one', () => {
    const d = SAMPLE()
    const r = handleMessage('/focus 1', ctx(d, ['a', 'b', 'c', 'd']))
    expect(r.replies[0].text).toBe(translate('en', 'tg_focused', { title: '<b>Pay bill</b>' }))
    const next = apply(d, r)
    expect(find(next, 'a').focused).toBe(true)
    expect(find(next, 'd').focused).toBe(false)
  })
})

describe('/add and plain text', () => {
  const TR = settings({ language: 'tr' })

  it('/add yarın 18:00 fatura #ev !1 @30dk sets every parsed field and echoes them one per line', () => {
    const d = data([task({ id: 'a' })], TR)
    const r = handleMessage('/add yarın 18:00 fatura #ev !1 @30dk', ctx(d))
    const next = apply(d, r)
    expect(next.tasks).toHaveLength(2)
    const t = next.tasks[0]
    expect(t).toMatchObject({ title: 'fatura', priority: 'high', tags: ['ev'], remindEveryMin: 30, dueAt: new Date(2026, 9, 14, 18, 0).getTime(), completedAt: null })
    expect(t.order).toBeLessThan(find(next, 'a').order)
    const lines = r.replies[0].text.split('\n')
    expect(lines[0]).toBe(translate('tr', 'tg_added', { title: '<b>fatura</b>' }))
    expect(lines[1]).toBe(translate('tr', 'tg_added_due', { due: formatDue(t.dueAt, 'tr', NOW) }))
    expect(lines[2]).toBe(translate('tr', 'tg_added_prio', { icon: '🔴', prio: translate('tr', 'p_high') }))
    expect(lines[3]).toBe(translate('tr', 'tg_added_tags', { tags: '#ev' }))
    expect(lines[4]).toBe(translate('tr', 'tg_added_every', { n: 30 }))
    expect(lines).toHaveLength(5)
    expect(r.replies[0].buttons).toEqual(taskButtons(t.id, 'tr'))
  })

  it('plain text is the same as /add, and a bare title echoes only the first line', () => {
    const d = data([], TR)
    const viaAdd = apply(d, handleMessage('/add yarın 18:00 fatura #ev !1 @30dk', ctx(d))).tasks[0]
    const plain = apply(d, handleMessage('yarın 18:00 fatura #ev !1 @30dk', ctx(d))).tasks[0]
    const strip = ({ id: _i, createdAt: _c, order: _o, updatedAt: _u, ...rest }: Task) => rest
    expect(strip(plain)).toEqual(strip(viaAdd))
    const r = handleMessage('süt al', ctx(d))
    expect(r.replies[0].text).toBe(translate('tr', 'tg_added', { title: '<b>süt al</b>' }))
    expect(apply(d, r).tasks[0]).toMatchObject({ title: 'süt al', priority: 'medium', tags: [], remindEveryMin: DEFAULT_SETTINGS.defaultRemindEveryMin, dueAt: null })
  })

  it('uses the raw text as title when parsing leaves nothing (and still keeps the date), escapes HTML in titles', () => {
    const d = data([], TR)
    const only = apply(d, handleMessage('yarın', ctx(d))).tasks[0]
    expect(only.title).toBe('yarın')
    expect(only.dueAt).toBe(new Date(2026, 9, 14, 23, 59).getTime())
    const r = handleMessage('/a fix <div> & co #a&b', ctx(d))
    expect(r.replies[0].text).toContain('<b>fix &lt;div&gt; &amp; co</b>')
    expect(r.replies[0].text).toContain(translate('tr', 'tg_added_tags', { tags: '#a&amp;b' }))
  })

  it('an empty /add and an unknown command answer with the help text', () => {
    const d = SAMPLE()
    expect(handleMessage('/add', ctx(d))).toEqual({ replies: [{ text: helpText('en') }] })
    expect(handleMessage('/whatever 1', ctx(d))).toEqual({ replies: [{ text: helpText('en') }] })
    expect(handleMessage('/help', ctx(d))).toEqual({ replies: [{ text: helpText('en') }] })
  })

  it('a recurrence token is echoed as a ↻ line', () => {
    const d = data([])
    const r = handleMessage('water plants *weekly', ctx(d))
    expect(r.replies[0].text).toContain(`↻ ${translate('en', 'r_weekly')}`)
    expect(apply(d, r).tasks[0].recurrence).toBe('weekly')
  })
})

describe('/start and pairing', () => {
  const unlinked = (pairCode: string) => data([], settings({}, { chatId: '', pairCode }))

  it('unlinked: wrong or missing code is refused, the right code links the chat and clears the code', () => {
    const d = unlinked('123456')
    for (const text of ['/start', '/start 111111', '/start@HyperDoBot abc']) {
      const r = handleMessage(text, ctx(d, [], '777'))
      expect(r.mutate).toBeUndefined()
      expect(r.replies).toEqual([{ text: translate('en', 'tg_need_code') }])
    }
    const ok = handleMessage('/start 123456', ctx(d, [], '777'))
    expect(ok.replies[0].text.startsWith(translate('en', 'tg_hello'))).toBe(true)
    expect(ok.replies[0].text).toContain(helpText('en'))
    const next = apply(d, ok)
    expect(next.settings.telegram.chatId).toBe('777')
    expect(next.settings.telegram.pairCode).toBe('')
  })

  it('unlinked without a code (nothing generated yet): no code can link', () => {
    const r = handleMessage('/start 123456', ctx(unlinked(''), [], '777'))
    expect(r.mutate).toBeUndefined()
    expect(r.replies).toEqual([{ text: translate('en', 'tg_need_code') }])
  })

  it('linked: the owner is greeted (no code needed), every other chat is told the bot is taken', () => {
    const d = data([], settings({}, { chatId: OWNER, pairCode: '123456' }))
    const owner = handleMessage('/start', ctx(d))
    expect(owner.mutate).toBeUndefined()
    expect(owner.replies[0].text.startsWith(translate('en', 'tg_hello'))).toBe(true)
    for (const text of ['/start', '/start 123456']) {
      const other = handleMessage(text, ctx(d, [], '999'))
      expect(other.mutate).toBeUndefined()
      expect(other.replies).toEqual([{ text: translate('en', 'tg_not_linked') }])
    }
  })

  it('every other message from a foreign (or no linked) chat is ignored', () => {
    expect(handleMessage('/list', ctx(SAMPLE(), [], '999'))).toEqual({ replies: [] })
    expect(handleMessage('buy milk', ctx(SAMPLE(), [], '999'))).toEqual({ replies: [] })
    expect(handleMessage('/list', ctx(unlinked('123456'), [], OWNER))).toEqual({ replies: [] })
  })
})

describe('inline button callbacks', () => {
  it('done:<id> completes the task, toasts plain text and drops the buttons', () => {
    const d = SAMPLE()
    const r = handleCallback('done:a', ctx(d))
    expect(r.toast).toBe(translate('en', 'tg_done_ok', { title: 'Pay bill' }))
    expect(r.keepButtons).toBe(false)
    expect(r.append).toBe(translate('en', 'tg_done_ok', { title: '<b>Pay bill</b>' }))
    expect(r.effect.replies).toEqual([])
    const next = apply(d, r.effect)
    expect(find(next, 'a').completedAt).not.toBeNull()
    expect(Object.values(next.dailyDone)).toEqual([1])
  })

  it('snooze:<id>:30 snoozes from now, focus:<id> focuses; both keep the buttons', () => {
    const d = data([task({ id: 'a', title: 'A & B', nagCount: 2 }), task({ id: 'b', focused: true })])
    const s = handleCallback('snooze:a:30', ctx(d))
    expect(s.keepButtons).toBe(true)
    expect(s.toast).toBe(translate('en', 'tg_snoozed', { n: 30, title: 'A & B' })) // plain, not escaped
    expect(s.append).toContain('<b>A &amp; B</b>')
    expect(find(apply(d, s.effect), 'a')).toMatchObject({ snoozedUntil: NOW + 30 * MIN, nagCount: 0 })
    expect(find(apply(d, handleCallback('snooze:a:x', ctx(d)).effect), 'a').snoozedUntil).toBe(NOW + 30 * MIN)
    const f = handleCallback('focus:a', ctx(d))
    expect(f.keepButtons).toBe(true)
    const next = apply(d, f.effect)
    expect(find(next, 'a').focused).toBe(true)
    expect(find(next, 'b').focused).toBe(false)
  })

  it('unknown id toasts "no such number"; foreign chats and unknown actions are silently acknowledged', () => {
    const d = SAMPLE()
    const unknown = handleCallback('done:nope', ctx(d))
    expect(unknown).toEqual({ effect: { replies: [] }, toast: translate('en', 'tg_bad_index'), keepButtons: true })
    expect(handleCallback('done:a', ctx(d, [], '999'))).toEqual({ effect: { replies: [] }, toast: '', keepButtons: true })
    expect(handleCallback('explode:a', ctx(d))).toEqual({ effect: { replies: [] }, toast: '', keepButtons: true })
  })

  it('snooze:<id>:tomorrow snoozes until tomorrow morning and says so (B4)', () => {
    const d = SAMPLE()
    const r = handleCallback('snooze:a:tomorrow', ctx(d))
    const until = new Date(2026, 9, 14, 9, 0).getTime()
    expect(find(apply(d, r.effect), 'a').snoozedUntil).toBe(until)
    expect(r.keepButtons).toBe(true)
    expect(r.toast).toBe(translate('en', 'tg_snoozed_until', { t: formatDue(until, 'en', NOW), title: 'Pay bill' }))
    expect(r.append).toBe(translate('en', 'tg_snoozed_until', { t: formatDue(until, 'en', NOW), title: '<b>Pay bill</b>' }))
    const quiet = data(d.tasks, settings({ quietHours: { enabled: true, from: '22:00', to: '07:00' } }))
    expect(find(apply(quiet, handleCallback('snooze:a:tomorrow', ctx(quiet)).effect), 'a').snoozedUntil).toBe(new Date(2026, 9, 14, 7, 0).getTime())
  })
})

describe('/mute and /quiet (B5)', () => {
  it('/mute 2h mutes until the given time and answers with the local time; /mute off unmutes; bare = 1 h', () => {
    const d = SAMPLE()
    const r = handleMessage('/mute 2h', ctx(d))
    const next = apply(d, r)
    expect(next.settings.mutedUntil).toBe(NOW + 2 * H)
    expect(r.replies[0].text).toBe(translate('en', 'tg_muted', { t: new Date(NOW + 2 * H).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }))
    expect(apply(d, handleMessage('/mute', ctx(d))).settings.mutedUntil).toBe(NOW + H)
    const off = handleMessage('/mute off', ctx(next))
    expect(apply(next, off).settings.mutedUntil).toBeNull()
    expect(off.replies[0].text).toBe(translate('en', 'tg_unmuted'))
    // past midnight the reply names the day
    const late = handleMessage('/mute 20h', ctx(d))
    expect(late.replies[0].text).toBe(translate('en', 'tg_muted', { t: formatDue(NOW + 20 * H, 'en', NOW) }))
    const bad = handleMessage('/mute later', ctx(d))
    expect(bad.mutate).toBeUndefined()
    expect(bad.replies[0].text).toBe(escapeHtml(translate('en', 'tg_cmd_mute')))
  })

  it('/mute understands TR and RU units in their own language settings', () => {
    const tr = data([], settings({ language: 'tr' }))
    expect(apply(tr, handleMessage('/mute 2sa', ctx(tr))).settings.mutedUntil).toBe(NOW + 2 * H)
    expect(apply(tr, handleMessage('/mute 45dk', ctx(tr))).settings.mutedUntil).toBe(NOW + 45 * MIN)
    expect(handleMessage('/mute kapat', ctx(tr)).replies[0].text).toBe(translate('tr', 'tg_unmuted'))
    const ru = data([], settings({ language: 'ru' }))
    expect(apply(ru, handleMessage('/mute 2ч', ctx(ru))).settings.mutedUntil).toBe(NOW + 2 * H)
    expect(apply(ru, handleMessage('/mute 45мин', ctx(ru))).settings.mutedUntil).toBe(NOW + 45 * MIN)
    expect(handleMessage('/mute выкл', ctx(ru)).replies[0].text).toBe(translate('ru', 'tg_unmuted'))
  })

  it('/quiet toggles quiet hours, /quiet on|off sets them, and the reply names the window', () => {
    const d = data([], settings({ quietHours: { enabled: false, from: '22:00', to: '07:00' } }))
    const on = handleMessage('/quiet', ctx(d))
    const next = apply(d, on)
    expect(next.settings.quietHours).toEqual({ enabled: true, from: '22:00', to: '07:00' })
    expect(on.replies[0].text).toBe(translate('en', 'tg_quiet_state', { state: translate('en', 'tg_on'), from: '22:00', to: '07:00' }))
    expect(apply(next, handleMessage('/quiet', ctx(next))).settings.quietHours.enabled).toBe(false)
    expect(apply(next, handleMessage('/quiet on', ctx(next))).settings.quietHours.enabled).toBe(true)
    const off = handleMessage('/quiet off', ctx(next))
    expect(apply(next, off).settings.quietHours.enabled).toBe(false)
    expect(off.replies[0].text).toContain(translate('en', 'tg_off'))
  })
})

describe('views (C1)', () => {
  it('/today = due today or overdue, /week = this week or overdue, /overdue, /search; all share the renderer, numbering and pick buttons', () => {
    const d = SAMPLE()
    const today = handleMessage('/today', ctx(d))
    expect(today.listIndex).toEqual(['a', 'b'])
    expect(today.replies[0].text.startsWith(translate('en', 'tg_today_title', { n: 2 }))).toBe(true)
    expect(today.replies[0].text).toContain('1. 🔴 <b>Pay bill</b>')
    expect(today.replies[0].text).toContain('2. 🟠 <b>Call mom</b>')
    expect(today.replies[0].buttons).toEqual([[{ text: '1', callback_data: 'pick:a' }, { text: '2', callback_data: 'pick:b' }]])
    expect(handleMessage('/week', ctx(d)).listIndex).toEqual(['a', 'b', 'c'])
    expect(handleMessage('/overdue', ctx(d)).listIndex).toEqual(['a'])
    const search = handleMessage('/search REPORT', ctx(d))
    expect(search.listIndex).toEqual(['d'])
    expect(search.replies[0].text.startsWith(translate('en', 'tg_search_title', { q: 'REPORT', n: 1 }))).toBe(true)
    expect(handleMessage('/search', ctx(d)).replies[0].text).toBe(translate('en', 'tg_need_text'))
    // /list carries the number buttons as well; the numbering of a view is what /done N uses afterwards
    expect(handleMessage('/list', ctx(d)).replies[0].buttons).toHaveLength(1)
    expect(find(apply(d, handleMessage('/done 1', ctx(d, search.listIndex!))), 'd').completedAt).not.toBeNull()
    expect(viewTasks(d.tasks, NOW, 'week').map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('an empty view answers "nothing here" without buttons, a far-future task is only in /list', () => {
    const d = data([task({ id: 'x', dueAt: NOW + 30 * 24 * H })])
    expect(handleMessage('/overdue', ctx(d))).toEqual({ replies: [{ text: translate('en', 'tg_view_empty') }], listIndex: [] })
    expect(handleMessage('/today', ctx(d)).listIndex).toEqual([])
    expect(handleMessage('/week', ctx(d)).listIndex).toEqual([])
    expect(handleMessage('/list', ctx(d)).listIndex).toEqual(['x'])
  })

  it('/stats shows done today / 7 days, and streak + focus lines only when there is data', () => {
    const bare = handleMessage('/stats', ctx(SAMPLE()))
    expect(bare.replies[0].text).toBe([translate('en', 'tg_stats_title'), translate('en', 'tg_stats_done', { today: 0, week: 0 })].join('\n'))
    const rich: AppData = {
      ...SAMPLE(),
      dailyDone: { [dayKey(NOW)]: 2, [dayKey(NOW - 24 * H)]: 1, [dayKey(NOW - 10 * 24 * H)]: 5 },
      focusLog: [
        { id: 'f1', taskId: 'a', phase: 'work', startedAt: NOW - 2 * H, endedAt: NOW - H },
        { id: 'f2', taskId: 'a', phase: 'work', startedAt: NOW - 3 * 24 * H, endedAt: NOW - 3 * 24 * H + 30 * MIN },
        { id: 'f3', taskId: null, phase: 'break', startedAt: NOW - H, endedAt: NOW },
      ],
    }
    const lines = handleMessage('/stats', ctx(rich)).replies[0].text.split('\n')
    expect(lines).toEqual([translate('en', 'tg_stats_title'), translate('en', 'tg_stats_done', { today: 2, week: 3 }), translate('en', 'tg_stats_streak', { n: 2 }), translate('en', 'tg_stats_focus', { today: '1h', week: '1h 30m' })])
  })

  it('/undo reopens the most recently completed task (dailyDone taken back) and mentions a recurring next occurrence', () => {
    const d: AppData = { ...SAMPLE(), dailyDone: { [dayKey(NOW - H)]: 2 } }
    d.tasks.push(task({ id: 'y', title: 'Water plants', completedAt: NOW - 10 * MIN, recurrence: 'daily' }))
    const r = handleMessage('/undo', ctx(d))
    expect(r.replies[0].text).toBe(`${translate('en', 'tg_undo_ok', { title: '<b>Water plants</b>' })} ${translate('en', 'tg_undo_recurring')}`)
    expect(r.replies[0].taskId).toBe('y')
    const next = apply(d, r)
    expect(find(next, 'y').completedAt).toBeNull()
    expect(find(next, 'z').completedAt).not.toBeNull()
    expect(next.dailyDone[dayKey(NOW)]).toBe(1)
    expect(handleMessage('/undo', ctx(data([task({ id: 'a' })]))).replies[0].text).toBe(translate('en', 'tg_undo_none'))
    expect(handleMessage('/undo', ctx(SAMPLE())).replies[0].text).toBe(translate('en', 'tg_undo_ok', { title: '<b>Old one</b>' }))
  })
})

describe('natural arguments (C2)', () => {
  const IDX = ['a', 'b', 'c', 'd']

  it('/snooze N <date text> snoozes until the parsed time, numbers stay minutes', () => {
    const d = data(SAMPLE().tasks, settings({ language: 'tr' }))
    const r = handleMessage('/snooze 2 yarın 09:00', ctx(d, IDX))
    const until = new Date(2026, 9, 14, 9, 0).getTime()
    expect(find(apply(d, r), 'b').snoozedUntil).toBe(until)
    expect(r.replies[0].text).toBe(translate('tr', 'tg_snoozed_until', { t: formatDue(until, 'tr', NOW), title: '<b>Call mom</b>' }))
    expect(find(apply(d, handleMessage('/snooze 2 18:00', ctx(d, IDX))), 'b').snoozedUntil).toBe(new Date(2026, 9, 13, 18, 0).getTime())
    expect(find(apply(d, handleMessage('/snooze 2 45', ctx(d, IDX))), 'b').snoozedUntil).toBe(NOW + 45 * MIN)
    const en = SAMPLE()
    expect(find(apply(en, handleMessage('/s 1 in 2h', ctx(en, IDX))), 'a').snoozedUntil).toBe(NOW + 2 * H)
  })

  it('/due N <date> sets the due date (nag reset, snooze cleared); off clears it; unreadable text is refused', () => {
    const d = data([task({ id: 'a', nagCount: 4, snoozedUntil: NOW + H })])
    const r = handleMessage('/due 1 friday 17:00', ctx(d))
    const due = new Date(2026, 9, 16, 17, 0).getTime()
    expect(find(apply(d, r), 'a')).toMatchObject({ dueAt: due, nagCount: 0, snoozedUntil: null })
    expect(r.replies[0].text).toBe(translate('en', 'tg_due_set', { title: '<b>a</b>', due: formatDue(due, 'en', NOW) }))
    expect(find(apply(d, handleMessage('/due 1 off', ctx(d))), 'a').dueAt).toBeNull()
    const bad = handleMessage('/due 1 whenever', ctx(d))
    expect(bad.mutate).toBeUndefined()
    expect(bad.replies[0].text).toBe(translate('en', 'tg_bad_date'))
    expect(handleMessage('/due 1', ctx(d)).replies[0].text).toBe(translate('en', 'tg_bad_date'))
    expect(handleMessage('/due 9 tomorrow', ctx(d)).replies[0].text).toBe(translate('en', 'tg_bad_index'))
  })

  it('/prio, /every, /sub, /note, /rename change one task each and confirm in HTML', () => {
    const d = SAMPLE()
    const prio = handleMessage('/prio 2 1', ctx(d, IDX))
    expect(find(apply(d, prio), 'b').priority).toBe('high')
    expect(prio.replies[0].text).toBe(translate('en', 'tg_prio_set', { icon: '🔴', title: '<b>Call mom</b>', prio: translate('en', 'p_high') }))
    expect(find(apply(d, handleMessage('/prio 2 düşük', ctx(d, IDX))), 'b').priority).toBe('low')
    expect(handleMessage('/prio 2 urgent', ctx(d, IDX)).replies[0].text).toBe(translate('en', 'tg_bad_prio'))

    const every = handleMessage('/every 2 2h', ctx(d, IDX))
    expect(find(apply(d, every), 'b').remindEveryMin).toBe(120)
    expect(every.replies[0].text).toBe(translate('en', 'tg_every_set', { title: '<b>Call mom</b>', n: 120 }))
    const off = handleMessage('/every 2 off', ctx(d, IDX))
    expect(find(apply(d, off), 'b').remindEveryMin).toBe(0)
    expect(off.replies[0].text).toBe(translate('en', 'tg_every_off', { title: '<b>Call mom</b>' }))

    const sub = handleMessage('/sub 3 call & book', ctx(d, IDX))
    const withSub = find(apply(d, sub), 'c')
    expect(withSub.subtasks.map((s) => s.title)).toEqual(['book', 'call & book'])
    expect(withSub.subtasks[1].done).toBe(false)
    expect(sub.replies[0].text).toBe(translate('en', 'tg_sub_added', { title: '<b>Dentist</b>' }))
    expect(sub.replies[0].taskId).toBe('c')

    const note = handleMessage('/note 3 bring <card>', ctx(d, IDX))
    expect(find(apply(d, note), 'c').notes).toBe('bring <card>')
    expect(find(apply(apply(d, note), handleMessage('/note 3 second', ctx(d, IDX))), 'c').notes).toBe('bring <card>\nsecond')
    expect(note.replies[0].text).toBe(translate('en', 'tg_note_added', { title: '<b>Dentist</b>' }))

    const ren = handleMessage('/rename 4 Write the report', ctx(d, IDX))
    expect(find(apply(d, ren), 'd').title).toBe('Write the report')
    expect(ren.replies[0].text).toBe(translate('en', 'tg_renamed', { title: '<b>Write the report</b>' }))
    for (const text of ['/sub 3', '/note 3', '/rename 4']) expect(handleMessage(text, ctx(d, IDX)).replies[0].text).toBe(translate('en', 'tg_need_text'))
  })

  it('/del N asks with yes / no buttons; del:<id>:yes deletes, del:<id>:no only drops the keyboard', () => {
    const d = SAMPLE()
    const ask = handleMessage('/del 1', ctx(d, IDX))
    expect(ask.mutate).toBeUndefined()
    expect(ask.replies[0]).toEqual({
      text: translate('en', 'tg_del_confirm', { title: '<b>Pay bill</b>' }),
      buttons: [[{ text: translate('en', 'tg_btn_del_yes'), callback_data: 'del:a:yes' }, { text: translate('en', 'tg_btn_del_no'), callback_data: 'del:a:no' }]],
      taskId: 'a',
    })
    const yes = handleCallback('del:a:yes', ctx(d))
    expect(apply(d, yes.effect).tasks.some((x) => x.id === 'a')).toBe(false)
    expect(yes.keepButtons).toBe(false)
    expect(yes.toast).toBe(translate('en', 'tg_del_ok', { title: 'Pay bill' }))
    expect(yes.append).toBe(translate('en', 'tg_del_ok', { title: '<b>Pay bill</b>' }))
    const no = handleCallback('del:a:no', ctx(d))
    expect(no).toEqual({ effect: { replies: [] }, toast: translate('en', 'tg_del_cancel'), keepButtons: false })
    // from a card: asks first in a new message
    const fromCard = handleCallback('del:a', ctx(d))
    expect(fromCard.effect.replies[0].buttons![0].map((b) => b.callback_data)).toEqual(['del:a:yes', 'del:a:no'])
    expect(fromCard.keepButtons).toBe(true)
  })
})

describe('task card (C3)', () => {
  const card = () =>
    task({
      id: 'k',
      title: 'Plan <trip>',
      dueAt: NOW + 2 * H,
      priority: 'high',
      tags: ['travel', 'a&b'],
      remindEveryMin: 30,
      recurrence: 'weekly',
      notes: 'x'.repeat(320),
      subtasks: [
        { id: 's1', title: 'Book flights', done: false },
        { id: 's2', title: 'Hotel & car', done: true },
      ],
    })

  it('renderCard: bold title, due, priority, tags, interval, recurrence, subtask count, notes cut at 300', () => {
    const html = renderCard(card(), 'en', NOW)
    const lines = html.split('\n')
    expect(lines[0]).toBe('<b>Plan &lt;trip&gt;</b>')
    expect(lines[1]).toBe(translate('en', 'tg_added_due', { due: formatDue(NOW + 2 * H, 'en', NOW) }))
    expect(lines[2]).toBe(translate('en', 'tg_added_prio', { icon: '🔴', prio: translate('en', 'p_high') }))
    expect(lines[3]).toBe(translate('en', 'tg_added_tags', { tags: '#travel #a&amp;b' }))
    expect(lines[4]).toBe(translate('en', 'tg_added_every', { n: 30 }))
    expect(lines[5]).toBe(`↻ ${translate('en', 'r_weekly')}`)
    expect(lines[6]).toBe(`☐ ${translate('en', 'tg_card_subs', { done: 1, n: 2 })}`)
    expect(lines[7].startsWith('📝 ')).toBe(true)
    expect(lines[7].length).toBe(3 + 300)
    expect(lines[7].endsWith('…')).toBe(true)
    expect(renderCard(task({ id: 'm', title: 'Minimal', remindEveryMin: 0 }), 'en', NOW)).toBe(`<b>Minimal</b>\n${translate('en', 'tg_added_prio', { icon: '🟠', prio: translate('en', 'p_medium') })}`)
  })

  it('cardButtons: one row per subtask (☐/☑, sub:<task>:<sub>), the action rows, then Delete · Priority', () => {
    const rows = cardButtons(card(), 'en')
    expect(rows).toHaveLength(5)
    expect(rows[0]).toEqual([{ text: '☐ Book flights', callback_data: 'sub:k:s1' }])
    expect(rows[1]).toEqual([{ text: '☑ Hotel & car', callback_data: 'sub:k:s2' }])
    expect(rows[2].map((b) => b.callback_data)).toEqual(['done:k', 'focus:k'])
    expect(rows[3].map((b) => b.callback_data)).toEqual(['snooze:k:30', 'snooze:k:60', 'snooze:k:tomorrow'])
    expect(rows[4]).toEqual([{ text: translate('en', 'tg_btn_delete'), callback_data: 'del:k' }, { text: translate('en', 'tg_btn_prio'), callback_data: 'prio:k' }])
  })

  it('pick:<id> replies with the card registered for the task; sub: toggles and re-renders in place; prio: cycles high → medium → low → high', () => {
    const d = data([card()])
    const pick = handleCallback('pick:k', ctx(d))
    expect(pick.effect.mutate).toBeUndefined()
    expect(pick.effect.replies).toEqual([{ text: renderCard(card(), 'en', NOW), buttons: cardButtons(card(), 'en'), taskId: 'k' }])
    expect(pick.keepButtons).toBe(true)

    const toggle = handleCallback('sub:k:s1', ctx(d))
    const next = apply(d, toggle.effect)
    expect(find(next, 'k').subtasks.map((s) => s.done)).toEqual([true, true])
    expect(toggle.edit).toEqual({ text: renderCard(find(next, 'k'), 'en', NOW), buttons: cardButtons(find(next, 'k'), 'en') })
    expect(toggle.edit!.buttons![0][0].text).toBe('☑ Book flights')
    expect(toggle.keepButtons).toBe(true)
    expect(handleCallback('sub:k:nope', ctx(d)).toast).toBe(translate('en', 'tg_bad_index'))

    let cur = d
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const r = handleCallback('prio:k', ctx(cur))
      cur = apply(cur, r.effect)
      seen.push(find(cur, 'k').priority)
      expect(r.edit!.text).toBe(renderCard(find(cur, 'k'), 'en', NOW))
    }
    expect(seen).toEqual(['medium', 'low', 'high'])
  })
})

describe('reply = attach (C4)', () => {
  it('a reply to a known task message adds a subtask; note: / not: / заметка: append to the notes', () => {
    const d = SAMPLE()
    const sub = handleMessage('buy stamps', { ...ctx(d), replyToTaskId: 'b' })
    expect(find(apply(d, sub), 'b').subtasks.map((s) => s.title)).toEqual(['buy stamps'])
    expect(sub.replies[0]).toEqual({ text: translate('en', 'tg_sub_added', { title: '<b>Call mom</b>' }), taskId: 'b' })
    for (const text of ['note: ask about Sunday', 'Not: ask about Sunday', 'заметка: ask about Sunday']) {
      const n = handleMessage(text, { ...ctx(d), replyToTaskId: 'b' })
      expect(find(apply(d, n), 'b').notes).toBe('ask about Sunday')
      expect(n.replies[0].text).toBe(translate('en', 'tg_note_added', { title: '<b>Call mom</b>' }))
    }
    expect(apply(d, sub).tasks).toHaveLength(d.tasks.length) // nothing new created
  })

  it('a reply to an unknown or completed task, or a command, is handled normally', () => {
    const d = SAMPLE()
    expect(apply(d, handleMessage('buy stamps', { ...ctx(d), replyToTaskId: null })).tasks).toHaveLength(d.tasks.length + 1)
    expect(apply(d, handleMessage('buy stamps', { ...ctx(d), replyToTaskId: 'gone' })).tasks).toHaveLength(d.tasks.length + 1)
    expect(apply(d, handleMessage('buy stamps', { ...ctx(d), replyToTaskId: 'z' })).tasks).toHaveLength(d.tasks.length + 1)
    expect(handleMessage('/list', { ...ctx(d), replyToTaskId: 'b' }).listIndex).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('forwarded messages and links (C5)', () => {
  it('linkTitle: first line without URLs, at most 80 characters, empty for a bare URL', () => {
    expect(linkTitle('Read this https://example.com/x?y=1 later')).toBe('Read this later')
    expect(linkTitle('https://example.com/only')).toBe('')
    expect(linkTitle('\n\nhttps://a.b\nSecond line here')).toBe('Second line here')
    const long = 'w'.repeat(100)
    expect(linkTitle(long)).toHaveLength(80)
    expect(linkTitle(long).endsWith('…')).toBe(true)
  })

  it('a text with a link becomes a task titled by the first line, with the full text in the notes; the title line is still parsed', () => {
    const d = data([])
    const text = 'tomorrow 18:00 read this #later https://example.com/article\nsome more context'
    const r = handleMessage(text, ctx(d))
    const t = apply(d, r).tasks[0]
    expect(t.title).toBe('read this')
    expect(t.notes).toBe(text)
    expect(t.tags).toEqual(['later'])
    expect(t.dueAt).toBe(new Date(2026, 9, 14, 18, 0).getTime())
    expect(r.replies[0].text.split('\n')).toEqual([translate('en', 'tg_added', { title: '<b>read this</b>' }), translate('en', 'tg_added_due', { due: formatDue(t.dueAt, 'en', NOW) }), translate('en', 'tg_added_tags', { tags: '#later' }), translate('en', 'tg_added_notes')])
    expect(r.replies[0].taskId).toBe(t.id)
  })

  it('a bare URL is titled "Link"; a forwarded message (no URL) keeps its first line as title and everything in the notes', () => {
    const d = data([])
    const bare = apply(d, handleMessage('https://example.com/only', ctx(d))).tasks[0]
    expect(bare.title).toBe(translate('en', 'tg_link_title'))
    expect(bare.notes).toBe('https://example.com/only')
    const tr = data([], settings({ language: 'tr' }))
    expect(apply(tr, handleMessage('https://example.com/only', ctx(tr))).tasks[0].title).toBe(translate('tr', 'tg_link_title'))
    const fwd = apply(d, handleMessage('Meeting notes from Ali\nbring the <docs>\nand coffee', { ...ctx(d), forwarded: true })).tasks[0]
    expect(fwd.title).toBe('Meeting notes from Ali')
    expect(fwd.notes).toBe('Meeting notes from Ali\nbring the <docs>\nand coffee')
    // without the forward flag a multi-line text is still an ordinary quick add
    expect(apply(d, handleMessage('Meeting notes', ctx(d))).tasks[0].notes).toBe('')
  })
})

describe('digest reply (C6) and /backup (C7)', () => {
  it('digestReply carries the top-3 pick buttons and sets the numbering; the evening review has neither', () => {
    const d = SAMPLE()
    const m = digestReply(d, NOW, 'morning')
    expect(m.listIndex).toEqual(['d', 'a', 'b']) // smart order: focused, then overdue, then priority
    expect(m.replies[0].buttons).toEqual([[{ text: '1', callback_data: 'pick:d' }, { text: '2', callback_data: 'pick:a' }, { text: '3', callback_data: 'pick:b' }]])
    expect(m.replies[0].text.startsWith(`<b>${translate('en', 'digest_morning_title')}</b>`)).toBe(true)
    const e = digestReply(d, NOW, 'evening')
    expect(e.listIndex).toBeUndefined()
    expect(e.replies[0].buttons).toBeUndefined()
  })

  it('/backup yields the data file with the token blanked, dated name and caption, and no message', () => {
    const d = data([task({ id: 'a' })], settings({}, { token: 'SECRET-TOKEN' }))
    const r = handleMessage('/backup', ctx(d))
    expect(r.replies).toEqual([])
    expect(r.mutate).toBeUndefined()
    expect(r.documents).toHaveLength(1)
    const doc = r.documents![0]
    expect(doc).toMatchObject({ filename: 'hyperdo-backup-2026-10-13.json', mime: 'application/json', caption: translate('en', 'tg_backup_caption', { n: 1 }) })
    expect(doc.content).not.toContain('SECRET-TOKEN')
    const parsed = JSON.parse(doc.content) as AppData
    expect(parsed.settings.telegram).toMatchObject({ token: '', chatId: OWNER })
    expect(parsed.tasks).toEqual(d.tasks)
    expect(backupDocument(d, NOW).content).toBe(doc.content)
    expect(d.settings.telegram.token).toBe('SECRET-TOKEN') // input untouched
  })
})
