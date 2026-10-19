# Hyper Do — "stuck?" nudge, start-by time, Android keep-alive (design spec)

Polish batch after the What-now release, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. The
general rules at the top of the roadmap apply (i18n in EN/TR/RU, new `Task` fields get defaults in `newTask` /
`normalizeTask`, pure logic in `src/lib`). Verified with `npm run build && npm run build:web && npm test`; UI and
device checks in `docs/MANUAL-TEST-2026-10.md` (A15, A16, C7).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

Two ADHD patterns the app did not see yet:

- **Endless snoozing.** A task snoozed or pushed to tomorrow again and again is rarely forgotten. It is usually too
  big, unclear or unwanted. Another reminder does not help. A question does: split it, give it a real date, drop it,
  or do it now.
- **Time blindness.** "Due 17:00" with a 45-minute estimate really means "start by 16:15". People with ADHD
  routinely notice the deadline at 16:55. The estimate already exists (#10), so the app can show the start time.

Plus a known Android gap: reminders are planned 48 hours ahead, so if the app is not opened for two days they stop
silently.

## Non-goals

Automatic splitting (AI or templates), a separate "start-by" reminder notification (the chip and What-now carry it;
reminders keep their own interval), counting snoozes per device (the counter syncs like any task field) and a
background job on Android (the keep-alive notification asks the user to open the app instead).

## 1. Snooze counter and "stuck?" nudge

- [x] New field `Task.snoozeCount: number` (default 0 in `newTask` / `normalizeTask`; old data loads with 0). It
  counts snoozes **and** postpones (due date pushed by a day) since the last fresh start.
- [x] One helper `snoozeTask(task, patch, now)` (tasks.ts) applies `snoozedUntil` and/or `dueAt`. It resets the nag
  ladder (`nagCount: 0`), adds one to `snoozeCount` and bumps `updatedAt`. Every snooze path goes through it:
  renderer snooze / postpone (`useTaskActions`), the Windows toast deep link (`main.ts`), the Android notification
  button (`applyNotificationAction`), Telegram buttons and `/snooze` (`snoozeIn`).
- [x] `snoozeCount` starts over (0) on completion (the next recurring copy starts at 0), on duplicate, and on any
  choice in the "stuck?" dialog.
- [x] From `SNOOZE_NUDGE = 3` on:
  - the task row shows a **😴 ×N** chip; clicking it opens the **"Stuck on this?"** dialog
    (`src/components/Stuck.tsx`). The choices are ✂ **Split it** (opens the editor), 📅 **New date** (tomorrow 09:00
    / next Monday 09:00, the time of day kept for timed tasks), ▶ **Do it now** (focus, plus a Hyper Focus round
    where available), 🗑 **Let it go** (delete, with the usual undo), and **Keep going** (just reset the counter);
  - every reminder (desktop toast, Android, web, Telegram) gets the line "😴 Snoozed N× — split it or give it a real
    date?" (`buildNotification`).

## 2. Start-by time

- [x] `startBy(task, now)` (tasks.ts, pure) applies to open tasks with a timed (not all-day) due date in the future
  and an estimate. It returns `{ at: dueAt − estimate, late: now ≥ at }`, and null when the start lies more than 12 h
  ahead (no noise for next week).
- [x] Task row chip: **▶ start 16:15** (formatDue), or **▶ start now · 45 min** in the accent colour once `late`.
- [x] What-now: a task whose start time has come gets +20 and the reason **▶ Time to start (takes 45 min)**. It
  ranks above "due today" (+25 + 20) and stays below overdue.

## 3. Android keep-alive

- [x] Each replan adds one notification at `now + 47 h`: "Open Hyper Do once so the reminders keep coming". It only
  fires if the app was not opened (no replan) for 47 hours. It is only added when at least one task reminder or
  digest is planned. Its id is `KEEPALIVE_ID = 3_100_000`, and tapping it opens the app, which replans.
