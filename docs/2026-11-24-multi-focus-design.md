# Up to three tasks in focus — design (24 Nov 2026)

## Goal

Until now exactly one task could be in focus (🎯); focusing another one silently took the flag away. The user wants
up to **three** tasks in focus, all visible on top of the list.

## Behaviour

- [x] `MAX_FOCUS = 3` (tasks.ts). `setFocused(tasks, id, on, now)` is the only focus path (UI, Android notification
      button, Telegram `/focus` + `focus:` callback). Focusing resets the nag ladder and bumps `updatedAt`.
- [x] Focusing a fourth task pushes the **least recently updated** focused task out (no new field; `Task.focused`
      stays a boolean, old data and backups load unchanged).
- [x] Sync merge (`mergeData`): at most `MAX_FOCUS` focused tasks, the most recently updated ones keep the flag; a
      demoted task gets `updatedAt = newest + 1` so the demotion wins on both sides (as before with one).
- [x] UI: one focused task → the big banner as before ("One thing right now"). Two or three → compact cards side by
      side (`.focus-stack`, wraps on narrow screens) labelled "In focus · n/count", each with Done / Hyper Focus /
      Unfocus and its next step. Order = list order (`focusedTasks`).
- [x] i18n key `focus_label_many` (TR / EN / RU).

## Unchanged on purpose

- Mini window and the Pomodoro button in the header use the first focused task.
- Hyper Focus suppression (`activeFocusTaskId`) follows the Hyper Focus session, not the 🎯 flag.
- A device still running an older version keeps one focused task after its own merges; the newer device accepts that.

## Tests

`tasks.test.ts` (setFocused / focusedTasks), `sync.test.ts` (three survive, the fourth is demoted), `stats.test.ts`,
`telegram-commands.test.ts` (focus joins instead of replacing).

## Manual check

Focus three tasks → three cards on top (All / Today / Week; not on Board). Focus a fourth → the one touched longest
ago leaves. Narrow the window / open the Mini App → cards stack vertically.
