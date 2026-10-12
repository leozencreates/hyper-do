import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppData, Settings, Task } from './types'
import { normalizeData } from './data'
import { platform } from './platform'

export function useAppData() {
  const [data, setData] = useState<AppData | null>(null)
  const timer = useRef<number | null>(null)
  const loaded = useRef(false)
  const skipSave = useRef(false)

  useEffect(() => {
    platform.load().then((d) => {
      setData(normalizeData(d))
      loaded.current = true
    })
    // Ana süreç (Telegram botu) veriyi değiştirdiyse arayüzü yenile, geri kaydetme
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

  const setTasks = useCallback((fn: (t: Task[]) => Task[]) => {
    setData((d) => (d ? { ...d, tasks: fn(d.tasks) } : d))
  }, [])
  const setSettings = useCallback((fn: (s: Settings) => Settings) => {
    setData((d) => (d ? { ...d, settings: fn(d.settings) } : d))
  }, [])

  /** Yedekten geri yükleme: tüm veriyi değiştirir. */
  const replaceData = useCallback((d: AppData) => setData(normalizeData(d)), [])

  return { data, setTasks, setSettings, replaceData }
}

export type AppStore = ReturnType<typeof useAppData>
