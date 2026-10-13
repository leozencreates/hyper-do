# Hyper Do — Telegram bot v2 (design spec)

Extends **Batch 4 — Telegram** of `docs/ROADMAP-2026-10.md`. The general rules at the top of the roadmap apply
(i18n in EN/TR/RU, defaults in `normalizeTask` / `DEFAULT_SETTINGS` / `normalizeData`, pure logic in `src/lib`,
never rename or remove fields). Each phase below is one Claude Code run, verified with
`npm run build && npm run build:web && npm test`, then committed.

Status legend: `[ ]` planned · `[x]` shipped.

## Why

The bot (`electron/telegram.ts`) works but is a thin command switch: `/list /done /snooze /focus /add` plus four
inline buttons under every reminder. Problems seen in the code:

- `add()` only sets the title; the README promises quick-add syntax (`yarın 18:00 fatura #ev !1 @30dk`).
- No `setMyCommands` → the "/" menu in Telegram is empty; no `getMe` → the user has to find the bot by hand.
- A wrong token makes the poll loop log an error every 5 s forever; the Settings panel cannot tell.
- The first chat that sends `/start` owns the bot — the bot username is searchable, so a stranger can grab it.
- Reminders pile up: one message per task per interval, all with live buttons. Nothing is edited when the task is
  finished from the desktop, so the chat is full of stale "Done" buttons.
- Zero tests: the whole bot lives in `electron/` and is untestable under Vitest.

## Non-goals

Telegram Mini App (the PWA has its own local data — pointless before cross-device sync, roadmap #16), voice
messages → tasks (needs a speech-to-text API), group chats / several linked chats, webhooks (long polling stays).

---

## Phase A — foundation, fixes, tests

- [x] **A1 Pure command layer** `src/lib/telegram-commands.ts` (no Electron, no React, no `fetch`). Everything that
  decides *what* to answer lives here; `electron/telegram.ts` keeps only transport (polling, HTTP, message-id
  bookkeeping). Suggested shape — adjust names, keep the separation:

  ```ts
  export interface TgInlineButton { text: string; callback_data: string }
  export interface TgReply { text: string; buttons?: TgInlineButton[][] }            // text is HTML (see A6)
  export interface TgEffect {
    mutate?: (d: AppData) => AppData   // applied by the host via TelegramHost.mutate
    replies: TgReply[]                 // 0..n messages to send (lists may be split, see A7)
    listIndex?: string[]               // new /list numbering when a list was produced
  }
  export interface TgContext { data: AppData; now: number; listIndex: string[] }
  export function handleMessage(text: string, ctx: TgContext): TgEffect
  export function handleCallback(data: string, ctx: TgContext): { effect: TgEffect; toast: string; keepButtons: boolean }
  export function taskButtons(taskId: string, lang: Lang): TgInlineButton[][]
  export function botCommands(lang: Lang): { command: string; description: string }[]   // feeds setMyCommands AND /help
  export function reminderText(task: Task, title: string, body: string): string           // HTML
  ```

  `/help` is generated from `botCommands()` so the menu and the help text can never drift apart.
  `electron/telegram.ts` must not import from `electron` (it does not today) — keep it that way so A9 can run it
  under Vitest.

- [x] **A2 Quick-add syntax everywhere**: `/add …` and plain text run `parseQuickAdd(text, lang, now)` and create
  the task with `newTask({ title, dueAt, priority, tags, remindEveryMin })` (only the fields the parser returned;
  the rest from settings). The confirmation lists what was understood, one line each, only when present:
  `➕ Added: <b>fatura öde</b>` / `📅 tomorrow 18:00` / `🔴 high` / `#ev` / `⏰ every 30 min`. Empty title after
  parsing (e.g. the text was only `yarın`) → use the raw text as title.

- [x] **A3 Bot commands menu**: on every (re)start and whenever `settings.language` changes call
  `setMyCommands` with `botCommands(lang)` (one call, no `language_code` scoping). Track the last applied
  language in the bot instance so `sync()` — which runs after every save — does not spam the API.

- [x] **A4 Bot status in Settings**: new optional `HyperDoApi` members `telegramStatus?(): Promise<TelegramStatus>`
  and `onTelegramStatus?(cb): () => void`; preload bridges `tidi:tg-status` (handle + push).
  `TelegramStatus = { state: 'off' | 'starting' | 'running' | 'error'; error: string | null; username: string;
  lastPollAt: number | null }`. Rules in the poll loop:
  - `401`/`404` from `getUpdates` (bad token) → `state: 'error'`, **stop polling** until the token changes
    (no retry loop). Error text from i18n (`tg_err_token`).
  - `409 Conflict` (another instance polls the same token) → `'error'` with `tg_err_conflict`, retry every 30 s.
  - Network errors → stay `'running'`-ish: `state: 'error'` with the message, exponential backoff 5 s → 60 s,
    back to `'running'` on the next successful poll.
  - `getMe` on start fills `username`; it is also written to `settings.telegram.botUsername` (new field, default
    `''`, not secret) so the Settings panel can render the link before the status arrives.
  Settings → Telegram shows a status line under the token field: "Off" / "Starting…" / "Running as @name ·
  last poll 12:03" / "Error: …" (i18n keys `tg_status_*`).

- [x] **A5 Pairing code instead of first-come-first-served**: `settings.telegram.pairCode: string` (default `''`).
  When the bot is enabled and `chatId` is empty and `pairCode` is empty, main generates a 6-digit code and saves
  it. Linking requires `/start <code>` (Telegram sends exactly that when the user opens
  `https://t.me/<username>?start=<code>`). Wrong or missing code while unlinked → `tg_need_code`. Once linked,
  `/start` from the owner chat → `tg_hello`; from any other chat → `tg_not_linked` (unchanged).
  Settings shows: the code in large type, the hint `tg_pair_hint` ("Send /start {code} to your bot"), and — when
  `botUsername` is known — a button **Open bot in Telegram** (`https://t.me/{u}?start={code}`, opens in the
  system browser via the existing window-open handler) so pairing from the phone is one tap after scanning the
  link. **Unlink** clears `chatId` and regenerates the code. Old data files with `chatId` already set keep working
  (no code needed when linked).

- [x] **A6 HTML formatting**: every `sendMessage`/`editMessageText` uses `parse_mode: 'HTML'`. A single
  `escapeHtml()` in the pure layer escapes `& < >` in *every* user-provided string (titles, notes, tags, parser
  output). Reminders: `<b>{title}</b>\n{body}`; `/list` section headers in `<b>`; task titles in `<b>` in all
  confirmations. Callback toasts (`answerCallbackQuery`) are plain text — do not HTML-escape them.

- [x] **A7 Better `/list`**: open tasks grouped under headers **Overdue · Today · Later · No date** (sections
  without tasks are omitted), numbering continuous across sections (the numbers are what `/done N` takes), each
  row `N. 🔴 🎯 <b>title</b> · due · 2 subtasks` as today. A message longer than 3800 characters is split into
  several messages at line boundaries (`chunkText(text, 3800)`), numbering continues. `listIndex` returned in the
  effect; the stale-index fallback (`byIndex`) keeps its current behaviour.

- [x] **A8 Unit tests** `src/lib/telegram-commands.test.ts` (Vitest, explicit `now`, local-time dates):
  `/done 2`, `/done 1 3 4` (multi, see C2 — implement the multi form here), `/snooze 2 45`, `/snooze 2` (default
  30), `/focus 1`, `/add yarın 18:00 fatura #ev !1 @30dk` → every parsed field on the created task, plain text ==
  `/add`, `/list` numbering + section headers + empty list, stale `listIndex` falls back to the live order,
  callbacks `done:<id>` / `snooze:<id>:30` / `focus:<id>` / unknown id, unknown command → help, `/list@botname`
  suffix stripped, `/start` with wrong / right / missing code in the unlinked and linked states, `escapeHtml`,
  `chunkText` never splits inside a line, `botCommands()` and `/help` list the same commands in all three
  languages.

- [x] **A9 Transport test with a fake Telegram API** `electron/telegram.test.ts`: `TelegramBot` gets a constructor
  option `apiBase` (default `https://api.telegram.org`); the test starts a `node:http` server on port 0 that
  implements `/bot<token>/getUpdates` (returns queued updates, then empty arrays; honour `offset`),
  `sendMessage`, `editMessageText`, `editMessageReplyMarkup`, `deleteMessage`, `answerCallbackQuery`,
  `setMyCommands`, `getMe`, and records every call. Add `electron/**/*.test.ts` to `vitest.config.ts › include`.
  Scenarios: start → `getMe` + `setMyCommands` called once; `/start 123456` pairs and writes `chatId`; `/list`
  then `/done 1` completes the task through `host.mutate`; a `done:` callback answers the query and edits the
  original message without buttons; `getUpdates` answering 401 stops polling (no further request within 300 ms)
  and the status becomes `error`; `remind()` sends `<b>` text with the button rows. Use short poll timeouts
  (pass `pollTimeoutSec: 0` via the same options object) so the suite stays fast; always `stop()` the bot and
  close the server in `afterEach`.

- [x] **A10 Docs**: README Telegram section — pairing with the code / link, the commands table regenerated from
  `botCommands()`, status line. CLAUDE.md architecture map: add `src/lib/telegram-commands.ts` and the fake-API
  test. Tick the boxes above.

## Phase B — smarter reminders

- [x] **B1 One live reminder per task**: the bot keeps `Map<taskId, { chatId, messageId, sentAt }>` in memory.
  Before sending a new reminder for a task it tidies the previous one: `deleteMessage` when
  `settings.telegram.tidy` (new, default `true`) and the message is younger than 47 h; otherwise (or when delete
  fails) `editMessageReplyMarkup` with no keyboard. Restart loses the map — acceptable.

- [x] **B2 Desktop actions reflect into the chat**: after every `commit()` the host calls
  `telegram.onDataChanged(prev, next)`; for every task that became completed and has a live reminder/card
  message, edit it to `<s>title</s> ✓` with no buttons (keep the body). Tasks that disappeared (deleted / cleared)
  → remove buttons only.

- [x] **B3 Only when away from the PC**: `settings.telegram.onlyWhenIdle: boolean` (default `false`) and
  `settings.telegram.idleMinutes: number` (default `5`). `TelegramHost` gains `idleSeconds(): number`; main
  implements it with `powerMonitor.getSystemIdleTime()` and returns `Infinity` while the session is locked
  (`powerMonitor` `lock-screen` / `unlock-screen` events). `remind()` skips the Telegram message when
  `onlyWhenIdle && idleSeconds() < idleMinutes * 60`; the desktop toast is unaffected. Settings → Telegram:
  toggle + minutes field. Pure decision `shouldSendToTelegram(settings, idleSeconds)` tested.

- [x] **B4 "Tomorrow morning" button**: reminder/card keyboard becomes `✓ Done · ⏰ 30m · ⏰ 1h · 🌅 Tomorrow ·
  🎯 Focus` (two rows if Telegram wraps badly on phones: `[Done, Focus]` / `[30m, 1h, Tomorrow]`). Tomorrow =
  next calendar day at `settings.quietHours.to` when quiet hours are enabled, else 09:00; pure
  `tomorrowMorning(now, settings)` tested across midnight and DST. Callback `snooze:<id>:tomorrow`; the task's
  `snoozedUntil` is set and the reminder text gets `⏰ until tomorrow 09:00`.

- [x] **B5 Global mute** `settings.mutedUntil: number | null` (default `null`). `collectDueReminders` and
  `planReminderTimes` return nothing / skip times while `mutedUntil > now` (tested). Telegram: `/mute 2h`,
  `/mute 90m`, `/mute 2sa`, `/mute 45dk`, `/mute 2ч`, bare `/mute` = 1 h, `/mute off` → `null`; reply
  `🔇 Muted until 16:30` / `🔔 Unmuted`. App header shows a small `🔇 until 16:30` chip while muted; clicking it
  unmutes. `/quiet on|off` toggles `settings.quietHours.enabled` and answers with the current window.

- [x] **B6 Escalation line**: when `task.nagCount` (roadmap #6) exists and `settings.escalation` says so, prefix
  the Telegram reminder with the escalation line (`👀 Ignored {n}× — still not done?`). Read both via optional
  chaining so the bot works whether or not #6 has landed.

- [x] **B7 Tests**: fake-API scenarios for B1 (second reminder deletes the first; delete failure falls back to
  removing buttons), B2 (completing from the desktop edits the live message), B3 (`onlyWhenIdle` with idle 0 vs
  600 s), B4 callback, B5 reminder-engine tests + `/mute` parsing in all three languages.

## Phase C — commands and interaction

- [x] **C1 Views**: `/today` (due today or overdue), `/week` (`isThisWeek`), `/overdue`, `/search <text>`
  (`matchesQuery`), `/stats` (done today / this week; streak and focus minutes when roadmap #9 / #8 data exists,
  otherwise omit those lines), `/undo` (reopens the most recently completed task: `completedAt = null`; for
  recurring tasks say that the next occurrence stays). All views share the `/list` renderer and numbering.

- [x] **C2 Natural arguments**: `/done 1 3 4` (multi; already in A8), `/snooze 2 yarın 09:00` — if the remainder
  parses to a `dueAt` via `parseQuickAdd` snooze until then, else treat it as minutes. `/due N <date text>`,
  `/prio N 1|2|3|high|…`, `/every N <min>|off`, `/sub N <text>` (adds a subtask), `/note N <text>` (appends to
  notes), `/rename N <text>`, `/del N` (asks with a confirm button `del:<id>:yes`).

- [x] **C3 Task card**: `/list` output gets inline number buttons (`pick:<id>`, rows of 5, first 20 tasks).
  Tapping sends a card: `<b>title</b>`, due, priority, tags, first 300 characters of notes, subtasks as a button
  per row (`☐ text` / `☑ text`, callback `sub:<taskId>:<subId>` toggles and re-renders the card in place),
  then the B4 action row and a last row `🗑 Delete · ✏ Priority`. Cards register in the same message→task map as
  reminders (B1), so B2 and C4 work on them.

- [x] **C4 Reply = attach**: replying (Telegram `reply_to_message`) to a known reminder/card/confirmation message
  with text adds a **subtask** with that text; text starting with `not:` / `note:` / `заметка:` appends to the
  notes instead. Replies to unknown messages are ordinary quick-adds. The map is bounded (newest 500 entries).

- [x] **C5 Forwarded messages and links**: a message with `forward_origin` (or `forward_date`) or containing an
  `http(s)://` URL becomes a task whose title is the first line without the URL (≤ 80 chars, fallback
  `Link`) and whose notes hold the full text plus the URL. Still runs `parseQuickAdd` on the first line.

- [x] **C6 Digest over Telegram** (Electron side; Android scheduling stays open, see roadmap #17): roadmap #17 (morning digest, optional evening review) is delivered to the
  linked chat as well, with the top-3 tasks as number buttons (`pick:`). If #17 has not been implemented when
  this phase runs, implement it as specified there (`buildDigest` pure + `lastDigestAt` in a platform state file
  `userData/hyperdo-state.json`). Sunday evening the review becomes a weekly one (`done this week · open ·
  streak`).

- [x] **C7 `/backup`**: sends the current data file as a document (`sendDocument`, multipart via the global
  `FormData`/`Blob` of Node 18+), with `settings.telegram.token` replaced by `''`, filename
  `hyperdo-backup-YYYY-MM-DD.json`. PRIVACY.md gets a line: the backup travels through Telegram's servers only
  when the user asks for it.

- [x] **C8 Tests + docs**: pure tests for every parser form above (TR/EN/RU keywords), card rendering, reply
  attach, forward/link extraction; fake-API scenarios for card toggling and `/backup`. README command table
  regenerated; `/help` grouped (Tasks · Views · Reminders · Other).

---

## i18n keys (EN wording; TR/RU required by the `Key` type)

Phase A: `tg_status_off` "Off", `tg_status_starting` "Starting…", `tg_status_running` "Running as @{u}",
`tg_status_poll` "last poll {t}", `tg_status_error` "Error: {e}", `tg_err_token` "Telegram rejected the token —
check it in @BotFather", `tg_err_conflict` "Another Hyper Do is already polling this bot", `tg_pair_code`
"Pairing code", `tg_pair_hint` "Send /start {code} to your bot, or open the link below from your phone.",
`tg_open_bot` "Open bot in Telegram", `tg_need_code` "Send /start followed by the pairing code shown in Hyper Do →
Settings → Telegram.", `tg_added_due` "📅 {due}", `tg_added_prio` "{icon} {prio}", `tg_added_tags` "🏷 {tags}",
`tg_added_every` "⏰ every {n} min", `tg_sec_overdue` "Overdue", `tg_sec_today` "Today", `tg_sec_later` "Later",
`tg_sec_nodate` "No date", `tg_done_many` "✓ Done: {n} tasks", `tg_cmd_*` one description per command.

Phase B: `tg_tidy` "Delete the previous reminder of a task when a new one is sent", `tg_only_idle` "Send to
Telegram only when the PC has been idle for", `tg_idle_min` "{n} min", `tg_btn_tomorrow` "🌅 Tomorrow",
`tg_snoozed_until` "⏰ until {t}: {title}", `tg_muted` "🔇 Muted until {t}", `tg_unmuted` "🔔 Reminders are
back", `mute_chip` "🔇 until {t}", `tg_quiet_state` "Quiet hours {state}: {from}–{to}", `tg_escalation`
"👀 Ignored {n}× — still not done?".

Phase C: section titles, `tg_card_*`, `tg_sub_added` "☐ Subtask added to {title}", `tg_note_added`
"📝 Note added to {title}", `tg_undo_ok` "↩ Reopened: {title}", `tg_undo_recurring` "(the next occurrence
stays)", `tg_del_confirm` "Delete <b>{title}</b>?", `tg_del_ok` "🗑 Deleted: {title}", `tg_backup_caption`
"Hyper Do backup · {n} tasks · token removed", `tg_help_tasks` "Tasks", `tg_help_views` "Views",
`tg_help_reminders` "Reminders", `tg_help_other` "Other".

## New fields (all with defaults in `DEFAULT_SETTINGS` + `normalizeData`)

| Field | Default | Phase |
|---|---|---|
| `settings.telegram.botUsername: string` | `''` | A4 |
| `settings.telegram.pairCode: string` | `''` (generated by main when needed) | A5 |
| `settings.telegram.tidy: boolean` | `true` | B1 |
| `settings.telegram.onlyWhenIdle: boolean` | `false` | B3 |
| `settings.telegram.idleMinutes: number` | `5` | B3 |
| `settings.mutedUntil: number \| null` | `null` | B5 |

## Verification checklist per phase

1. `npm run build && npm run build:web && npm test` green (A9's fake-API suite included).
2. Live smoke with the real bot (owner only): `/start <code>` pairs; `/list`, `/done 1`, a reminder with buttons,
   the Settings status line shows "Running as @…". Phase B: finish a task on the desktop and watch the Telegram
   message turn into `<s>title</s> ✓`; Phase C: tap a number button, toggle a subtask, reply to a reminder.
3. Old `hyperdo-data.json` (pre-v2 Telegram settings, `chatId` already set) loads and the bot keeps answering
   without a pairing code.
