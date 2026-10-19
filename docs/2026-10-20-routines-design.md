# Hyper Do — routines (design spec)

Feature after the "stuck?" batch, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. The general rules
at the top of the roadmap apply (i18n in EN/TR/RU, new `Task` fields get defaults in `newTask` / `normalizeTask`, pure
logic in `src/lib`). Verified with `npm run build && npm run build:web && npm test`; UI checks in
`docs/MANUAL-TEST-2026-10.md` (A17).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

Morning and evening routines are where ADHD days are won or lost. Brush teeth, meds, pack the bag: each step is
trivial, but the sequence falls apart the moment attention drifts. A checklist alone does not help much, because
the whole list is visible and the user jumps around or stalls. What helps is **one step at a time**, big, with a
visible clock for the current step and an obvious "next".

## Non-goals

A separate routine data type, per-step durations or alarms, per-step reminders, routine statistics beyond the normal
streak, and running two routines at once.

## Model: a routine is a task

- [x] New field `Task.routine: boolean` (default `false` in `newTask` / `normalizeTask`; old data loads with
  `false`). A routine is a normal, usually recurring task whose **subtasks are its steps**. Reminders, recurrence,
  sync, Telegram, calendar push, tombstones and the streak all keep working unchanged.
- [x] Completing the routine completes the task. The next recurring copy comes with every step unchecked
  (`completeTask` already resets subtasks).
- [x] Editor: a **Routine (run step by step)** toggle. Row: a **🔁** chip and a **▶ Run** button (only routines that
  have steps).

## Templates (`src/lib/routine.ts`, pure)

- [x] `ROUTINE_TEMPLATES`: `morning` (07:30: water, meds, wash, dress, breakfast, check today's plan, bag & keys) and
  `evening` (21:30: tidy 5 min, plan tomorrow, prepare clothes & bag, phone on charge, screens off). Step texts live in
  i18n, so a template is created in the current language.
- [x] `routineFromTemplate(kind, lang, now)` → task fields: title, `routine: true`, `recurrence: 'daily'`, steps, and a
  due date at the next occurrence of the template time.
- [x] Sidebar block **Routines**: open routines with ▶, and **+ Routine** offering Morning / Evening / Empty. Each
  opens the editor prefilled, so nothing is saved until the user presses Save.

## Runner (`RoutineRunner.tsx` on top of pure run state)

- [x] `RunState { taskId, current, startedAt, stepStartedAt, skipped[], history[] }` with pure `startRun`,
  `advance(task, state, 'done' | 'skip' | 'back', now) → { state, subtasks }`, `runProgress`, `runFinished`.
  It starts at the first unchecked step. `done` checks the step, `skip` leaves it unchecked and moves on, and `back`
  undoes the last action (a mis-tap). Steps already checked before the run are left alone.
- [x] The dialog shows the routine title, "Step k of n", a progress bar, the current step in large type and a stopwatch
  for the current step. Buttons: **✓ Done** (Enter), **⏭ Skip**, **↶ Back**. Closing keeps the checked steps.
- [x] When no unchecked, unskipped step is left: everything done → the task is completed through the normal path
  (celebration, `dailyDone`, recurrence). Skipped steps → a summary "N of M done" with **Finish anyway** (complete) or
  **Later** (close; the skipped steps stay open).
- [x] Every step change is a reaction (`nagCount: 0`) and bumps `updatedAt` through the normal update path.
