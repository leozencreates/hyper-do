# Google Calendar: automatic push + reminders (1 Nov 2026)

Request: every task that gets a date should land in Google Calendar on its own, and Google should notify 1 hour,
1 day and 3 days before.

## Behaviour

- [x] `settings.calendar.google.pushTasks` defaults to **on** (`DEFAULT_SETTINGS`). The push itself is unchanged
  (`CalendarSync.pushTasks`: open tasks with a due date → the "Hyper Do" calendar, finished / deleted ones removed);
  it only runs while a Google account is connected.
- [x] One-off migration (`normalizeCalendarSettings`, data.ts): stored settings without `eventReminders` are from
  before this change, so `pushTasks` is switched on once and the default offsets are filled in. Once
  `eventReminders` is stored, the user's `pushTasks` choice is respected (turning it off sticks).
- [x] New `settings.calendar.google.eventReminders: number[]` (minutes before the start, default `[60, 1440, 4320]`,
  `normalizeEventReminders`: unique, sorted, 0…40320, max 5 = Google's limit). `[]` = the calendar's own defaults
  (`reminders: { useDefault: true }`, the previous behaviour).
- [x] `googleEventBody(task, tz, reminderMinutes?)` sends `reminders: { useDefault: false, overrides: [{ method:
  'popup', minutes }] }` via `eventReminders(minutes, allDay)`:
  - timed tasks: the offsets as they are (18:00 task → 17:00, the day before 18:00, three days before 18:00);
  - all-day tasks (due 23:59): Google counts from midnight, so whole-day offsets ring at **09:00** that many days
    before (`d·1440 − 540`), shorter offsets at **20:00 the evening before** (240 min), duplicates merged.
- [x] The offsets are part of the push fingerprint (`fp|r60,1440,4320`) and of `settingsFp`, so changing them in
  Settings re-patches every pushed event; existing events pick up the reminders on the first sync after the update.

## UI

- [x] Settings → Calendars → Google, under "Send tasks to Google Calendar": "Google Calendar notifications" with
  toggle chips 10 min · 30 min · 1 h · 2 h · 1 day · 2 days · 3 days · 1 week (max 5; further chips disabled),
  hint explaining the all-day times. TR/EN/RU keys `cal_rem_*`.

## Not covered

- Tasks imported from a calendar (`calendarEventId`) are still not pushed back.
- Android/web: the push runs wherever `CalendarSync` runs (Electron main, browser/Android page); nothing
  platform-specific was added.
