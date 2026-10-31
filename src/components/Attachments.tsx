import { useEffect, useRef, useState } from 'react'
import { attachmentKind, documentBadge, DOCUMENT_EXTENSIONS, formatBytes, rejectReason } from '../lib/attachments'
import { uid } from '../lib/tasks'
import { useT } from '../lib/useT'
import type { Attachment, MediaApi } from '../lib/types'

/** Object URL of a stored file: undefined while loading, null when the file is not on this device. */
function useMediaUrl(media: MediaApi, id: string): string | null | undefined {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    let made: string | null = null
    media
      .get(id)
      .then((b) => {
        if (!alive) return
        made = b ? URL.createObjectURL(b) : null
        setUrl(made)
      })
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [media, id])
  return url
}

/** What the file picker offers: photos, videos and the document types `attachmentKind` accepts. */
const ACCEPT = ['image/*', 'video/*', ...DOCUMENT_EXTENSIONS.map((e) => `.${e}`)].join(',')

/**
 * Opens a document: the desktop hands a temp copy to the default app (PDF reader, Word…); elsewhere the browser
 * downloads it under its original name.
 */
async function openDocument(media: MediaApi, a: Attachment, openFile?: (name: string, data: ArrayBuffer) => Promise<boolean>): Promise<boolean> {
  const blob = await media.get(a.id)
  if (!blob) return false
  if (openFile && (await openFile(a.name, await blob.arrayBuffer()))) return true
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = a.name || 'document'
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000)
  return true
}

function DocTile({ a, onOpen, onRemove }: { a: Attachment; onOpen(): void; onRemove(): void }) {
  const t = useT()
  const title = [a.name, a.size ? formatBytes(a.size) : ''].filter(Boolean).join(' · ')
  return (
    <div className="att-thumb att-doc" title={title}>
      <button type="button" className="att-open" onClick={onOpen}>
        <span className="att-doc-icon">📄</span>
        <span className="att-doc-badge">{documentBadge(a.name)}</span>
        <span className="att-doc-name">{a.name || t('att_doc')}</span>
      </button>
      <button type="button" className="icon att-remove" title={t('att_remove')} onClick={onRemove}>
        ×
      </button>
    </div>
  )
}

function Thumb({ media, a, onOpen, onRemove }: { media: MediaApi; a: Attachment; onOpen(): void; onRemove(): void }) {
  const t = useT()
  const url = useMediaUrl(media, a.id)
  const title = [a.name, a.size ? formatBytes(a.size) : ''].filter(Boolean).join(' · ')
  return (
    <div className="att-thumb" title={title}>
      <button type="button" className="att-open" disabled={!url} onClick={onOpen}>
        {url === null ? (
          <span className="att-missing">{t('att_missing')}</span>
        ) : url && a.kind === 'image' ? (
          <img src={url} alt={a.name} />
        ) : url ? (
          <>
            <video src={url} preload="metadata" muted />
            <span className="att-play">▶</span>
          </>
        ) : null}
      </button>
      <button type="button" className="icon att-remove" title={t('att_remove')} onClick={onRemove}>
        ×
      </button>
    </div>
  )
}

/** Full-size photo / playable video over the editor; Escape closes only this layer. */
function Viewer({ media, a, onClose }: { media: MediaApi; a: Attachment; onClose(): void }) {
  const url = useMediaUrl(media, a.id)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
  return (
    <div className="att-viewer" onMouseDown={(e) => { e.stopPropagation(); onClose() }}>
      <div onMouseDown={(e) => e.stopPropagation()}>
        {url && (a.kind === 'image' ? <img src={url} alt={a.name} /> : <video src={url} controls autoPlay />)}
      </div>
    </div>
  )
}

interface Props {
  media: MediaApi
  items: Attachment[]
  onChange(items: Attachment[]): void
  /** Files pasted into the notes field are routed here by the editor. */
  pasted?: File[]
  /** Desktop only: open a document with the system's default app (`DesktopApi.openFile`). */
  openFile?(name: string, data: ArrayBuffer): Promise<boolean>
}

/**
 * Attachment strip under the notes: thumbnails, document tiles, "add photo / video / document" (file picker, camera on Android), drop target.
 * Files are written to the media store immediately; removing one only drops the metadata, the bytes are
 * collected by `media.gc` on the next start (so Cancel and undo never lose a file).
 */
export default function Attachments({ media, items, onChange, pasted, openFile }: Props) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState<Attachment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef(items)
  latest.current = items

  const add = async (files: File[]) => {
    if (!files.length) return
    setError(null)
    setBusy(true)
    const added: Attachment[] = []
    try {
      for (const f of files) {
        const why = rejectReason(f, latest.current.length + added.length)
        if (why) {
          setError(t(`att_err_${why}` as const, { name: f.name }))
          continue
        }
        const a: Attachment = { id: uid(), kind: attachmentKind(f.type, f.name)!, name: f.name, mime: f.type, size: f.size, addedAt: Date.now() }
        await media.put(a.id, f)
        added.push(a)
      }
    } catch {
      setError(t('att_err_store'))
    } finally {
      setBusy(false)
      if (added.length) onChange([...latest.current, ...added])
    }
  }

  useEffect(() => {
    if (pasted?.length) void add(pasted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pasted])

  return (
    <div
      className="attachments"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        void add([...e.dataTransfer.files])
      }}
    >
      {items.map((a) =>
        a.kind === 'document' ? (
          <DocTile
            key={a.id}
            a={a}
            onOpen={() => {
              setError(null)
              openDocument(media, a, openFile)
                .then((ok) => !ok && setError(t('att_err_open', { name: a.name })))
                .catch(() => setError(t('att_err_open', { name: a.name })))
            }}
            onRemove={() => onChange(items.filter((x) => x.id !== a.id))}
          />
        ) : (
          <Thumb key={a.id} media={media} a={a} onOpen={() => setOpen(a)} onRemove={() => onChange(items.filter((x) => x.id !== a.id))} />
        ),
      )}
      <button type="button" className="mini att-add" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '…' : t('att_add')}
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void add(files)
        }}
      />
      {error && <small className="att-error">{error}</small>}
      {items.length > 0 && <small className="att-hint">{t('att_hint')}</small>}
      {open && <Viewer media={media} a={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
