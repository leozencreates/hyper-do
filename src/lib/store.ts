import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData, FocusEntry, HfSession, Settings, Task } from './types'
import { normalizeData, normalizeHfSession } from './data'
import { pushFocusEntry } from './stats'
import { bumpChanged } from './tasks'
import { platform } from './platform'

/** Pre-0.2 builds kept the Hyper Focus session here; it is moved into AppData once and the key removed. */
const LEGACY_HF_KEY = 'hyperdo-hyperfocus'

function migrateLegacyHyperFocus(d: AppData): AppData {
  try {
    const raw = localStorage.getItem(LEGACY_HF_KEY)
    if (raw === null) return d
    localStorage.removeItem(LEGACY_HF_KEY)
    if (d.hyperFocus) return d
    return { ...d, hyperFocus: normalizeHfSession(JSON.parse(raw), d.settings.pomodoro) }
  } catch {
    return d
  }
}

/**
 * The app state of one renderer window (main or mini) with debounced persistence.
 * Data arriving from the platform (`onDataChanged`: Telegram, calendar import, another window)
 * replaces the state without being saved back, so windows do not echo each other.
 */
export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const timer = useRef<number | null>(null)
  const loaded = useRef(false)
  const skipSave = useRef(false)

  useEffect(() => {
    platform.load().then((d) => {
      skipSave.current = true // what was just loaded needs no saving (and no broadcast to other windows)
      setData(migrateLegacyHyperFocus(normalizeData(d)))
      loaded.current = true
    })
    // Ana süreç (Telegram botu, hızlı ekleme / mini penceresi) veriyi değiştirdiyse arayüzü yenile, geri kaydetme
    const off = platform.onDataChanged?.((d) => {
      skipSave.current = true
      setData(normalizeData(d))
    })
    return () => off?.()
  }, [])

  // Debounce'lu kaydetme (ilk yüklemede kaydetme)
  useEffect(() => {
    if (!data || !loaded.current) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void platform.save(data), 250)
  }, [data])

  /**
   * Whole-document update (completion counters, focus log + tasks in one step).
   * Safety net for sync (#16): every task object replaced by `fn` gets its `updatedAt` bumped, even when the
   * caller forgot to.
   */
  const updateData = useCallback((fn: (d: AppData) => AppData) => {
    setData((d) => {
      if (!d) return d
      const next = fn(d)
      return next.tasks === d.tasks ? next : { ...next, tasks: bumpChanged(d.tasks, next.tasks) }
    })
  }, [])
  const setTasks = useCallback((fn: (t: Task[]) => Task[]) => {
    setData((d) => (d ? { ...d, tasks: bumpChanged(d.tasks, fn(d.tasks)) } : d))
  }, [])
  const setSettings = useCallback((fn: (s: Settings) => Settings) => {
    setData((d) => (d ? { ...d, settings: fn(d.settings) } : d))
  }, [])
  /** Hyper Focus session: part of AppData so the platform's reminder engine sees it. */
  const setHyperFocus = useCallback((fn: (s: HfSession | null) => HfSession | null) => {
    setData((d) => {
      if (!d) return d
      const next = fn(d.hyperFocus)
      return next === d.hyperFocus ? d : { ...d, hyperFocus: next }
    })
  }, [])
  /** Appends a finished Hyper Focus phase to the (capped) focus log. */
  const appendFocusEntry = useCallback((entry: FocusEntry) => {
    setData((d) => (d ? { ...d, focusLog: pushFocusEntry(d.focusLog, entry) } : d))
  }, [])

  /** Yedekten geri yükleme: tüm veriyi değiştirir. */
  const replaceData = useCallback((d: AppData) => setData(normalizeData(d)), [])

  return { data, updateData, setTasks, setSettings, setHyperFocus, appendFocusEntry, replaceData }
}

export type AppStore = ReturnType<typeof useAppData>
