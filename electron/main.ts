import { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, type AppData } from '../src/lib/types'
import { buildNotification, collectDueReminders, syncCounters } from '../src/lib/reminder'
import { translate } from '../src/lib/i18n'
import { normalizeTask } from '../src/lib/tasks'
import { TelegramBot } from './telegram'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---- Kalıcı depolama: userData/hyperdo-data.json ----
const dataFile = () => path.join(app.getPath('userData'), 'hyperdo-data.json')

function loadData(): AppData {
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppData>
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
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

// ---- Tepsi simgesi (programatik 16x16 turuncu daire) ----
function trayIcon() {
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
})
ipcMain.handle('tidi:telegram-test', () => telegram.test())
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
    setInterval(tick, 30_000)
  })
  app.on('activate', showWindow) // macOS: Dock simgesine tıklama
  app.on('window-all-closed', () => {
    /* tepside/Dock'ta yaşamaya devam et */
  })
  app.on('before-quit', () => {
    quitting = true
    telegram.stop()
  })
}
