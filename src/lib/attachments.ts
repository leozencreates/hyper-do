/**
 * Photo / video / document attachments on a task's notes (docs/2026-10-24-attachments-design.md). Pure: the task only
 * carries metadata (`Task.attachments`); the bytes live in the platform media store (`HyperDoApi.media`,
 * IndexedDB), keyed by `Attachment.id`, outside AppData, backups and sync.
 */
import type { Attachment, AttachmentKind, Task } from './types'

/** Largest file accepted (bytes): 200 MB, enough for a few minutes of phone video. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** At most this many attachments per task. */
export const MAX_ATTACHMENTS = 20

/** File extensions accepted as documents (lower case, no dot). Executables / scripts are never accepted. */
export const DOCUMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'csv', 'tsv',
  'json', 'xml', 'epub', 'pages', 'numbers', 'key', 'zip', 'rar', '7z',
] as const

/** MIME types accepted as documents even when the file name carries no known extension. */
const DOCUMENT_MIMES = new Set([
  'application/pdf', 'application/msword', 'application/rtf', 'text/rtf', 'text/plain', 'text/markdown', 'text/csv',
  'text/tab-separated-values', 'application/json', 'application/xml', 'text/xml', 'application/epub+zip',
  'application/zip', 'application/x-zip-compressed', 'application/vnd.rar', 'application/x-rar-compressed',
  'application/x-7z-compressed', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
])

/** Lower-case extension of a file name without the dot ('' when there is none). */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/**
 * `image/*` → image, `video/*` → video, office / PDF / text / archive files → document (by MIME type or, since
 * browsers often leave `type` empty for .md / .docx on Windows, by extension), anything else → null (not accepted).
 */
export function attachmentKind(mime: string, name = ''): AttachmentKind | null {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (DOCUMENT_MIMES.has(m) || m.startsWith('application/vnd.openxmlformats-officedocument.') || m.startsWith('application/vnd.oasis.opendocument.')) return 'document'
  if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(fileExtension(name))) return 'document'
  return null
}

/** Why a file cannot be attached, or null when it can. */
export function rejectReason(file: { type: string; size: number; name?: string }, current: number): 'type' | 'size' | 'count' | null {
  if (!attachmentKind(file.type, file.name)) return 'type'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'size'
  if (current >= MAX_ATTACHMENTS) return 'count'
  return null
}

/** Short badge for a document tile: "PDF", "DOCX", … ("FILE" when the name has no extension). */
export function documentBadge(name: string): string {
  return (fileExtension(name) || 'file').toUpperCase().slice(0, 5)
}

/** Keeps well-formed entries (unique ids); anything else becomes an empty list. */
export function normalizeAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Attachment[] = []
  for (const a of v as Partial<Attachment>[]) {
    if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue
    const kind =
      a.kind === 'image' || a.kind === 'video' || a.kind === 'document'
        ? a.kind
        : attachmentKind(typeof a.mime === 'string' ? a.mime : '', typeof a.name === 'string' ? a.name : '')
    if (!kind) continue
    seen.add(a.id)
    out.push({
      id: a.id,
      kind,
      name: typeof a.name === 'string' ? a.name : '',
      mime: typeof a.mime === 'string' ? a.mime : '',
      size: typeof a.size === 'number' && a.size > 0 ? Math.round(a.size) : 0,
      addedAt: typeof a.addedAt === 'number' && Number.isFinite(a.addedAt) ? a.addedAt : 0,
    })
  }
  return out
}

/** Every media id still referenced by a task (done ones included: they can be reopened or undone). */
export function referencedMediaIds(tasks: Task[]): Set<string> {
  const ids = new Set<string>()
  for (const t of tasks) for (const a of t.attachments) ids.add(a.id)
  return ids
}

/** "2.4 MB" style size for the editor tooltip. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * File name for the temp copy the desktop opens with the default app: no folders, no characters Windows rejects,
 * at most 120 chars; null when the extension is not a document one (never hand an .exe / .bat to the shell).
 */
export function safeOpenName(name: string): string | null {
  const ext = fileExtension(name)
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) return null
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[.\s]+/, '').trim()
  const stem = base.slice(0, base.length - ext.length - 1).slice(0, 110) || 'document'
  return `${stem}.${ext}`
}
