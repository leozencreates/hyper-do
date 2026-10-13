/** Folder transport against a real temp directory, plus two engines sharing one folder. */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FolderTransport } from './syncfolder'
import { SyncConflictError } from '../src/lib/synctransport'
import { SyncEngine } from '../src/lib/syncengine'
import { SYNC_FILE_NAME, addTombstones, parseSyncDoc } from '../src/lib/sync'
import { normalizeData } from '../src/lib/data'
import { normalizeTask, touchTask } from '../src/lib/tasks'
import { DEFAULT_SETTINGS, type AppData, type Task } from '../src/lib/types'

const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW - MIN, order: NOW - MIN, updatedAt: NOW - MIN, ...o })
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms))

const dirs: string[] = []
const engines: SyncEngine[] = []
const tmpDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdo-sync-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop())
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

describe('FolderTransport', () => {
  it('missing → create → unchanged → conflict semantics on the file mtime', async () => {
    const dir = tmpDir()
    const t = new FolderTransport(dir)
    expect(await t.pull()).toEqual({ status: 'missing' })
    const tok1 = await t.push('{"tasks":[]}', null)
    expect(tok1).not.toBe('')
    expect(fs.readFileSync(path.join(dir, SYNC_FILE_NAME), 'utf8')).toBe('{"tasks":[]}')
    expect(await t.pull()).toEqual({ status: 'ok', body: '{"tasks":[]}', token: tok1 })
    expect(await t.pull(tok1)).toEqual({ status: 'unchanged' })
    // creating again while the file exists, or writing with a stale token, is a conflict
    await expect(t.push('{}', null)).rejects.toBeInstanceOf(SyncConflictError)
    await tick()
    fs.writeFileSync(path.join(dir, SYNC_FILE_NAME), '{"tasks":[],"external":true}')
    await expect(t.push('{}', tok1)).rejects.toBeInstanceOf(SyncConflictError)
    const fresh = await t.pull(tok1)
    expect(fresh.status).toBe('ok')
    const tok2 = (fresh as { token: string }).token
    expect(tok2).not.toBe(tok1)
    const tok3 = await t.push('{"tasks":[1]}', tok2)
    expect(await t.pull(tok3)).toEqual({ status: 'unchanged' })
    // '' = unknown token → unconditional write
    await expect(t.push('{"tasks":[2]}', '')).resolves.toBeTruthy()
    expect(fs.readdirSync(dir)).toEqual([SYNC_FILE_NAME]) // no temp file left behind
  })

  it('two engines on the same folder converge (edit on one, delete on the other)', async () => {
    const dir = tmpDir()
    const clock = { now: NOW }
    const make = (init: Partial<AppData>) => {
      let state: string | null = null
      const dev = {
        data: normalizeData({ ...init, settings: { ...DEFAULT_SETTINGS, sync: { mode: 'folder' as const, webdavUrl: '', folder: dir } } }, DEFAULT_SETTINGS, NOW),
        engine: null as unknown as SyncEngine,
        ids: () => dev.data.tasks.map((t) => t.id).sort(),
      }
      dev.engine = new SyncEngine({
        getData: () => dev.data,
        mutate: (fn) => {
          dev.data = fn(dev.data)
        },
        transport: (s) => (s.mode === 'folder' && s.folder ? new FolderTransport(s.folder) : null),
        loadState: () => state,
        saveState: (j) => {
          state = j
        },
        onStatus: () => {},
        now: () => clock.now,
        intervalMs: 2_000_000_000,
        startDelayMs: 2_000_000_000,
        debounceMs: 0,
      })
      engines.push(dev.engine)
      return dev
    }
    const a = make({ tasks: [task({ id: 'a1' }), task({ id: 'shared' })] })
    const b = make({ tasks: [task({ id: 'b1' })] })
    await a.engine.start()
    await b.engine.start()
    await a.engine.syncNow()
    await tick()
    await b.engine.syncNow()
    await tick()
    await a.engine.syncNow()
    expect(a.ids()).toEqual(['a1', 'b1', 'shared'])
    expect(b.ids()).toEqual(['a1', 'b1', 'shared'])
    expect(a.engine.status()).toMatchObject({ enabled: true, transport: 'folder', lastError: null })

    clock.now = NOW + MIN
    a.data = { ...a.data, tasks: a.data.tasks.map((t) => (t.id === 'shared' ? touchTask({ ...t, title: 'renamed' }, clock.now) : t)) }
    b.data = { ...b.data, tasks: b.data.tasks.filter((t) => t.id !== 'a1'), deleted: addTombstones(b.data.deleted, ['a1'], clock.now) }
    await a.engine.syncNow()
    await tick()
    await b.engine.syncNow()
    await tick()
    await a.engine.syncNow()
    expect(a.ids()).toEqual(['b1', 'shared'])
    expect(b.ids()).toEqual(['b1', 'shared'])
    expect(b.data.tasks.find((t) => t.id === 'shared')!.title).toBe('renamed')
    const file = parseSyncDoc(fs.readFileSync(path.join(dir, SYNC_FILE_NAME), 'utf8'), NOW)!
    expect(file.tasks.map((t) => t.id).sort()).toEqual(['b1', 'shared'])
    expect(file.deleted).toEqual([{ id: 'a1', at: NOW + MIN }])
  })
})
