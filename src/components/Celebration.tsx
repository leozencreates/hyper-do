import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'

/** Particles per burst and how long a burst stays in the DOM (matches the CSS animation). */
const PARTICLES = 24
const BURST_MS = 1200
const COLORS = ['#ff8a3d', '#ff5fa2', '#a78bfa', '#2dd4bf', '#38bdf8', '#a3e635', '#ffb03a']

/**
 * Completion celebration (#9): a two-note chime plus a CSS confetti burst.
 * The confetti is skipped under `prefers-reduced-motion`; the chime still plays. The chime itself comes from
 * `chime` (App: `play('complete')` of `useSounds`), so the sound switch and the Hyper Focus silence apply.
 * Returns the trigger and the element to render once near the root.
 */
export function useCelebration(enabled: boolean, chime: () => void) {
  const [burst, setBurst] = useState(0)

  const celebrate = useCallback(() => {
    if (!enabled) return
    chime()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    setBurst(Date.now())
  }, [enabled, chime])

  useEffect(() => {
    if (!burst) return
    const h = window.setTimeout(() => setBurst(0), BURST_MS)
    return () => window.clearTimeout(h)
  }, [burst])

  return { celebrate, element: burst ? <Confetti key={burst} /> : null }
}

function Confetti() {
  const parts = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        x: (Math.random() * 2 - 1) * 260,
        y: -(140 + Math.random() * 220),
        r: Math.random() * 720 - 360,
        d: Math.random() * 0.12,
        s: 0.6 + Math.random() * 0.7,
        c: COLORS[i % COLORS.length],
      })),
    [],
  )
  return (
    <div className="confetti" aria-hidden>
      {parts.map((p, i) => (
        <span key={i} style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.r}deg`, '--d': `${p.d}s`, '--s': p.s, background: p.c } as CSSProperties} />
      ))}
    </div>
  )
}
