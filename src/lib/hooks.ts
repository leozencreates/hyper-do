import { useEffect, useState } from 'react'

/** Calls `onEscape` when the Escape key is pressed anywhere in the window (modals). */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onEscape])
}

/** Current time, refreshed every `intervalMs`, so time-dependent UI (overdue, "x min ago") stays fresh without user interaction. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(h)
  }, [intervalMs])
  return now
}
