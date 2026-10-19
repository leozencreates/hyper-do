# Hyper Do — October 2026 feature roadmap (spec)

## Shipped in 0.2.0 (closing pass, 13 October 2026)

Every batch below and every phase of `docs/2026-10-13-telegram-bot-design.md` is implemented. Verification at the
closing pass: `npm test` → **17 files, 405 tests, all passing**; `npm run build` and `npm run build:web` green.
`package.json` is `0.2.0`, Android `versionCode 2` / `versionName "0.2.0"`. Hand tests that cannot run under Vitest are
collected in `docs/MANUAL-TEST-2026-10.md` (Turkish, by platform, riskiest first).

| Area | What shipped |
|---|---|
| Foundations (B0) | `CLAUDE.md`, Vitest harness, tests for every pure lib, mojibake fix, `Object.hasOwn` parser fix |
| Desktop core (B1) | Launch at login, Windows toasts with Done / 30 min / Open via `hyperdo://` deep links, Hyper Focus suppression, global quick-add popup + shortcut, automatic daily backups |
| ADHD core (B2) | Escalation ladder (`nagCount`, line after 3, mini window after 5), mini window, estimates + focus log, streaks / heatmap / Stats / celebration, energy level + "easy one", brain dump |
| Parser + recurrence (B3) | Relative offsets, next week/weekday, month names, 12-hour times, `*recurrence` tokens; yearly + custom recurrence rules (every N, weekday sets, month-end clamp, after completion), RRULE export |
| Digest + Telegram (B4 + spec A/B/C) | Morning digest / evening + weekly review (desktop toast + Telegram); Telegram bot v2: pure command layer, quick-add echo, "/" menu, status line, pairing code, HTML, grouped lists, one live reminder per task, desktop reflection, idle rule, Tomorrow button, global mute, 22 commands, task cards, reply = attach, forwards/links, `/backup`, fake-API transport tests, pause button (Settings → Telegram: `settings.telegram.paused` holds back reminders + digests until resumed, commands keep working) |
| Platforms (B5) | Android notification buttons, Android share target, Google Calendar on Android (Custom Tab + Android client), auto-update (electron-updater + GitHub Releases), cross-device sync (WebDAV everywhere, folder on desktop; `updatedAt` + tombstones merge) |
| Final | README rewritten as one document, PRIVACY.md covers every outbound connection, `CLAUDE.md` map + conventions updated, version bump |

## Known gaps (left out deliberately or still unverified)

- ~~**Android digest**~~ and ~~**Android nag counting**~~: closed on 19 Oct 2026, see
  `docs/2026-10-19-known-gaps-design.md`. Still open there: escalation level 2 (popup) has no Android equivalent, and
  digests / reminders stop after 48 hours without opening the app (planning horizon).
- **Telegram is desktop-only** (Electron main process hosts the bot and the Mini App server); one linked chat, long
  polling only, no voice messages (spec non-goals). The Mini App (Phase D of
  `2026-10-13-telegram-bot-design.md`) needs the PC running and a tunnel (Cloudflare quick tunnel = a new random
  address on every restart; stable addresses need "My own address"). The live-message map (`live` / `byMessage`)
  survives restarts since 19 Oct 2026 (`userData/hyperdo-telegram.json`).
- ~~**Google push of recurring tasks**~~: closed on 19 Oct 2026 (`docs/2026-10-19-gcal-recurring-design.md`); still
  open: snoozed / moved single occurrences are not written as exceptions, "repeat after completion" stays a single
  event.
- **Sync**: settings and the running Hyper Focus session are never synced (by design). `markNagged` does not bump
  `updatedAt` and `bumpChanged` ignores nag-only changes, so nag counts may differ per device. Folder mode uses
  `mtimeMs` as its token (a cloud client delivering a different file with an identical mtime goes unnoticed until the
  next local change); its temporary `.hyperdo-sync.json.<pid>.tmp` may be briefly picked up by cloud clients. WebDAV
  servers that only expose weak ETags could answer 412 forever (ETags are stripped to their strong form). Web/PWA
  WebDAV needs CORS incl. the `If-Match` / `If-None-Match` preflight; Android relies on `CapacitorHttp`'s patched
  `fetch` exposing `ETag` — unverified on a device.
- **Desktop**: launch at login is applied only in packaged builds (`app.isPackaged`); macOS toast actions, `open-url`
  and the DMG are untested on real hardware. The mini window is a second store instance: a renderer edit inside the
  250 ms save debounce at the moment a `markNagged` commit broadcasts can lose that increment (pre-existing
  cross-window race).
- **Updater**: unsigned builds (SmartScreen warning); `latest.yml` emission by `npm run dist` and the electron-updater
  runtime were not exercised in these runs. 0.1.0 installs do not auto-update to 0.2.0 (the updater ships with 0.2.0).
- **Parser**: Turkish/Russian month names are recognised only after the day number (`15 ekim`, never `ekim 15`),
  because `ara` / `kas` are everyday words; `10.12` is always a date, never 10:12. The recurrence chip gives no visual
  hint for "repeat after completion" (tooltip only).
- **Runtime verification**: nothing Electron / Windows / Android / browser was executed by the automated runs — toast
  rendering, protocol registration, popup focus, mini window, celebration, Telegram against the real API, Android
  intents and OAuth redirect, updater, two-device sync. All of it is in `docs/MANUAL-TEST-2026-10.md`.

---

Status legend: `[ ]` planned · `[x]` shipped. Each batch is one Claude Code run, verified with
`npm run build && npm run build:web && npm test`, then committed.

General rules for every item:

- Every user-facing string goes into `src/lib/i18n.ts` for **all three languages** (EN/TR/RU); `Dict` is
  `typeof tr`, so the **TR** table defines the key set and adding a key there forces EN/RU (`Key` excludes the
  `fun` / `fun_overdue` title pools).
- New `Task` / `Settings` / `AppData` fields get defaults in `normalizeTask` / `DEFAULT_SETTINGS` /
  `normalizeData` so old data files and old JSON backups keep loading. Never rename or remove existing fields.
- Pure logic lives in `src/lib/*.ts` (no React, no Electron imports) so the Electron main process, the browser
  build and Vitest share it. UI in `src/components`. Electron-only code in `electron/`.
- Platform capabilities are exposed through `HyperDoApi` (`src/lib/types.ts`) as optional members; the UI
  hides a feature when the member is missing (as `calendar?` already does).
- The data file format stays a single JSON (`AppData`); secrets that must not enter backups (tokens) stay
  in the platform state store, as the calendar refresh token already does.

---

## Batch 0 — foundations

- [x] **CLAUDE.md** at the repo root: architecture map, commands, conventions above, gotchas
  (`npm run dist` output dir, `.tools` JDK, Windows paths), test layout.
- [x] **Vitest** harness: `vitest` dev-dependency, `vitest.config.ts` (environment `node`, include
  `src/**/*.test.ts`; do NOT reuse `vite.config.ts`, it loads the Electron plugin), script `"test": "vitest run"`.
  Tests import from `'vitest'` explicitly (no globals). Date-dependent tests build dates with local-time
  constructors (`new Date(2026, 9, 13, 18, 0)`) so they pass in any time zone.
- [x] **Tests** for the pure libs: `parse.ts` (every token class in the header comment, TR/EN/RU keywords,
  "18:00 in the past → tomorrow", `dd.mm` in the past → next year), `reminder.ts` (interval, overdue halving
  with the 5-minute floor, snooze, quiet hours across midnight, `planReminderTimes` horizon/quiet-hours
  skipping, `syncCounters`), `tasks.ts` (`completeTask` + recurrence spawn, `duplicateTask`, `reorderTasks`,
  `sortTasks` for every mode, `matchesQuery`, `normalizeTask` defaults), `dates.ts` (`nextOccurrence` for every
  recurrence incl. month-end, `isThisWeek`, `formatDue` relative labels), `ics.ts` (RRULE daily/weekly/monthly/
  yearly with COUNT/UNTIL/BYDAY, EXDATE, RECURRENCE-ID override, TZID, all-day events, writer round-trip),
  `data.ts` (`parseAppData` on `null`, garbage, old-version objects).
- [x] **Mojibake fix**: `src/lib/tasks.ts` lines 12–13 contain double-encoded UTF-8 (`ğŸ”´` …). Rewrite the
  comment and `priorityIcon` so the file contains the real characters `🔴 🟠 🟢`; grep the repo for `ğŸ` and `Ã`
  afterwards — zero hits.

## Batch 1 — desktop core

- [x] **#1 Launch at login** (Electron): `settings.launchAtLogin: boolean` (default `false`). Main process
  applies `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ['--hidden'] })` on every
  settings commit and on startup. `--hidden` in `process.argv` → create the window but do not show it (tray
  only). Settings toggle under a new "Desktop" group, shown only when `platform.kind === 'electron'`.
- [x] **#2 Actionable reminders (Windows)**: reminder toasts get buttons **Done / Snooze 30 min / Open**.
  Implementation: `toastXml` on `Notification` (Windows only; other platforms keep the current behaviour).
  Buttons use `activationType="protocol"` with `hyperdo://task/<id>/done`, `hyperdo://task/<id>/snooze/30`,
  `hyperdo://task/<id>/open`. The app registers the `hyperdo` scheme (`app.setAsDefaultProtocolClient`; in
  dev pass `process.execPath` + `path.resolve(process.argv[1])`) and handles URLs from `second-instance`
  (`commandLine`), from `open-url` (macOS) and from the first launch's `process.argv`. A shared
  `handleDeepLink(url)` in `electron/main.ts` performs the action via the same pure helpers Telegram uses
  (`completeTask`, snooze). Toast body keeps title/body from `buildNotification`; the XML escapes `& < > "`.
  Also handle the Electron `'action'` event if the platform emits it (macOS actions: `actions: [{type:'button', text}]`).
- [x] **#3 Hyper Focus silences other tasks**: `settings.focusSuppressOthers: boolean` (default `true`). While a
  Hyper Focus **work** phase is running, reminders for every task except the session's task are skipped.
  The session already lives in `localStorage` (`hyperdo-hyperfocus`) which the Electron main process cannot
  read → persist the session into `AppData` as `data.hyperFocus: HfSession | null` (replace the localStorage
  store; migrate on load), so `collectDueReminders(tasks, settings, lastNotified, nowMs, activeFocusTaskId)`
  can take it on every platform. Skipped tasks do **not** advance `lastNotified` (they fire right after the
  round ends). Break phases do not suppress. Unit-tested.
- [x] **#4 Global quick-add popup** (Electron): `settings.quickAddShortcut: string` (default
  `CommandOrControl+Shift+Space`, editable text field with a "reset" button; invalid/occupied accelerators
  show an inline error returned by main via `tidi:shortcut-status`). The shortcut opens a frameless,
  always-on-top, centered 560×120 window loading the renderer with `?view=quick`; `App.tsx` renders
  `<QuickCapture>` for that view: one `QuickAdd` input with the live preview, Enter → IPC `tidi:quick-add(text)`
  → main parses (`parseQuickAdd` + `newTask`), commits, broadcasts to all windows, hides the popup and shows a
  2-second "✓ Added" state. Esc / blur hides. Also reachable from the tray menu ("Quick add…").
  Main process: `commit()` broadcasts `tidi:data-changed` to every window except the sender (multiple
  renderer windows now exist).
- [x] **#5 Automatic backups** (Electron): `settings.autoBackup: boolean` (default `true`). On the first save of
  each calendar day copy the current data file to `userData/backups/hyperdo-data-YYYY-MM-DD.json`; keep the
  newest 7, delete older. Settings → Backup shows the folder path with an "Open folder" button
  (`shell.openPath`) and the date of the last automatic backup. Browser/Android: no-op (member absent).

## Batch 2 — ADHD core

- [x] **#6 Escalation ladder**: `task.nagCount: number` (default 0) — incremented every time a reminder for the
  task is actually delivered; reset to 0 on complete, snooze, postpone, focus toggle, editor save, deep-link
  action, Telegram button. `settings.escalation: { enabled: boolean; telegramAfter: number; popupAfter: number }`
  (defaults `true, 3, 5`). Reminder delivery consults the ladder: from `telegramAfter` ignored reminders on,
  the Telegram message is prefixed with an escalation line ("Ignored 3× — still not done?") — Telegram is
  otherwise unchanged (it already receives every reminder); from `popupAfter` on, the Electron app shows the
  **mini window** (#7) on top of everything with the task, and the toast is `urgency: 'critical'`. Task rows show
  a small "👀 ×N" chip when `nagCount ≥ telegramAfter`. Pure helper `escalationLevel(task, settings)` is tested.
- [x] **#7 Mini mode** (Electron): a second frameless always-on-top window (`?view=mini`, 340×150,
  remembers position in a `userData/window-state.json`) rendering `<MiniView>`: focus task title (or "no focus
  task"), next open subtask, Hyper Focus ring + countdown when a session runs, buttons Done · Snooze 30 ·
  Start/Pause focus · ↗ Expand (shows the main window). Toggle via tray menu, Settings → Desktop, the main
  window header button "▣ Mini", and the shortcut `M` in the main window. Closing the main window while mini
  is open keeps mini visible. The mini window drags by its background (`-webkit-app-region: drag`, buttons
  `no-drag`).
- [x] **#8 Time estimates + focus log**: `task.estimateMin: number | null` (editor field with presets 5/15/30/60/
  120 and free input; quick-add token `~30m` / `~2h` / `~45dk` sets it). `data.focusLog: FocusEntry[]` with
  `{ id, taskId: string | null, phase: 'work' | 'break', startedAt, endedAt }` appended when a Hyper Focus
  phase ends or the session is stopped/skipped (only phases ≥ 1 minute). Derived per task:
  `spentMin` = sum of work entries. Task row shows `~30m` chip and, when spent > 0, `30m / 1h 10m`; when
  `spent > estimate` the chip turns orange (time-blindness feedback). Pure helpers in `src/lib/stats.ts`, tested.
  The log is capped at the newest 5000 entries.
- [x] **#9 Streaks, heatmap, celebration**: `data.dailyDone: Record<string /* YYYY-MM-DD local */, number>`
  incremented on complete, decremented (not below 0) on reopen — survives "clear done". Sidebar footer shows
  🔥 current streak (consecutive days with ≥1 completion ending today or yesterday). A **Stats** modal (sidebar
  button) shows: streak, best streak, done today / this week, a 12-week GitHub-style heatmap, focus minutes
  today / this week (from `focusLog`), top tags this week. `settings.celebrate: boolean` (default `true`):
  completing a task plays a short chime (reuse the Web Audio helper from HyperFocus) and fires a lightweight CSS
  confetti burst (no dependency, ~20 particles, respects `prefers-reduced-motion`).
- [x] **#10 Energy level + "give me an easy one"**: `task.energy: 'low' | 'medium' | 'high' | null` (editor
  segmented control; quick-add tokens `^low ^med ^high`, TR `^düşük ^orta ^yüksek`, RU `^низкая ^средняя
  ^высокая`, icons 🪫 🔋 ⚡). Sidebar filter chips by energy. Header button **🎲 Easy one** (shortcut `E`): picks a
  random open task preferring `energy: 'low'`, then short `estimateMin` (≤ 15), then low priority; highlights and
  scrolls to it and offers "Focus it" / "Another". Pure `pickEasyTask(tasks, rng)` tested.
- [x] **#11 Brain dump**: QuickAdd accepts multi-line paste (and `Shift+Enter` for a new line): when the text
  contains newlines, show "N tasks" in the preview and on Enter create one task per non-empty line (each line
  parsed by `parseQuickAdd`; empty lines and leading `- ` / `* ` / `1. ` bullets stripped). Also a **Brain dump**
  button in the header opening a textarea modal with the same behaviour. `actions.quickAddMany(lines)`.

## Batch 3 — parser + recurrence

- [x] **#12 Quick-add parser extensions** (`parse.ts`, all three languages, tested): relative offsets
  `in 30m` / `in 2h` / `in 3d`, TR `30dk sonra` / `2 saat sonra` / `3 gün sonra`, RU `через 30 мин` / `через 2 ч` /
  `через 3 дня`; `next week` / `haftaya` / `на следующей неделе` (= Monday of next week 09:00 → keep end-of-day
  rule: date without time → 23:59), `next monday` / `gelecek pazartesi` / `в следующий понедельник`; month
  names `15 oct` / `oct 15` / `15 ekim` / `15 окт` (short and long names, case-insensitive); 12-hour times
  `5pm` / `5:30pm` / `noon` / `midnight`; recurrence tokens `*daily *weekdays *weekly *monthly *yearly`,
  `*every 3d` / `*every 2w`, TR `*günlük *hafta-içi *haftalık *aylık *yıllık *her 3g`, RU `*ежедневно *будни
  *еженедельно *ежемесячно *ежегодно *каждые 3д`; estimate `~30m` (#8) and energy `^low` (#10) if not done yet.
  `ParsedQuickAdd` gains `recurrence`, `estimateMin`, `energy`; `QuickAdd` preview shows them.
- [x] **#13 Recurrence extensions**: keep `Recurrence` strings and add `'yearly'` and `'custom'`; add
  `task.recurrenceRule?: { every: number; unit: 'day' | 'week' | 'month' | 'year'; weekdays?: number[] /* 0-6,
  unit week */; afterCompletion?: boolean }`. `nextOccurrence(dueAt, rec, now, rule)` handles every N units,
  weekday sets (Mon/Wed/Fri), yearly (Feb 29 → Feb 28), month-end clamping, and `afterCompletion` (next due =
  completion time + interval instead of the fixed schedule). Editor: recurrence select gains Yearly and
  Custom…; Custom reveals "every [n] [days|weeks|months|years]", weekday toggles for weeks, and a
  "Repeat after completion" toggle. Task chip shows a short label (`↻ 3d`, `↻ Mon·Wed·Fri`). ICS export maps the
  rule to RRULE. Tested.

## Batch 4 — digest + Telegram

> **Delegated**: the Telegram side of this batch (commands `/today /week /overdue /stats`, escalation prefix,
> quick-add parsing in `/add`) and the digest delivery are specified in more detail in
> `docs/2026-10-13-telegram-bot-design.md` (Phase A/B/C — C1 views, C6 digest). Those runs own
> `electron/telegram.ts` and `src/lib/telegram-commands.ts`; the roadmap batches do not touch them.

- [x] **#17 Morning digest**: `settings.digest: { enabled: boolean; time: string /* HH:MM */; evening: boolean;
  eveningTime: string }` (defaults `true, '08:00', false, '20:00'`). At the digest time the platform sends one
  notification (desktop toast + Telegram if linked; Android schedules it as a daily local notification):
  "Good morning — N overdue, M due today, K open · 🔥 streak" with the top 3 tasks by smart order; evening
  review: "Done today N · still open for today M". Pure `buildDigest(data, nowMs, lang)` tested; `lastDigestAt`
  stored in the platform state store (not AppData) so it fires once per day even after restarts.
  → Shipped with Telegram Phase C6: `src/lib/digest.ts` (`buildDigest(data, now, lang, kind)`, `digestDue`), the
  Electron check inside `tick()`, state in `userData/hyperdo-state.json`, Settings → Reminders toggles + times,
  Sunday evening = weekly review. **Android scheduling is still open**: the Capacitor adapter does not schedule the
  digest as a daily local notification yet (the settings exist and are normalised, so a later run only has to add
  the `LocalNotifications` schedule in `platform.capacitor.ts`).
- [x] **Telegram commands**: `/today`, `/week`, `/overdue`, `/stats` (streak + done today + focus minutes),
  `/mini on|off` is NOT needed. `/add` and plain text must run `parseQuickAdd` (README promises quick-add
  syntax; today `add()` only sets the title) — fix and test via the shared helper. `/help` lists the new commands.
  Reminders from the escalation ladder (#6) get the prefix line.
  → Spec: `docs/2026-10-13-telegram-bot-design.md`. Phase A (pure layer `src/lib/telegram-commands.ts`, quick-add
  echo, "/" menu, status line, pairing code, HTML, grouped `/list`, tests, docs), Phase B (one live reminder,
  desktop reflection, idle rule, Tomorrow button, `/mute` + header chip, escalation prefix) and Phase C (views,
  `/stats`, natural arguments, task cards, reply = attach, forwarded links, digest, `/backup`, grouped `/help`)
  are done.

## Batch 5 — platforms

- [x] **#2b Android notification actions**: `LocalNotifications.registerActionTypes({ types: [{ id:
  'HYPERDO_TASK', actions: [done, snooze30, focus] }] })` at startup, `actionTypeId: 'HYPERDO_TASK'` on every
  scheduled reminder; `localNotificationActionPerformed` dispatches on `e.actionId` (`done` → `completeTask`,
  `snooze30` → snooze 30 min, `focus` → set focus, `tap` → highlight) and reschedules. Button labels translated.
- [x] **#15 Android share target**: `AndroidManifest.xml` intent filter `ACTION_SEND` + `text/plain` on
  `MainActivity`; `MainActivity.java` reads `Intent.EXTRA_TEXT`/`EXTRA_SUBJECT` in `onCreate`/`onNewIntent` and
  forwards them with `getBridge().triggerWindowJSEvent("hyperdoShare", json)`; the Capacitor adapter listens and
  opens the quick-add box prefilled (`platform.onShare?(cb)`), subject first then URL on a second line into notes.
- [x] **#14 Google Calendar on Android**: use `@capacitor/browser` (Custom Tabs) + redirect URI
  `com.hyperdo.app:/oauth2redirect` (intent filter `android:scheme="com.hyperdo.app"`), captured via
  `@capacitor/app` `appUrlOpen`. Google requires an OAuth client of type **Android** (package
  `com.hyperdo.app` + SHA-1 of the signing key, no client secret): add
  `settings.calendar.google.androidClientId`; `gcal.ts` must treat `clientSecret` as optional (omit the
  parameter when empty). `CalendarStatus.googleSupported` becomes true on Android when `androidClientId` is set.
  README: steps incl. `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass
  android` for the debug SHA-1.
- [x] **#18 Auto-update** (Electron): `electron-updater` with `publish: [{ provider: 'github', owner:
  'leozencreates', repo: 'hyper-do' }]` in `package.json › build` (so `npm run dist` also emits `latest.yml`);
  `settings.autoUpdate: boolean` (default `true`); on startup (packaged only, 30 s after ready) and every 6 h
  `checkForUpdates`; when downloaded, show a toast "Update x.y.z ready — Restart now / Later" inside the app
  (IPC `tidi:update-status`) and a "Check for updates" button + current version in Settings → About.
  Unsigned builds: do not set `publisherName`.
- [x] **#16 Cross-device sync without a server**: `src/lib/sync.ts` — pure merge of two `AppData` task sets using
  `task.updatedAt: number` (new field, bumped on every change through `useTaskActions` / Telegram / deep links;
  default `createdAt`) and tombstones `data.deleted: { id: string; at: number }[]` (kept 30 days; `remove`
  writes one). Merge rule: per id the newer `updatedAt` wins; a tombstone newer than the task deletes it;
  `dailyDone` merges by max per day; `focusLog` unions by id; settings are **not** synced. Transports:
  **Folder** (Electron: a user-chosen directory such as a OneDrive/Dropbox/Syncthing folder; file
  `hyperdo-sync.json`; `fs.watch` + 30 s poll) and **WebDAV** (Electron + Android + web: URL, user, password →
  `PUT`/`GET` with `If-Match`/ETag; Android via `CapacitorHttp`, credentials in the platform state store). Sync
  runs after every local save (debounced 2 s) and on a 60 s timer; Settings → Sync shows status/last sync/
  errors and a "Sync now" button. Conflicts never lose data thanks to `updatedAt` + tombstones; the merge is
  unit-tested with the obvious matrix (local-only, remote-only, both edited, deleted on one side, reopened).

## Final

- [x] README: new features in the feature list, Settings groups, Telegram command table, Android share/OAuth
  steps, sync section, updater note, `npm test`. PRIVACY.md: WebDAV/folder sync and updater network calls.
  → Closing pass 13 Oct 2026: README rewritten as one document (grouped features, shortcuts table, verified token
  table, Settings overview, command table from `botCommands()`, regenerated project tree); PRIVACY.md lists every
  outbound connection with what is stored locally; `CLAUDE.md` map, i18n and sync notes corrected;
  `docs/MANUAL-TEST-2026-10.md` added.
- [x] Bump version to 0.2.0 (`package.json`; Android `versionCode 2`, `versionName "0.2.0"`).

## After 0.2.1 — polish

- [x] **Sound effects + mute switch** (15 Oct 2026, spec `docs/2026-10-15-sound-effects-design.md`): Web Audio
  blips for add / done / delete / undo / snooze / focus next to the existing Hyper Focus chimes (`SoundKind`,
  `playSound` in `sound.ts`); `settings.sounds: boolean` (default `true`) with a 🔊/🔇 button in the header and a
  Settings toggle; pure gate `soundAllowed` — a running Hyper Focus work round silences every sound, its own closing
  chime included (the chime ending a break plays). `useSounds` hook, `useTaskActions.onSound`,
  `useCelebration(enabled, chime)`, `useHyperFocus({ play })`, mini window wired too.
- [x] **Three known gaps closed** (19 Oct 2026, spec `docs/2026-10-19-known-gaps-design.md`): Android morning digest /
  evening review as pre-scheduled local notifications (`planDigestTimes`, toggles visible on Android); Android nag
  counting from the previous plan (`deliveredNags` / `markNaggedBy`, plan in Preferences `hyperdo-nag-plan`, escalation
  line on planned notifications); Telegram `live` / `byMessage` persisted in `userData/hyperdo-telegram.json` with a
  `reconcile()` pass on start for tasks finished while the app was closed.
- [x] **🧭 What now?** (19 Oct 2026, spec `docs/2026-10-19-what-now-design.md`): pure ranking `rankNext` /
  `suggestNext` / `reasonText` in `src/lib/whatnow.ts` (urgency, priority, momentum, ignored reminders; energy and
  time chips narrow it), dialog `WhatNow.tsx` (header button + `W`, Focus / Hyper Focus / Open / Another), Telegram
  `/next` (`/n`) with ↻ Another.
- [x] **Recurring tasks on Google Calendar** (19 Oct 2026, spec `docs/2026-10-19-gcal-recurring-design.md`): the push
  sends `recurrence: ['RRULE:…']` (+ `timeZone` for timed series) via `googleEventBody`; single ↔ recurring switches
  recreate the event (`pushAction`); monthly anchors on the 29th–31st export with the month-end clamp
  (`BYMONTHDAY=28..d;BYSETPOS=-1`) in the push, the `.ics` export and the "add to calendar" links.
- [x] **Android escalation level 2** (19 Oct 2026, `docs/2026-10-19-known-gaps-design.md` § 2b): from `popupAfter`
  ignored reminders on, planned notifications use the high-importance channel `hyperdo-urgent` (heads-up, vibration,
  🚨 title) via `plannedEscalation`; Android Settings name the step "Urgent notification after".
- [x] **Stuck? · start-by · Android keep-alive** (20 Oct 2026, spec `docs/2026-10-20-stuck-and-start-by-design.md`):
  `Task.snoozeCount` counted by `snoozeTask` on every snooze / postpone path; from 3 on a 😴 ×N chip opens the
  "Stuck on this?" dialog (split / real date / do it now / let it go / keep going) and reminders carry a nudge line;
  `startBy` chip "▶ Start: 16:15" / "▶ Start now" (+20 in What-now); Android "open the app once" notification at
  +47 h.
- [x] **🔁 Routines** (20 Oct 2026, spec `docs/2026-10-20-routines-design.md`): `Task.routine` (subtasks = steps),
  morning / evening templates in TR/EN/RU (`routine.ts`), sidebar block "Routines" (+ Routine, ▶), editor toggle, row
  🔁 chip + ▶ Run, step-by-step runner `RoutineRunner.tsx` (✓ Done / ⏭ Skip / ↶ Back, stopwatch per step, summary;
  completing the last step completes the task → streak, next day's copy with fresh steps).
