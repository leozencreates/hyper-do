/**
 * Sync transports (#16): where the shared document lives. Pure TypeScript, no Electron / React.
 *
 *  - `WebDavTransport` (every platform): one JSON file on a WebDAV server (Nextcloud, ownCloud, Yandex Disk,
 *    Koofr, Synology, Apache/nginx DAV…). `GET` reads it, `PUT` writes it with `If-Match: <etag>` (or
 *    `If-None-Match: *` when the file does not exist yet), so two devices never overwrite each other blindly:
 *    a `412 Precondition Failed` becomes `SyncConflictError` and the engine re-pulls, merges and retries once.
 *    Works with the global `fetch` (Electron main, browsers; on Android Capacitor's native HTTP plugin backs
 *    `fetch`) or any `fetchImpl` with the same shape (tests use an in-memory fake).
 *  - The folder transport (Electron only, file mtime as the token) lives in `electron/syncfolder.ts`.
 */

export type SyncTransportKind = 'folder' | 'webdav'

export type PullResult =
  /** The file does not exist yet (404 / ENOENT): start from an empty document. */
  | { status: 'missing' }
  /** The file still has the token passed to `pull` (304 / same mtime): the cached copy is current. */
  | { status: 'unchanged' }
  | { status: 'ok'; body: string; token: string }

export interface SyncTransport {
  readonly kind: SyncTransportKind
  /** Reads the document. With `knownToken` the transport may answer `unchanged` instead of sending the body again. */
  pull(knownToken?: string | null): Promise<PullResult>
  /**
   * Writes the document. `token` is the one the body was merged against (null = the file must not exist yet;
   * '' = unknown, write unconditionally). Resolves with the new token; rejects with `SyncConflictError` when
   * somebody else wrote in between.
   */
  push(body: string, token: string | null): Promise<string>
  /** Optional change notification (folder watcher). Returns the unsubscribe function. */
  watch?(cb: () => void): () => void
}

/** The remote changed between pull and push (HTTP 412 / mtime differs). */
export class SyncConflictError extends Error {
  readonly code = 'conflict'
  constructor(message = 'conflict') {
    super(message)
    this.name = 'SyncConflictError'
  }
}

/** A transport failure with a stable code the UI can translate (`unauthorized`, `http_<status>`, `invalid_file`…). */
export class SyncTransportError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message)
    this.name = 'SyncTransportError'
  }
}

// ---- WebDAV ----

export interface FetchInit {
  method: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
  cache?: 'no-store'
}

export interface FetchResponseLike {
  status: number
  headers: { get(name: string): string | null }
  text(): Promise<string>
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponseLike>

export interface WebDavOptions {
  url: string
  username?: string
  password?: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

/** UTF-8 safe base64 (credentials may contain non-ASCII characters). */
export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** `W/"abc"` → `"abc"`: `If-Match` requires strong comparison, and most servers store the strong form. */
const strongEtag = (etag: string) => etag.replace(/^W\//i, '').trim()

const timeoutSignal = (ms: number): AbortSignal | undefined => (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(ms) : undefined)

export class WebDavTransport implements SyncTransport {
  readonly kind = 'webdav' as const
  private readonly url: string
  private readonly auth: string | null
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number

  constructor(opts: WebDavOptions) {
    this.url = opts.url.trim()
    const u = opts.username ?? ''
    const p = opts.password ?? ''
    this.auth = u || p ? 'Basic ' + toBase64(`${u}:${p}`) : null
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init) as Promise<FetchResponseLike>)
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.auth ? { authorization: this.auth } : {}), ...extra }
  }

  private request(method: string, headers: Record<string, string>, body?: string): Promise<FetchResponseLike> {
    const init: FetchInit = { method, headers: this.headers(headers), cache: 'no-store' }
    if (body !== undefined) init.body = body
    const signal = timeoutSignal(this.timeoutMs)
    if (signal) init.signal = signal
    return this.fetchImpl(this.url, init)
  }

  private static fail(res: FetchResponseLike): never {
    if (res.status === 401 || res.status === 403) throw new SyncTransportError('unauthorized', `HTTP ${res.status}`)
    throw new SyncTransportError(`http_${res.status}`, `HTTP ${res.status}`)
  }

  async pull(knownToken?: string | null): Promise<PullResult> {
    const res = await this.request('GET', { accept: 'application/json, */*;q=0.8', ...(knownToken ? { 'if-none-match': knownToken } : {}) })
    if (res.status === 404) return { status: 'missing' }
    if (res.status === 304) return { status: 'unchanged' }
    if (res.status < 200 || res.status >= 300) WebDavTransport.fail(res)
    const body = await res.text()
    return { status: 'ok', body, token: strongEtag(res.headers.get('etag') ?? '') }
  }

  async push(body: string, token: string | null): Promise<string> {
    const precondition: Record<string, string> = token === null ? { 'if-none-match': '*' } : token ? { 'if-match': strongEtag(token) } : {}
    const res = await this.request('PUT', { 'content-type': 'application/json; charset=utf-8', ...precondition }, body)
    if (res.status === 412) throw new SyncConflictError()
    if (res.status < 200 || res.status >= 300) WebDavTransport.fail(res)
    const etag = res.headers.get('etag')
    if (etag) return strongEtag(etag)
    // Some servers answer PUT without an ETag: ask for it, otherwise write unconditionally next time.
    try {
      const head = await this.request('HEAD', {})
      if (head.status >= 200 && head.status < 300) return strongEtag(head.headers.get('etag') ?? '')
    } catch {
      /* ignore */
    }
    return ''
  }
}
