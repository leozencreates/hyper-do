/**
 * Platform seçimi:
 *  - Electron: preload'un sağladığı window.tidi köprüsü (Windows / macOS)
 *  - Telegram Mini App: tg.html inside the Telegram client, data on the PC over the tunnel (Phase D)
 *  - Capacitor: yerel Android uygulaması, önceden planlanan yerel bildirimler
 *  - Web: tarayıcı / PWA (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
 */
import { Capacitor } from '@capacitor/core'
import type { HyperDoApi } from './types'
import { createWebApi } from './platform.web'
import { createCapacitorApi } from './platform.capacitor'
import { createTelegramApi } from './platform.telegram'
import { isTelegramMiniApp } from './tg-bridge'

function pick(): HyperDoApi {
  if (window.tidi) return window.tidi
  if (isTelegramMiniApp()) return createTelegramApi()
  if (Capacitor.isNativePlatform()) return createCapacitorApi()
  return createWebApi()
}

export const platform: HyperDoApi = pick()
