# Print / PDF of all tasks, ▲▼ ordering, "All" first — design (1 Nov 2026)

Status: [x] implemented (1 Nov 2026)

## Goal

- [x] One click downloads every task as a tidy PDF; one click prints every task.
- [x] Each list row has ▲ / ▼ to move a task one place up / down (rank by importance without drag and drop).
- [x] The sidebar reads **All · This week · Today · …** and the app always opens on **All**.

## Print document (`src/lib/printout.ts`, pure)

- `buildPrintHtml(tasks, lang, now)` → one self-contained HTML document (inline CSS, no script, no external
  asset, A4 via `@page`). Header: "Hyper Do", title, creation stamp, open / overdue / done counts.
- `printSections(tasks, now)`: archived tasks are left out; open tasks grouped Overdue → Today → next 7 days →
  Later (by due, then priority) → No date (by priority, then manual order) → Done (newest first). Empty
  sections are dropped.
- Each task: checkbox, title, priority pill + coloured left border, due (absolute + relative), recurrence,
  estimate, subtask progress, tags, notes (pre-wrap), subtasks. Every user string goes through `escapeHtml`.
- `printFileName(now)` → `hyperdo-tasks-YYYY-MM-DD.pdf` (local date).

## Platforms

- Electron (`DesktopApi.exportPdf` / `printHtml`, IPC `tidi:export-pdf` / `tidi:print-html`): the HTML is
  written to a temp file and loaded in a hidden window with JavaScript off. PDF = save dialog (Downloads,
  default name above) → `printToPDF({ printBackground, preferCSSPageSize })` → file opened with the default
  viewer. Print = `webContents.print` (system dialog).
- Web / PWA: both buttons print from a hidden `srcdoc` iframe (`printHtmlDocument`, download.ts); the PDF
  button shows the hint to pick "Save as PDF".
- Android and the Telegram Mini App: buttons hidden (WebViews cannot print).

## ▲ / ▼ (`moveInList`, tasks.ts)

- Moves the task one place within the list as displayed (any sort mode). The shown tasks keep the `order`
  slots they already occupy, re-dealt in the new display order, so switching to manual sort (as drag and drop
  already does) shows the same list; tasks outside the list never move. Changed tasks are `touchTask`ed (sync).
- Hidden in the Done view and in the Mini App; ▲ disabled on the first row, ▼ on the last.

## Views

- `VIEW_KEYS` = all, week, today, board, done, inbox, archive (keys 1-7 follow). Default view `all`
  (`?view=` still wins; the Mini App keeps `today`, it has no All tab).
