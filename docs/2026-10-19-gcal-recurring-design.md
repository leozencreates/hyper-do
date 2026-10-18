# Hyper Do — recurring tasks on Google Calendar (design spec)

Polish item after 0.2.2, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. It closes the known gap
"Google push of recurring tasks". The general rules at the top of the roadmap apply. Verified with
`npm run build && npm run build:web && npm test`; the real Google API checks are in `docs/MANUAL-TEST-2026-10.md`
(D3 steps 3–6, which also apply to the desktop app).

Status legend: `[ ]` planned · `[x]` shipped.

## Why

The push to the "Hyper Do" calendar sent every open task as a single 30-minute event, so a weekly task showed only
its current occurrence: the calendar could not be used to see next week's routine. The `.ics` export and the "add to
calendar" links already carried an RRULE; the push now does the same.

## Non-goals

Per-instance exceptions (EXDATE when one occurrence is snoozed or moved), pulling recurring events back from the
"Hyper Do" calendar (it is excluded from the pull, and our own events are recognised by `hyperdoId`), and "repeat after
completion" rules. Those stay single events, because no calendar can express "N days after it was finished".

## Design

- [x] `googleEventBody(task, timeZone)` (pure, `calendar-links.ts`) builds the event body. It moved there from
  `CalendarSync.eventBody` so it can be tested. Recurring tasks get `recurrence: ['RRULE:…']` from the shared
  `recurrenceRrule`. Timed recurring events name `timeZone` on start and end (the machine's IANA zone); Google
  requires it to expand a series. All-day events use dates and need none.
- [x] Completing a recurring task works as before: the finished task's event is deleted (the whole series) and the
  next copy (a new task id) is pushed as a new series starting at its next due date.
- [x] `taskFp` includes the RRULE only when there is one, so the fingerprints of single events are unchanged (no mass
  re-patch after the update). Changing a task's recurrence changes the fingerprint and triggers a push.
- [x] `pushAction(prev, fp, rrule)` (exported, pure) chooses skip / patch / recreate / insert. When an event switches
  between single and recurring it is **recreated** (delete + insert). A PATCH cannot reliably drop `recurrence`, and a
  stale series must not linger. `PushedEntry.rrule` remembers what was pushed; entries stored before this change have
  none and count as single events. The re-link after a reinstall (`findByHyperdoId`) also replaces an event whose
  single/recurring kind does not match.
- [x] Month-end clamp: Hyper Do moves monthly anchors on the 29th–31st to the month's last day (31 Jan → 28 Feb →
  31 Mar), while a plain `FREQ=MONTHLY` skips shorter months. `recurrenceRrule(rec, rule, anchor)` adds
  `BYMONTHDAY=28..d;BYSETPOS=-1` (the last existing day of 28..d = min(d, month length)) for `monthly` and custom
  `month` rules. The `.ics` export and the "add to calendar" links get the same fix.
- Known limit: a snoozed or postponed occurrence is not reflected in the series (only the task's own due date
  moves the series start); yearly rules anchored on 29 Feb follow Google's RRULE semantics (leap years only).
