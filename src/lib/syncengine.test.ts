/**
 * Engine + WebDAV transport against an in-memory fake server (GET / PUT / HEAD, ETags, 304, 404, 412, 401).
 * Two "devices" share one server; the clock is controlled so `updatedAt` / tombstone decisions are deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { SyncEngine, parseSyncState } from './syncengine'
import { WebDavTransport, toBase64, type FetchLike } from './synctransport'
import { normalizeData } from './data'
import { normalizeTask, touchTask } from './tasks'
import { addTombstones, parseSyncDoc } from './sync'
import { DEFAULT_SETTINGS, type AppData, type SyncStatus, type Task } from './types'

// Tuesday, 13 October 2026, 10:00 local time
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const MIN = 60_000
const URL = 'https://dav.example.com/remote.php/dav/files/me/HyperDo/hyperdo-sync.json'
const USER = 'me'
const PASS = 'pässwörd' // non-ASCII on purpose
const AUTH = 'Basic ' + toBase64(`${USER}:${PASS}`)

const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW - MIN, order: NOW - MIN, updatedAt: NOW - MIN, ...o })
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms))

function fakeDav() {
  let file: { body: string; etag: string } | null = null
  let version = 0
  const log: string[] = []
  const dav = {
    log,
    /** Runs once right before the next PUT is handled (simulates another device writing in between). */
    beforePut: null as (() => void) | null,
    /** Server-side write by "someone else": new ETag. */
    set(body: string) {
      file = { body, etag: `"v${++version}"` }
    },
    get file() {
      return file
    },
    get doc() {
      return file ? parseSyncDoc(file.body, NOW)! : null
    },
    /** When set, every request answers this status (e.g. 500). */
    failWith: 0,
    fetchImpl: (async (_url, init) => {
      const res = (status: number, body = '', etag?: string) => ({
        status,
        headers: { get: (n: string) => (n.toLowerCase() === 'etag' ? (etag ?? null) : null) },
        text: async () => body,
      })
      log.push(init.method + (init.headers['if-match'] ? ' if-match' : init.headers['if-none-match'] ? ' if-none-match=' + init.headers['if-none-match'] : ''))
      if (dav.failWith) return res(dav.failWith)
      if (init.headers.authorization !== AUTH) return res(401)
      if (init.method === 'GET') {
        if (!file) return res(404)
        if (init.headers['if-none-match'] === file.etag) return res(304)
        return res(200, file.body, file.etag)
      }
      if (init.method === 'HEAD') return file ? res(200, '', file.etag) : res(404)
      if (init.method === 'PUT') {
        if (dav.beforePut) {
          const hook = dav.beforePut
          dav.beforePut = null
          hook()
        }
        const ifMatch = init.headers['if-match']
        if (init.headers['if-none-match'] === '*' && file) return res(412)
        if (ifMatch && (!file || file.etag !== ifMatch)) return res(412)
        file = { body: init.body ?? '', etag: `"v${++version}"` }
        return res(file.body.length ? 204 : 201, '', file.etag)
      }
      return res(405)
    }) as FetchLike,
  }
  return dav
}

const clock = { now: NOW }

interface Device {
  engine: SyncEngine
  data: AppData
  statuses: SyncStatus[]
  state(): string | null
  edit(fn: (d: AppData) => AppData): void
  ids(): string[]
}

function device(dav: ReturnType<typeof fakeDav>, init: Partial<AppData> = {}, creds = { username: USER, password: PASS }, mode: 'webdav' | 'off' = 'webdav', url = URL): Device {
  let stateJson: string | null = JSON.stringify({ credentials: creds })
  const statuses: SyncStatus[] = []
  const dev: Device = {
    data: normalizeData({ ...init, settings: { ...DEFAULT_SETTINGS, ...init.settings, sync: { mode, webdavUrl: url, folder: '' } } }, DEFAULT_SETTINGS, NOW),
    statuses,
    state: () => stateJson,
    engine: new SyncEngine({
      getData: () => dev.data,
      mutate: (fn) => {
        dev.data = fn(dev.data)
      },
      transport: (s, c) => (s.mode === 'webdav' && s.webdavUrl ? new WebDavTransport({ url: s.webdavUrl, username: c.username, password: c.password, fetchImpl: dav.fetchImpl }) : null),
      loadState: () => stateJson,
      saveState: (j) => {
        stateJson = j
      },
      onStatus: (s) => statuses.push(s),
      now: () => clock.now,
      intervalMs: 2_000_000_000,
      startDelayMs: 2_000_000_000,
      debounceMs: 0,
    }),
    edit(fn) {
      dev.data = fn(dev.data)
      dev.engine.onDataSaved()
    },
    ids: () => dev.data.tasks.map((t) => t.id).sort(),
  }
  return dev
}

const engines: SyncEngine[] = []
const up = async (d: Device) => {
  engines.push(d.engine)
  await d.engine.start()
  return d
}
afterEach(() => {
  engines.splice(0).forEach((e) => e.stop())
  clock.now = NOW
})

describe('SyncEngine over WebDAV', () => {
  it('first device creates the file (If-None-Match: *), keeps the token and a generated device id', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await a.engine.syncNow()
    expect(dav.log).toEqual(['GET', 'PUT if-none-match=*'])
    expect(dav.doc!.tasks.map((t) => t.id)).toEqual(['a1'])
    const st = a.engine.status()
    expect(st).toMatchObject({ enabled: true, transport: 'webdav', lastSyncAt: NOW, lastError: null, syncing: false, credentialsSaved: true })
    const persisted = parseSyncState(a.state())
    expect(persisted.deviceId).not.toBe('')
    expect(persisted.lastToken).toBe('"v1"')
    expect(dav.doc!.deviceId).toBe(persisted.deviceId)
    // the cycle toggled `syncing` on and off
    expect(a.statuses.some((s) => s.syncing)).toBe(true)
    expect(a.statuses[a.statuses.length - 1].syncing).toBe(false)
  })

  it('second device pulls without pushing; nothing changed afterwards → conditional GET (304) and no PUT', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await a.engine.syncNow()
    dav.log.length = 0
    const b = await up(device(dav))
    await b.engine.syncNow()
    expect(b.ids()).toEqual(['a1'])
    expect(dav.log).toEqual(['GET'])
    dav.log.length = 0
    await b.engine.syncNow()
    expect(dav.log).toEqual(['GET if-none-match="v1"'])
    expect(b.engine.status().lastError).toBeNull()
  })

  it('edits and deletes converge across two devices; settings stay per device', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' }), task({ id: 'shared' })], settings: { ...DEFAULT_SETTINGS, language: 'tr' } }))
    const b = await up(device(dav, { tasks: [task({ id: 'b1' })], settings: { ...DEFAULT_SETTINGS, language: 'ru' } }))
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(a.ids()).toEqual(['a1', 'b1', 'shared'])
    expect(b.ids()).toEqual(['a1', 'b1', 'shared'])

    // A renames `shared`, B deletes `a1`
    clock.now = NOW + MIN
    a.edit((d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === 'shared' ? touchTask({ ...t, title: 'renamed' }, clock.now) : t)) }))
    b.edit((d) => ({ ...d, tasks: d.tasks.filter((t) => t.id !== 'a1'), deleted: addTombstones(d.deleted, ['a1'], clock.now) }))
    await tick() // debounced (0 ms) cycles of both devices run
    await a.engine.syncNow()
    await b.engine.syncNow()
    await a.engine.syncNow()
    expect(a.ids()).toEqual(['b1', 'shared'])
    expect(b.ids()).toEqual(['b1', 'shared'])
    expect(b.data.tasks.find((t) => t.id === 'shared')!.title).toBe('renamed')
    expect(a.data.deleted).toEqual([{ id: 'a1', at: NOW + MIN }])
    expect(a.data.settings.language).toBe('tr')
    expect(b.data.settings.language).toBe('ru')
    expect(dav.doc!.tasks.map((t) => t.id).sort()).toEqual(['b1', 'shared'])
  })

  it('412 on push → re-pull, merge the other device’s write, retry once → both changes survive', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await a.engine.syncNow()
    // A edits; while A is between GET and PUT, another device writes a new task into the file
    clock.now = NOW + MIN
    a.edit((d) => ({ ...d, tasks: d.tasks.map((t) => touchTask({ ...t, title: 'edited on A' }, clock.now)) }))
    const other = parseSyncDoc(dav.file!.body, NOW)!
    dav.beforePut = () => dav.set(JSON.stringify({ ...other, tasks: [...other.tasks, task({ id: 'from-other' })] }))
    dav.log.length = 0
    await a.engine.syncNow()
    expect(dav.log).toEqual(['GET if-none-match="v1"', 'PUT if-match', 'GET', 'PUT if-match'])
    expect(a.engine.status().lastError).toBeNull()
    expect(a.ids()).toEqual(['a1', 'from-other'])
    const remote = dav.doc!
    expect(remote.tasks.map((t) => t.id).sort()).toEqual(['a1', 'from-other'])
    expect(remote.tasks.find((t) => t.id === 'a1')!.title).toBe('edited on A')
  })

  it('a second conflict in a row is reported as `conflict` and nothing is lost locally', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await a.engine.syncNow()
    clock.now = NOW + MIN
    a.edit((d) => ({ ...d, tasks: d.tasks.map((t) => touchTask({ ...t, title: 'edited' }, clock.now)) }))
    let n = 0
    const bump = () => {
      dav.set(JSON.stringify({ ...parseSyncDoc(dav.file!.body, NOW)!, tasks: [...parseSyncDoc(dav.file!.body, NOW)!.tasks, task({ id: 'x' + n++ })] }))
      dav.beforePut = bump
    }
    dav.beforePut = bump
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBe('conflict')
    expect(a.data.tasks.find((t) => t.id === 'a1')!.title).toBe('edited')
    dav.beforePut = null
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBeNull()
    expect(dav.doc!.tasks.find((t) => t.id === 'a1')!.title).toBe('edited')
  })

  it('wrong credentials → `unauthorized`; setCredentials reconnects and syncs', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }, { username: USER, password: 'nope' }))
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBe('unauthorized')
    expect(dav.file).toBeNull()
    a.engine.setCredentials(USER, PASS)
    await tick()
    expect(a.engine.status().lastError).toBeNull()
    expect(dav.doc!.tasks.map((t) => t.id)).toEqual(['a1'])
    expect(parseSyncState(a.state()).credentials).toEqual({ username: USER, password: PASS })
  })

  it('server errors and unreadable files are reported without touching local data or the file', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    dav.failWith = 500
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBe('http_500')
    dav.failWith = 0
    dav.set('this is not json')
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBe('invalid_file')
    expect(a.ids()).toEqual(['a1'])
    expect(dav.file!.body).toBe('this is not json')
    // an empty file counts as "nothing there yet" and gets written
    dav.set('   ')
    await a.engine.syncNow()
    expect(a.engine.status().lastError).toBeNull()
    expect(dav.doc!.tasks.map((t) => t.id)).toEqual(['a1'])
  })

  it('onDataSaved: task changes sync after the debounce, settings-only saves do not; sync settings change rebuilds the transport', async () => {
    const dav = fakeDav()
    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await a.engine.syncNow()
    dav.log.length = 0
    a.edit((d) => ({ ...d, settings: { ...d.settings, funTitles: false } }))
    await tick()
    expect(dav.log).toEqual([])
    clock.now = NOW + MIN
    a.edit((d) => ({ ...d, tasks: [...d.tasks, task({ id: 'a2', updatedAt: clock.now })] }))
    await tick()
    expect(dav.log).toEqual(['GET if-none-match="v1"', 'PUT if-match'])
    expect(dav.doc!.tasks.map((t) => t.id).sort()).toEqual(['a1', 'a2'])
    // switching sync off drops the transport
    a.edit((d) => ({ ...d, settings: { ...d.settings, sync: { ...d.settings.sync, mode: 'off' } } }))
    expect(a.engine.status()).toMatchObject({ enabled: false, transport: null })
    dav.log.length = 0
    await a.engine.syncNow()
    expect(dav.log).toEqual([])
  })

  it('status: mode off → disabled; WebDAV without a URL → not_configured; concurrent syncNow calls share one cycle', async () => {
    const dav = fakeDav()
    const off = await up(device(dav, {}, undefined, 'off'))
    expect(off.engine.status()).toMatchObject({ enabled: false, transport: null, lastError: null })
    const noUrl = await up(device(dav, {}, undefined, 'webdav', ''))
    expect(noUrl.engine.status()).toMatchObject({ enabled: true, transport: null, lastError: 'not_configured' })

    const a = await up(device(dav, { tasks: [task({ id: 'a1' })] }))
    await Promise.all([a.engine.syncNow(), a.engine.syncNow(), a.engine.syncNow()])
    // one real cycle (GET + PUT) plus the single queued re-run (conditional GET only)
    expect(dav.log).toEqual(['GET', 'PUT if-none-match=*', 'GET if-none-match="v1"'])
  })
})

describe('WebDavTransport details', () => {
  it('sends Basic auth, strips weak ETags for If-Match and falls back to HEAD when PUT returns no ETag', async () => {
    const seen: { method: string; headers: Record<string, string> }[] = []
    let putCount = 0
    const fetchImpl: FetchLike = async (_u, init) => {
      seen.push({ method: init.method, headers: init.headers })
      const etag = init.method === 'PUT' ? null : 'W/"weak-1"'
      if (init.method === 'PUT') putCount++
      return { status: init.method === 'PUT' ? 204 : 200, headers: { get: (n: string) => (n === 'etag' ? etag : null) }, text: async () => '{"tasks":[]}' }
    }
    const t = new WebDavTransport({ url: URL, username: USER, password: PASS, fetchImpl })
    const pulled = await t.pull()
    expect(pulled).toEqual({ status: 'ok', body: '{"tasks":[]}', token: '"weak-1"' })
    expect(seen[0].headers.authorization).toBe(AUTH)
    const token = await t.push('{}', 'W/"weak-1"')
    expect(seen[1].headers['if-match']).toBe('"weak-1"')
    expect(seen[2].method).toBe('HEAD')
    expect(token).toBe('"weak-1"')
    expect(putCount).toBe(1)
    // '' token → unconditional write; no credentials → no authorization header
    const anon = new WebDavTransport({ url: URL, fetchImpl })
    await anon.push('{}', '')
    const last = seen[seen.length - 2]
    expect(last.method).toBe('PUT')
    expect('if-match' in last.headers).toBe(false)
    expect('if-none-match' in last.headers).toBe(false)
    expect('authorization' in last.headers).toBe(false)
  })
})
