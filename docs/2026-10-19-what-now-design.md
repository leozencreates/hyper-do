# Hyper Do — "What now?" (design spec)

Feature after 0.2.2, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. The general rules at the top
of the roadmap apply (i18n in EN/TR/RU, pure logic in `src/lib`, no new `Task` / `Settings` fields). Verified with
`npm run build && npm run build:web && npm test`; UI checks in `docs/MANUAL-TEST-2026-10.md` (A14, B3).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

Choice paralysis is the most common ADHD blocker: a list of twelve open tasks reads as "everything at once", and the
user picks none. **🎲 Easy one** (#10) answers a different question ("what is low effort?") and draws at random. "What
now?" gives one deterministic answer to "what should I do *right now*?". It weighs urgency (overdue, due today), weight
(priority), momentum (in progress, subtasks started, already focused) and the ignored-reminder count. It can also be
narrowed in one click by the energy the user has and the time available. The reasons are shown, so the user
trusts the pick rather than second-guessing it, and "Another" walks down the same ranking instead of rolling dice.

## Non-goals

Learning from past choices, AI ranking, a persistent "my energy today" setting (the energy / time chips are session
state; they reset with the dialog), auto-starting a timer, and the Android notification (the dialog works in the
Android app like everywhere else).

## Scoring (`src/lib/whatnow.ts`, pure)

- [x] Candidates: open tasks that are not snoozed into the future and not `status: 'waiting'` (blocked on someone).
- [x] Points: focused +30 · overdue +40 (+1 per overdue hour, max +20) · due later today +25 · due within 3 days +10 ·
  priority high +15 / medium +5 · board status `doing` +12 · some but not all subtasks done +6 · `nagCount` +2 each
  (max +10).
- [x] Energy chip (`low < medium < high`): a task whose energy ≤ the chosen one +10; above it −40; unknown energy 0.
- [x] Time chip (15 / 30 / 60 min): estimate ≤ chosen time +10; above it −40; no estimate with 15 min −5.
  Without a time chip, an estimate ≤ 15 min is a "quick win" +3.
- [x] (20 Oct 2026) Start time reached (`startBy(task).late`, see `docs/2026-10-20-stuck-and-start-by-design.md`) +20,
  reason `startby {min}`.
- [x] Ties: earlier due date first (no date last), then list order (`order`).
- [x] `rankNext(tasks, ctx, now)` → `NextPick[] { task, score, reasons }` best first; `suggestNext(…, index)` picks the
  index-th, wrapping around. Reasons are typed (`overdue {min}`, `today`, `soon`, `focused`, `priority`, `doing`,
  `started {done,total}`, `nagged {n}`, `energy`, `fits {min}`, `quick`), most important first; `reasonText(reason, lang)`
  renders them.

## UI

- [x] Header button **🧭 What now?** (all platforms incl. the Mini App) and keyboard shortcut **W**.
- [x] Dialog (`src/components/WhatNow.tsx`): energy chips (Any / 🪫 / 🔋 / ⚡) and time chips (Any / 15 / 30 / 60 min)
  that re-rank live. It shows one card: the title, up to three reason chips and the due date. Buttons: **🎯 Focus it**,
  **⏱ Hyper Focus** (not in the Mini App, not while a session runs), **✏ Open**, **↻ Another**. "Nothing to pick"
  state when no candidate is left.
- [x] Shortcut list in Settings (`s_shortcuts_d`) mentions W.

## Telegram

- [x] `/next` (group *Views*): the top pick with its reasons and the usual task buttons plus **↻ Another**
  (`next:<shownId>:<k>` callback → a new message with the k-th pick; the old message keeps its buttons).
