/**
 * Global quick-add popup (Electron main process).
 *
 * A small frameless always-on-top window loading the renderer with `?view=quick`. It is created
 * lazily on first use and then only hidden/shown. Opened by the global shortcut
 * (`settings.quickAddShortcut`) or the tray menu; hidden on blur, on Esc and after a successful add
 * (the renderer asks via `tidi:quick-hide`). The shortcut registration result is reported through
 * `onStatus` so Settings can show "already in use" / "invalid accelerator".
 */
import { BrowserWindow, globalShortcut, screen } from 'electron'
import type { ShortcutStatus } from '../src/lib/types'

export const QUICK_WIDTH = 560
export const QUICK_HEIGHT = 120

export interface QuickHost {
  /** Creates the (hidden) renderer window for `?view=quick`. */
  createWindow(): BrowserWindow
  /** Called whenever the shortcut is (re)registered. */
  onStatus(status: ShortcutStatus): void
}

export class QuickAddPopup {
  private win: BrowserWindow | null = null
  private status: ShortcutStatus = { ok: true, accelerator: '' }
  /** Windows may fire a spurious `blur` right after `show()` when focus is not granted yet; ignore it briefly. */
  private shownAt = 0

  constructor(private host: QuickHost) {}

  get shortcutStatus(): ShortcutStatus {
    return this.status
  }

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const w = this.host.createWindow()
    w.on('blur', () => {
      if (Date.now() - this.shownAt < 400) {
        w.focus()
        return
      }
      this.hide()
    })
    w.on('closed', () => {
      this.win = null
    })
    this.win = w
    return w
  }

  /** Shows the popup centred (slightly above the middle) on the display under the mouse cursor. */
  show() {
    const w = this.ensure()
    const { x, y, width, height } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const [ww, wh] = w.getSize()
    w.setPosition(Math.round(x + (width - ww) / 2), Math.round(y + (height - wh) / 2.6))
    this.shownAt = Date.now()
    w.show()
    w.moveTop()
    w.focus()
    w.webContents.send('tidi:quick-shown')
  }

  hide() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide()
  }

  toggle() {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.hide()
    else this.show()
  }

  /**
   * (Re)registers the global shortcut; an empty accelerator turns it off.
   * `globalShortcut.register` returns false when another app owns the combination and throws
   * for an invalid accelerator string — both end up as `ok: false` for Settings.
   */
  registerShortcut(accelerator: string): ShortcutStatus {
    globalShortcut.unregisterAll()
    const acc = accelerator.trim()
    let status: ShortcutStatus
    if (!acc) {
      status = { ok: true, accelerator: '' }
    } else {
      try {
        status = globalShortcut.register(acc, () => this.toggle()) ? { ok: true, accelerator: acc } : { ok: false, accelerator: acc }
      } catch (e) {
        status = { ok: false, accelerator: acc, error: (e as Error).message }
      }
    }
    this.status = status
    this.host.onStatus(status)
    return status
  }

  destroy() {
    globalShortcut.unregisterAll()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }
}
