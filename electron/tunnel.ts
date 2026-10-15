/**
 * Cloudflare quick tunnel helper (Phase D3): finds or downloads `cloudflared`, spawns
 * `cloudflared tunnel --url http://127.0.0.1:<port> --no-autoupdate` and reports the public
 * `https://<name>.trycloudflare.com` URL it prints. Restart / backoff policy lives in the host (`electron/main.ts`).
 *
 * No `electron` import: `electron/tunnel.test.ts` covers the pure parts (URL parsing, asset names) without
 * network or child processes.
 */
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const RELEASE_BASE = 'https://github.com/cloudflare/cloudflared/releases/latest/download/'

export interface CloudflaredAsset {
  /** Release asset name on GitHub. */
  asset: string
  /** Download URL. */
  url: string
  /** Executable file name inside `binDir` once installed. */
  file: string
  /** `tgz` assets (macOS) are extracted with `tar -xzf`. */
  archive: 'none' | 'tgz'
}

/** Release asset for a platform / CPU (`process.platform` / `process.arch` by default); null when unsupported. */
export function cloudflaredAsset(platform: NodeJS.Platform = process.platform, arch: string = process.arch): CloudflaredAsset | null {
  const cpu = arch === 'x64' ? 'amd64' : arch === 'arm64' ? 'arm64' : arch === 'ia32' ? '386' : arch === 'arm' ? 'arm' : null
  if (!cpu) return null
  if (platform === 'win32') {
    if (cpu !== 'amd64' && cpu !== '386') return null
    const asset = `cloudflared-windows-${cpu}.exe`
    return { asset, url: RELEASE_BASE + asset, file: 'cloudflared.exe', archive: 'none' }
  }
  if (platform === 'darwin') {
    if (cpu !== 'amd64' && cpu !== 'arm64') return null
    const asset = `cloudflared-darwin-${cpu}.tgz`
    return { asset, url: RELEASE_BASE + asset, file: 'cloudflared', archive: 'tgz' }
  }
  if (platform === 'linux') {
    const asset = `cloudflared-linux-${cpu}`
    return { asset, url: RELEASE_BASE + asset, file: 'cloudflared', archive: 'none' }
  }
  return null
}

const URL_RE = /https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.trycloudflare\.com/i

/** The quick-tunnel URL in one line of cloudflared output (stdout or stderr), or null. */
export function parseTunnelUrl(line: string): string | null {
  const m = URL_RE.exec(line)
  return m ? m[0].toLowerCase() : null
}

/** `where` / `which` lookup of an executable on PATH; null when absent. */
export function findOnPath(name: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(platform === 'win32' ? 'where' : 'which', [name], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const first = String(stdout)
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s.length > 0)
      resolve(first ?? null)
    })
  })
}

export interface EnsureOptions {
  platform?: NodeJS.Platform
  arch?: string
  /** `fetch` replacement (tests). */
  fetchImpl?: typeof fetch
  /** Skip the PATH lookup (tests / forcing the bundled copy). */
  skipPath?: boolean
}

/**
 * Resolves to an executable `cloudflared`: the one on PATH, the one already in `binDir`, or a fresh download
 * of the latest release into `binDir` (streamed to disk, progress 0–100 via `onProgress`, null when the size is
 * unknown; macOS `.tgz` extracted with `tar -xzf`; `chmod 755` outside Windows).
 */
export async function ensureCloudflared(binDir: string, onProgress?: (percent: number | null) => void, opts: EnsureOptions = {}): Promise<string> {
  const platform = opts.platform ?? process.platform
  if (!opts.skipPath) {
    const onPath = await findOnPath('cloudflared', platform)
    if (onPath) return onPath
  }
  const asset = cloudflaredAsset(platform, opts.arch ?? process.arch)
  if (!asset) throw new Error(`cloudflared: no release for ${platform}/${opts.arch ?? process.arch}`)
  const target = path.join(binDir, asset.file)
  if (fs.existsSync(target)) return target

  fs.mkdirSync(binDir, { recursive: true })
  const f = opts.fetchImpl ?? fetch
  const res = await f(asset.url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`cloudflared download failed: HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  let got = 0
  onProgress?.(total > 0 ? 0 : null)
  const tmp = path.join(binDir, `${asset.asset}.download`)
  const source = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream)
  source.on('data', (c: Buffer) => {
    got += c.length
    if (total > 0) onProgress?.(Math.min(100, Math.floor((got / total) * 100)))
  })
  await pipeline(source, fs.createWriteStream(tmp))

  if (asset.archive === 'tgz') {
    await new Promise<void>((resolve, reject) => {
      execFile('tar', ['-xzf', tmp, '-C', binDir], (err) => (err ? reject(err) : resolve()))
    })
    fs.rmSync(tmp, { force: true })
    if (!fs.existsSync(target)) throw new Error('cloudflared: archive did not contain the binary')
  } else {
    fs.renameSync(tmp, target)
  }
  if (platform !== 'win32') fs.chmodSync(target, 0o755)
  onProgress?.(100)
  return target
}

export interface TunnelOptions {
  bin: string
  port: number
  /** Called once with the public origin (`https://….trycloudflare.com`). */
  onUrl(url: string): void
  /** The process ended (crash, kill, network loss); `code` null when killed by a signal. */
  onExit(code: number | null): void
  /** Raw output lines (diagnostics). */
  onLog?(line: string): void
}

export interface Tunnel {
  stop(): void
  readonly process: ChildProcess
}

/** Spawns a quick tunnel for the local port. `stop()` kills it (and makes the following `onExit` expected). */
export function startQuickTunnel({ bin, port, onUrl, onExit, onLog }: TunnelOptions): Tunnel {
  const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let found = false
  const feed = (buf: string) => {
    for (const line of buf.split(/\r?\n/)) {
      if (!line) continue
      onLog?.(line)
      if (found) continue
      const url = parseTunnelUrl(line)
      if (url) {
        found = true
        onUrl(url)
      }
    }
  }
  let outRest = ''
  let errRest = ''
  child.stdout?.on('data', (c: Buffer) => {
    outRest += c.toString('utf8')
    const i = outRest.lastIndexOf('\n')
    if (i >= 0) {
      feed(outRest.slice(0, i))
      outRest = outRest.slice(i + 1)
    }
  })
  child.stderr?.on('data', (c: Buffer) => {
    errRest += c.toString('utf8')
    const i = errRest.lastIndexOf('\n')
    if (i >= 0) {
      feed(errRest.slice(0, i))
      errRest = errRest.slice(i + 1)
    }
  })
  let ended = false
  const end = (code: number | null) => {
    if (ended) return
    ended = true
    onExit(code)
  }
  child.on('error', () => end(null))
  child.on('exit', (code) => end(code))
  return {
    process: child,
    stop() {
      if (ended) return
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    },
  }
}
