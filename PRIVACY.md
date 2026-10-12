# Hyper Do – Privacy Policy

_Last updated: 12 October 2026_

Hyper Do is a personal to-do application available as a desktop app, an Android app and a web app. This policy applies to all of them.

## What data Hyper Do handles

Hyper Do stores the tasks you create (titles, notes, tags, due dates, subtasks, reminder settings) and your application settings (language, theme, reminder intervals, Pomodoro lengths, optional Telegram bot token, optional Google OAuth client and calendar feed links). If you connect a calendar, a local cache of the upcoming events is kept on the device as well.

## Where the data is stored

All data stays on your device:

| Version | Storage location |
|---|---|
| Desktop (Windows/macOS) | A JSON file in the application data folder |
| Android | The app's private preferences storage |
| Web / PWA | The browser's `localStorage` |

Hyper Do has no server, no account system and no analytics. We do not collect, transmit, sell or share any personal information. The developers have no access to your tasks.

## Network connections

Hyper Do connects to the internet only for features **you** switch on in Settings:

- **Telegram bot** (desktop): the app talks directly to the Telegram Bot API (`api.telegram.org`) using the bot token you provided, in order to send your reminders to your own Telegram chat and receive your commands. The token is stored only on your device.
- **Google Calendar**: after you sign in with your own Google account and your own OAuth client, the app talks directly to Google (`accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`) to read your calendar events and, if you enable it, to write your tasks with a due date into a calendar named "Hyper Do". The OAuth refresh token is stored only on your device, in a separate file that is not included in backups. Disconnecting revokes the token.
- **Calendar feeds (ICS / webcal)**: the app downloads the calendar links you add, directly from the provider you chose.

No request ever goes through a Hyper Do server, because there is none.

## Data deletion

Uninstalling the app removes its data. You can also export or import your data as a JSON file from Settings at any time.

## Contact

Questions about this policy: open an issue at https://github.com/leozencreates/hyper-do/issues.
