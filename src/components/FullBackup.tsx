import { useRef, useState } from 'react'
import type { AppData, MediaApi } from '../lib/types'
import { buildFullBackup, inspectFullBackup, restoreFullBackup } from '../lib/full-backup'
import { usePlanningCopy } from '../lib/planning-i18n'
import { dateStamp } from '../lib/download'

export default function FullBackup({ data, media, onImport }: { data: AppData; media: MediaApi; onImport(d: AppData): void }) {
  const c = usePlanningCopy()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<File | null>(null)
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await fn() } catch (e) { setMessage(e instanceof Error && e.message === 'missing_media' ? c.missingMedia : c.error) }
    finally { setBusy(false) }
  }
  return <section className="field"><span>{c.fullBackup}</span><p className="hint">{c.backupHint}</p><div className="row">
    <button className="ghost small" disabled={busy} onClick={() => void run(async () => {
      const blob = await buildFullBackup(data, media)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `hyperdo-full-${dateStamp()}.hyperdo`; a.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      setMessage(c.backupReady)
    })}>{c.export}</button>
    <button className="ghost small" disabled={busy} onClick={() => input.current?.click()}>{c.import}</button>
    <input ref={input} hidden type="file" accept=".hyperdo" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => { await inspectFullBackup(file); setPending(file) }) }} />
  </div>{busy && <p role="status">{c.busy}</p>}{message && <p role="status">{message}</p>}
    {pending && <div><p>{c.confirmImport} <b>{pending.name}</b></p><button className="mini danger" disabled={busy} onClick={() => void run(async () => { const restored = await restoreFullBackup(pending, media); onImport(restored); setPending(null) })}>{c.import}</button><button className="mini" disabled={busy} onClick={() => setPending(null)}>{c.cancel}</button></div>}
  </section>
}
