/**
 * Platform seçimi:
 *  - Electron: preload'un sağladığı window.tidi köprüsü (Windows / macOS)
 *  - Capacitor: yerel Android uygulaması, önceden planlanan yerel bildirimler
 *  - Web: tarayıcı / PWA (iPhone, iPad, Mac Safari, herhangi bir tarayıcı)
 */
import { Capacitor } from '@capacitor/core'
import type { HyperDoApi } from './types'
import { createWebApi } from './platform.web'
import { createCapacitorApi } from './platform.capacitor'
import { createExtensionApi, isExtension } from './platform.extension'

function pick(): HyperDoApi {
  if (window.tidi) return window.tidi
  if (isExtension()) return createExtensionApi()
  if (Capacitor.isNativePlatform()) return createCapacitorApi()
  return createWebApi()
}

export const platform: HyperDoApi = pick()
