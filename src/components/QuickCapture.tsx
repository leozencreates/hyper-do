import { useEffect, useState } from 'react'
import { platform } from '../lib/platform'
import { normalizeData } from '../lib/data'
import type { AppData } from '../lib/types'
import { LangContext, useT } from '../lib/useT'
import { useTheme } from '../lib/hooks'
import QuickAdd from './QuickAdd'

/** How long the "✓ Added" state stays before the popup hides itself. */
const ADDED_MS = 1500

/**
 * The global quick-add popup (`?view=quick`, Electron only): one input with the live preview.
 * Enter → the main process parses and stores the task and tells every window; Esc / blur hides.
 * Self-contained on purpose: it only needs the settings (language, theme), never writes AppData itself.
 */
export default function QuickCapture() {
  const [data, setData] = useState<AppData | null>(null)

  useEffect(() => {
    void platform.load().then((d) => setData(normalizeData(d)))
    return platform.onDataChanged?.((d) => setData(normalizeData(d)))
  }, [])

  if (!data) return <div className="loading">…</div>
  return (
    <LangContext.Provider value={data.settings.language}>
      <Capture theme={data.settings.theme} />
    </LangContext.Provider>
  )
}

function Capture({ theme }: { theme: AppData['settings']['theme'] }) {
  const t = useT()
  useTheme(theme)
  const desktop = platform.desktop
  const [shown, setShown] = useState(0) // remounts the input on every show (clears text + refocuses)
  const [added, setAdded] = useState<string | null>(null)

  const hide = () => void desktop?.hideQuick()

  useEffect(() => {
    document.documentElement.dataset.view = 'quick'
    const off = desktop?.onQuickShown(() => {
      setAdded(null)
      setShown((n) => n + 1)
    })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off?.()
      window.removeEventListener('keydown', onKey)
    }
  }, [desktop])

  // Brief "✓ Added" state, then the popup hides itself
  useEffect(() => {
    if (added === null) return
    const h = window.setTimeout(() => void desktop?.hideQuick(), ADDED_MS)
    return () => window.clearTimeout(h)
  }, [added, desktop])

  const submit = async (text: string) => {
    const r = await desktop?.quickAdd(text)
    if (r?.ok) setAdded(r.title ?? text)
  }

  return (
    <div className="quick-capture">
      <span className="brand-dot" />
      {added !== null ? (
        <div className="qc-added">{t('quick_added', { title: added })}</div>
      ) : (
        <div className="qc-body">
          <QuickAdd key={shown} autoFocus maxRows={1} onAdd={(text) => void submit(text)} onAddMany={(lines) => void submit(lines.join('\n'))} onEscape={hide} />
          <div className="qc-hint">{t('quick_esc')}</div>
        </div>
      )}
    </div>
  )
}
