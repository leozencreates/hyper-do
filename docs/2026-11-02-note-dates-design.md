# Note dates — design (2 Nov 2026)

Goal: show when a task's notes were **added**, **edited** and **removed**, next to the task's own dates
(created, last change, completed).

## Data

- [x] `Task.noteLog: NoteEvent[]` (`{ at, kind: 'added' | 'edited' | 'removed' }`), newest first, at most
  `NOTE_LOG_LIMIT` (50). Default `[]` in `newTask` / `normalizeTask` (`normalizeNoteLog` drops unreadable entries),
  so old files and backups keep loading.
- [x] Kind (`noteChangeKind`, trimmed text): empty → text = added, text → other text = edited, text → empty = removed.
- [x] Written in one place, `bumpChanged` (tasks.ts), which every mutation path already runs (store, Electron
  `commit`, web / Android `mutate`): a change is stamped with the task's new `updatedAt`. A task that appears
  without a log (fresh, recurring copy, duplicate, template, import of an old backup) and has notes gets
  `added` at its `createdAt`. Sync pulls (`bump: false`) never create events.
- [x] Sync: `preserveVersions` unions both copies' logs (`mergeNoteLog`, dedupe by time + kind), so an edit on
  the phone and one on the PC both stay visible.
- [x] Recurring copies, duplicates and templates start with an empty log.

## UI

- [x] Task editor → **🕓 Dates** (collapsed, existing tasks only): Created / Last change / Completed, then the note
  log (＋ added, ✎ edited, − removed) with locale-formatted date + time. Strings in EN/TR/RU.

## Not covered

- Deleted tasks: their notes vanish with them (the tombstone only keeps id + time).
- Edits made before this version have no events (the "Previous versions" list still shows their snapshots).
