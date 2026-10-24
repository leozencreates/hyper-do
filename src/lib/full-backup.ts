import type { AppData, MediaApi } from './types'
import { normalizeData } from './data'
import { referencedMediaIds, MAX_ATTACHMENT_BYTES } from './attachments'
import { uid } from './tasks'

const MAGIC = 'HYPERDO1\n'
const HEADER_SIZE = MAGIC.length + 4
const MAX_MANIFEST = 16 * 1024 * 1024
interface Manifest { version: 1; data: AppData; files: { id: string; mime: string; size: number }[] }

/** Binary container: magic, uint32 manifest length, UTF-8 manifest, then media bytes. No base64 expansion. */
export async function buildFullBackup(data: AppData, media: MediaApi): Promise<Blob> {
  const blobs: Blob[] = []
  const files: Manifest['files'] = []
  for (const id of referencedMediaIds(data.tasks)) {
    const blob = await media.get(id)
    if (!blob) throw new Error('missing_media')
    blobs.push(blob)
    files.push({ id, mime: blob.type, size: blob.size })
  }
  const json = new TextEncoder().encode(JSON.stringify({ version: 1, data, files } satisfies Manifest))
  if (json.byteLength > MAX_MANIFEST) throw new Error('manifest_too_large')
  const header = new Uint8Array(HEADER_SIZE)
  header.set(new TextEncoder().encode(MAGIC))
  new DataView(header.buffer).setUint32(MAGIC.length, json.byteLength)
  return new Blob([header, json, ...blobs], { type: 'application/octet-stream' })
}

export async function inspectFullBackup(file: Blob): Promise<Manifest> {
  if (file.size < HEADER_SIZE) throw new Error('invalid_backup')
  const header = await file.slice(0, HEADER_SIZE).arrayBuffer()
  if (new TextDecoder().decode(header.slice(0, MAGIC.length)) !== MAGIC) throw new Error('invalid_backup')
  const length = new DataView(header).getUint32(MAGIC.length)
  if (length > MAX_MANIFEST || length > file.size - HEADER_SIZE) throw new Error('invalid_backup')
  const manifest = JSON.parse(await file.slice(HEADER_SIZE, HEADER_SIZE + length).text()) as Manifest
  if (manifest.version !== 1 || !Array.isArray(manifest.data?.tasks) || !Array.isArray(manifest.files)) throw new Error('invalid_backup')
  const ids = new Set<string>()
  let total = HEADER_SIZE + length
  for (const f of manifest.files) {
    if (!f || typeof f.id !== 'string' || !f.id || ids.has(f.id) || !Number.isSafeInteger(f.size) || f.size < 0 || f.size > MAX_ATTACHMENT_BYTES || typeof f.mime !== 'string' || !/^(image|video)\//.test(f.mime)) throw new Error('invalid_backup')
    ids.add(f.id); total += f.size
  }
  if (total !== file.size) throw new Error('invalid_backup')
  const data = normalizeData(manifest.data)
  for (const task of data.tasks) for (const a of task.attachments) {
    const entry = manifest.files.find((f) => f.id === a.id)
    if (!entry || entry.size !== a.size || entry.mime !== a.mime) throw new Error('invalid_backup')
  }
  return { ...manifest, data }
}

/** New media ids keep the current data usable even if an import fails partway through. */
export async function restoreFullBackup(file: Blob, media: MediaApi): Promise<AppData> {
  const manifest = await inspectFullBackup(file)
  const header = await file.slice(0, HEADER_SIZE).arrayBuffer()
  let offset = HEADER_SIZE + new DataView(header).getUint32(MAGIC.length)
  const replacements = new Map<string, string>()
  for (const f of manifest.files) {
    const id = uid()
    await media.put(id, file.slice(offset, offset + f.size, f.mime))
    replacements.set(f.id, id)
    offset += f.size
  }
  return { ...manifest.data, tasks: manifest.data.tasks.map((t) => ({ ...t, attachments: t.attachments.map((a) => ({ ...a, id: replacements.get(a.id)! })) })) }
}
