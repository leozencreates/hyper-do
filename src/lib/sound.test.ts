import { describe, it, expect } from 'vitest'
import { inFocusWork, playSound, soundAllowed, type SoundKind } from './sound'
import type { HfSession } from './types'

const NOW = new Date(2026, 9, 15, 14, 0).getTime()

function session(over: Partial<HfSession> = {}): HfSession {
  return { phase: 'work', round: 1, endsAt: NOW + 20 * 60_000, pausedRemaining: null, taskId: null, startedAt: NOW - 20 * 60_000, ...over }
}

const UI_KINDS: SoundKind[] = ['complete', 'add', 'delete', 'undo', 'snooze', 'focus']

describe('inFocusWork', () => {
  it('is true only for a running work round', () => {
    expect(inFocusWork(null, NOW)).toBe(false)
    expect(inFocusWork(session(), NOW)).toBe(true)
    expect(inFocusWork(session({ phase: 'break' }), NOW)).toBe(false)
    expect(inFocusWork(session({ pausedRemaining: 5000 }), NOW)).toBe(false)
  })

  it('an expired round (timer not advanced yet) does not count', () => {
    expect(inFocusWork(session({ endsAt: NOW - 1 }), NOW)).toBe(false)
  })
})

describe('soundAllowed', () => {
  it('plays everything when sounds are on and no Hyper Focus runs', () => {
    for (const k of [...UI_KINDS, 'phase-work', 'phase-break'] as SoundKind[]) expect(soundAllowed({ sounds: true }, null, k, NOW)).toBe(true)
  })

  it('the master switch silences every sound, including the phase chimes', () => {
    for (const k of [...UI_KINDS, 'phase-work', 'phase-break'] as SoundKind[]) expect(soundAllowed({ sounds: false }, null, k, NOW)).toBe(false)
    expect(soundAllowed({ sounds: false }, session({ phase: 'break' }), 'phase-work', NOW)).toBe(false)
  })

  it('a Hyper Focus work round silences the UI effects but keeps the phase chimes', () => {
    for (const k of UI_KINDS) expect(soundAllowed({ sounds: true }, session(), k, NOW)).toBe(false)
    expect(soundAllowed({ sounds: true }, session(), 'phase-break', NOW)).toBe(true)
    expect(soundAllowed({ sounds: true }, session(), 'phase-work', NOW)).toBe(true)
  })

  it('a break or a paused round lets the UI effects through again', () => {
    expect(soundAllowed({ sounds: true }, session({ phase: 'break' }), 'complete', NOW)).toBe(true)
    expect(soundAllowed({ sounds: true }, session({ pausedRemaining: 60_000 }), 'add', NOW)).toBe(true)
  })
})

describe('playSound', () => {
  it('is a no-op without a window (Node, Electron main)', () => {
    expect(() => playSound('complete')).not.toThrow()
    expect(() => playSound('phase-break')).not.toThrow()
  })
})
