/**
 * Mini App server (D1) against a temp static directory on 127.0.0.1 (port 0): auth (401/403), secrets blanked,
 * PUT merge rules, revision counter, static routing (redirect, PWA shell hidden, traversal, content types).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { blankSecrets, contentType, resolveStatic, startMiniAppServer, type MiniAppServer } from './miniapp-server'
import { initDataHash } from './tg-auth'
import { normalizeData } from '../src/lib/data'
import { normalizeTask } from '../src/lib/tasks'
import { DEFAULT_SETTINGS, type AppData, type Task } from '../src/lib/types'

const TOKEN = '123456:ABC-dummy'
const NOW = new Date(2026, 9, 15, 12, 0).getTime()
const NOW_SEC = Math.floor(NOW / 1000)

function initData(userId: number, token = TOKEN) {
  const entries: [string, string][] = [
    ['auth_date', String(NOW_SEC - 30)],
    ['query_id', 'AAH'],
    ['user', JSON.stringify({ id: userId, first_name: 'Leo' })],
  ]
  const p = new URLSearchParams(entries)
  p.set('hash', initDataHash(entries, token))
  return p.toString()
}

const task = (o: Partial<Task> & { id: string }): Task => normalizeTask({ title: o.id, createdAt: NOW - 100_000, order: NOW, updatedAt: NOW - 100_000, ...o })

let dir = ''
let server: MiniAppServer | null = null
let data: AppData
let rev = 0
let commits = 0

function host() {
  return {
    getData: () => data,
    rev: () => rev,
    mutate(fn: (d: AppData) => AppData) {
      data = fn(data)
      rev++
      commits++
    },
    staticDir: dir,
    now: () => NOW,
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyperdo-miniapp-'))
  fs.writeFileSync(path.join(dir, 'tg.html'), '<!doctype html><title>tg</title>')
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>pwa</title>')
  fs.mkdirSync(path.join(dir, 'assets'))
  fs.writeFileSync(path.join(dir, 'assets', 'app-abc.js'), 'console.log(1)')
  fs.writeFileSync(path.join(dir, 'icon.svg'), '<svg/>')
  data = normalizeData({
    tasks: [task({ id: 'a', title: 'Desk A' }), task({ id: 'b', title: 'Desk B' }), task({ id: 'c', title: 'Desk C' })],
    settings: {
      ...DEFAULT_SETTINGS,
      telegram: { ...DEFAULT_SETTINGS.telegram, enabled: true, token: TOKEN, chatId: '42', pairCode: '999999' },
      calendar: { ...DEFAULT_SETTINGS.calendar, google: { ...DEFAULT_SETTINGS.calendar.google, clientId: 'cid', clientSecret: 'shh' } },
    },
    dailyDone: { '2026-10-14': 2 },
  })
  rev = 7
  commits = 0
})

afterEach(async () => {
  await server?.close()
  server = null
  fs.rmSync(dir, { recursive: true, force: true })
})

async function start() {
  server = await startMiniAppServer(host())
  return `http://127.0.0.1:${server.port}`
}

const auth = (userId = 42, token = TOKEN) => ({ authorization: `tma ${initData(userId, token)}` })

describe('API auth', () => {
  it('401 without / with a bad Authorization header, 403 for a user other than the linked chat, 200 for the owner', async () => {
    const base = await start()
    expect((await fetch(`${base}/api/rev`)).status).toBe(401)
    expect((await fetch(`${base}/api/rev`, { headers: { authorization: 'Bearer x' } })).status).toBe(401)
    expect((await fetch(`${base}/api/rev`, { headers: auth(42, 'wrong-token') })).status).toBe(401)
    const other = await fetch(`${base}/api/data`, { headers: auth(43) })
    expect(other.status).toBe(403)
    const ok = await fetch(`${base}/api/rev`, { headers: auth() })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(await ok.json()).toEqual({ rev: 7 })
  })

  it('403 while nothing is linked, 401 while the bot has no token', async () => {
    data = { ...data, settings: { ...data.settings, telegram: { ...data.settings.telegram, chatId: '' } } }
    const base = await start()
    expect((await fetch(`${base}/api/rev`, { headers: auth() })).status).toBe(403)
    data = { ...data, settings: { ...data.settings, telegram: { ...data.settings.telegram, token: '' } } }
    expect((await fetch(`${base}/api/rev`, { headers: auth() })).status).toBe(401)
  })

  it('unknown /api paths answer 404 (after auth)', async () => {
    const base = await start()
    expect((await fetch(`${base}/api/nope`, { headers: auth() })).status).toBe(404)
    expect((await fetch(`${base}/api/data`, { method: 'POST', headers: auth() })).status).toBe(404)
  })
})

describe('GET /api/data', () => {
  it('returns rev + the data with the bot token, pairing code and Google client secret blanked; nothing else changes', async () => {
    const base = await start()
    const r = await fetch(`${base}/api/data`, { headers: auth() })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { rev: number; data: AppData }
    expect(body.rev).toBe(7)
    expect(body.data.settings.telegram).toMatchObject({ token: '', pairCode: '', chatId: '42', enabled: true })
    expect(body.data.settings.calendar.google).toMatchObject({ clientId: 'cid', clientSecret: '' })
    expect(body.data.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(body.data.dailyDone).toEqual({ '2026-10-14': 2 })
    // the server's own copy keeps its secrets
    expect(data.settings.telegram.token).toBe(TOKEN)
    expect(blankSecrets(data).settings.telegram.token).toBe('')
  })
})

describe('PUT /api/data', () => {
  const put = (base: string, body: unknown, headers: Record<string, string> = auth()) =>
    fetch(`${base}/api/data`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

  it('merges: the phone-newer task wins, the desktop-newer task is kept, a tombstone deletes, settings are ignored, rev increments', async () => {
    const base = await start()
    const phone = {
      tasks: [
        task({ id: 'a', title: 'Phone A', completedAt: NOW, updatedAt: NOW }), // newer than the desktop copy
        task({ id: 'b', title: 'Phone B (stale)', updatedAt: NOW - 500_000 }), // older → desktop wins
        task({ id: 'p', title: 'Phone only', updatedAt: NOW }),
      ],
      deleted: [{ id: 'c', at: NOW }],
      dailyDone: { '2026-10-14': 1, '2026-10-15': 3 },
      focusLog: [{ id: 'f1', taskId: 'a', phase: 'work', startedAt: NOW - 3_600_000, endedAt: NOW - 3_000_000 }],
      settings: { ...DEFAULT_SETTINGS, language: 'ru', telegram: { ...DEFAULT_SETTINGS.telegram, token: 'evil' } },
    }
    const r = await put(base, phone)
    expect(r.status).toBe(200)
    const body = (await r.json()) as { rev: number; data: AppData }
    expect(body.rev).toBe(8)
    expect(commits).toBe(1)
    const byId = Object.fromEntries(data.tasks.map((t) => [t.id, t]))
    expect(byId.a).toMatchObject({ title: 'Phone A', completedAt: NOW })
    expect(byId.b).toMatchObject({ title: 'Desk B' })
    expect(byId.p).toMatchObject({ title: 'Phone only' })
    expect(byId.c).toBeUndefined()
    expect(data.deleted).toEqual([{ id: 'c', at: NOW }])
    expect(data.dailyDone).toEqual({ '2026-10-14': 2, '2026-10-15': 3 })
    expect(data.focusLog.map((e) => e.id)).toEqual(['f1'])
    // settings untouched on the desktop, blanked in the reply
    expect(data.settings.language).toBe('en')
    expect(data.settings.telegram.token).toBe(TOKEN)
    expect(body.data.settings.telegram.token).toBe('')
    expect(body.data.tasks.map((t) => t.id)).toEqual(['a', 'b', 'p'])
    // the reply is what GET returns now
    const again = (await (await fetch(`${base}/api/data`, { headers: auth() })).json()) as { rev: number }
    expect(again.rev).toBe(8)
  })

  it('an unchanged document still commits (idempotent merge) and a partial body gets defaults', async () => {
    const base = await start()
    const r = await put(base, { tasks: [] })
    expect(r.status).toBe(200)
    expect(data.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c']) // desktop tasks are not deleted by an empty phone list
    expect(commits).toBe(1)
  })

  it('400 on garbage: invalid JSON, wrong shape, tasks not an array; nothing committed; auth still first', async () => {
    const base = await start()
    expect((await put(base, '{not json')).status).toBe(400)
    expect((await put(base, '"a string"')).status).toBe(400)
    expect((await put(base, { tasks: 'nope' })).status).toBe(400)
    expect((await put(base, [])).status).toBe(400)
    expect(commits).toBe(0)
    expect(rev).toBe(7)
    expect((await put(base, { tasks: [] }, auth(43))).status).toBe(403)
    expect((await put(base, { tasks: [] }, {})).status).toBe(401)
  })
})

describe('static files', () => {
  it('/ redirects to /tg.html, tg.html and assets are served with content types, index.html is hidden', async () => {
    const base = await start()
    const root = await fetch(`${base}/`, { redirect: 'manual' })
    expect(root.status).toBe(302)
    expect(root.headers.get('location')).toBe('/tg.html')
    const tg = await fetch(`${base}/tg.html?task=abc`)
    expect(tg.status).toBe(200)
    expect(tg.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await tg.text()).toContain('<title>tg</title>')
    const js = await fetch(`${base}/assets/app-abc.js`)
    expect(js.status).toBe(200)
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(js.headers.get('cache-control')).toContain('immutable')
    expect((await fetch(`${base}/icon.svg`)).headers.get('content-type')).toBe('image/svg+xml')
    expect((await fetch(`${base}/index.html`)).status).toBe(404)
    expect((await fetch(`${base}/INDEX.HTML`)).status).toBe(404)
    expect((await fetch(`${base}/missing.png`)).status).toBe(404)
    expect((await fetch(`${base}/assets/`)).status).toBe(404)
    expect((await fetch(`${base}/tg.html`, { method: 'POST' })).status).toBe(405)
  })

  it('directory traversal is impossible (resolveStatic) and the server answers 404', async () => {
    const outside = path.join(path.dirname(dir), 'outside.txt')
    fs.writeFileSync(outside, 'secret')
    try {
      expect(resolveStatic(dir, '/../outside.txt')).toBeNull()
      expect(resolveStatic(dir, '/..%2Foutside.txt')).toBeNull()
      expect(resolveStatic(dir, '/assets/../../outside.txt')).toBeNull()
      expect(resolveStatic(dir, '/tg.html')).toBe(path.join(path.resolve(dir), 'tg.html'))
      expect(resolveStatic(dir, '/index.html')).toBeNull()
      expect(resolveStatic(dir, '/%zz')).toBeNull()
      const base = await start()
      const r = await fetch(`${base}/..%2Foutside.txt`)
      expect(r.status).toBe(404)
      expect(await r.text()).not.toContain('secret')
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it('contentType covers the web build extensions', () => {
    expect(contentType('x.html')).toContain('text/html')
    expect(contentType('x.css')).toContain('text/css')
    expect(contentType('x.webmanifest')).toContain('manifest')
    expect(contentType('x.png')).toBe('image/png')
    expect(contentType('x.bin')).toBe('application/octet-stream')
  })
})
