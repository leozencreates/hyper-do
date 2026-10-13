/**
 * Mini window (Electron main process, #7).
 *
 * A 340×150 frameless always-on-top card loading the renderer with `?view=mini`. Created lazily,
 * then only hidden/shown; it is never closed by the main window going to the tray. Its position is
 * remembered in `userData/window-state.json` (`{ mini: { x, y } }`); the first time it sits in the
 * bottom-right corner of the primary display's work area. The escalation ladder (#6) also opens it
 * (`show()`), and it stays until the user hides it.
 */
import { BrowserWindow, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const MINI_WIDTH = 340
export const MINI_HEIGHT = 150
const MARGIN = 16
const SAVE_DEBOUNCE_MS = 500

interface WindowState {
  mini?: { x: number; y: number }
}

export interface MiniHost {
  /** Creates the (hidden) renderer window for `?view=mini`. */
  createWindow(): BrowserWindow
  /** Path of the JSON file holding window positions. */
  stateFile(): string
  /** Called on every show / hide (tray checkbox, Settings toggle). */
  onVisible(visible: boolean): void
}

export class MiniWindow {
  private win: BrowserWindow | null = null
  /** `ready-to-show` seen: the renderer has painted, showing it will not flash a blank window. */
  private ready = false
  private wantShow = false
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private host: MiniHost) {}

  get visible(): boolean {
    return this.win !== null && !this.win.isDestroyed() && this.win.isVisible()
  }

  private readState(): WindowState {
    try {
      const s = JSON.parse(fs.readFileSync(this.host.stateFile(), 'utf8')) as unknown
      return s && typeof s === 'object' ? (s as WindowState) : {}
    } catch {
      return {}
    }
  }

  private persistPosition(w: BrowserWindow) {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      if (w.isDestroyed()) return
      const [x, y] = w.getPosition()
      try {
        const file = this.host.stateFile()
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, JSON.stringify({ ...this.readState(), mini: { x, y } }, null, 2), 'utf8')
      } catch (e) {
        console.error('[mini] position save failed:', (e as Error).message)
      }
    }, SAVE_DEBOUNCE_MS)
  }

  /** Saved position if it is still (at least partly) on a display, otherwise bottom-right of the primary work area. */
  private initialPosition(): { x: number; y: number } {
    const saved = this.readState().mini
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
      const onScreen = screen.getAllDisplays().some(({ workArea: a }) => saved.x + MINI_WIDTH > a.x && saved.x < a.x + a.width && saved.y + MINI_HEIGHT > a.y && saved.y < a.y + a.height)
      if (onScreen) return { x: Math.round(saved.x), y: Math.round(saved.y) }
    }
    const a = screen.getPrimaryDisplay().workArea
    return { x: a.x + a.width - MINI_WIDTH - MARGIN, y: a.y + a.height - MINI_HEIGHT - MARGIN }
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const w = this.host.createWindow()
    const { x, y } = this.initialPosition()
    w.setPosition(x, y)
    w.setAlwaysOnTop(true, 'floating')
    w.once('ready-to-show', () => {
      this.ready = true
      if (this.wantShow) this.reveal(w)
    })
    w.on('move', () => this.persistPosition(w))
    w.on('show', () => this.host.onVisible(true))
    w.on('hide', () => this.host.onVisible(false))
    w.on('closed', () => {
      this.win = null
      this.ready = false
    })
    this.win = w
    return w
  }

  /** Shows without stealing keyboard focus from whatever the user is doing. */
  private reveal(w: BrowserWindow) {
    if (!w.isVisible()) w.showInactive()
    w.moveTop()
  }

  show() {
    const w = this.ensure()
    this.wantShow = true
    if (this.ready) this.reveal(w)
  }

  hide() {
    this.wantShow = false
    if (this.visible) this.win!.hide()
  }

  toggle() {
    if (this.visible) this.hide()
    else this.show()
  }

  destroy() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
