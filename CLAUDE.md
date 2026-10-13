# Hyper Do — notes for Claude Code

Hyper Do is an ADHD-friendly personal to-do app (React 19 + TypeScript + Vite) that keeps reminding you about a
task at a per-task interval until you mark it done. It ships as an Electron app (Windows/macOS, tray, Telegram bot),
an Android app (Capacitor, pre-scheduled local notifications) and a PWA. No server, no account; all data is local.
Calendars (Google two-way, ICS feeds) and Telegram are optional and talk directly to those services.

## Architecture map

```
electron/main.ts        Main process: windows (createRendererWindow 'main' | 'quick'), tray, JSON storage
                        (userData/hyperdo-data.json) + daily backups (userData/backups), reminder tick (30 s), toasts
                        with buttons (Windows toastXml → hyperdo:// deep links), launch at login, IPC handlers `tidi:*`,
                        hosts CalendarSync + TelegramBot + QuickAddPopup
electron/quick.ts       Quick-add popup window (?view=quick) + globalShortcut registration → tidi:shortcut-status
electron/mini.ts        Mini window (?view=mini): frameless always-on-top 340×150, position in userData/window-state.json,
                        IPC tidi:mini-toggle|hide|visible, tidi:show-main, event tidi:mini-visible; escalation level 2 shows it
electron/preload.ts     contextBridge → window.tidi (implements HyperDoApi, kind 'electron', incl. `desktop`, `sync`,
                        `calendar`, telegramStatus/onTelegramStatus)
electron/calendar.ts    Google OAuth for desktop (PKCE + loopback redirect on 127.0.0.1, 5-minute timeout)
electron/telegram.ts    Telegram bot transport only: long polling (getUpdates), HTTP, status (TelegramStatus → host.onStatus →
                        tidi:tg-status), setMyCommands per language, pairing-code generation in sync(), halts on 401/404,
                        retries 409 every 30 s, network backoff 5→60 s. Message bookkeeping: `live` Map<taskId, {chatId,
                        messageId, html, sentAt, kind}> (one message with buttons per task; a new reminder deletes the old
                        one when settings.telegram.tidy, else removes its keyboard) + `byMessage` (messageId → taskId, newest
                        500, resolves reply_to_message → ctx.replyToTaskId). Edits rebuild from the stored HTML.
                        onDataChanged(prev, next) (called from main commit()) turns completed tasks' live messages into
                        <s>title</s> ✓, never mutates. remind() honours shouldSendToTelegram(settings, host.idleSeconds()).
                        sendDigest(kind), sendDocument via FormData/Blob. No `electron` import: electron/telegram.test.ts
                        runs it under Vitest against a fake Bot API (node:http on 127.0.0.1, options apiBase/pollTimeoutSec)
src/lib/telegram-commands.ts  Pure bot logic: handleMessage / handleCallback → TgEffect { mutate, replies[{text,buttons,taskId}],
                        listIndex, documents }, callback result { toast, keepButtons, append | edit }. botCommands(lang) grouped
                        Tasks·Views·Reminders·Other (feeds setMyCommands AND /help); views /list /today /week /overdue /search
                        share renderView (sections, numbering, pick: buttons); /stats, /undo, /due /prio /every /sub /note
                        /rename /del, /mute (parseMuteArg TR/EN/RU) /quiet, /backup (backupDocument: token blanked);
                        task card (renderCard / cardButtons, callbacks pick: sub: prio: del:); reply = attach (C4), forwarded /
                        link → task (C5, linkTitle); taskButtons [Done,Focus]/[30m,1h,Tomorrow], tomorrowMorning,
                        reminderText (+ escalation line via escalationLevel), completedHtml, shouldSendToTelegram,
                        escapeHtml (every user string; callback toasts stay plain), chunkText(3800), /start <pairCode>
src/lib/digest.ts       Pure digest (#17): buildDigest(data, now, lang, 'morning'|'evening'|'weekly') → {title, body, html, tasks},
                        digestDue(settings, state, now) (morning: from digest.time for 12 h; evening: from eveningTime; Sunday
                        → weekly; once per local day), markDigestSent, parseDigestState. State lives in
                        userData/hyperdo-state.json (main.ts checkDigest inside tick(); toast + telegram.sendDigest)
electron/syncfolder.ts  FolderTransport (#16): <dir>/hyperdo-sync.json, token = mtimeMs, temp+rename write, fs.watch(dir);
                        no `electron` import (electron/syncfolder.test.ts runs it against a temp dir)
electron/updater.ts     Auto-update (electron-updater, GitHub Releases): packaged builds only, first check 30 s after
                        ready then every 6 h while settings.autoUpdate; IPC tidi:update-status|update-check|update-install|
                        app-version; install() sets `quitting` before quitAndInstall
src/lib/share.ts        Pure: parseShareEvent (hyperdoShare window event from MainActivity.java), shareToTaskFields
src/lib/platform.ts     Picks the adapter at startup: window.tidi (Electron) → Capacitor → web
src/lib/platform.web.ts        Browser/PWA adapter: localStorage + Web Notifications, runs collectDueReminders itself
src/lib/platform.capacitor.ts  Android adapter: Capacitor Preferences + LocalNotifications scheduled 48 h ahead with action
                        type HYPERDO_TASK (done/snooze30/focus → applyNotificationAction in stats.ts), share target
                        (window event hyperdoShare → onShare), Google login via @capacitor/browser + appUrlOpen on
                        com.hyperdo.app:/oauth2redirect (secret-less settings.calendar.google.androidClientId)
src/lib/platform.calendar.ts   Browser-side calendar bridge (CalendarSync in the page, state in localStorage)
src/lib/sync.ts         Pure sync merge (#16): SyncDoc {version, deviceId, savedAt, tasks, deleted, dailyDone, focusLog},
                        mergeData (newer task.updatedAt wins, tie → local; tombstone ≥ updatedAt deletes, later edit
                        resurrects; dailyDone max; focusLog union/5000; one focused task), toSyncDoc / applySyncDoc
                        (settings + hyperFocus untouched), parseSyncDoc, addTombstones / dropTombstones, syncFingerprint
src/lib/syncengine.ts   SyncEngine({getData, mutate, transport(settings, creds), loadState, saveState, onStatus}):
                        pull → merge → mutate(applySyncDoc) if changedLocal → push with ETag/mtime if changedRemote,
                        412/mtime conflict → re-pull + retry once; onDataSaved (2 s debounce, settings fp → rebuild
                        transport), 60 s timer, in-flight guard, status {enabled, transport, lastSyncAt, lastError,
                        syncing, credentialsSaved}. State (deviceId, lastToken, credentials) via loadState/saveState
src/lib/synctransport.ts  SyncTransport interface + WebDavTransport (GET/If-None-Match, PUT If-Match | If-None-Match: *,
                        Basic auth, weak ETags stripped, HEAD fallback), SyncConflictError, SyncTransportError(code)
src/lib/platform.sync.ts  createBrowserSync(getData, mutate, store) → HyperDoApi.sync for web (localStorage) + Android
                        (Preferences key `hyperdo-sync`); WebDAV only
src/lib/calsync.ts      Calendar sync engine (pure): Google pull/push + ICS feeds → CalendarEvent[], auto-import tasks
src/lib/gcal.ts, ics.ts, calendar-links.ts   Google client, iCalendar parser/writer, "add to calendar" links
src/lib/reminder.ts     Reminder engine (pure): collectDueReminders, planReminderTimes, buildNotification, quiet hours, isMuted
                        (settings.mutedUntil — global mute, B5; both engines honour it),
                        activeFocusTaskId / focusSuppressedUntil (Hyper Focus suppression), escalation ladder
                        (markNagged / resetNag / escalationLevel; Android cannot count nags, UI chips only)
src/lib/stats.ts        Pure: focus log (pushFocusEntry, spentMinByTask, focusMinutes), dailyDone (recordDone / recordReopen /
                        completeInData — use these wherever completeTask is called), streak, bestStreak, heatmap, topTags
src/lib/sound.ts        Web Audio chimes (phase change, celebration); browser only
src/lib/deeplink.ts     hyperdo://task/<id>/done|snooze/<min>|open: parse/build, Windows toast XML (pure)
src/lib/tasks.ts        Pure task helpers: newTask, taskFromQuickAdd (UI + popup + Telegram), normalizeTask,
                        completeTask (+recurrence), sort, reorder, search, pickEasyTask
src/lib/parse.ts        Natural-language quick-add parser (TR/EN/RU) + splitBrainDump; phrase matcher looks 1–3 words
                        ahead (relative offsets, next week/weekday, month names, 12-hour times, *recurrence tokens)
src/lib/dates.ts        Date helpers: startOfDay/endOfDay, nextOccurrence(dueAt, rec, now, rule) incl. custom rules
                        (every N, weekday sets, month-end clamp, afterCompletion), recurrenceLabel/recurrenceText,
                        weekdayShort, formatDue, dayKey/addDays, formatMinutes
src/lib/data.ts         normalizeData / parseAppData: the single place where old data gets defaults
src/lib/types.ts        Task, Settings, AppData (tasks, settings, hyperFocus, focusLog, dailyDone), HfSession, FocusEntry,
                        DEFAULT_SETTINGS, HyperDoApi (+ DesktopApi)
src/lib/i18n.ts         EN/TR/RU dictionaries. `Dict = typeof tr` (the **TR** table is the source of truth; `en` and `ru`
                        are typed `Dict`), `Key = Exclude<keyof Dict, 'fun' | 'fun_overdue'>` (the two playful-title
                        pools are arrays, not keys), `translate(lang, key, vars)`, `LOCALE`, `LANGS`, `detectLang`
src/lib/useT.ts         React: `LangContext`, `useLang()`, `useT()` (translate bound to the current language)
src/lib/useCalendar.ts  React: `CalendarState` {available, api, events, status} from `platform.calendar`
src/lib/hooks.ts        React: useTheme (data-theme + system mode), useNow (ticking clock), useEscape
src/lib/store.ts, useTaskActions.ts   React state (useAppData: updateData, setTasks, setHyperFocus, appendFocusEntry,
                        one-off localStorage migration), debounced save, task-action hook (undo, undoDelete, update,
                        remove, complete, reopen, setFocus, snooze, toggleSub, duplicate, postpone, clearDone, save,
                        quickAdd, quickAddMany, move, reorder — all bump updatedAt, deletions leave tombstones)
src/lib/download.ts     Browser-only "save as file": JSON backup, .ics export (downloadJson / downloadText / …Ics)
src/lib/emitter.ts      Minimal typed event emitter used by the browser adapters
src/components/         Board (Kanban DnD), QuickAdd (textarea + live preview + brain-dump split), QuickCapture (popup
                        window ?view=quick), MiniView (mini window ?view=mini), BrainDump (modal), TaskItem (row + chips),
                        TaskEditor (panel incl. recurrence rule, estimate, energy), FocusBanner, HyperFocus (useHyperFocus
                        hook + bar; `driver` option), StatsModal, Celebration (useCelebration: chime + confetti),
                        SettingsPanel (+ DesktopSection, TelegramSection, AutoBackupSection, AboutSection, BackupSection),
                        CalendarSettings, CalendarStrip (events above Today/Week), AddToCalendar (per-task menu),
                        SyncSettings (Settings → Sync), Modal (Esc + backdrop close), Toggle
src/App.tsx             Shell; `?view=today|week|all|board|done` selects the initial view, `?view=quick` renders the
                        quick-add popup, `?view=mini` the mini window. Keyboard: N / E B M 1-5 (Esc via Modal). Hosts the
                        mute chip, the "easy one" toast, the update toast and the share-target editor
public/sw.js            PWA service worker (+ manifest, icons); android/ Capacitor project (generated web assets under
                        android/app/src/main/assets/public are git-ignored — do not hand-edit)
docs/                   ROADMAP-2026-10.md (feature roadmap with `[x]` status, "Shipped" + "Known gaps"),
                        2026-10-13-telegram-bot-design.md (design spec, phases A/B/C), MANUAL-TEST-2026-10.md (hand-test
                        plan, Turkish). Rule: every new feature area gets a dated design spec here
                        (`docs/YYYY-MM-DD-<area>-design.md`) before implementation; roadmap items link to it
```

Tests: `src/lib/*.test.ts` (calendar-links, data, dates, deeplink, digest, gcal, ics, parse, reminder, share, stats, sync,
syncengine, tasks, telegram-commands) and `electron/telegram.test.ts`, `electron/syncfolder.test.ts` — 17 files, 405 tests.

Data flow: renderer edits `AppData` → debounced `platform.save` → Electron main `commit()` writes the JSON file and
syncs reminder counters. Platform-side changes (Telegram, calendar import) come back via `onDataChanged`.
Everything in `src/lib` except `platform*.ts`, `store.ts`, `use*.ts`, `hooks.ts` is pure and shared by the Electron main
process, the browser build and Vitest.

## Commands

| Command               | What it does                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`         | Electron + Vite dev server with hot reload                                       |
| `npm run dev:web`     | Browser-only dev server, http://localhost:5180 (`vite.web.config.ts`)            |
| `npm run build`       | `tsc --noEmit` + Vite build for Electron → `dist/`, `dist-electron/`             |
| `npm run build:web`   | `tsc --noEmit` + PWA build → `dist-web/`                                         |
| `npm test`            | `vitest run` (`vitest.config.ts`, node env, `src/**/*.test.ts`)                  |
| `npm run dist`        | Windows NSIS installer → `%LOCALAPPDATA%\hyperdo-release\` (not the repo folder) |
| `npm run android:apk` | `build:web` + `cap sync` + Gradle debug APK; uses the portable JDK under `.tools` |

## Conventions

- Every user-facing string goes into `src/lib/i18n.ts` in **all three** languages (EN/TR/RU). `Dict` is
  `typeof tr`, so the **TR** table defines the key set and adding a key there makes TypeScript demand it in EN and RU
  (adding it to EN/RU only is a type error). `Key` excludes `fun` / `fun_overdue` (title pools).
- Each new feature area gets a dated design spec in `docs/` (`docs/YYYY-MM-DD-<area>-design.md`, status boxes
  `[ ]`/`[x]`) and a line in `docs/ROADMAP-2026-10.md` (or its successor) pointing at it. Hand-test steps for
  anything that cannot run under Vitest go into `docs/MANUAL-TEST-*.md`.
- New `Task` / `Settings` / `AppData` fields get defaults in `normalizeTask` (tasks.ts), `DEFAULT_SETTINGS` (types.ts)
  and `normalizeData` (data.ts). Never rename or remove existing fields; old JSON files and backups must keep loading.
- Pure logic lives in `src/lib/*.ts` with **no React and no Electron imports**. UI in `src/components`,
  Electron-only code in `electron/`.
- Platform features are optional members of `HyperDoApi` (`calendar?`, `telegramTest?`, `onDataChanged?`); the UI
  hides a feature when the member is missing. Add new capabilities the same way.
- Secrets that must not enter JSON backups (OAuth refresh token, task→event map) live in the platform state store,
  not in `AppData`. The Telegram bot token is the one exception already in `settings`.
- Tests: `src/lib/<module>.test.ts`, one file per module (plus `electron/telegram.test.ts` for the bot transport),
  `import { describe, it, expect } from 'vitest'`.
  Build dates with local-time constructors (`new Date(2026, 9, 13, 18, 0)`), never UTC ISO strings, and pass an
  explicit `now` where the API accepts one, so tests pass in any time zone.
- Source files use CRLF line endings and UTF-8 without BOM.

## Gotchas

- Windows paths: Electron data lives in `%APPDATA%\hyper-do\hyperdo-data.json`; calendar state (refresh token,
  pushed/imported maps) in `hyperdo-calendar.json` next to it and it is **not** part of backups. Browser/Android keep
  the same two documents under the keys `hyperdo-data` / `hyperdo-calendar` (localStorage / Capacitor Preferences).
  `hyperdo-state.json` (Electron only) holds platform state that must survive restarts but never enter AppData or
  backups: the digest timestamps (`lastDigestAt` / `lastEveningAt`).
- `commit()` in `electron/main.ts` calls `telegram.onDataChanged(prev, next)` after every save (any source). It only
  edits Telegram messages, never the data — keep it that way or completions loop back into saves.
- Telegram callbacks run with `handling = taskId` so `onDataChanged` leaves that task's message to the callback path
  (otherwise a `done:` button would edit the message twice: strike-through from B2 and the "✓ Done" line).
- `npm run dist` writes to `%LOCALAPPDATA%\hyperdo-release\` because of a folder-naming restriction under Desktop.
  Do not run `dist` or anything Gradle/Android unless asked; both are slow and need the `.tools` JDK / Android SDK.
- `vite.config.ts` loads `vite-plugin-electron`; Vitest must use `vitest.config.ts` only.
- `DEFAULT_SETTINGS` reads `import.meta.env.VITE_GOOGLE_CLIENT_ID/_SECRET` with optional chaining so it also works
  in Node (Electron main, Vitest).
- `detectLang()` reads `navigator.language`, which Node 21+ also provides, so `browserDefaultSettings()` follows the
  machine locale even under Vitest. Tests must not assert a fixed language from it.
- `completeTask` spawns the next recurring copy via `nextOccurrence`, which always lands after `now`. Completions must
  also bump `dailyDone` → call `completeInData` (stats.ts) or `recordDone`, never `completeTask` alone.
- `task.recurrenceRule` exists only when `recurrence === 'custom'` (`normalizeTask` drops it otherwise and supplies
  `DEFAULT_RECURRENCE_RULE` when a custom rule is unreadable). `recurrenceRrule` (calendar-links.ts) maps recurrences
  to RRULE; `afterCompletion` rules export without one.
- Quick-add month names: Turkish/Russian names are only recognised after the day (`15 ekim`), never before it, because
  TR abbreviations like `ara` (= call) and `kas` are everyday words; English allows `oct 15`.
- Two renderer windows (main + mini) share `useAppData`; `useHyperFocus` must run with `driver: false` everywhere except
  the main window, otherwise phases advance twice. Reminder delivery increments `task.nagCount` (`markNagged`); every
  user reaction must go through `resetNag` or the ladder never calms down.
- `endOfDay` = 23:59 local; tasks due exactly at 23:59 are treated as all-day when mirrored to calendars.
- The renderer window is hidden (not closed) on close; `quitting` gates the real quit from the tray menu.
- Sync (#16): every task mutation must bump `task.updatedAt` (`touchTask`), every deletion must leave a tombstone in
  `data.deleted` (`addTombstones`). Safety nets: `store.ts` `setTasks`/`updateData` and the platform `mutate`/`commit`
  run `bumpChanged(prev, next)` (reference compare) — so the sync engine's own `mutate(applySyncDoc)` passes
  `bump: false` (Electron `commit(..., { bump: false })`), otherwise every pulled task would look locally edited and
  ping-pong forever. Renderer saves (`senderId` set) are not bumped either: they arrive as fresh objects already stamped.
  `markNagged` does **not** bump `updatedAt` (reminder.ts, deliberately no `touchTask`) and `bumpChanged` skips
  replacements where only `nagCount` changed (`onlyNagChanged` in tasks.ts), so a delivered reminder never beats an
  unsynced edit from another device. Consequence: nag counts may diverge per device (`resetNag` does bump, so a
  reaction wins). Electron sync state + WebDAV credentials: `userData/hyperdo-sync.json` (not in backups).
