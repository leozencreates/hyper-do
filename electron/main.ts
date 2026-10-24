import { app, BrowserWindow, dialog, ipcMain, Notification, Tray, Menu, nativeImage, powerMonitor, shell, type BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AppData, BackupInfo, MiniAppMode, MiniAppStatus, Task } from '../src/lib/types'
import { activeFocusTaskId, reminderSummary, buildNotification, collectDueReminders, escalationLevel, markNagged, resetNag, syncCounters } from '../src/lib/reminder'
import { bumpChanged, snoozeTask, taskFromQuickAdd, touchTask } from '../src/lib/tasks'
import { SyncEngine } from '../src/lib/syncengine'
import { WebDavTransport } from '../src/lib/synctransport'
import { FolderTransport } from './syncfolder'
import { completeInData } from '../src/lib/stats'
import { splitBrainDump } from '../src/lib/parse'
import { DEEP_LINK_SCHEME, deepLinkUrl, findDeepLinkArg, parseDeepLink, reminderToastXml } from '../src/lib/deeplink'
import { translate } from '../src/lib/i18n'
import { normalizeData, parseAppData } from '../src/lib/data'
import { buildDigest, digestDue, markDigestSent, parseDigestState, type DigestState } from '../src/lib/digest'
import { CalendarSync } from '../src/lib/calsync'
import { TelegramBot } from './telegram'
import { googleLoginDesktop } from './calendar'
import { QUICK_HEIGHT, QUICK_WIDTH, QuickAddPopup } from './quick'
import { MINI_HEIGHT, MINI_WIDTH, MiniWindow } from './mini'
import { Updater } from './updater'
import { startMiniAppServer, type MiniAppServer } from './miniapp-server'
import { ensureCloudflared, startQuickTunnel, type Tunnel } from './tunnel'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- Uygulama ikonu ----
// Paketli sürümde electron-builder ikonu resources/icon.ico olarak kopyalar (extraResources);
// geliştirmede build/icon.ico kullanılır. Pencereye açıkça ikon verilmezse Windows görev çubuğu
// ikonu AppUserModelID kısayol önbelleğinden arar; önbellek bozuksa boş belge simgesi görünür.
function appIconPath() {
  const packaged = path.join(process.resourcesPath, 'icon.ico')
  if (app.isPackaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '../build/icon.ico')
}

// ---- Kalıcı depolama: userData/hyperdo-data.json ----
const dataFile = () => path.join(app.getPath('userData'), 'hyperdo-data.json')

function loadData(): AppData {
  try {
    return parseAppData(fs.readFileSync(dataFile(), 'utf8'))
  } catch {
    return normalizeData(null)
  }
}

function saveData(d: AppData) {
  const file = dataFile()
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8')
  fs.renameSync(tmp, file) // atomik yazma: yarım dosya kalmaz
}

// ---- Otomatik yedek: userData/backups/hyperdo-data-YYYY-MM-DD.json (yerel tarih), en yeni 7 tutulur ----
const backupsDir = () => path.join(app.getPath('userData'), 'backups')
const BACKUP_RE = /^hyperdo-data-\d{4}-\d{2}-\d{2}\.json$/
const BACKUPS_KEEP = 7

function localDateStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Backup file names, newest first (the date is in the name, so sorting by name is sorting by day). */
function listBackups(): string[] {
  try {
    return fs
      .readdirSync(backupsDir())
      .filter((f) => BACKUP_RE.test(f))
      .sort()
      .reverse()
  } catch {
    return []
  }
}

/** First save of a calendar day: copy the data file as it is *before* the write; prune to the newest 7. */
function maybeBackup() {
  const file = dataFile()
  if (!fs.existsSync(file)) return
  const dir = backupsDir()
  const target = path.join(dir, `hyperdo-data-${localDateStamp()}.json`)
  if (fs.existsSync(target)) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(file, target)
    for (const old of listBackups().slice(BACKUPS_KEEP)) fs.rmSync(path.join(dir, old), { force: true })
  } catch (e) {
    console.error('[backup] failed:', (e as Error).message)
  }
}

function backupInfo(): BackupInfo {
  const dir = backupsDir()
  const newest = listBackups()[0]
  let lastAt: number | null = null
  if (newest) {
    try {
      lastAt = fs.statSync(path.join(dir, newest)).mtimeMs
    } catch {
      /* raced with a delete */
    }
  }
  return { dir, lastAt }
}

// ---- Oturum açınca başlat (--hidden: pencere oluşturulur ama gösterilmez) ----
function applyLoginItem(on: boolean) {
  // In development this would register the bare electron binary; only the packaged app registers itself.
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] })
  } catch (e) {
    console.error('[login-item] failed:', (e as Error).message)
  }
}

let data: AppData = normalizeData(null)
/** Revision counter (Phase D): +1 on every commit, any source; the Mini App polls it to learn about changes. */
let rev = 0
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false
/** Set once the data is loaded and the windows exist; deep links arriving earlier wait in `pendingDeepLink`. */
let ready = false
let pendingDeepLink: string | null = null

// Son bildirim zamanı bellekte tutulur; uygulama yeniden açıldığında
// bekleyen görevler kısa süre içinde tekrar hatırlatılır.
const lastNotified = new Map<string, number>()

/** Sends to every live renderer window (main, quick-add popup, mini), optionally skipping one webContents. */
function broadcast(channel: string, payload: unknown, exceptId?: number) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w.webContents.id !== exceptId) w.webContents.send(channel, payload)
  }
}

/**
 * Yeni veriyi uygular: günün ilk kaydında yedek alır, hatırlatma sayaçlarını eşler, diske yazar,
 * değişen ayarları (dil, kısayol, oturum açılışı) uygular ve kaydı gönderen pencere dışındaki
 * tüm pencerelere bildirir (gönderene geri yansıtılmaz: yoldaki daha yeni düzenlemeleri ezmesin).
 *
 * `updatedAt` safety net (#16): changes made here in the main process (Telegram, deep links, nag counters,
 * quick add) replace task objects without necessarily stamping them, so every replaced object is bumped
 * (`bump`, default on). Renderer saves arrive already stamped (and as fresh objects), and the sync engine's
 * own merge result must keep the timestamps it negotiated — both pass `bump: false`.
 */
function commit(next: AppData, opts: { senderId?: number; bump?: boolean } = {}) {
  const bump = opts.bump ?? opts.senderId === undefined
  if (bump && next.tasks !== data.tasks) next = { ...next, tasks: bumpChanged(data.tasks, next.tasks) }
  syncCounters(data.tasks, next.tasks, lastNotified)
  const prev = data
  data = next
  rev++
  if (next.settings.autoBackup) maybeBackup()
  saveData(data)
  if (prev.settings.language !== next.settings.language) buildTrayMenu()
  if (prev.settings.launchAtLogin !== next.settings.launchAtLogin) applyLoginItem(next.settings.launchAtLogin)
  if (prev.settings.quickAddShortcut !== next.settings.quickAddShortcut) quick.registerShortcut(next.settings.quickAddShortcut)
  if (prev.settings.autoUpdate !== next.settings.autoUpdate) updater.setEnabled(next.settings.autoUpdate)
  broadcast('tidi:data-changed', data, opts.senderId)
  telegram.onDataChanged(prev, data) // B2: completed / deleted tasks update their live Telegram messages (never mutates)
  sync.onDataSaved() // #16: debounced upload (ignores the save caused by its own merge)
}

// ---- Platform state (not AppData, not in backups): userData/hyperdo-state.json — digest timestamps (#17) ----
const stateFile = () => path.join(app.getPath('userData'), 'hyperdo-state.json')
let digestState: DigestState = { lastDigestAt: null, lastEveningAt: null }

function loadDigestState(): DigestState {
  try {
    return parseDigestState(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    return parseDigestState(null)
  }
}

function saveDigestState(s: DigestState) {
  try {
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true })
    fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2), 'utf8')
  } catch (e) {
    console.error('[digest] state save failed:', (e as Error).message)
  }
}

/** Morning digest / evening review (#17): once per local day as a toast and, when linked, a Telegram message. */
function checkDigest(now: number) {
  const kind = digestDue(data.settings, digestState, now)
  if (!kind) return
  digestState = markDigestSent(digestState, kind, now)
  saveDigestState(digestState)
  const d = buildDigest(data, now, data.settings.language, kind)
  try {
    const n = new Notification({ title: d.title, body: d.body })
    n.on('click', showWindow)
    n.show()
  } catch (e) {
    console.error('[digest] toast failed:', (e as Error).message)
  }
  void telegram.sendDigest(kind)
}

/** B3: seconds since the last input; `Infinity` while the session is locked (powerMonitor is ready-only). */
let sessionLocked = false
function idleSeconds(): number {
  if (sessionLocked) return Infinity
  try {
    return powerMonitor.getSystemIdleTime()
  } catch {
    return Infinity
  }
}

/** Ayarlar değişmiş olabilir: Telegram botunu, takvim motorunu ve Mini App sunucusunu yeni duruma göre uyar. */
function afterSave() {
  telegram.sync()
  calendar.onDataSaved()
  void applyMiniApp()
}

// ---- Takvim senkronu: Google + ICS akışları. Token ve görev→etkinlik eşlemesi ayrı dosyada tutulur
//      (yedeğe girmez): userData/hyperdo-calendar.json ----
const calendarFile = () => path.join(app.getPath('userData'), 'hyperdo-calendar.json')
const calendar = new CalendarSync({
  getData: () => data,
  mutate: (fn) => commit(fn(data)),
  loadState() {
    try {
      return fs.readFileSync(calendarFile(), 'utf8')
    } catch {
      return null
    }
  },
  saveState(json) {
    try {
      fs.mkdirSync(path.dirname(calendarFile()), { recursive: true })
      fs.writeFileSync(calendarFile(), json, 'utf8')
    } catch (e) {
      console.error('[calendar] state save failed:', (e as Error).message)
    }
  },
  onEvents: (events) => broadcast('tidi:cal-events', events),
  onStatus: (status) => broadcast('tidi:cal-status', status),
  googleSupported: true,
})

// ---- Cihazlar arası eşitleme (#16): paylaşılan klasör ya da WebDAV. Cihaz kimliği, son jeton ve WebDAV
//      kullanıcı adı/parolası ayrı dosyada (yedeğe girmez): userData/hyperdo-sync.json ----
const syncFile = () => path.join(app.getPath('userData'), 'hyperdo-sync.json')
const sync = new SyncEngine({
  getData: () => data,
  mutate: (fn) => commit(fn(data), { bump: false }),
  transport(s, creds) {
    if (s.mode === 'folder') return s.folder.trim() ? new FolderTransport(s.folder.trim()) : null
    if (s.mode === 'webdav') return s.webdavUrl.trim() ? new WebDavTransport({ url: s.webdavUrl, username: creds.username, password: creds.password }) : null
    return null
  },
  loadState() {
    try {
      return fs.readFileSync(syncFile(), 'utf8')
    } catch {
      return null
    }
  },
  saveState(json) {
    try {
      fs.mkdirSync(path.dirname(syncFile()), { recursive: true })
      fs.writeFileSync(syncFile(), json, 'utf8')
    } catch (e) {
      console.error('[sync] state save failed:', (e as Error).message)
    }
  },
  onStatus: (status) => broadcast('tidi:sync-status', status),
})

// ---- Telegram botu: veriyi okur; komutla değiştirdiğinde kaydeder ve arayüzü günceller;
//      durumunu (çalışıyor / hata / eşleştirme) ayarlar paneline iletir. Mesaj defteri: userData/hyperdo-telegram.json ----
const telegramFile = () => path.join(app.getPath('userData'), 'hyperdo-telegram.json')
const telegram = new TelegramBot({
  getData: () => data,
  mutate(fn) {
    commit(fn(data))
    afterSave()
  },
  onStatus: (s) => broadcast('tidi:tg-status', s),
  idleSeconds,
  // live reminder / card per task + message → task map survive restarts (not part of backups)
  loadMessages() {
    try {
      return fs.readFileSync(telegramFile(), 'utf8')
    } catch {
      return null
    }
  },
  saveMessages(json) {
    try {
      fs.mkdirSync(path.dirname(telegramFile()), { recursive: true })
      fs.writeFileSync(telegramFile(), json, 'utf8')
    } catch (e) {
      console.error('[telegram] message state save failed:', (e as Error).message)
    }
  },
})

// ---- Telegram Mini App (Phase D): local server (dist-web + /api) + tunnel; the public URL feeds the bot's
//      ☰ menu button and the "📱 Open in app" rows. Settings → Telegram → Mini App drives it through settings.miniApp.
const MINI_BACKOFF_MIN = 5_000
const MINI_BACKOFF_MAX = 60_000
let miniStatus: MiniAppStatus = { state: 'off', url: '', port: 0, progress: null, error: null }
let miniServer: MiniAppServer | null = null
let miniTunnel: Tunnel | null = null
let miniTimer: NodeJS.Timeout | null = null
let miniBackoff = MINI_BACKOFF_MIN
/** Mode the running setup was started for ('off' = nothing running). */
let miniMode: MiniAppMode = 'off'
/** Generation counter: results of async steps started before a stop / restart are ignored. */
let miniGen = 0

function setMiniStatus(patch: Partial<MiniAppStatus>) {
  miniStatus = { ...miniStatus, ...patch }
  broadcast('tidi:miniapp-status', miniStatus)
}

/** The web build next to the Electron build: `<app>/dist-web` when packaged (package.json › build.files), the repo folder in dev. */
const miniStaticDir = () => (app.isPackaged ? path.join(app.getAppPath(), 'dist-web') : path.join(__dirname, '../dist-web'))
const miniBinDir = () => path.join(app.getPath('userData'), 'bin')

async function stopMiniApp() {
  miniGen++
  if (miniTimer) {
    clearTimeout(miniTimer)
    miniTimer = null
  }
  miniTunnel?.stop()
  miniTunnel = null
  const server = miniServer
  miniServer = null
  if (server) await server.close()
  miniMode = 'off'
  telegram.setMiniAppUrl(null)
  setMiniStatus({ state: 'off', url: '', port: 0, progress: null, error: null })
}

/** Spawns the quick tunnel; when it dies while the mode is still `cloudflare`, respawns with 5 s → 60 s backoff. */
function spawnTunnel(gen: number, bin: string, port: number) {
  if (gen !== miniGen) return
  setMiniStatus({ state: 'starting', url: '', progress: null, error: null })
  miniTunnel = startQuickTunnel({
    bin,
    port,
    onUrl(url) {
      if (gen !== miniGen) return
      miniBackoff = MINI_BACKOFF_MIN
      setMiniStatus({ state: 'up', url, error: null })
      telegram.setMiniAppUrl(url)
    },
    onExit(code) {
      if (gen !== miniGen) return // stopped on purpose
      miniTunnel = null
      telegram.setMiniAppUrl(null)
      const delay = miniBackoff
      miniBackoff = Math.min(MINI_BACKOFF_MAX, miniBackoff * 2)
      setMiniStatus({ state: 'error', url: '', error: translate(data.settings.language, 'miniapp_err_exit', { code: code ?? '?', s: Math.round(delay / 1000) }) })
      miniTimer = setTimeout(() => {
        miniTimer = null
        spawnTunnel(gen, bin, port)
      }, delay)
    },
    onLog: (line) => {
      if (process.env.HYPERDO_DEBUG) console.log('[cloudflared]', line)
    },
  })
}

async function startMiniApp() {
  const { mode, publicUrl } = data.settings.miniApp
  const gen = ++miniGen
  miniMode = mode
  const dir = miniStaticDir()
  if (!fs.existsSync(path.join(dir, 'tg.html'))) {
    setMiniStatus({ state: 'error', url: '', port: 0, progress: null, error: translate(data.settings.language, 'miniapp_err_build') })
    return
  }
  let server: MiniAppServer
  try {
    server = await startMiniAppServer({
      getData: () => data,
      rev: () => rev,
      mutate(fn) {
        // the merge result keeps the timestamps it negotiated with the phone (like the sync engine)
        commit(fn(data), { bump: false })
        afterSave()
      },
      staticDir: dir,
    })
  } catch (e) {
    if (gen === miniGen) setMiniStatus({ state: 'error', url: '', port: 0, progress: null, error: (e as Error).message })
    return
  }
  if (gen !== miniGen) {
    await server.close() // stopped while starting
    return
  }
  miniServer = server
  setMiniStatus({ state: 'starting', port: server.port, url: '', progress: null, error: null })
  if (mode === 'manual') {
    // the user runs the tunnel: the port is what they need; the URL may come later (same server, see applyMiniApp)
    setMiniStatus({ state: publicUrl ? 'up' : 'starting', url: publicUrl })
    telegram.setMiniAppUrl(publicUrl || null)
    return
  }
  let bin: string
  try {
    bin = await ensureCloudflared(miniBinDir(), (p) => {
      if (gen === miniGen) setMiniStatus({ state: 'downloading', progress: p })
    })
  } catch (e) {
    if (gen === miniGen) setMiniStatus({ state: 'error', progress: null, error: (e as Error).message })
    return
  }
  if (gen !== miniGen) return
  miniBackoff = MINI_BACKOFF_MIN
  spawnTunnel(gen, bin, server.port)
}

/** Follows `settings.miniApp` (launch + every save): idempotent while the mode is unchanged; a manual URL edit keeps the server. */
async function applyMiniApp() {
  const { mode, publicUrl } = data.settings.miniApp
  if (mode !== miniMode) {
    await stopMiniApp()
    if (mode !== 'off') await startMiniApp()
    return
  }
  if (mode === 'manual' && miniServer && publicUrl !== miniStatus.url) {
    setMiniStatus({ state: publicUrl ? 'up' : 'starting', url: publicUrl, error: null })
    telegram.setMiniAppUrl(publicUrl || null)
  }
}

/** "Restart tunnel" button: everything down and up again in the current mode (also retries after an error). */
async function restartMiniApp() {
  await stopMiniApp()
  await applyMiniApp()
}

// ---- Pencereler: ana, hızlı ekleme ve mini pencere aynı renderer'ı ?view= ile yükler ----
type RendererView = 'main' | 'quick' | 'mini'

function createRendererWindow(view: RendererView, options: BrowserWindowConstructorOptions): BrowserWindow {
  const w = new BrowserWindow({
    backgroundColor: '#0f1117',
    icon: appIconPath(),
    autoHideMenuBar: true,
    ...options,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...options.webPreferences,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    void w.loadURL(process.env.VITE_DEV_SERVER_URL + '?view=' + view)
  } else {
    void w.loadFile(path.join(__dirname, '../dist/index.html'), { query: { view } })
  }

  // Dış bağlantılar ("Takvime ekle" vb.) sistem tarayıcısında açılır, yeni Electron penceresi değil.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Kapat = gizle (macOS'ta Dock'ta kalır). Hatırlatmalar çalışmaya devam eder.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      w.hide()
    }
  })
  return w
}

function createMainWindow(show: boolean) {
  win = createRendererWindow('main', {
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    title: 'Hyper Do',
    show,
  })
  win.on('focus', () => win?.flashFrame(false))
}

function showWindow() {
  if (!win) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

/** Shows the main window and highlights a task in it. */
function openTask(taskId: string) {
  showWindow()
  win?.webContents.send('tidi:focus-task', taskId)
}

// ---- Hızlı ekleme penceresi + global kısayol ----
const quick = new QuickAddPopup({
  createWindow: () =>
    createRendererWindow('quick', {
      width: QUICK_WIDTH,
      height: QUICK_HEIGHT,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: '#161a23',
      title: 'Hyper Do — Quick add',
    }),
  onStatus: (s) => broadcast('tidi:shortcut-status', s),
})

// ---- Mini pencere: her zaman üstte küçük kart (odak görevi, Hyper Focus, Bitirdim / Sustur) ----
const mini = new MiniWindow({
  createWindow: () =>
    createRendererWindow('mini', {
      width: MINI_WIDTH,
      height: MINI_HEIGHT,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: '#161a23',
      title: 'Hyper Do — Mini',
    }),
  stateFile: () => path.join(app.getPath('userData'), 'window-state.json'),
  onVisible(visible) {
    buildTrayMenu() // the "Mini window" checkbox follows the real state
    broadcast('tidi:mini-visible', visible)
  },
})

// ---- Otomatik güncelleme (#18): GitHub Releases; durum tüm pencerelere tidi:update-status ile gider ----
const updater = new Updater({
  onStatus: (s) => broadcast('tidi:update-status', s),
  beforeInstall() {
    quitting = true // the close-to-tray handler must let quitAndInstall close the windows
  },
})

// ---- Tepsi simgesi: gerçek logo; ikon dosyası okunamazsa programatik turuncu daire ----
function trayIcon() {
  const fromFile = nativeImage.createFromPath(appIconPath())
  if (!fromFile.isEmpty()) return fromFile.resize({ width: 16, height: 16 })
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5
      const dy = y - 7.5
      const inside = dx * dx + dy * dy <= 7.5 * 7.5
      const i = (y * size + x) * 4
      // BGRA
      buf[i] = 61
      buf[i + 1] = 138
      buf[i + 2] = 255
      buf[i + 3] = inside ? 255 : 0
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}

function buildTrayMenu() {
  const lang = data.settings.language
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: translate(lang, 'tray_open'), click: showWindow },
      { label: translate(lang, 'tray_quick'), click: () => quick.show() },
      { label: translate(lang, 'tray_mini'), type: 'checkbox', checked: mini.visible, click: () => mini.toggle() },
      { type: 'separator' },
      {
        label: translate(lang, 'tray_quit'),
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
}

function createTray() {
  tray = new Tray(trayIcon())
  tray.setToolTip('Hyper Do')
  buildTrayMenu()
  tray.on('click', showWindow)
}

// ---- Derin bağlantılar: hyperdo://task/<id>/done | snooze/<dk> | open ----
//      Windows bildirim düğmeleri, second-instance (komut satırı), open-url (macOS) ve ilk açılış argv'si.
function handleDeepLink(url: string) {
  const link = parseDeepLink(url)
  if (!link) return
  const task = data.tasks.find((t) => t.id === link.taskId)
  if (!task) {
    if (link.action === 'open') showWindow()
    return
  }
  if (link.action === 'done') {
    if (task.completedAt === null) {
      commit(completeInData(data, task.id))
      afterSave()
    }
  } else if (link.action === 'snooze') {
    const now = Date.now()
    const until = now + (link.minutes ?? 30) * 60_000
    commit({ ...data, tasks: data.tasks.map((x) => (x.id === task.id ? snoozeTask(x, { snoozedUntil: until }, now) : x)) })
    afterSave()
  } else {
    openTask(task.id)
  }
}

function registerProtocol() {
  if (process.defaultApp) {
    // dev: `electron .` → the handler must launch electron with the project path
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

// ---- Hatırlatma bildirimi: Windows'ta düğmeli toast (Done / 30 dk / Aç), diğerlerinde macOS action'ları ----
function showReminder(task: Task, title: string, body: string, critical: boolean) {
  const lang = data.settings.language
  const labels = { done: translate(lang, 'tg_btn_done'), snooze: translate(lang, 'notif_snooze_30'), open: translate(lang, 'notif_open') }
  const urgency = critical ? 'critical' : 'normal'
  const plain = () =>
    new Notification({
      title,
      body,
      urgency,
      timeoutType: 'never',
      actions: [
        { type: 'button', text: labels.done },
        { type: 'button', text: labels.snooze },
      ],
    })

  let n: Notification
  if (process.platform === 'win32') {
    n = new Notification({ toastXml: reminderToastXml(task.id, title, body, labels) })
    // Should the XML be rejected (Windows build without toast support), fall back to the plain toast.
    n.once('failed', (_e, err) => {
      console.error('[notify] toastXml failed, falling back:', err)
      const p = plain()
      p.on('click', () => openTask(task.id))
      p.show()
    })
  } else {
    n = plain()
  }
  // macOS buttons (Windows buttons go through the protocol links instead)
  n.on('action', (details) => handleDeepLink(deepLinkUrl(task.id, details.actionIndex === 0 ? 'done' : 'snooze', 30)))
  n.on('click', () => openTask(task.id)) // fallback when the OS does not pass the launch argument through
  n.show()
}

// ---- Hatırlatma motoru + tırmanma merdiveni (#6) ----
//      Bildirim mevcut nagCount ile kurulur ("3 kez görmezden geldin"), sonra sayaç artar.
function tick() {
  const now = Date.now()
  checkDigest(now)
  const hits = collectDueReminders(data.tasks, data.settings, lastNotified, now, activeFocusTaskId(data, now))
  if (hits.length === 0) return
  let popup = false
  const grouped = data.settings.groupReminders && hits.length > 1
  if (grouped) {
    const summary = reminderSummary(hits)
    const notification = new Notification(summary)
    notification.on('click', () => showWindow())
    notification.show()
    void telegram.remindGroup(hits.map((h) => h.task))
  }
  for (const { task, overdue } of hits) {
    const level = escalationLevel(task, data.settings)
    const { title, body } = buildNotification(task, overdue, data.settings, now)
    if (!grouped) {
      showReminder(task, title, body, overdue || task.priority === 'high' || level >= 2)
      void telegram.remind(task, title, body)
    }
    if (level >= 2) popup = true

    if (data.settings.flashWindow && win) win.flashFrame(true)
    if (data.settings.showWindowOnRemind) showWindow()
    win?.webContents.send('tidi:reminded', task.id)
  }
  // popupAfter reached: the mini window comes up on top of everything and stays until hidden by the user
  if (popup) mini.show()
  commit({ ...data, tasks: markNagged(data.tasks, hits.map((h) => h.task.id)) })
}

// ---- IPC ----
ipcMain.handle('tidi:load', () => data)
ipcMain.handle('tidi:save', (e, incoming: AppData) => {
  commit(incoming, { senderId: e.sender.id })
  afterSave()
})
ipcMain.handle('tidi:telegram-test', () => telegram.test())
ipcMain.handle('tidi:tg-status', () => telegram.status())

// ---- Hızlı ekleme / kısayol / yedek IPC (HyperDoApi.desktop) ----
ipcMain.handle('tidi:quick-add', (_e, text: unknown): { ok: boolean; title?: string } => {
  // Several lines (brain dump pasted into the popup) → one task per line, first line on top.
  const created: Task[] = []
  for (const line of splitBrainDump(typeof text === 'string' ? text : '').reverse()) {
    const task = taskFromQuickAdd(line, data.settings, { tasks: [...data.tasks, ...created] })
    if (task) created.push(task)
  }
  if (created.length === 0) return { ok: false }
  created.reverse()
  commit({ ...data, tasks: [...created, ...data.tasks] })
  afterSave()
  return { ok: true, title: created.length === 1 ? created[0].title : translate(data.settings.language, 'qa_many', { n: created.length }) }
})
ipcMain.handle('tidi:quick-hide', () => quick.hide())
// Mini pencere (HyperDoApi.desktop)
ipcMain.handle('tidi:mini-toggle', () => mini.toggle())
ipcMain.handle('tidi:mini-hide', () => mini.hide())
ipcMain.handle('tidi:mini-visible', () => mini.visible)
ipcMain.handle('tidi:show-main', () => showWindow())
ipcMain.handle('tidi:shortcut-status', () => quick.shortcutStatus)
ipcMain.handle('tidi:backup-info', () => backupInfo())
ipcMain.handle('tidi:open-backups', async () => {
  const dir = backupsDir()
  fs.mkdirSync(dir, { recursive: true })
  await shell.openPath(dir)
})
// Otomatik güncelleme (HyperDoApi.desktop)
ipcMain.handle('tidi:update-status', () => updater.current)
ipcMain.handle('tidi:update-check', () => updater.checkNow())
ipcMain.handle('tidi:update-install', () => updater.install())
ipcMain.handle('tidi:app-version', () => app.getVersion())
// Telegram Mini App (HyperDoApi.desktop)
ipcMain.handle('tidi:miniapp-status', () => miniStatus)
ipcMain.handle('tidi:miniapp-restart', () => restartMiniApp())

// ---- Eşitleme IPC (HyperDoApi.sync) ----
ipcMain.handle('tidi:sync-status', () => sync.status())
ipcMain.handle('tidi:sync-now', () => sync.syncNow())
ipcMain.handle('tidi:sync-set-credentials', (_e, creds: { username?: unknown; password?: unknown }) => {
  sync.setCredentials(typeof creds?.username === 'string' ? creds.username : '', typeof creds?.password === 'string' ? creds.password : '')
})
ipcMain.handle('tidi:sync-pick-folder', async (): Promise<string | null> => {
  const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})

// ---- Takvim IPC ----
ipcMain.handle('tidi:cal-status', () => calendar.status())
ipcMain.handle('tidi:cal-events', () => calendar.events())
ipcMain.handle('tidi:cal-sync', () => calendar.sync())
ipcMain.handle('tidi:cal-disconnect', () => calendar.disconnectGoogle())
ipcMain.handle('tidi:cal-connect', async (): Promise<{ ok: boolean; error?: string }> => {
  const { clientId, clientSecret } = data.settings.calendar.google
  if (!clientId.trim()) return { ok: false, error: 'client_id' }
  const lang = data.settings.language
  try {
    const tokens = await googleLoginDesktop(clientId.trim(), clientSecret.trim(), { ok: translate(lang, 'cal_browser_ok'), fail: translate(lang, 'cal_browser_fail') })
    await calendar.completeGoogleLogin(tokens)
    showWindow()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
})

ipcMain.handle('tidi:notify-test', () => {
  const lang = data.settings.language
  new Notification({ title: translate(lang, 'notif_test_title'), body: translate(lang, 'notif_test_body') }).show()
})

// ---- Yaşam döngüsü ----
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // İkinci kopya: bir derin bağlantı taşıyorsa uygula, yoksa pencereyi öne getir.
  app.on('second-instance', (_e, argv) => {
    const url = findDeepLinkArg(argv)
    if (url) handleDeepLink(url)
    else showWindow()
  })
  // macOS: hyperdo:// bağlantıları open-url ile gelir (veri yüklenmeden gelirse bekletilir)
  app.on('open-url', (e, url) => {
    e.preventDefault()
    if (ready) handleDeepLink(url)
    else pendingDeepLink = url
  })
  app.whenReady().then(() => {
    app.setAppUserModelId('com.hyperdo.app') // Windows bildirimleri için gerekli
    registerProtocol()
    data = loadData()
    digestState = loadDigestState()
    powerMonitor.on('lock-screen', () => (sessionLocked = true))
    powerMonitor.on('unlock-screen', () => (sessionLocked = false))
    for (const t of data.tasks) lastNotified.set(t.id, Date.now()) // açılışta bir aralık bekle
    const hidden = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAsHidden)
    createMainWindow(!hidden)
    createTray()
    quick.registerShortcut(data.settings.quickAddShortcut)
    applyLoginItem(data.settings.launchAtLogin)
    telegram.sync()
    calendar.start()
    void applyMiniApp() // Phase D: server + tunnel when settings.miniApp.mode is not 'off'
    void sync.start() // #16: first cycle 2.5 s after start when a transport is configured
    if (data.settings.autoUpdate) updater.start() // packaged builds only; first check after 30 s
    setInterval(tick, 30_000)
    ready = true
    const url = pendingDeepLink ?? findDeepLinkArg(process.argv)
    pendingDeepLink = null
    if (url) handleDeepLink(url)
  })
  app.on('activate', showWindow) // macOS: Dock simgesine tıklama
  app.on('window-all-closed', () => {
    /* tepside/Dock'ta yaşamaya devam et */
  })
  app.on('before-quit', () => {
    quitting = true
    void stopMiniApp() // kills cloudflared and closes the server; the menu-button reset is best effort
    telegram.stop()
    calendar.stop()
    sync.stop()
    updater.stop()
  })
  app.on('will-quit', () => {
    quick.destroy()
    mini.destroy()
  })
}
