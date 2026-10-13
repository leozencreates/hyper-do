/**
 * Auto-update (#18): electron-updater against GitHub Releases (`package.json › build.publish`).
 * Only packaged builds can check; the first check runs 30 s after start, then every 6 h while
 * `settings.autoUpdate` is on. Downloads happen in the background; the update is installed on the next
 * quit or right away through `install()` (Settings / the in-app toast).
 */
import { app } from 'electron'
import updater from 'electron-updater'
import type { UpdateStatus } from '../src/lib/types'

const FIRST_CHECK_MS = 30_000
const INTERVAL_MS = 6 * 3_600_000

export interface UpdaterHost {
  onStatus(s: UpdateStatus): void
  /** Called right before `quitAndInstall` so the close-to-tray handler lets the windows close. */
  beforeInstall(): void
}

export class Updater {
  private status: UpdateStatus = { status: app.isPackaged ? 'idle' : 'unavailable' }
  private first: ReturnType<typeof setTimeout> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private wired = false
  private checking: Promise<UpdateStatus> | null = null

  constructor(private host: UpdaterHost) {}

  get current(): UpdateStatus {
    return this.status
  }

  /** electron-updater creates the platform updater lazily (NSIS / macOS); touched only when it is really used. */
  private get auto() {
    return updater.autoUpdater
  }

  private set(s: UpdateStatus) {
    this.status = s
    this.host.onStatus(s)
  }

  private wire() {
    if (this.wired) return
    this.wired = true
    const a = this.auto
    a.autoDownload = true
    a.autoInstallOnAppQuit = true
    a.logger = console
    a.on('checking-for-update', () => this.set({ status: 'checking' }))
    a.on('update-available', (info) => this.set({ status: 'available', version: info.version }))
    a.on('update-not-available', (info) => this.set({ status: 'not-available', version: info.version }))
    a.on('download-progress', (p) => this.set({ status: 'downloading', version: this.status.version, percent: Math.round(p.percent) }))
    a.on('update-downloaded', (info) => this.set({ status: 'downloaded', version: info.version }))
    a.on('error', (err) => this.set({ status: 'error', error: err?.message || String(err) }))
  }

  /** `settings.autoUpdate` changed: (re)start or stop the periodic checks. */
  setEnabled(on: boolean) {
    if (on) this.start()
    else this.stop()
  }

  start() {
    if (!app.isPackaged) return
    this.stop()
    this.wire()
    this.first = setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), INTERVAL_MS)
  }

  stop() {
    if (this.first) clearTimeout(this.first)
    if (this.timer) clearInterval(this.timer)
    this.first = null
    this.timer = null
  }

  private check(): Promise<UpdateStatus> {
    if (this.checking) return this.checking
    this.checking = (async () => {
      try {
        await this.auto.checkForUpdates()
      } catch (e) {
        this.set({ status: 'error', error: (e as Error)?.message || String(e) })
      } finally {
        this.checking = null
      }
      return this.status
    })()
    return this.checking
  }

  /** Settings → "Check for updates". Resolves with the state once the check (not the download) is over. */
  async checkNow(): Promise<UpdateStatus> {
    if (!app.isPackaged) return this.status
    this.wire()
    if (this.status.status === 'downloaded' || this.status.status === 'downloading') return this.status
    return this.check()
  }

  /** Quits and installs the downloaded update (no-op while nothing is downloaded). */
  install() {
    if (this.status.status !== 'downloaded') return
    this.host.beforeInstall()
    this.auto.quitAndInstall()
  }
}
