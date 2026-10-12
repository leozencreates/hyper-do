# Hyper Do

> An ADHD-friendly personal to-do app that keeps nagging you **until you actually mark the task done**.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Android%20%7C%20PWA-ff8a3d)
![Stack](https://img.shields.io/badge/stack-React%2019%20%C2%B7%20TypeScript%20%C2%B7%20Vite%20%C2%B7%20Electron%20%C2%B7%20Capacitor-a78bfa)
![Languages](https://img.shields.io/badge/i18n-EN%20%7C%20TR%20%7C%20RU-38bdf8)
![Privacy](https://img.shields.io/badge/data-only%20on%20your%20device-4fd18b)

No account, no cloud, no subscription. Your data never leaves your device.

---

## Contents

- [Why Hyper Do?](#why-hyper-do)
- [Features](#features)
- [Platforms](#platforms)
- [Quick start](#quick-start)
- [Natural-language quick add](#natural-language-quick-add)
- [Telegram bot](#telegram-bot-windowsmacos)
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
- 🌐 **Language switcher** — English, Türkçe, Русский. English is the default; switch from the sidebar or Settings.
- 🌗 **Theme** — dark / light / system, with a colourful gradient-based look.
- 💾 **Backup** — JSON export and import.

## Platforms

| Platform | How | Reminder behaviour |
|---|---|---|
| Windows (Electron) | `npm run dist` → run `Hyper-Do-Setup-x.y.z.exe`; desktop and Start menu shortcuts are created automatically | Reminds from the tray even when the window is closed, flashes the taskbar entry |
| macOS (Electron) | `npm run dist:mac` (must run on a Mac) | Stays in the Dock, notifies when the window is closed |
| Android (Capacitor) | `npm run android:apk` → `android/app/build/outputs/apk/debug/app-debug.apk` | Notifies even when the app is closed: reminders are scheduled 48 h ahead as local notifications and extended on every launch |
| Web / iPhone / iPad (PWA) | `npm run dev:web` or publish the `dist-web` folder | Notifies only while the tab or the home-screen app is **open** |

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

There is no account, no telemetry and no remote server. The only outbound connection is the Telegram Bot API, and only **if you enable it**. Use Settings → Export JSON to back up.
