# Hyper Do — closing three known gaps (design spec)

Polish batch after 0.2.2, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. It closes three items
from that roadmap's **Known gaps** list: the Android digest, Android nag counting and the in-memory Telegram message
map. The general rules at the top of the roadmap apply (i18n in EN/TR/RU, pure logic in `src/lib`, no new `AppData`
fields, platform state outside backups). Verified with `npm run build && npm run build:web && npm test`; the device
checks are in `docs/MANUAL-TEST-2026-10.md` (B2 steps 9–10, C1 step 7, C6).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

All three gaps were felt in normal use, not edge cases. On Android the morning digest toggle was hidden although
`settings.digest` existed. The escalation ladder (#6), one of the main ADHD features, never moved on Android because
pre-scheduled notifications did not count. And after every desktop restart the Telegram bot forgot which message
belonged to which task, so finishing a task on the PC no longer struck through its reminder, and replies to older
reminders turned into new tasks.

## Non-goals

Full-screen (alarm-style) escalation on Android (level 2 got a high-importance channel instead, see 2b), quiet
hours / mute for digests (the desktop does not apply them either), extending the 48-hour Android planning horizon,
and syncing nag counts across devices (unchanged: `markNagged` never bumps `updatedAt`).

## 1. Android digest (#17)

- [x] `planDigestTimes(settings, fromMs, horizonMs)` in `src/lib/digest.ts` (pure): every morning (`digest.time`)
  and evening (`eveningTime`; Sunday → `weekly`) in `(from, from + horizon]`, oldest first. There is no grace window
  and no state file. The plan is rebuilt from `now` on every save / resume, so a time already passed is not planned again.
- [x] `platform.capacitor.ts › reschedule` appends one local notification per planned digest (ids from
  `DIGEST_ID_BASE = 3_000_000`, above every task block), rendered with `buildDigest(data, at, …)` as of its fire time,
  with `largeBody` for the expanded view and no action buttons. Its content is refreshed whenever the data changes.
- [x] Settings shows the two digest toggles on Android too (`platform.kind === 'capacitor'`); the `s_digest_d` text no
  longer says "desktop toast" in all three languages.

## 2. Android nag counting (#6)

- [x] `NagPlan = Record<taskId, number[]>`: the reminder times scheduled per task by the last replan, stored in
  Preferences under `hyperdo-nag-plan` (not in `AppData`, not in backups).
- [x] Every replan cancels what is still pending and plans anew from `now`. So the past entries of the previous plan
  are exactly the notifications that fired in between. `deliveredNags(plan, tasks, now)` counts them per open task,
  but only those after `task.updatedAt`. A reaction (done, snooze, edit, `resetNag`) bumps `updatedAt`, so
  reminders from before it never count against the fresh ladder. `markNaggedBy(tasks, counts)` adds the counts
  without bumping `updatedAt` (same sync rule as `markNagged`).
- [x] Order inside `reschedule`: count with the old plan → store an empty plan → schedule → store the new plan.
  A failed `schedule` therefore never turns cancelled notifications into phantom nags.
- [x] The i-th planned reminder of a task is built with `nagCount + i`: it only fires if the i before it were
  ignored, so the "👀 N times…" line appears on the phone from the right reminder on, even while the app is closed.
- Known limit: a renderer save inside the debounce window can still overwrite a just-counted increment (the same
  cross-window race the desktop has); the next replan does not recount it.

## 2b. Android escalation level 2 (added the same day)

- [x] The desktop answers level 2 (`popupAfter` ignored reminders) with a critical toast and the mini window. Android
  has no mini window, so its counterpart is a separate notification channel `hyperdo-urgent`: importance 5
  (heads-up), vibration, lights, public on the lock screen, default system sound. It is created in `registerActions`
  and renamed there when the language changes.
- [x] `plannedEscalation(task, i, settings)` (reminder.ts): the i-th planned reminder counts as `nagCount + i`
  ignored ones. From level 2 on, the planned notification goes to the urgent channel with a `🚨` title prefix.
- [x] Settings on Android describe the last step as "Urgent notification after N" (`s_esc_urgent_after`,
  `s_escalation_d_android`) rather than the mini window.
- The user keeps control: the channel's sound, importance and "pop on screen" can be changed or muted in the system
  notification settings, independently of normal reminders. Full-screen intents (alarm-style) are a non-goal: they
  need native code and a sensitive permission.

## 3. Telegram message map across restarts

- [x] `TelegramHost.loadMessages?() / saveMessages?(json)`; Electron stores the JSON in
  `userData/hyperdo-telegram.json` (not in backups). `serializeMessages` / `parseMessages` (exported from
  `electron/telegram.ts`, tolerant per entry, `byMessage` capped at 500).
- [x] Read once on the first `start()`; entries already in memory win. Every change to `live` / `byMessage` queues one
  save (microtask-coalesced: one reply or callback = one write).
- [x] `reconcile()` runs once after `getMe` / `setMyCommands` / menu button: restored live messages whose task was
  completed (→ `<s>title</s> ✓`) or deleted (→ buttons removed) while the app was closed are tidied like
  `onDataChanged` would have done. It never mutates the data.
- [x] Tests: `electron/telegram.test.ts › Message bookkeeping across restarts` (restore + reconcile, reply to an old
  reminder after a restart, tolerant parsing).
