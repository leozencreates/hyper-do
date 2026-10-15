import { useCallback, useRef } from 'react'
import type { HfSession, Settings } from './types'
import { playSound, soundAllowed, type SoundKind } from './sound'

/**
 * `play(kind)` for a renderer window: plays the effect only when `soundAllowed` says so (master switch
 * `settings.sounds`, silence during a Hyper Focus work round). The latest settings / session are read through a
 * ref, so the returned function is stable and safe to hand to `useTaskActions` / `useCelebration`.
 */
export function useSounds(settings: Pick<Settings, 'sounds'>, hf: HfSession | null): (kind: SoundKind) => void {
  const ref = useRef({ settings, hf })
  ref.current = { settings, hf }
  return useCallback((kind: SoundKind) => {
    const { settings: s, hf: h } = ref.current
    if (soundAllowed(s, h, kind)) playSound(kind)
  }, [])
}
