# Hyper Do

> An ADHD-friendly personal to-do app that keeps nagging you **until you actually mark the task done**.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android%20%7C%20PWA-ff8a3d)
![Stack](https://img.shields.io/badge/stack-React%2019%20%C2%B7%20TypeScript%20%C2%B7%20Vite%20%C2%B7%20Electron%20%C2%B7%20Capacitor-a78bfa)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20TR%20%7C%20RU-38bdf8)
![Privacy](https://img.shields.io/badge/data-only%20on%20your%20device-4fd18b)

No account, no cloud, no subscription. Your data never leaves your device — unless **you** connect Telegram or a calendar, and even then it goes straight from your device to that service.

---

## Contents

- [Why Hyper Do?](#why-hyper-do)
- [Features](#features)
- [Platforms](#platforms)
- [Quick start](#quick-start)
- [Natural-language quick add](#natural-language-quick-add)
- [Telegram bot](#telegram-bot-windowsmacos)
- [Calendar connections](#calendar-connections)
- [Windows installer and uninstall](#windows-installer-and-uninstall)
- [Building for Android](#building-for-android)
- [Development](#development)
- [Project structure](#project-structure)
- [Data and privacy](#data-and-privacy)

---

## Why Hyper Do?

Most to-do apps notify you once and go quiet. Hyper Do doesn't. Until you complete a task and check it off, it keeps reminding you at the interval you chose. If the due date has passed, the interval is halved. It reaches you from the system tray when the window is closed, as a local notification when your phone is locked, and through Telegram if you want it to.

## Features

- 🔔 **Reminds until done** — a separate interval per task (5 min … 2 h). Overdue tasks get reminded twice as often.
- 😏 **Playful titles** — random notification titles like "Forgot again, didn't you?" or "Tick tock…" (can be turned off in settings).
- 🎯 **Focus mode** — pin a single task to the top and see its next sub-step.
- ⚡ **Hyper Focus (Pomodoro)** — one click starts a 40-minute deep-work round followed by a 5-minute break, repeating until you stop. Progress ring, countdown in the window title, chime and notification on every phase change. Lengths are adjustable in Settings.
- 📋 **Task details** — priority (high / medium / low), tags, due date, subtasks, recurring tasks (daily, weekdays, weekly, monthly).
- 🗂️ **Board (Kanban)** — To do / Doing / Waiting / Done columns. Drag cards between columns and reorder them; dropping onto "Done" completes the task. Quick add at the bottom of every column.
- ⚡ **Natural-language quick add** — `tomorrow 18:00 pay the bill #home !1 @30m` → date, time, tag, priority and reminder interval are parsed automatically with a live preview.
- 🔍 **Search and sort** — search (`/`), sort (smart, due date, priority, newest, A→Z, manual), drag to reorder manually.
- ↶ **No regrets** — undo delete, duplicate a task, push to tomorrow, clear all completed tasks, "N done today" counter.
- ⌨️ **Shortcuts** — `N` new task, `/` search, `1-5` switch views, `Esc` close.
- 🔕 **Snooze** — 15 min / 30 min / 1 h / 3 h, plus quiet hours.
- 📲 **Telegram bot** — reminders also arrive on your phone via Telegram. Use the inline buttons ("Done / Snooze 30 min / Focus") or just type to the bot to add tasks.
- 📅 **Calendar connections** — connect Google Calendar or any ICS/webcal link (Outlook, iCloud, Nextcloud…) and upcoming events turn into tasks automatically, so meetings get nagged like everything else. Google is two-way: due tasks can be mirrored into a "Hyper Do" calendar. Plus one-click "Add to calendar" per task (Google, Outlook.com, Office 365, Yahoo, .ics) and a full .ics export.
- 🌐 **Language switcher** — English, Türkçe, Русский. English is the default; switch from the sidebar or Settings.
- 🌗 **Theme** — dark / light / system, with a colourful gradient-based look.
- 💾 **Backup** — JSON export and import.

## Platforms

| Platform | How | Reminder behaviour | Calendars |
|---|---|---|---|
| Windows (Electron) | `npm run dist` → run `Hyper-Do-Setup-x.y.z.exe`; desktop and Start menu shortcuts are created automatically | Reminds from the tray even when the window is closed, flashes the taskbar entry | Google (two-way, syncs in the background) + ICS feeds + Telegram |
| macOS (Electron) | `npm run dist:mac` (must run on a Mac) | Stays in the Dock, notifies when the window is closed | Google (two-way) + ICS feeds + Telegram |
| Android (Capacitor) | `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` | Notifies even when the app is closed: reminders are scheduled 48 h ahead as local notifications and extended on every launch | ICS feeds only (Google sign-in is blocked in WebViews) |
| Web / iPhone / iPad (PWA) | `npm run dev:web` or publish the `dist-web` folder | Notifies only while the tab or the home-screen app is **open** | Google (two-way) + ICS feeds (some providers block CORS) |

"Add to calendar" links and `.ics` export work everywhere.

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
tomorrow 18:00 pay the bill #home !1 @30m
```

| Token | Meaning |
|---|---|
| `today`, `tomorrow`, `friday`, `15.10` | Due date (weekday names and `dd.mm` are supported) |
| `18:00` | Time |
| `#home` | Tag (several allowed) |
| `!1` / `!2` / `!3` | Priority: high / medium / low |
| `@30m`, `@2h` | Reminder interval |

Keywords work in English, Turkish and Russian. Parsed parts show up in the preview as you type.

## Telegram bot (Windows/macOS)

1. In Telegram, send `/newbot` to **@BotFather**, give it a name and copy the token it returns.
2. In Hyper Do open Settings → enable **Telegram bot** and paste the token.
3. Open your bot in Telegram and send `/start`. The link is established automatically. The first chat that sends `/start` becomes the owner; others are ignored.
4. While the app (or its tray icon) is running, reminders arrive both as desktop notifications and as Telegram messages.

| Command | What it does |
|---|---|
| `/list` | List open tasks |
| `/done N` | Complete task number N |
| `/snooze N [min]` | Snooze task N (default duration from settings) |
| `/focus N` | Put task N in focus |
| `/add text` | Add a task (plain text works too, quick-add syntax applies) |
| `/help` | Help |

The token is stored only in the local data file; it is never sent anywhere except to the Telegram Bot API.

## Calendar connections

Settings → **📅 Calendars**. Everything runs on your device; there is no Hyper Do server in between.

### Google Calendar (two-way)

Like the Telegram bot, Hyper Do uses *your own* Google OAuth client, so nobody else can see your calendar.

1. Open [console.cloud.google.com](https://console.cloud.google.com) → create a project → **APIs & Services → Library** → enable **Google Calendar API**.
2. **APIs & Services → OAuth consent screen** → External → add yourself as a test user (or publish the app so the login does not expire every 7 days).
3. **Credentials → Create credentials → OAuth client ID**
   - Desktop app (Windows/macOS): application type **Desktop app**.
   - Web / PWA: application type **Web application**, and add the app URL shown in Settings (e.g. `http://localhost:5180/`) as an *authorized redirect URI*.
4. Paste the **Client ID** and **Client secret** into Hyper Do and click **Connect Google account**. The desktop app opens your browser and finishes the login on `127.0.0.1`; the web app redirects back to itself.

What you get:

| Direction | Behaviour |
|---|---|
| Google → Hyper Do | **Events become tasks automatically**: every event of the next 7 days is added to the task list with the `#calendar` tag and nagged like any other task (toggle *Turn events into tasks automatically*). If an event moves, its task follows; a task you delete is not re-added. Events of the next 2 weeks are also shown above the list in **Today** and **This week** (collapsible). Pick which calendars to show. Refreshes every 10 minutes or on **Sync now**. |
| Hyper Do → Google | Optional toggle **Send tasks to Google Calendar**: every open task with a due date appears in a calendar named **Hyper Do** (30-minute block at the due time; tasks due at 23:59 become all-day). Edits are patched, done/deleted tasks are removed. Turning the toggle off removes them all. |

The refresh token and the task→event map are stored in a separate local file (`hyperdo-calendar.json` next to the data file, or `localStorage` on the web). They are **not** part of JSON backups. **Disconnect** deletes the mirrored events and revokes the token.

Android: Google blocks OAuth inside app WebViews, so the Android build offers ICS feeds only for now.

### Other calendars (ICS / webcal, read-only)

Paste the private iCal address of any calendar: Outlook.com (*Settings → Calendar → Shared calendars → Publish → ICS*), iCloud (*Share → Public calendar*), Nextcloud, Fastmail, Proton, a Google "secret address in iCal format"… Their upcoming events become tasks automatically too. Recurring events (`RRULE` daily/weekly/monthly/yearly, `EXDATE`, overrides) and `TZID` time zones are handled. The web version may be blocked by some providers (CORS); the desktop and Android apps are not.

### Add to calendar / export

- Expand a task with a due date → **📆 Add to calendar** → Google Calendar, Outlook.com, Office 365, Yahoo or a downloadable `.ics` (Apple Calendar, Thunderbird…). No account connection needed.
- Settings → **Export tasks (.ics)** writes all open tasks with a due date into one `.ics` file.

Optional for distributors: a `.env` with `VITE_GOOGLE_CLIENT_ID` / `VITE_GOOGLE_CLIENT_SECRET` pre-fills the OAuth client in the build.

## Windows installer and uninstall

```bash
npm run dist     # → %LOCALAPPDATA%\hyperdo-release\Hyper-Do-Setup-0.1.0.exe
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

## Development

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run dev:web      # Browser only, http://localhost:5180
npm run build        # Build for Electron (dist/ + dist-electron/)
npm run build:web    # Build the PWA (dist-web/)
npm run preview:web  # Preview dist-web locally
npm run dist         # Windows installer → %LOCALAPPDATA%\hyperdo-release\
npm run dist:mac     # macOS DMG (on a Mac)
npm run android:apk  # Android debug APK
```

> `npm run dist` writes its output to `%LOCALAPPDATA%\hyperdo-release\` instead of the project folder because of a folder-naming restriction under Desktop.

Tech stack: React 19, TypeScript, Vite, Electron, electron-builder, Capacitor (Android), Web Notifications + Service Worker (PWA).

## Project structure

```
electron/main.ts               Main process: window, tray, notifications, reminder scheduler, JSON storage
electron/telegram.ts           Telegram bot: long-polling commands, reminders with inline buttons
electron/calendar.ts           Google login for the desktop app (PKCE + loopback redirect)
src/lib/calsync.ts             Calendar sync engine: Google pull/push + ICS feeds (shared by Electron and browser)
src/lib/gcal.ts                Google OAuth (PKCE) + Calendar v3 client
src/lib/ics.ts                 iCalendar parser (RRULE, EXDATE, TZID) and writer
src/lib/calendar-links.ts      "Add to calendar" deep links, task → event mapping, .ics export
src/lib/platform.calendar.ts   Browser calendar bridge (localStorage state, redirect login)
src/components/CalendarStrip.tsx     Events above Today / This week
src/components/CalendarSettings.tsx  Settings → Calendars
src/components/AddToCalendar.tsx     Per-task "Add to calendar" menu
electron/preload.ts            Secure IPC bridge (window.tidi)
src/lib/reminder.ts            Platform-independent reminder engine (shared by Electron and web)
src/lib/tasks.ts               Pure task helpers (add, complete, sort, drag-and-drop, duplicate, normalize)
src/lib/parse.ts               Natural-language quick-add parser
src/lib/dates.ts               Date helpers (today, this week, overdue)
src/lib/store.ts               App state and persistence
src/lib/types.ts               Task / settings types and defaults
src/lib/platform.ts            Picks the Electron / Capacitor / web adapter
src/lib/platform.capacitor.ts  Android: schedules local notifications 48 h ahead
src/lib/platform.web.ts        Browser: localStorage + Web Notification
src/lib/i18n.ts                EN / TR / RU strings and the playful title pool
src/components/Board.tsx       Kanban board (drag-and-drop)
src/components/QuickAdd.tsx    Quick-add box with live preview
src/components/TaskItem.tsx    List row
src/components/TaskEditor.tsx  Task editor panel
src/components/FocusBanner.tsx Focus-mode banner
src/components/HyperFocus.tsx  Hyper Focus (Pomodoro) timer hook and bar
src/components/SettingsPanel.tsx  Settings
src/App.tsx                    UI shell
public/sw.js                   PWA service worker (offline + notification click)
android/                       Capacitor Android project
```

## Data and privacy

| Environment | Storage |
|---|---|
| Electron (Windows/macOS) | `%APPDATA%/hyper-do/hyperdo-data.json` |
| Android | Capacitor Preferences (app sandbox) |
| Web / PWA | Browser `localStorage` |

There is no account, no telemetry and no remote server. Outbound connections exist only for features **you enable** in Settings:

| Feature | Talks to | Stored locally |
|---|---|---|
| Telegram bot | `api.telegram.org` | Bot token (in the data file) |
| Google Calendar | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` | Refresh token + task→event map in `hyperdo-calendar.json` (desktop) or `localStorage` (web) — never in backups |
| ICS / webcal feeds | The provider you pasted | Feed links (in the data file), a cache of upcoming events |

Use Settings → Export JSON to back up. See [PRIVACY.md](PRIVACY.md) for the full policy.
