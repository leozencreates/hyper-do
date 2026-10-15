import { describe, it, expect } from 'vitest'
import { inFocusWork, playSound, soundAllowed, type SoundKind } from './sound'
import type { HfSession } from './types'

const NOW = new Date(2026, 9, 15, 14, 0).getTime()

function session(over: Partial<HfSession> = {}): HfSession {
  return { phase: 'work', round: 1, endsAt: NOW + 20 * 60_000, pausedRemaining: null, taskId: null, startedAt: NOW - 20 * 60_000, ...over }
}

const ALL_KINDS: SoundKind[] = ['complete', 'add', 'delete', 'undo', 'snooze', 'focus', 'phase-work', 'phase-break']

describe('inFocusWork', () => {
  it('is true only for a running work round', () => {
    expect(inFocusWork(null)).toBe(false)
    expect(inFocusWork(session())).toBe(true)
    expect(inFocusWork(session({ phase: 'break' }))).toBe(false)
    expect(inFocusWork(session({ pausedRemaining: 5000 }))).toBe(false)
  })

  it('a work round whose timer just ran out still counts (its closing chime must stay silent)', () => {
    expect(inFocusWork(session({ endsAt: NOW - 1 }))).toBe(true)
  })
})

describe('soundAllowed', () => {
  it('plays everything when sounds are on and no Hyper Focus runs', () => {
    for (const k of ALL_KINDS) expect(soundAllowed({ sounds: true }, null, k)).toBe(true)
  })

  it('the master switch silences every sound, including the phase chimes', () => {
    for (const k of ALL_KINDS) expect(soundAllowed({ sounds: false }, null, k)).toBe(false)
    expect(soundAllowed({ sounds: false }, session({ phase: 'break' }), 'phase-work')).toBe(false)
  })

  it('a Hyper Focus work round silences every sound, the chime that ends it included', () => {
    for (const k of ALL_KINDS) expect(soundAllowed({ sounds: true }, session(), k)).toBe(false)
    expect(soundAllowed({ sounds: true }, session({ endsAt: NOW - 1 }), 'phase-break')).toBe(false)
  })

  it('a break or a paused round lets sounds through again, so the chime ending a break plays', () => {
    expect(soundAllowed({ sounds: true }, session({ phase: 'break' }), 'complete')).toBe(true)
    expect(soundAllowed({ sounds: true }, session({ phase: 'break' }), 'phase-work')).toBe(true)
    expect(soundAllowed({ sounds: true }, session({ pausedRemaining: 60_000 }), 'add')).toBe(true)
  })
})

describe('playSound', () => {
  it('is a no-op without a window (Node, Electron main)', () => {
    expect(() => playSound('complete')).not.toThrow()
    expect(() => playSound('phase-break')).not.toThrow()
  })
})
