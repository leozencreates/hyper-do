# Hyper Do – Privacy Policy

_Last updated: 13 October 2026 (version 0.2.0)_

Hyper Do is a personal to-do application available as a desktop app (Windows/macOS), an Android app and a web app (PWA). This policy applies to all of them.

## What data Hyper Do handles

Hyper Do stores the tasks you create (titles, notes, tags, due dates, subtasks, reminder settings, estimates, energy levels, how often a reminder was ignored), your Hyper Focus log (when a work or break round started and ended and for which task), daily completion counters (for streaks and the heatmap) and your application settings (language, theme, reminder intervals, quiet hours, Pomodoro lengths, keyboard shortcut, optional Telegram bot token, optional Google OAuth client, calendar feed links, sync location).

If you connect a calendar, a local cache of the upcoming events is kept on the device as well. If you turn on sync, a random device identifier and (for WebDAV) the username and password you entered are kept on the device too.

## Where the data is stored

All data stays on your device:

| Version | Storage location |
|---|---|
| Desktop (Windows/macOS) | JSON files in the application data folder (`%APPDATA%\hyper-do` on Windows): `hyperdo-data.json` (tasks + settings), daily copies in `backups/`, `hyperdo-calendar.json` (Google refresh token + task→event map), `hyperdo-sync.json` (sync device id + WebDAV credentials), `hyperdo-state.json` (digest timestamps), `window-state.json` (mini window position) |
| Android | The app's private preferences storage (same documents under the keys `hyperdo-data`, `hyperdo-calendar`, `hyperdo-sync`) |
| Web / PWA | The browser's `localStorage` (same keys) |

The Telegram bot token is part of the data file and therefore of JSON exports and automatic backups; keep those files private. The Google refresh token and the WebDAV password are kept **outside** the data file and never enter a backup.

Hyper Do has no server, no account system and no analytics. We do not collect, transmit, sell or share any personal information. The developers have no access to your tasks.

## Network connections

Hyper Do connects to the internet only for features **you** switch on in Settings. With everything off, the app makes no network request at all.

| Feature (where) | Connects to | What is sent | What is stored locally |
|---|---|---|---|
| **Telegram bot** (desktop, off by default) | `api.telegram.org`, using the bot token you created with @BotFather | Your reminders, the lists and task cards you request, your commands and button taps; the `/backup` command sends a copy of your whole data file (bot token removed) to your own chat — the only time your complete data travels through Telegram's servers, and only when you ask for it | Bot token, bot username, pairing code and linked chat id in the data file |
| **Google Calendar** (desktop, web, Android; off until you connect) | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, with your own Google account and your own OAuth client | Reads your calendar events; if you enable *Send tasks to Google Calendar*, writes the title and due time of open tasks with a due date into a calendar named "Hyper Do". On Android the login opens in a browser tab (Custom Tab) and returns to the app through `com.hyperdo.app:/oauth2redirect` | Refresh token and task→event map in a separate file / key that is not included in backups; disconnecting revokes the token |
| **Calendar feeds (ICS / webcal)** (all platforms) | The address you pasted (Outlook.com, iCloud, Nextcloud, …) | A plain download of the feed; nothing is written | Feed links in the data file, a cache of upcoming events |
| **"Add to calendar" links** (all platforms) | Opened in your browser: Google, Outlook.com, Office 365 or Yahoo | The task title and time as URL parameters — only when you click the link; the `.ics` option creates a file locally instead | Nothing |
| **Automatic updates** (installed desktop app, on by default, Settings → About) | `api.github.com`, `github.com` (the GitHub Releases of this repository) | A request for the latest release metadata and, if newer, the installer download. No personal data beyond what any download carries (your IP address, the requested version) | The downloaded installer in the system temp folder until it is installed; turn the toggle off and nothing is contacted |
| **Sync between devices — WebDAV** (desktop, Android, web; off by default) | The WebDAV server you entered (your own Nextcloud, NAS, Yandex Disk, Koofr, …) | One JSON file with your tasks, deletions, daily completion counters and Hyper Focus log — never your settings, the Telegram token or calendar credentials | WebDAV username and password plus the device id, outside the data file and the backups. Nobody but you and your server provider can read the file; Hyper Do has no access to it |
| **Sync between devices — Folder** (desktop, off by default) | Nothing — the app only writes the same JSON file into a folder you picked | If another program mirrors that folder (OneDrive, Dropbox, Syncthing…), that program's privacy policy applies to the transfer | Device id in `hyperdo-sync.json` |

Notifications (desktop toasts, Android local notifications, browser notifications) are produced on the device and do not use a push service.

No request ever goes through a Hyper Do server, because there is none.

## Data deletion

Uninstalling the app removes its data (on Windows the data folder `%APPDATA%\hyper-do` is kept so a reinstall can pick up where you left off; delete it by hand for a full wipe). Disconnecting Google revokes the token and removes the mirrored "Hyper Do" calendar events; unlinking Telegram forgets the chat. A sync file on your WebDAV server or in your folder stays there until you delete it. You can also export or import your data as a JSON file from Settings at any time.

## Contact

Questions about this policy: open an issue at https://github.com/leozencreates/hyper-do/issues.
