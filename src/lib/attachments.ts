/**
 * Photo / video attachments on a task's notes (docs/2026-10-24-attachments-design.md). Pure: the task only
 * carries metadata (`Task.attachments`); the bytes live in the platform media store (`HyperDoApi.media`,
 * IndexedDB), keyed by `Attachment.id`, outside AppData, backups and sync.
 */
import type { Attachment, AttachmentKind, Task } from './types'

/** Largest file accepted (bytes): 200 MB, enough for a few minutes of phone video. */
export const MAX_ATTACHMENT_BYTES = 200 * 1024 * 1024
/** At most this many attachments per task. */
export const MAX_ATTACHMENTS = 20

/** `image/*` → image, `video/*` → video, anything else → null (not accepted). */
export function attachmentKind(mime: string): AttachmentKind | null {
  const m = mime.toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  return null
}

/** Why a file cannot be attached, or null when it can. */
export function rejectReason(file: { type: string; size: number }, current: number): 'type' | 'size' | 'count' | null {
  if (!attachmentKind(file.type)) return 'type'
  if (file.size > MAX_ATTACHMENT_BYTES) return 'size'
  if (current >= MAX_ATTACHMENTS) return 'count'
  return null
}

/** Keeps well-formed entries (unique ids); anything else becomes an empty list. */
export function normalizeAttachments(v: unknown): Attachment[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: Attachment[] = []
  for (const a of v as Partial<Attachment>[]) {
    if (!a || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue
    const kind = a.kind === 'image' || a.kind === 'video' ? a.kind : attachmentKind(typeof a.mime === 'string' ? a.mime : '')
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
