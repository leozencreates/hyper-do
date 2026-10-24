/**
 * Platform seçimi:
 *  - Electron: preload'un sağladığı window.tidi köprüsü (Windows / macOS)
 *  - Telegram Mini App: tg.html inside the Telegram client, data on the PC over the tunnel (Phase D)
 *  - Capacitor: yerel Android uygulaması, önceden planlanan yerel bildirimler
 *  - Web: tarayıcı / PWA (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
 * Every platform except the Mini App gets the IndexedDB attachment store (`media`).
 */
import { Capacitor } from '@capacitor/core'
import type { HyperDoApi } from './types'
import { createWebApi } from './platform.web'
import { createCapacitorApi } from './platform.capacitor'
import { createTelegramApi } from './platform.telegram'
import { createMediaStore } from './platform.media'
import { isTelegramMiniApp } from './tg-bridge'

function pick(): HyperDoApi {
  // window.tidi comes through contextBridge (frozen), so it is copied before adding `media`
  if (window.tidi) return { ...window.tidi, media: createMediaStore() }
  if (isTelegramMiniApp()) return createTelegramApi()
  if (Capacitor.isNativePlatform()) return { ...createCapacitorApi(), media: createMediaStore() }
  return { ...createWebApi(), media: createMediaStore() }
}

export const platform: HyperDoApi = pick()
