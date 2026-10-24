# Hyper Do — photo and video attachments on notes (design spec)

Listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. The general rules at the top of the roadmap apply
(i18n in EN/TR/RU, new `Task` fields get defaults in `newTask` / `normalizeTask`, pure logic in `src/lib`). Verified with
`npm test`; UI and device checks in `docs/MANUAL-TEST-2026-10.md` (A18).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

A note often is a picture: the whiteboard after a meeting, the shelf to buy for, a screenshot of the error, a short
video of the leaking tap for the plumber. Typing it out is the step an ADHD brain skips; snapping it is not.

## Non-goals

Syncing the files themselves (WebDAV / folder sync carry only the metadata), putting them into JSON backups,
showing them in the Telegram Mini App or sending them through the bot, other file types (PDF, audio), editing or
compressing images.

## Storage

- [x] `Task.attachments: Attachment[]` (`types.ts`) — metadata only: `{ id, kind: 'image' | 'video', name, mime,
  size, addedAt }`. Default `[]` in `newTask` / `normalizeTask` (`normalizeAttachments` in `src/lib/attachments.ts`
  drops malformed entries and duplicate ids), so old files and backups keep loading.
- [x] Bytes in IndexedDB (`src/lib/platform.media.ts`, database `hyperdo-media`, store `files`, key = attachment id),
  exposed as the optional `HyperDoApi.media` (`put` / `get` / `gc`). One implementation for the Electron renderer,
  the browser / PWA and the Android WebView; `platform.ts` adds it to every adapter except the Mini App (no
  `media` → the editor hides attachments; the metadata is kept untouched by its saves).
- [x] Why not AppData: a single phone video is larger than years of tasks; the JSON file, daily backups, WebDAV
  uploads and the Mini App `PUT` would all grow with it.
- [x] Limits (`attachments.ts`): images and videos only, 200 MB per file, 20 per task.

## Lifecycle

- [x] Adding writes the file to the store immediately; the editor only gets the metadata. Removing (×) drops the
  metadata only.
- [x] Garbage collection: once per start of the main window (`App.tsx`), `media.gc(referencedMediaIds(tasks))`
  deletes files no task points at (removed in the editor, editor cancelled after adding, task deleted). Done tasks
  count as references, so reopening / undo keep their files. Duplicated tasks and recurring copies share the ids.
- [x] Other devices: synced metadata shows a "Not on this device" tile.

## UI

- [x] Editor, under the notes: thumbnail strip (photo, or video still with ▶), × to remove, **📎 Photo / video**
  (file picker, `accept="image/*,video/*"`; on Android the system chooser also offers the camera), drag & drop onto
  the strip, paste an image into the notes field (screenshots). Errors per file (type / size / count / storage full).
  Hint: files stay on this device.
- [x] Tap a thumbnail → full-screen viewer (photo, or video with controls); Escape / tapping outside closes only the
  viewer.
- [x] Task row: `📎 N` chip.
- [x] CSP (`index.html`): `img-src … blob:` and `media-src 'self' blob:` for the object URLs.
