/**
 * Telegram Mini App bridge (Phase D5): the thin layer over `window.Telegram.WebApp` that the adapter and the
 * UI share. Every SDK member is optional and every call is guarded — the SDK version on the user's client may
 * lack newer methods (`disableVerticalSwipes`, `BackButton`, `HapticFeedback`, …).
 *
 * Theme: `colorScheme` picks the app's dark / light palette and `themeParams` are mapped onto the app's own
 * CSS variables (backgrounds, text, link) so the UI blends with the client; the brand accent stays.
 */
import { detectLang, type Lang } from './i18n'

export interface TgThemeParams {
  bg_color?: string
  secondary_bg_color?: string
  section_bg_color?: string
  text_color?: string
  hint_color?: string
  subtitle_text_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  destructive_text_color?: string
}

export interface TgBackButton {
  isVisible?: boolean
  show?(): void
  hide?(): void
  onClick?(cb: () => void): void
  offClick?(cb: () => void): void
}

export interface TgWebApp {
  /** Signed launch parameters (query string); '' outside Telegram. */
  initData?: string
  initDataUnsafe?: { user?: { id?: number; language_code?: string } }
  version?: string
  platform?: string
  colorScheme?: 'light' | 'dark'
  themeParams?: TgThemeParams
  ready?(): void
  expand?(): void
  disableVerticalSwipes?(): void
  onEvent?(name: string, cb: () => void): void
  offEvent?(name: string, cb: () => void): void
  BackButton?: TgBackButton
  HapticFeedback?: { notificationOccurred?(type: 'error' | 'success' | 'warning'): void }
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp }
  }
}

export const tgWebApp = (): TgWebApp | null => (typeof window !== 'undefined' ? (window.Telegram?.WebApp ?? null) : null)

/** True when the page runs inside Telegram with signed launch data (what `platform.ts` checks). */
export function isTelegramMiniApp(): boolean {
  const wa = tgWebApp()
  return typeof wa?.initData === 'string' && wa.initData.length > 0
}

export const tgInitData = (): string => tgWebApp()?.initData ?? ''

/** App language for screens shown before the data (and its `settings.language`) arrived: the Telegram user's, else the device's. */
export function tgLang(): Lang {
  const code = (tgWebApp()?.initDataUnsafe?.user?.language_code ?? '').toLowerCase()
  if (code.startsWith('ru')) return 'ru'
  if (code.startsWith('tr')) return 'tr'
  if (code.startsWith('en')) return 'en'
  return detectLang()
}

const HEX = /^#[0-9a-f]{6}$/i
const THEME_VARS: [keyof TgThemeParams, string][] = [
  ['bg_color', '--bg'],
  ['secondary_bg_color', '--bg-2'],
  ['section_bg_color', '--bg-3'],
  ['text_color', '--text'],
  ['hint_color', '--text-2'],
  ['subtitle_text_color', '--text-3'],
  ['link_color', '--sky'],
  ['button_color', '--tg-button'],
  ['button_text_color', '--tg-button-text'],
  ['destructive_text_color', '--danger'],
]

/** `data-theme` from `colorScheme` and the client's colours on the app's CSS variables (missing ones fall back to the palette). */
export function applyTelegramTheme(wa: TgWebApp | null = tgWebApp()): void {
  const root = document.documentElement
  root.dataset.theme = wa?.colorScheme === 'light' ? 'light' : 'dark'
  const p: TgThemeParams = { ...(wa?.themeParams ?? {}) }
  if (!HEX.test(p.section_bg_color ?? '')) p.section_bg_color = p.secondary_bg_color
  if (!HEX.test(p.subtitle_text_color ?? '')) p.subtitle_text_color = p.hint_color
  for (const [key, cssVar] of THEME_VARS) {
    const v = p[key]
    if (v && HEX.test(v)) root.style.setProperty(cssVar, v)
    else root.style.removeProperty(cssVar)
  }
}

/** Marks the document, applies the theme (and follows `themeChanged`), tells Telegram the app is ready and expands it. */
export function setupTelegram(): TgWebApp | null {
  const wa = tgWebApp()
  if (!wa) return null
  document.documentElement.classList.add('tg')
  applyTelegramTheme(wa)
  try {
    wa.onEvent?.('themeChanged', () => applyTelegramTheme(wa))
  } catch {
    /* older SDK */
  }
  for (const call of [() => wa.ready?.(), () => wa.expand?.(), () => wa.disableVerticalSwipes?.()]) {
    try {
      call()
    } catch {
      /* older SDK */
    }
  }
  return wa
}

// ---- BackButton: shown while any modal is open; the top-most modal closes on tap ----
const backStack: (() => void)[] = []
let backBound = false
const onBack = () => backStack[backStack.length - 1]?.()

/** Registers a modal: shows the BackButton and makes it close this modal. Returns the release function (hide when none is left). */
export function pushBackButton(onClose: () => void): () => void {
  const bb = tgWebApp()?.BackButton
  if (!bb) return () => {}
  backStack.push(onClose)
  try {
    if (!backBound) {
      bb.onClick?.(onBack)
      backBound = true
    }
    bb.show?.()
  } catch {
    /* older SDK */
  }
  return () => {
    const i = backStack.lastIndexOf(onClose)
    if (i >= 0) backStack.splice(i, 1)
    if (backStack.length === 0) {
      try {
        bb.hide?.()
      } catch {
        /* older SDK */
      }
    }
  }
}

/** Haptic tick (task completed → `success`); silent where unsupported. */
export function tgHaptic(type: 'error' | 'success' | 'warning'): void {
  try {
    tgWebApp()?.HapticFeedback?.notificationOccurred?.(type)
  } catch {
    /* older SDK */
  }
}
