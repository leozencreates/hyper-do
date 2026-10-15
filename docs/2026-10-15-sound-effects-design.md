# Hyper Do — sound effects (design spec)

Polish item after 0.2.1, listed under **After 0.2.1 — polish** in `docs/ROADMAP-2026-10.md`. The general rules at
the top of the roadmap apply (i18n in EN/TR/RU, defaults in `DEFAULT_SETTINGS` / `normalizeData`, pure logic in
`src/lib`, never rename or remove fields). Verified with `npm run build && npm run build:web && npm test`, then
committed.

Status legend: `[ ]` planned · `[x]` shipped.

## Why

Before this change the app had exactly two sounds: the Hyper Focus phase chime and the completion "ta-da" (part of
**Celebrate completions**). Adding, deleting, undoing, snoozing and focusing were silent, so the only feedback for a
quick action was a row moving. For an ADHD-friendly app a short, soft audio hint closes the loop ("yes, that
registered") without the user having to look. At the same time sound must be easy to kill — one click in the header,
not a trip into Settings — and it must never interrupt a Hyper Focus work round, the one place the app promises
silence.

## Non-goals

Audio assets (everything stays synthesised with Web Audio, no files to ship), per-sound volume or theme packs,
sounds on Android notifications (those use the system channel), sounds in the Electron main process (toasts use the
Windows "Reminder" event sound already, see `deeplink.ts`), and a sound for reminders delivered inside the renderer
(the web adapter's `Notification` carries the browser's own sound).

## Design

- [x] **Sound catalogue** (`src/lib/sound.ts`): `SoundKind = complete | add | delete | undo | snooze | focus |
  phase-work | phase-break`, each a small sine-blip recipe (`RECIPES`: notes in Hz, gap, gain). `playSound(kind)` is
  unconditional; `chimePhase` / `chimeCelebrate` stay as thin wrappers. All effects are quiet (gain ≤ 0.25) and
  under half a second.
- [x] **Gate** (pure, tested in `src/lib/sound.test.ts`): `soundAllowed(settings, hyperFocus, kind, now)`.
  `settings.sounds === false` → nothing plays, phase chimes included. While `inFocusWork(hf, now)` (phase `work`, not
  paused, `endsAt > now`) only `phase-work` / `phase-break` may play: the chime that ends the round is the whole
  point of the round, every other effect is noise. Breaks and paused rounds let the UI effects through.
- [x] **Setting**: `settings.sounds: boolean`, default `true`; `normalizeData` accepts only booleans. Shown in
  Settings as **Sound effects** right above **Celebrate completions**. `celebrate` keeps its meaning (chime + confetti)
  but its chime now goes through the gate, so `sounds` off = confetti only.
- [x] **Header switch** (`App.tsx`, `head-tools`, left of the reminder-mute chip): 🔊 when sounds play, 🔇 when
  switched off *or* auto-muted by a Hyper Focus work round (tooltip explains which; `.snd-btn.off` dims it). Click
  toggles `settings.sounds`. Disabled in the Telegram Mini App like the mute chip: settings are never saved from the
  phone, so the toggle would revert.
- [x] **Wiring**: `useSounds(settings, hyperFocus)` (`src/lib/useSounds.ts`) returns a stable `play(kind)` that
  applies the gate. `useTaskActions` gets an optional `onSound(kind)` dep and calls it from `remove` (delete),
  `undoDelete` (undo), `snooze` / `postpone` (snooze), `setFocus(on)` (focus), `quickAdd` / `quickAddMany` / new task
  in `save` (add). Completion stays on `onCompleted` → `useCelebration(enabled, chime)`. `useHyperFocus` takes
  `sounds` in its options for the phase chimes. The mini window (`MiniView`) wires the same hook, so Done / Snooze
  there sound too; the Mini App (`IS_TG`) keeps haptics and gets the sounds through the same code path.

## Hand tests

`docs/MANUAL-TEST-2026-10.md` → A13 (header switch, Hyper Focus silence, Settings toggle) and A6 (celebration).
