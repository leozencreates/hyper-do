# Hyper Do

> An ADHD-friendly personal to-do app that keeps nagging you **until you actually mark the task done**.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android%20%7C%20PWA-ff8a3d)
![Stack](https://img.shields.io/badge/stack-React%2019%20%C2%B7%20TypeScript%20%C2%B7%20Vite%20%C2%B7%20Electron%20%C2%B7%20Capacitor-a78bfa)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20TR%20%7C%20RU-38bdf8)
![Privacy](https://img.shields.io/badge/data-only%20on%20your%20device-4fd18b)

No account, no cloud, no subscription. Your data never leaves your device — unless **you** connect Telegram, a calendar or a sync file, and even then it goes straight from your device to that service.

## Download

**Windows:** grab the latest installer from the [Releases page](https://github.com/leozencreates/hyper-do/releases/latest) — currently [`Hyper-Do-Setup-0.2.0.exe`](https://github.com/leozencreates/hyper-do/releases/download/v0.2.0/Hyper-Do-Setup-0.2.0.exe). Run it, pick a folder, done. See [Windows installer and uninstall](#windows-installer-and-uninstall) for details.

**New in 0.2.0:** quick-add popup, actionable toasts, mini window, escalation ladder, streaks, Telegram bot v2, digests, Android notification buttons and share target, auto-update and cross-device sync. Installing over 0.1.0 keeps your data. Installed 0.1.0 builds do not auto-update; install 0.2.0 by hand once, later versions arrive through the built-in updater.

> Windows SmartScreen may warn that the publisher is unknown because the installer is not code-signed. Click **More info → Run anyway**.

**Android / macOS:** no prebuilt packages yet — see [Building for Android](#building-for-android) and [Development](#development).

---

## Contents

- [Download](#download)
- [Why Hyper Do?](#why-hyper-do)
- [Features](#features)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Platforms](#platforms)
- [Quick start](#quick-start)
- [Natural-language quick add](#natural-language-quick-add)
- [Settings overview](#settings-overview)
- [Telegram bot](#telegram-bot-windowsmacos)
- [Calendar connections](#calendar-connections)
- [Sync between devices](#sync-between-devices)
- [Updates](#updates)
- [Windows installer and uninstall](#windows-installer-and-uninstall)
- [Building for Android](#building-for-android)
- [Development](#development)
- [Project structure](#project-structure)
- [Data and privacy](#data-and-privacy)

---

## Why Hyper Do?

Most to-do apps notify you once and go quiet. Hyper Do doesn't. Until you complete a task and check it off, it keeps reminding you at the interval you chose. If the due date has passed, the interval is halved. It reaches you from the system tray when the window is closed, as a local notification when your phone is locked, and through Telegram if you want it to.

## Features

### Reminders

- 🔔 **Reminds until done** — a separate interval per task (5 min … 2 h, `@0` = off). Overdue tasks are reminded twice as often (minimum every 5 minutes).
- ✅ **Actionable reminders** (Windows) — every toast has **Done**, **😴 30 min** and **Open** buttons that work without bringing the app up (macOS gets Done / 30 min). They fire `hyperdo://task/<id>/done|snooze/30|open` deep links.
- 👀 **Escalation ladder** — every reminder you ignore is counted per task. From the 3rd one on, notifications and Telegram messages start with "👀 Ignored 3× — still not done?"; from the 5th on the desktop app pops the mini window on top of everything and the toast turns critical. Any reaction (done, snooze, postpone, focus, edit, a toast or Telegram button) resets the counter. Thresholds in Settings; task rows show a "👀 ×N" chip. Android counts only in the UI, because its notifications are pre-scheduled.
- 😴 **Snooze and quiet** — snooze 15 min / 30 min / 1 h / 3 h per task, quiet hours per day, and a global mute (`/mute 2h` in Telegram; the header shows a 🔇 chip you can click to unmute).
- ☀️ **Morning digest / evening review** (desktop + Telegram) — one notification a day with overdue / due today / open counts, your streak and the top 3 tasks; the optional evening review says what got done; on Sundays it becomes a weekly review.
- 😏 **Playful titles** — random notification titles like "Forgot again, didn't you?" or "Tick tock…" (can be turned off).

### Focus

- 🎯 **Focus mode** — pin a single task to the top and see its next sub-step.
- ⚡ **Hyper Focus (Pomodoro)** — one click starts a 40-minute deep-work round followed by a 5-minute break, repeating until you stop. Progress ring, countdown in the window title, chime and notification on every phase change. Lengths are adjustable.
- 🔕 **Hyper Focus silences the rest** — during a work round only the focused task may remind you; everything else waits for the break (toggle in Settings).
- ⏱ **Estimates and time tracking** — give a task an estimate (5/15/30/60/120 or any number; quick add `~30m`, `~2h`). Hyper Focus logs every finished work round to the task, so the row shows `45m / 30m` and turns orange when you have gone over — gentle feedback against time blindness.
- 🪫 **Energy level and "give me an easy one"** — tag tasks 🪫 low / 🔋 medium / ⚡ high (editor or quick add `^low ^med ^high`), filter by energy in the sidebar, and press `E` (or 🎲) when you are stuck: Hyper Do picks a random low-energy, short, low-priority task, scrolls to it and offers "Focus it" / "Another".
- 🔥 **Streaks, heatmap, celebration** — the sidebar shows your current streak (consecutive days with at least one completion). **📈 Stats** opens the current and best streak, done today / in 7 days, a 12-week GitHub-style heatmap, Hyper Focus minutes and the top tags of the week. Completing a task plays a two-note chime and fires a small confetti burst (toggle; respects reduced-motion).

### Organise

- 📋 **Task details** — priority (high / medium / low), tags, due date, notes, subtasks, time estimate, energy level.
- ↻ **Recurring tasks** — daily, weekdays, weekly, monthly, yearly, or custom: every N days/weeks/months/years, chosen weekdays such as Mon·Wed·Fri, and "repeat after completion" (the next date counts from when you finish). Monthly tasks keep their day of month (31 Jan → 28 Feb → 31 Mar), yearly ones their date (29 Feb → 28 Feb in common years).
- 🗂️ **Board (Kanban)** — To do / Doing / Waiting / Done columns. Drag cards between columns and reorder them; dropping onto "Done" completes the task. Quick add at the bottom of every column.
- 🔍 **Views, search and sort** — Today, This week, All, Board, Done; search (`/`) across titles, notes, tags and subtasks; sort by smart order, due date, priority, newest, A→Z or manually (drag to reorder).
- ↶ **No regrets** — undo delete, duplicate a task, push to tomorrow, clear all completed tasks, "N done today" counter.
- 🌐 **Three languages** — English, Türkçe, Русский (default: English; switch from the sidebar or Settings). 🌗 Dark / light / system theme.

### Capture

- ⚡ **Natural-language quick add** — `tomorrow 18:00 pay the bill #home !1 @30m` → date, time, tag, priority, reminder interval, estimate, energy and recurrence are parsed with a live preview. [Full token table](#natural-language-quick-add).
- 🧠 **Brain dump** — paste a whole list into the quick-add box (or press `B` for the big textarea) and every line becomes a task; bullets are stripped and the quick-add syntax works per line. Shift+Enter adds a line, Enter adds the tasks.
- 🪄 **Global quick-add popup** (Windows/macOS) — press `Ctrl+Shift+Space` (`Cmd+Shift+Space` on a Mac, changeable) anywhere on the desktop and a small always-on-top box appears; type, Enter, done. Also in the tray menu.
- 📲 **Share → Hyper Do** (Android) — share text or a link from any app and the task editor opens prefilled.
- 🤖 **Type to the bot** — plain text sent to the Telegram bot is a quick add too; forwarded messages and links become tasks.

### Telegram

- 📲 **Reminders on your phone** — every reminder also arrives in your own Telegram bot, one live message per task that updates itself when you finish the task on the desktop. Buttons **✓ Done · 🎯 Focus / ⏰ 30 min · ⏰ 1 h · 🌅 Tomorrow**.
- 🗂 **Work from the chat** — `/list`, `/today`, `/week`, `/overdue`, `/search`, task cards with tappable subtasks, `/done 1 3 4`, `/snooze 2 tomorrow 09:00`, `/due`, `/prio`, `/every`, `/sub`, `/note`, `/rename`, `/del`, `/undo`, `/stats`, `/mute`, `/quiet`, `/backup`. Reply to any reminder to add a subtask. [Command table](#telegram-bot-windowsmacos).
- 🔐 **Private by design** — your own bot token, a 6-digit pairing code, and an optional "only when the PC is idle" rule.

### Calendars

- 📅 **Calendar connections** — connect Google Calendar or any ICS/webcal link (Outlook, iCloud, Nextcloud…) and upcoming events turn into tasks automatically, so meetings get nagged like everything else. Google is two-way: due tasks can be mirrored into a "Hyper Do" calendar.
- 📆 **Add to calendar / export** — one-click "Add to calendar" per task (Google, Outlook.com, Office 365, Yahoo, .ics) and a full `.ics` export with `RRULE` for recurring tasks.

### Sync

- 🔄 **Sync between devices, no server** — point every device at one `hyperdo-sync.json`: a WebDAV file (Nextcloud, Yandex Disk, Koofr, Synology…) on desktop, Android and web, or a folder that OneDrive / Dropbox / Syncthing mirrors on desktop. Tasks, completions and the focus log merge by per-task timestamps and tombstones, so an edit on the phone and a delete on the PC never overwrite each other; settings stay per device.

### Desktop (Windows/macOS)

- 🖥 **Tray** — the window hides to the tray on close; reminders keep running. Tray menu: Open, Quick add…, Mini window, Quit.
- ▣ **Mini window** — a 340×150 always-on-top card with the focus task, its next step, the Hyper Focus ring and countdown, and Done · 😴 30 · ⚡ Focus · ↗ Expand buttons. Drag it anywhere; the position is remembered. Toggle with `M`, the ▣ header button, the tray menu or Settings → Desktop. Closing the main window to the tray leaves it open.
- 🚀 **Launch at login** — start hidden in the tray with the OS session so reminders run from the first minute (installed builds only).
- 🗃️ **Automatic daily backups** — on the first save of each day the data file is copied to `backups/` next to it; the newest 7 copies are kept. Settings → Backup shows the folder and the last copy.
- ⬆️ **Auto-update** — the installed app checks GitHub Releases and offers "Restart now / Later" when a new version is downloaded. [Details](#updates).
- 💾 **JSON backup** — export and import from Settings on every platform.

## Keyboard shortcuts

All single-key shortcuts are ignored while you type in a field or a dialog is open.

| Key | Where | Action |
|---|---|---|
| `N` | main window | New task (opens the editor) |
| `/` | main window | Focus the search box (`Esc` clears it) |
| `1` … `5` | main window | Switch view: Today · This week · All · Board · Done |
| `E` | main window | "Give me an easy one" |
| `B` | main window | Brain dump textarea |
| `M` | main window, desktop app | Show / hide the mini window |
| `Esc` | any dialog | Close the editor, Settings, Stats, Brain dump; in the quick-add popup: hide it |
| `Enter` / `Shift+Enter` | quick-add box | Add the task(s) / new line (one task per line) |
| `Ctrl+Shift+Space` (`Cmd+Shift+Space` on macOS) | anywhere on the desktop | Global quick-add popup (changeable in Settings → Desktop) |

Board cards are dragged with the mouse; there are no keyboard shortcuts for moving them.

## Platforms

| Platform | How | Reminders | Extras |
|---|---|---|---|
| Windows (Electron) | Installer from Releases, or `npm run dist` → `Hyper-Do-Setup-x.y.z.exe`; desktop and Start menu shortcuts are created | From the tray even when the window is closed; toasts with **Done / 😴 30 min / Open** buttons; flashes the taskbar entry | Tray, mini window, global quick-add shortcut, launch at login, daily backups, auto-update, Telegram bot, digests, Google (two-way) + ICS feeds, WebDAV + folder sync |
| macOS (Electron) | `npm run dist:mac` (must run on a Mac) | Stays in the Dock, notifies when the window is closed; notification actions Done / 30 min | Same as Windows (untested on real hardware) |
| Android (Capacitor) | `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` | Notifies even when the app is closed: reminders are scheduled 48 h ahead as local notifications and extended on every launch; every notification has **✓ Done / 😴 30 min / 🎯 Focus** buttons | Share target ("Share → Hyper Do"), Google Calendar (two-way) when an Android OAuth client is configured, ICS feeds, WebDAV sync. No digest, no nag counting, no Telegram |
| Web / iPhone / iPad (PWA) | `npm run dev:web` or publish the `dist-web` folder | Only while the tab or the home-screen app is **open** | Google (two-way) + ICS feeds (some providers block CORS), WebDAV sync (server needs CORS) |

"Add to calendar" links, `.ics` export and JSON backup work everywhere.

**On iPhone:** open the site in Safari → Share → **Add to Home Screen**. Notification permission can only be requested from the app launched from the home screen (iOS 16.4+).

## Quick start

```bash
git clone https://github.com/leozencreates/hyper-do.git
cd hyper-do
npm install
npm run dev        # Electron + Vite with hot reload
```

To try it in the browser only:

```bash
npm run dev:web    # http://localhost:5180 — phones on the same network can open it too
```

## Natural-language quick add

Type one line and Hyper Do parses the rest:

```
tomorrow 18:00 pay the bill #home !1 @30m ~45m ^low *weekly
```

| Token | Meaning |
|---|---|
| `today`, `tomorrow`, `friday`, `fri` (TR `bugün`, `yarın`, `cuma`, RU `сегодня`, `завтра`, `в пятницу`) | Due date; a weekday name means the next such day (today's name = next week) |
| `15.10`, `15/10`, `15.10.2027` | Day.month[.year]; a past date without a year means next year |
| `15 oct`, `oct 15`, `15 october 2027`, `october 15th` (TR `15 ekim` / `15 eki`, RU `15 окт` / `15 октября`) | Date with a month name; English names may come first, Turkish/Russian only after the day |
| `next week` (TR `haftaya`, `gelecek hafta`, RU `на следующей неделе`) | Monday of next week |
| `next monday` (TR `gelecek pazartesi`, `önümüzdeki salı`, RU `в следующий понедельник`) | That weekday of next week |
| `in 30m`, `in 2h`, `in 3 days`, `in 1w`, `in an hour` (TR `30dk sonra`, `2 saat sonra`, `yarım saat sonra`, `bir hafta sonra`, RU `через 30 мин`, `через 2 часа`, `через час`, `через неделю`) | Relative: now + offset, to the minute |
| `18:00`, `18.30`, `5pm`, `5:30pm`, `5 pm`, `12am`, `noon`, `midnight` (TR `öğlen`, `gece yarısı`, RU `полдень`, `полночь`) | Time; a time without a day is today, or tomorrow if already past |
| `*daily`, `*weekdays`, `*weekly`, `*monthly`, `*yearly` (TR `*günlük *haftaiçi *haftalık *aylık *yıllık`, RU `*ежедневно *будни *еженедельно *ежемесячно *ежегодно`) | Recurrence (without a date the series starts today 23:59) |
| `*every 3d`, `*every 2w`, `*every 2 months`, `*every 1y` (TR `*her 3g`, `*her 2h`, `*her 2a`, RU `*каждые 3д`, `*каждые 2н`, `*каждые 2м`) | Custom recurrence: every N days / weeks / months / years (`*every 1…` = the plain recurrence) |
| `#home` | Tag (several allowed) |
| `!1` / `!2` / `!3`, `!high` / `!med` / `!low` (TR `!yüksek !orta !düşük`, RU `!высокий !средний !низкий`) | Priority: high / medium / low |
| `@30m`, `@2h`, `@45dk`, `@2ч`, `@0` | Reminder interval (`@0` = no reminders) |
| `~30m`, `~2h`, `~45dk`, `~2ч` | Time estimate |
| `^low` / `^med` / `^high` (TR `^düşük ^orta ^yüksek`, RU `^низкая ^средняя ^высокая`) | Energy level |

A day without a time is due at 23:59. Keywords work in English, Turkish and Russian regardless of the app language. Parsed parts show up in the preview as you type. The same parser runs in the global quick-add popup and for text sent to the Telegram bot. Several lines (pasted or added with Shift+Enter) become several tasks — leading `- `, `* `, `• `, `1. `, `1) ` bullets are removed.

## Settings overview

Everything is in one Settings dialog (⚙ in the sidebar). Groups marked *desktop* appear only in the Electron app, *Android* only there.

| Group | Setting | Default | Notes |
|---|---|---|---|
| General | Language | English | EN / TR / RU |
| | Theme | dark | dark / light / system |
| | Default sort | smart | smart · due · priority · newest · A→Z · manual |
| | Default reminder interval | 20 min | 5 … 120 min, applied to new tasks |
| | Hyper Focus (Pomodoro) work / break | 40 / 5 min | |
| | Hyper Focus silences other tasks | on | only the focused task reminds during a work round |
| Reminders | Playful reminder titles | on | |
| | Escalate when overdue | on | interval halved past the due date, minimum 5 min |
| | Escalation ladder | on | "escalation line after 3", "mini window after 5" ignored reminders |
| | Celebrate completions | on | chime + confetti |
| | Flash in the taskbar *(desktop)* | on | |
| | Bring window to front on reminder *(desktop)* | off | |
| | Quiet hours | off, 23:00 → 08:00 | no reminders in the window; also the end of the "Tomorrow" snooze |
| | Morning digest *(desktop)* | on, 08:00 | toast + Telegram; sent once per day, within 12 h of the time |
| | Evening review *(desktop)* | off, 20:00 | Sundays: weekly review |
| 🖥 Desktop *(desktop)* | Launch at login | off | starts hidden in the tray (`--hidden`); installed builds only |
| | Mini window | off | same as `M`, the ▣ button and the tray menu |
| | Quick-add shortcut | `CommandOrControl+Shift+Space` | [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator) syntax, Reset button, status line "Active / Could not register…"; empty = off |
| Telegram bot *(desktop)* | Telegram bot | off | token field, status line, pairing code / "Open bot in Telegram" / Unlink, Send test message |
| | Delete a task's previous reminder when a new one is sent | on | off = only the old buttons are removed |
| | Send to Telegram only when the PC has been idle | off, 5 min | always sends while the session is locked |
| 📅 Calendars | Show calendar events | on | events above the list in Today / This week |
| | Turn events into tasks automatically | on | next 7 days, tag `#calendar` |
| | Google Calendar | — | Client ID + secret (desktop/web) or Android Client ID (Android); Connect / Disconnect, calendars to show, **Send tasks to Google Calendar** (off), Sync now |
| | Calendar feeds (ICS / webcal) | — | name + URL per feed, enable/disable, delete |
| | Export tasks (.ics) | — | all open tasks with a due date |
| 🔄 Sync between devices | Mode | off | Off · Folder *(desktop)* · WebDAV |
| | Folder | — | Choose… (directory picker) |
| | WebDAV file URL, username, password | — | **Save credentials** stores them outside the data file; status line, Sync now |
| Backup | Export JSON / Import JSON | — | import asks for confirmation and replaces the data |
| | Automatic daily backup *(desktop)* | on | folder path, Open folder, last copy time |
| Keyboard shortcuts | — | | the list above |
| ℹ️ About | Version | | on every platform |
| | Check for updates *(desktop)* | | status line, **Restart now** when downloaded |
| | Automatic updates *(desktop)* | on | |
| | Send test notification | | button at the bottom |

Reminder toasts on Windows carry **Done / 😴 30 min / Open** buttons. They fire `hyperdo://` deep links, which the app registers as a protocol handler at startup (in development it points at the Electron binary plus the project folder).

## Telegram bot (Windows/macOS)

1. In Telegram, send `/newbot` to **@BotFather**, give it a name and copy the token it returns.
2. In Hyper Do open Settings → enable **Telegram bot** and paste the token. A status line under the token field shows
   what the bot is doing: *Off*, *Starting…*, *Running as @yourbot · last poll 12:03*, or *Error: …* (a rejected
   token stops polling until you change it; "another Hyper Do is already polling this bot" means a second copy of the
   app uses the same token).
3. **Pair your chat.** Settings shows a 6-digit pairing code. Either send `/start <code>` to your bot, or tap
   **Open bot in Telegram** (a `t.me/yourbot?start=<code>` link that works from your phone too) and press *Start*.
   Only a chat that knows the code can link; a bot that is already linked tells every other chat so. **Unlink**
   forgets the chat and generates a new code. Data files from earlier versions that were already linked keep
   working without a code.
4. While the app (or its tray icon) is running, reminders arrive both as desktop notifications and as Telegram
   messages, with **✓ Done · 🎯 Focus** / **⏰ 30 min · ⏰ 1 h · 🌅 Tomorrow** buttons underneath (*Tomorrow* = next
   day at 09:00, or at the end of your quiet hours). Once a task has been ignored "escalation line after N" times,
   the message starts with `👀 Ignored N× — still not done?`.

How the chat stays tidy:

- **One live reminder per task.** A new reminder deletes the previous one of the same task (Settings → Telegram →
  *Delete a task's previous reminder…*, on by default; off = only its buttons are removed). Telegram only lets bots
  delete messages younger than 48 h; older ones lose their buttons instead.
- **Desktop actions reflect into the chat.** Finish a task in the app, from a toast or on the mini window and its
  Telegram message turns into ~~title~~ ✓ without buttons; deleting a task removes the buttons.
- **Only when away from the PC** (off by default): with *Send to Telegram only when the PC has been idle* the
  Telegram copy is skipped while you are typing or clicking; it goes out after the idle minutes you set, and
  always while the session is locked. Desktop toasts are unaffected.
- **Task cards.** Lists carry number buttons; tapping one opens a card with due, priority, tags, notes, a button
  per subtask (tap to tick), the action buttons and `🗑 Delete · ✏ Priority`.
- **Reply = attach.** Replying to any reminder, card or confirmation adds a **subtask** with your text; start it with
  `note:` (TR `not:`, RU `заметка:`) to append to the notes instead.
- **Forwarded messages and links** become tasks: the first line (without URLs, max 80 characters, or "Link") is the
  title, the whole text lands in the notes. The title line still understands quick-add syntax.
- **Morning digest / evening review** (Settings → Reminders): one message a day at the chosen time with
  overdue / due today / open counts, your streak and the top 3 tasks as number buttons; the optional evening
  review says what got done; on Sundays it becomes the weekly review.

Commands (generated from the same list that fills the "/" menu in Telegram; `/help` shows them grouped the same way):

| Group | Command | Alias | What it does |
|---|---|---|---|
| Tasks | `/add …` | `/a` | Add a task (quick-add syntax); the reply echoes what was understood |
| Tasks | `/done N [N…]` | `/d` | Finish task N (several at once: `/done 1 3 4`) |
| Tasks | `/snooze N [M \| date]` | `/s` | Snooze task N for M minutes or until a date (default 30): `/snooze 2 tomorrow 09:00`, `/snooze 2 in 2h` |
| Tasks | `/focus N` | `/f` | Put task N in focus |
| Tasks | `/due N <date>` | | Change the due date of task N (`/due 2 tomorrow 18:00`; `/due 2 off` clears it) |
| Tasks | `/prio N 1\|2\|3` | | Priority: `/prio N 1|2|3` (words work too: `high`, `yüksek`, `низкий`…) |
| Tasks | `/every N <min>\|off` | | Reminder interval: `/every N 30 | off` (`2h`, `45dk`, `2ч` also) |
| Tasks | `/sub N <text>` | | Add a subtask to task N |
| Tasks | `/note N <text>` | | Add a note to task N |
| Tasks | `/rename N <text>` | | Rename task N |
| Tasks | `/del N` | | Delete task N (asks first with 🗑 Delete / Cancel buttons) |
| Tasks | `/undo` | | Reopen the last finished task (a recurring task's next occurrence stays) |
| Views | `/list` | `/l` | Open tasks, numbered, grouped **Overdue · Today · Later · No date**; long lists arrive in several messages |
| Views | `/today` | | Today and overdue |
| Views | `/week` | | This week (due within 7 days) and overdue |
| Views | `/overdue` | | Overdue tasks |
| Views | `/search <text>` | | Search tasks (title, notes, tags, subtasks) |
| Views | `/stats` | | Streak, done today, focus minutes |
| Reminders | `/mute [2h\|45m\|off]` | | Mute every reminder on every device: `/mute 2h | 45m | off` (bare = 1 h; TR `2sa`, `45dk`; RU `2ч`, `45мин`) |
| Reminders | `/quiet [on\|off]` | | Toggle quiet hours; the reply names the window |
| Other | `/backup` | | Send the data file as JSON (`hyperdo-backup-YYYY-MM-DD.json`, bot token removed) |
| Other | `/help` | | This list |

Plain text (no slash) is the same as `/add`. The numbers refer to the last list or view you requested (a digest's
top 3 count as well). Everything the bot shows is HTML-escaped, so titles with `<` or `&` are safe.

The token is stored only in the local data file (so it is part of JSON exports and automatic backups); it is never
sent anywhere except to the Telegram Bot API. `/backup` is the one command that sends your data through Telegram's
servers, and only when you ask for it.

## Calendar connections

Settings → **📅 Calendars**. Everything runs on your device; there is no Hyper Do server in between.

### Google Calendar (two-way)

Like the Telegram bot, Hyper Do uses *your own* Google OAuth client, so nobody else can see your calendar.

1. Open [console.cloud.google.com](https://console.cloud.google.com) → create a project → **APIs & Services → Library** → enable **Google Calendar API**.
2. **APIs & Services → OAuth consent screen** → External → add yourself as a test user (or publish the app so the login does not expire every 7 days).
3. **Credentials → Create credentials → OAuth client ID**
   - Desktop app (Windows/macOS): application type **Desktop app**.
   - Web / PWA: application type **Web application**, and add the app URL shown in Settings (e.g. `http://localhost:5180/`) as an *authorized redirect URI*.
   - Android: application type **Android**, package name `com.hyperdo.app`, and the SHA-1 of the key that signs your APK. For the debug build:
     ```bash
     keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android
     ```
     (on Windows the keystore is `%USERPROFILE%\.android\debug.keystore`). Android clients have no secret.
4. Paste the **Client ID** and **Client secret** into Hyper Do and click **Connect Google account**. The desktop app opens your browser and finishes the login on `127.0.0.1`; the web app redirects back to itself. On Android paste the **Android Client ID** only: the login opens in a browser tab (Custom Tab) and returns to the app through `com.hyperdo.app:/oauth2redirect`.

What you get:

| Direction | Behaviour |
|---|---|
| Google → Hyper Do | **Events become tasks automatically**: every event of the next 7 days is added to the task list with the `#calendar` tag and nagged like any other task (toggle *Turn events into tasks automatically*). If an event moves, its task follows; a task you delete is not re-added. Events of the next ~2 weeks are also shown above the list in **Today** and **This week** (collapsible). Pick which calendars to show. Refreshes every 10 minutes or on **Sync now**. |
| Hyper Do → Google | Optional toggle **Send tasks to Google Calendar**: every open task with a due date appears in a calendar named **Hyper Do** (30-minute block at the due time; tasks due at 23:59 become all-day). Edits are patched, done/deleted tasks are removed. Turning the toggle off removes them all. Recurring tasks are pushed as single events (the current occurrence only). |

The refresh token and the task→event map are stored in a separate local file (`hyperdo-calendar.json` next to the data file, or `localStorage` / Preferences on web and Android). They are **not** part of JSON backups. **Disconnect** deletes the mirrored events and revokes the token.

Android: Google blocks OAuth inside app WebViews, which is why the Android app signs in through a browser tab with an OAuth client of type *Android* (PKCE, no secret). Without an Android Client ID the Android build offers ICS feeds only.

### Other calendars (ICS / webcal, read-only)

Paste the private iCal address of any calendar: Outlook.com (*Settings → Calendar → Shared calendars → Publish → ICS*), iCloud (*Share → Public calendar*), Nextcloud, Fastmail, Proton, a Google "secret address in iCal format"… Their upcoming events become tasks automatically too. Recurring events (`RRULE` daily/weekly/monthly/yearly, `EXDATE`, overrides) and `TZID` time zones are handled. The web version may be blocked by some providers (CORS); the desktop and Android apps are not.

### Add to calendar / export

- Expand a task with a due date → **📆 Add to calendar** → Google Calendar, Outlook.com, Office 365, Yahoo or a downloadable `.ics` (Apple Calendar, Thunderbird…). No account connection needed.
- Settings → **Export tasks (.ics)** writes all open tasks with a due date into one `.ics` file.
- Recurring tasks are exported with an `RRULE` (`FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY` for weekday sets; weekdays = `BYDAY=MO,TU,WE,TH,FR`), also in the Google "Add to calendar" link. "Repeat after completion" rules cannot be expressed in a calendar and are exported as single events.

Optional for distributors: a `.env` with `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET` pre-fills the OAuth client in the build.

## Sync between devices

Hyper Do has no server, so sync works through a file **you** host: every device reads and writes the same
`hyperdo-sync.json`, and a merge that never loses data reconciles the copies. Settings → **🔄 Sync between devices**:

| Mode | Where | Platforms |
|---|---|---|
| **WebDAV** | One JSON file on any WebDAV server, written with `If-Match`/ETag so two devices never overwrite each other blindly | Windows/macOS, Android, web/PWA |
| **Folder** | `hyperdo-sync.json` inside a directory that another tool mirrors between your computers (OneDrive, Dropbox, Google Drive, Syncthing…) | Windows/macOS |

What syncs: tasks (with their subtasks, reminders, nag counters…), deletions, the daily completion counters and the Hyper Focus log.
What does **not** sync: settings (language, theme, intervals, Telegram token, calendar connections) and the running Hyper Focus session — those stay per device.

How the merge works: every task carries `updatedAt`; the newer copy of a task wins, a deletion leaves a tombstone for 30 days
that removes the task on the other devices unless they edited it *after* the delete (then it comes back), completion counters
take the maximum per day, the focus log is unioned. A delivered reminder does not count as an edit, so a nagging PC never
overwrites a change you made on the phone (nag counters may therefore differ per device). Sync runs 2 s after every change,
every 60 s, when the folder changes, and on **Sync now**; the status line shows the last sync and any error.

### WebDAV

Enter the **full URL of the file** inside an existing folder (the file itself is created on the first sync), then the
username and password (prefer an *app password*) and press **Save credentials** — they are stored only on the device, in
`hyperdo-sync.json` next to the data file on desktop, in Preferences on Android, in `localStorage` on the web; never in
the data file or in backups.

| Provider | File URL pattern |
|---|---|
| Nextcloud / ownCloud | `https://cloud.example.com/remote.php/dav/files/USERNAME/HyperDo/hyperdo-sync.json` (Files → Settings shows your WebDAV address; create the `HyperDo` folder first). App password: Settings → Security → Devices & sessions. |
| Yandex Disk | `https://webdav.yandex.ru/HyperDo/hyperdo-sync.json` — use an [app password](https://id.yandex.ru/security/app-passwords) for "Yandex Disk WebDAV". |
| Koofr | `https://app.koofr.net/dav/Koofr/HyperDo/hyperdo-sync.json` — Preferences → Password → generate an app password. |
| Synology NAS | Enable *WebDAV Server* (port 5006 https), then `https://nas.local:5006/home/HyperDo/hyperdo-sync.json` with your DSM account. |
| Any Apache / nginx DAV share | The URL of the file in the share. The server must support `ETag` on `GET`/`PUT` and `If-Match` (most do). |

Web/PWA: the server must allow cross-origin requests from the page's origin (CORS, including the `If-Match`/`If-None-Match` headers); Nextcloud needs that configured, the desktop and Android apps do not care.

### Folder

Choose a folder with **Choose…**; the app writes `hyperdo-sync.json` there atomically (temp file + rename) and watches
the folder, so an edit on the other PC shows up as soon as OneDrive / Dropbox / Syncthing has delivered the file. If both
PCs write at the same instant the loser notices the changed timestamp, merges again and retries.

Trying it on one PC: the desktop app allows a single instance, so pair it with the web build (`npm run dev:web`) through
WebDAV, or — for the folder mode — edit `hyperdo-sync.json` in the chosen folder by hand (change a title and raise that
task's `updatedAt`); the watcher picks the change up within a second.

## Updates

The **installed desktop app** checks [GitHub Releases](https://github.com/leozencreates/hyper-do/releases) 30 seconds after
start and every 6 hours (Settings → About → *Automatic updates*, on by default), downloads a new version in the background
and shows a toast **"Update x.y.z ready — Restart now / Later"** in the main window. *Later* hides the toast; the download is
installed on the next quit at the latest. Settings → About also has a **Check for updates** button with a live status line
(Checking… / Version x found, downloading… / You are up to date / error). In `npm run dev` the line says updates are only
available in the installed app.

The PWA and the Android app are updated manually: reload the page / install the new APK. Settings → About shows the
version on every platform.

## Windows installer and uninstall

Prebuilt installers are published on the [Releases page](https://github.com/leozencreates/hyper-do/releases). To build one yourself:

```bash
npm run dist     # → %LOCALAPPDATA%\hyperdo-release\Hyper-Do-Setup-0.2.0.exe (+ latest.yml for the updater)
```

The installer is a standard NSIS setup wizard:

- Lets you pick the installation folder, creates desktop and Start menu shortcuts and launches the app when finished.
- Registers an uninstaller: remove it from **Settings → Apps → Installed apps → Hyper Do** or run `Uninstall Hyper Do.exe` in the install folder. Your task data in `%APPDATA%\hyper-do` is kept so a reinstall picks up where you left off.

## Building for Android

Requirements:

- Android SDK (`%LOCALAPPDATA%\Android\Sdk`, platform 36)
- JDK 21 — a portable copy under `.tools/jdk-21*`; `org.gradle.java.home` in `android/gradle.properties` points there

```bash
npm run android:sync   # build web + copy into the Android project
npm run android:apk    # build a debug APK
npm run android:open   # open in Android Studio (if installed)
npm run android:run    # install and run on a connected device
```

Copy the APK to your phone and install it. It asks for notification permission on first launch. Setting **Settings → Battery → Hyper Do → "Unrestricted"** matters so reminders are not delayed.

On the phone:

- **Notification buttons** — every reminder carries **✓ Done**, **😴 30 min** and **🎯 Focus** (in the app language). Done completes the task exactly like the checkbox (streak counted, recurring tasks spawn their next copy) and cancels the remaining notifications of that task; 30 min snoozes it; Focus makes it the focus task and opens the app on it. Tapping the notification body just opens the app on the task.
- **Share → Hyper Do** — share text or a link from any app (browser, YouTube, Twitter, a chat…) and pick **Hyper Do** in the share sheet: the task editor opens prefilled — the shared subject (or the first line) becomes the title, the whole text including the URL goes into the notes.
- **Google Calendar** — see [Calendar connections](#calendar-connections): an OAuth client of type *Android* (package `com.hyperdo.app` + SHA-1) lets the phone sign in through a browser tab; ICS feeds need no setup.
- **Sync** — WebDAV only (Settings → Sync); the folder mode is desktop-only.
- Not on Android: the Telegram bot, the morning digest and the escalation counter (notifications are pre-scheduled, so the app cannot know which ones you ignored).

## Development

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run dev:web      # Browser only, http://localhost:5180
npm run build        # Build for Electron (dist/ + dist-electron/), runs tsc --noEmit first
npm run build:web    # Build the PWA (dist-web/)
npm test             # Vitest: src/lib/*.test.ts (pure libs) + electron/telegram.test.ts (fake Bot API) + electron/syncfolder.test.ts
npm run preview:web  # Preview dist-web locally
npm run dist         # Windows installer → %LOCALAPPDATA%\hyperdo-release\
npm run dist:mac     # macOS DMG (on a Mac)
npm run android:apk  # Android debug APK
```

> `npm run dist` writes its output to `%LOCALAPPDATA%\hyperdo-release\` instead of the project folder because of a folder-naming restriction under Desktop.

`npm test` runs 17 files / 405 tests in a few seconds; the Telegram transport test starts a fake Bot API on `127.0.0.1`, the folder-sync test uses a temp directory. See `docs/` for the roadmap, the Telegram design spec and the manual test plan (`docs/MANUAL-TEST-2026-10.md`, Turkish). `CLAUDE.md` holds the architecture notes and conventions.

Tech stack: React 19, TypeScript, Vite, Electron, electron-builder, electron-updater, Capacitor (Android), Web Notifications + Service Worker (PWA), Vitest.

## Project structure

```
electron/
  main.ts             Main process: windows (main / quick / mini), tray, JSON storage + daily backups, reminder tick,
                      toasts with buttons + hyperdo:// deep links, launch at login, digest check, IPC, hosts the bot,
                      calendar sync, sync engine and updater
  preload.ts          Secure IPC bridge (window.tidi)
  quick.ts            Global quick-add popup window + global shortcut registration
  mini.ts             Always-on-top mini window (?view=mini), remembered position in window-state.json
  telegram.ts         Telegram bot transport: long polling, status, pairing code, "/" menu, live-message bookkeeping,
                      onDataChanged reflection, sendDocument
  telegram.test.ts    Transport test against a fake Bot API on 127.0.0.1
  calendar.ts         Google login for the desktop app (PKCE + loopback redirect)
  syncfolder.ts       Folder sync transport: <dir>/hyperdo-sync.json, mtime token, atomic write, fs.watch
  syncfolder.test.ts  Folder transport against a temp directory
  updater.ts          Auto-update via electron-updater (GitHub Releases), status pushed as tidi:update-status

src/lib/              Pure logic (no React, no Electron) shared by Electron main, the browser build and Vitest
  types.ts            Task / Settings / AppData types, defaults, HyperDoApi (+ DesktopApi, SyncApi, CalendarApi)
  data.ts             normalizeData / parseAppData: old files get defaults here
  tasks.ts            Task helpers: newTask, taskFromQuickAdd, normalizeTask, completeTask (+recurrence), touchTask /
                      bumpChanged / onlyNagChanged, sort, reorder, search, duplicate, pickEasyTask
  parse.ts            Natural-language quick-add parser (TR/EN/RU) + brain-dump line splitter
  dates.ts            Date helpers: nextOccurrence (incl. custom rules), formatDue, day keys, durations
  reminder.ts         Reminder engine: collectDueReminders, planReminderTimes, buildNotification, quiet hours, mute,
                      Hyper Focus suppression, escalation ladder (markNagged / resetNag / escalationLevel)
  stats.ts            Focus log, daily completion counters, streaks, heatmap, top tags, applyNotificationAction
  digest.ts           Morning digest / evening + weekly review: text + HTML, "is one due now" rule
  deeplink.ts         hyperdo:// deep links (parse/build) and the Windows toast XML
  share.ts            "Share → Hyper Do" payload parsing and the title/notes rule (Android share target)
  telegram-commands.ts  Telegram bot logic: commands, views, task cards, reply/forward handling, /mute, HTML escaping,
                      pairing rules, digest reply, /backup document
  sync.ts             Sync merge: SyncDoc, mergeData (updatedAt + tombstones), toSyncDoc / applySyncDoc
  syncengine.ts       Sync engine: pull → merge → push with ETag / mtime, conflict retry, 2 s debounce + 60 s timer
  synctransport.ts    WebDAV transport (GET / PUT with If-Match, Basic auth) over fetch
  calsync.ts          Calendar sync engine: Google pull/push + ICS feeds, auto-import of events as tasks
  gcal.ts             Google OAuth (PKCE) + Calendar v3 client
  ics.ts              iCalendar parser (RRULE, EXDATE, TZID) and writer
  calendar-links.ts   "Add to calendar" links, task → event mapping, RRULE export, .ics export
  i18n.ts             EN / TR / RU strings and the playful title pools
  sound.ts            Web Audio chimes (Hyper Focus phases, completion)
  download.ts         Browser "save as file" helpers (JSON backup, .ics)
  emitter.ts          Tiny typed event emitter
  platform.ts         Picks the Electron / Capacitor / web adapter
  platform.web.ts     Browser: localStorage + Web Notifications, runs the reminder engine itself
  platform.capacitor.ts  Android: local notifications 48 h ahead with Done / 30 min / Focus buttons, share target,
                      Google login via Custom Tab, WebDAV sync
  platform.calendar.ts   Browser calendar bridge (localStorage state, redirect login)
  platform.sync.ts    Browser / Android sync bridge (WebDAV)
  store.ts, useTaskActions.ts, hooks.ts, useT.ts, useCalendar.ts   React state, persistence, task actions, theme/clock, i18n context
  *.test.ts           Vitest unit tests (calendar-links, data, dates, deeplink, digest, gcal, ics, parse, reminder,
                      share, stats, sync, syncengine, tasks, telegram-commands)

src/components/
  Board.tsx           Kanban board (drag-and-drop)
  QuickAdd.tsx        Quick-add box with live preview (multi-line = brain dump)
  QuickCapture.tsx    The global quick-add popup (?view=quick)
  MiniView.tsx        The mini window (?view=mini)
  BrainDump.tsx       Brain-dump modal (one task per line)
  TaskItem.tsx        List row with chips (due, recurrence, estimate / spent, energy, 👀 ×N)
  TaskEditor.tsx      Task editor panel (recurrence rules, estimate, energy, subtasks)
  FocusBanner.tsx     Focus-mode banner
  HyperFocus.tsx      Hyper Focus (Pomodoro) timer hook and bar
  StatsModal.tsx      Streaks, heatmap, focus minutes, top tags
  Celebration.tsx     Completion chime + CSS confetti
  SettingsPanel.tsx   Settings (+ Desktop, Telegram, Backup, About sections)
  CalendarSettings.tsx  Settings → Calendars
  SyncSettings.tsx    Settings → Sync
  CalendarStrip.tsx   Events above Today / This week
  AddToCalendar.tsx   Per-task "Add to calendar" menu
  Modal.tsx, Toggle.tsx   Shared dialog and switch

src/App.tsx           UI shell (views, sidebar, shortcuts, mute chip, update toast, share-target editor)
public/               PWA service worker (sw.js), manifest, icons
android/              Capacitor Android project; MainActivity.java forwards ACTION_SEND text to the web app
docs/                 ROADMAP-2026-10.md, 2026-10-13-telegram-bot-design.md, MANUAL-TEST-2026-10.md
```

## Data and privacy

| Environment | Storage |
|---|---|
| Electron (Windows/macOS) | `%APPDATA%\hyper-do\hyperdo-data.json` (+ daily copies in `backups/`; `window-state.json` holds the mini window position, `hyperdo-state.json` the digest timestamps, `hyperdo-calendar.json` the Google token and event map, `hyperdo-sync.json` the sync device id + WebDAV credentials) |
| Android | Capacitor Preferences (app sandbox) |
| Web / PWA | Browser `localStorage` |

There is no account, no telemetry and no remote server. Outbound connections exist only for features **you enable** in Settings:

| Feature | Talks to | Stored locally |
|---|---|---|
| Telegram bot | `api.telegram.org` | Bot token (in the data file). `/backup` uploads the data file (token removed) to your chat, only on request |
| Google Calendar | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` | Refresh token + task→event map in `hyperdo-calendar.json` (desktop) or `localStorage` / Preferences (web / Android) — never in backups |
| ICS / webcal feeds | The provider you pasted | Feed links (in the data file), a cache of upcoming events |
| Automatic updates (desktop, on by default) | `api.github.com`, `github.com` (GitHub Releases of this repository) | The downloaded installer in the system temp folder until it is installed |
| Sync — WebDAV | The WebDAV server you entered (your Nextcloud, NAS, Yandex Disk, Koofr…): `GET`/`PUT` of one JSON file holding your tasks, deletions, completion counters and focus log (no settings, no tokens) | Username/password + device id in `hyperdo-sync.json` (desktop), Preferences (Android) or `localStorage` (web) — never in backups |
| Sync — Folder (desktop) | Nothing; the app only writes `hyperdo-sync.json` into the folder you chose. Whatever mirrors that folder (OneDrive, Dropbox, Syncthing…) does its own networking | Device id in `hyperdo-sync.json` next to the data file |

Use Settings → Export JSON to back up. See [PRIVACY.md](PRIVACY.md) for the full policy.
