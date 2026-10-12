import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, type AppData } from '../src/lib/types'
import { buildNotification, collectDueReminders, syncCounters } from '../src/lib/reminder'
import { translate } from '../src/lib/i18n'
import { normalizeTask } from '../src/lib/tasks'
import { CalendarSync, normalizeCalendarSettings } from '../src/lib/calsync'
import { TelegramBot } from './telegram'
import { googleLoginDesktop } from './calendar'

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
    const raw = fs.readFileSync(dataFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppData>
    const settings = { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
      settings: { ...settings, calendar: normalizeCalendarSettings(settings.calendar) },
    }
  } catch {
    return { tasks: [], settings: { ...DEFAULT_SETTINGS } }
  }
}

function saveData(d: AppData) {
  const file = dataFile()
  const tmp = file + '.tmp'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8')
  fs.renameSync(tmp, file) // atomik yazma: yarım dosya kalmaz
}

let data: AppData = { tasks: [], settings: { ...DEFAULT_SETTINGS } }
let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// Son bildirim zamanı bellekte tutulur; uygulama yeniden açıldığında
// bekleyen görevler kısa süre içinde tekrar hatırlatılır.
const lastNotified = new Map<string, number>()

// ---- Takvim senkronu: Google + ICS akışları. Token ve görev→etkinlik eşlemesi ayrı dosyada tutulur
//      (yedeğe girmez): userData/hyperdo-calendar.json ----
const calendarFile = () => path.join(app.getPath('userData'), 'hyperdo-calendar.json')
const calendar = new CalendarSync({
  getData: () => data,
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
  onEvents: (events) => win?.webContents.send('tidi:cal-events', events),
  onStatus: (status) => win?.webContents.send('tidi:cal-status', status),
  googleSupported: true,
})

// ---- Telegram botu: veriyi okur; komutla değiştirdiğinde kaydeder ve arayüzü günceller ----
const telegram = new TelegramBot({
  getData: () => data,
  mutate(fn) {
    const next = fn(data)
    syncCounters(data.tasks, next.tasks, lastNotified)
    data = next
    saveData(data)
    win?.webContents.send('tidi:data-changed', data)
    telegram.sync()
    calendar.onDataSaved()
  },
})

// ---- Pencere ----
function createWindow() {
  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#0f1117',
    title: 'Hyper Do',
    icon: appIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Dış bağlantılar ("Takvime ekle" vb.) sistem tarayıcısında açılır, yeni Electron penceresi değil.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Kapat = tepsiye küçült (macOS'ta Dock'ta kalır). Hatırlatmalar çalışmaya devam eder.
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('focus', () => win?.flashFrame(false))
}

function showWindow() {
  if (!win) return
  if (!win.isVisible()) win.show()
  if (win.isMinimized()) win.restore()
  win.focus()
}

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

// ---- Hatırlatma motoru ----
function tick() {
  const hits = collectDueReminders(data.tasks, data.settings, lastNotified)
  for (const { task, overdue } of hits) {
    const { title, body } = buildNotification(task, overdue, data.settings)
    const n = new Notification({
      title,
      body,
      urgency: overdue || task.priority === 'high' ? 'critical' : 'normal',
      timeoutType: 'never',
    })
    n.on('click', () => {
      showWindow()
      win?.webContents.send('tidi:focus-task', task.id)
    })
    n.show()
    void telegram.remind(task, title, body)

    if (data.settings.flashWindow && win) win.flashFrame(true)
    if (data.settings.showWindowOnRemind) showWindow()
    win?.webContents.send('tidi:reminded', task.id)
  }
}

// ---- IPC ----
ipcMain.handle('tidi:load', () => data)
ipcMain.handle('tidi:save', (_e, incoming: AppData) => {
  syncCounters(data.tasks, incoming.tasks, lastNotified)
  const langChanged = incoming.settings.language !== data.settings.language
  data = incoming
  saveData(data)
  if (langChanged) buildTrayMenu()
  telegram.sync()
  calendar.onDataSaved()
})
ipcMain.handle('tidi:telegram-test', () => telegram.test())

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
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    app.setAppUserModelId('com.hyperdo.app') // Windows bildirimleri için gerekli
    data = loadData()
    for (const t of data.tasks) lastNotified.set(t.id, Date.now()) // açılışta bir aralık bekle
    createWindow()
    createTray()
    telegram.sync()
    calendar.start()
    setInterval(tick, 30_000)
  })
  app.on('activate', showWindow) // macOS: Dock simgesine tıklama
  app.on('window-all-closed', () => {
    /* tepside/Dock'ta yaşamaya devam et */
  })
  app.on('before-quit', () => {
    quitting = true
    telegram.stop()
    calendar.stop()
  })
}
