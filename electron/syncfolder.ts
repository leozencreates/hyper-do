/**
 * Folder transport (#16, Electron only): the shared document is `<dir>/hyperdo-sync.json` in a directory the
 * user picked — typically one that OneDrive / Dropbox / Google Drive / Syncthing mirrors between the PCs.
 * The file's mtime is the optimistic-concurrency token; writes go through a temp file + rename so no reader
 * ever sees a half-written document. `fs.watch` on the directory (debounced by the engine) triggers a cycle in
 * addition to the engine's 60 s timer. No `electron` import so Vitest can run it (`electron/syncfolder.test.ts`).
 */
import fs from 'node:fs'
import path from 'node:path'
import { SyncConflictError, SyncTransportError, type PullResult, type SyncTransport } from '../src/lib/synctransport'
import { SYNC_FILE_NAME } from '../src/lib/sync'

const isEnoent = (e: unknown) => (e as NodeJS.ErrnoException)?.code === 'ENOENT'

export class FolderTransport implements SyncTransport {
  readonly kind = 'folder' as const
  readonly file: string

  constructor(readonly dir: string) {
    this.file = path.join(dir, SYNC_FILE_NAME)
  }

  /** Current mtime token, or null when the file does not exist. */
  private token(): string | null {
    try {
      return String(fs.statSync(this.file).mtimeMs)
    } catch (e) {
      if (isEnoent(e)) return null
      throw new SyncTransportError('folder_unreadable', (e as Error).message)
    }
  }

  async pull(knownToken?: string | null): Promise<PullResult> {
    const token = this.token()
    if (token === null) return { status: 'missing' }
    if (knownToken && token === knownToken) return { status: 'unchanged' }
    try {
      const body = fs.readFileSync(this.file, 'utf8')
      // re-stat: the file may have been replaced while we were reading
      return { status: 'ok', body, token: this.token() ?? token }
    } catch (e) {
      if (isEnoent(e)) return { status: 'missing' }
      throw new SyncTransportError('folder_unreadable', (e as Error).message)
    }
  }

  async push(body: string, token: string | null): Promise<string> {
    const current = this.token()
    if (token === null ? current !== null : token !== '' && current !== token) throw new SyncConflictError()
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const tmp = path.join(this.dir, `.${SYNC_FILE_NAME}.${process.pid}.tmp`)
      fs.writeFileSync(tmp, body, 'utf8')
      fs.renameSync(tmp, this.file)
      return this.token() ?? ''
    } catch (e) {
      throw new SyncTransportError('folder_unwritable', (e as Error).message)
    }
  }

  /** Fires on any change inside the directory (our own writes included — the engine's cache makes those cheap). */
  watch(cb: () => void): () => void {
    let watcher: fs.FSWatcher | null = null
    try {
      watcher = fs.watch(this.dir, { persistent: false }, (_event, name) => {
        if (!name || String(name) === SYNC_FILE_NAME) cb()
      })
      watcher.on('error', () => {
        /* the directory went away (unmounted drive): the timer keeps polling */
      })
    } catch {
      /* unwatchable directory: polling only */
    }
    return () => watcher?.close()
  }
}
