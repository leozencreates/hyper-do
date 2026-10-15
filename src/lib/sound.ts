/**
 * Tiny Web Audio sound effects (no assets). Browser-only: every caller runs in a renderer window.
 * Silently does nothing when audio is blocked or unavailable (autoplay policy, Node).
 *
 * `soundAllowed` is the pure gate (tested): the master switch `settings.sounds` silences everything, and a
 * running Hyper Focus work round silences every sound, the chime that ends the round included (the phone-style
 * notification still fires). The chime that ends a *break* plays, because a break is not focus time.
 */
import type { HfPhase, HfSession, Settings } from './types'

/** Every sound the UI can play. */
export type SoundKind = 'complete' | 'add' | 'delete' | 'undo' | 'snooze' | 'focus' | 'phase-work' | 'phase-break'

/**
 * Short sine-blip recipes per sound: frequencies in Hz, seconds between notes, peak gain.
 * Kept small and soft: an ADHD-friendly app should hint, not startle.
 */
const RECIPES: Record<SoundKind, { notes: number[]; gapS: number; gain: number }> = {
  complete: { notes: [784, 1175], gapS: 0.14, gain: 0.22 }, // rising "ta-da"
  add: { notes: [988], gapS: 0.1, gain: 0.14 }, // one soft pop
  delete: { notes: [330, 220], gapS: 0.1, gain: 0.16 }, // falling, low
  undo: { notes: [523, 784], gapS: 0.08, gain: 0.14 }, // quick lift back up
  snooze: { notes: [659, 494], gapS: 0.16, gain: 0.14 }, // sleepy two-note slide down
  focus: { notes: [880], gapS: 0.1, gain: 0.14 }, // single clear note
  'phase-break': { notes: [660, 880], gapS: 0.18, gain: 0.25 },
  'phase-work': { notes: [880, 660, 990], gapS: 0.18, gain: 0.25 },
}

/**
 * True while a Hyper Focus work round is running (not paused, not in a break). The end time is deliberately not
 * checked: the chime that ends the round is evaluated against the round it ends, and must stay silent too.
 */
export function inFocusWork(hf: HfSession | null | undefined): boolean {
  return !!hf && hf.phase === 'work' && hf.pausedRemaining === null
}

/**
 * Whether `kind` may play right now. `settings.sounds` off = nothing at all; a Hyper Focus work round silences
 * everything (even its own closing chime: nothing may break the concentration the round is meant to protect).
 */
export function soundAllowed(settings: Pick<Settings, 'sounds'>, hf: HfSession | null | undefined, _kind: SoundKind): boolean {
  return settings.sounds && !inFocusWork(hf)
}

/** Plays `notes` (Hz) as short sine blips, `gapS` seconds apart. */
export function playNotes(notes: number[], gapS = 0.18, gain = 0.25) {
  try {
    if (typeof window === 'undefined') return
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    notes.forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      g.gain.value = 0.0001
      o.connect(g)
      g.connect(ctx.destination)
      const t0 = ctx.currentTime + i * gapS
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4)
      o.start(t0)
      o.stop(t0 + 0.42)
    })
    setTimeout(() => void ctx.close(), 1500 + notes.length * gapS * 1000)
  } catch {
    /* audio blocked */
  }
}

/** Plays one of the named effects unconditionally; callers gate with `soundAllowed` (see `useSounds`). */
export function playSound(kind: SoundKind) {
  const r = RECIPES[kind]
  playNotes(r.notes, r.gapS, r.gain)
}

/** Hyper Focus phase change: two notes into a break, three back into work. */
export function chimePhase(phase: HfPhase) {
  playSound(phase === 'break' ? 'phase-break' : 'phase-work')
}

/** Task completed (#9): a quick rising two-note "ta-da". */
export function chimeCelebrate() {
  playSound('complete')
}
