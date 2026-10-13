/**
 * Tiny Web Audio chimes (no assets). Browser-only: every caller runs in a renderer window.
 * Silently does nothing when audio is blocked or unavailable (autoplay policy, Node).
 */
import type { HfPhase } from './types'

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

/** Hyper Focus phase change: two notes into a break, three back into work. */
export function chimePhase(phase: HfPhase) {
  playNotes(phase === 'break' ? [660, 880] : [880, 660, 990])
}

/** Task completed (#9): a quick rising two-note "ta-da". */
export function chimeCelebrate() {
  playNotes([784, 1175], 0.14, 0.22)
}
