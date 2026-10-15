/**
 * Telegram Mini App server (Phase D1): a tiny `node:http` server on 127.0.0.1 that serves the web build
 * (`dist-web/`: `tg.html` + assets) and a JSON API over the desktop's data. The tunnel (`tunnel.ts`) or the
 * user's own tunnel exposes it to the phone over HTTPS.
 *
 * No `electron` import: `electron/miniapp-server.test.ts` runs it under Vitest against a temp static dir.
 * Electron facts (paths, the `rev` counter, commit) reach it through `MiniAppHost`.
 *
 * Routes
 *   GET  /            → 302 /tg.html                (the PWA shell `index.html` is never served: 404)
 *   GET  /<file>      → static file from `staticDir` (content-type by extension; traversal impossible)
 *   GET  /api/rev     → { rev }                      cheap poll
 *   GET  /api/data    → { rev, data }                secrets blanked (bot token, pairing code, Google client secret)
 *   PUT  /api/data    → body { tasks, deleted, dailyDone, focusLog } merged with `mergeData` (newer `updatedAt`
 *                       wins per task, tombstones delete), committed, reply { rev, data }; 400 on garbage
 * Every `/api/*` request needs `Authorization: tma <initData>`: missing / invalid → 401, a Telegram user other
 * than the linked `settings.telegram.chatId` → 403. Settings are never accepted from the phone.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { AppData } from '../src/lib/types'
import { applySyncDoc, mergeData, parseSyncDoc, toSyncDoc } from '../src/lib/sync'
import { initDataFromHeader, validateInitData } from './tg-auth'

export interface MiniAppHost {
  getData(): AppData
  /** Revision counter: incremented by the host on every commit (any source). */
  rev(): number
  /** Applies the merged document and commits it (the host passes `bump: false` — timestamps are negotiated). */
  mutate(fn: (d: AppData) => AppData): void
  /** Directory holding the web build (`tg.html`, `assets/`). */
  staticDir: string
  /** Clock override for tests (epoch ms). */
  now?(): number
}

export interface MiniAppServerOptions {
  /** 0 (default) = a random free port. */
  port?: number
}

export interface MiniAppServer {
  port: number
  close(): Promise<void>
}

/** Largest accepted request body (the whole synced document). */
export const BODY_MAX_BYTES = 20 * 1024 * 1024

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/** Content type for a file name (unknown extensions are served as octet-stream). */
export function contentType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** `data` with every secret blanked before it leaves the PC (the Mini App never needs them). */
export function blankSecrets(data: AppData): AppData {
  return {
    ...data,
    settings: {
      ...data.settings,
      telegram: { ...data.settings.telegram, token: '', pairCode: '' },
      calendar: { ...data.settings.calendar, google: { ...data.settings.calendar.google, clientSecret: '' } },
    },
  }
}

/**
 * Resolves a request path inside `staticDir`; null when it would escape the directory or names the PWA shell.
 * `/` maps to `tg.html` by the caller (redirect), so it is not handled here.
 */
export function resolveStatic(staticDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const root = path.resolve(staticDir)
  const file = path.resolve(root, '.' + (decoded.startsWith('/') ? decoded : '/' + decoded))
  if (file !== root && !file.startsWith(root + path.sep)) return null
  if (path.relative(root, file).toLowerCase() === 'index.html') return null
  return file
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req: http.IncomingMessage, max: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) {
        resolve(null)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(null))
  })
}

export async function startMiniAppServer(host: MiniAppHost, opts: MiniAppServerOptions = {}): Promise<MiniAppServer> {
  const now = () => host.now?.() ?? Date.now()

  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      return res.end()
    }
    if (urlPath === '/') {
      res.writeHead(302, { location: '/tg.html', 'cache-control': 'no-store' })
      return res.end()
    }
    const file = resolveStatic(host.staticDir, urlPath)
    let stat: fs.Stats | null = null
    if (file) {
      try {
        stat = fs.statSync(file)
      } catch {
        stat = null
      }
    }
    if (!file || !stat || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      return res.end('Not found')
    }
    const hashed = urlPath.startsWith('/assets/')
    res.writeHead(200, {
      'content-type': contentType(file),
      'content-length': stat.size,
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(file).pipe(res)
  }

  const serveApi = async (req: http.IncomingMessage, res: http.ServerResponse, urlPath: string) => {
    const settings = host.getData().settings
    const initData = initDataFromHeader(req.headers.authorization)
    const auth = initData ? validateInitData(initData, settings.telegram.token, Math.floor(now() / 1000)) : null
    if (!auth || !auth.ok) return json(res, 401, { error: 'unauthorized', reason: auth ? auth.error : 'missing' })
    const linked = Number(settings.telegram.chatId)
    if (!settings.telegram.chatId || !Number.isFinite(linked) || linked !== auth.userId) return json(res, 403, { error: 'forbidden' })

    if (urlPath === '/api/rev' && req.method === 'GET') return json(res, 200, { rev: host.rev() })
    if (urlPath === '/api/data' && req.method === 'GET') return json(res, 200, { rev: host.rev(), data: blankSecrets(host.getData()) })
    if (urlPath === '/api/data' && req.method === 'PUT') {
      const raw = await readBody(req, BODY_MAX_BYTES)
      const doc = raw === null ? null : parseSyncDoc(raw, now())
      if (!doc) return json(res, 400, { error: 'bad_request' })
      const t = now()
      host.mutate((cur) => {
        const { merged } = mergeData(toSyncDoc(cur, 'desktop', t), toSyncDoc(doc, 'miniapp', t), t)
        return applySyncDoc(cur, merged)
      })
      return json(res, 200, { rev: host.rev(), data: blankSecrets(host.getData()) })
    }
    return json(res, 404, { error: 'not_found' })
  }

  const server = http.createServer((req, res) => {
    const urlPath = (req.url ?? '/').split('?')[0]
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      serveApi(req, res, urlPath).catch((e: Error) => {
        if (!res.headersSent) json(res, 500, { error: e.message })
        else res.end()
      })
    } else {
      serveStatic(req, res, urlPath)
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
