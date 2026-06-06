const { app, BrowserWindow, ipcMain, shell, dialog, Menu } = require('electron')
const { DatabaseSync } = require('node:sqlite')
Menu.setApplicationMenu(null) // remove barra nativa File/Edit/View
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')

let DATA_DIR
let win

// ── Single instance ──────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
  process.exit(0)
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

// ── Data dir ─────────────────────────────────────────────────────────────────
function ensureDataDir() {
  DATA_DIR = path.join(app.getPath('userData'), 'robodabet-data')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(DATA_DIR, 'debug'), { recursive: true })
}

// ── Run script ───────────────────────────────────────────────────────────────
// Roda um .mjs do src/ como child process Node e streama stdout/stderr ao renderer
function loadConfig() {
  const p = path.join(DATA_DIR, 'config.json')
  if (!fs.existsSync(p)) return {}
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
}

function runScript(scriptPath, args = [], onLine, onDone) {
  const cfg = loadConfig()
  const env = {
    ...process.env,
    BOT_DATA_DIR: DATA_DIR,
    BOT_MODE: cfg.mode || 'paper', // default paper (segurança)
    BOT_RISK_LEVEL: String(cfg.risk || 5),
    BOT_BANKROLL: String(cfg.bankroll || 100),
    BOT_MAX_PICKS: String(cfg.max || 5),
  }
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: app.isPackaged ? process.resourcesPath : __dirname,
    env,
    windowsHide: true,
  })
  child.stdout.on('data', d => d.toString().split('\n').forEach(l => l && onLine(l, 'out')))
  child.stderr.on('data', d => d.toString().split('\n').forEach(l => l && onLine(l, 'err')))
  child.on('close', code => onDone(code))
  return child
}

// ── IPC handlers ─────────────────────────────────────────────────────────────
function registerIpc() {
  // Select picks (sniffa Kambi + filtra EV)
  ipcMain.handle('bot:select', async (e, opts = {}) => {
    return new Promise(resolve => {
      const out = []
      runScript('src/strategy/select-treino.mjs', [],
        (line, kind) => { out.push({line, kind}); win?.webContents.send('bot:log', {line, kind}) },
        code => resolve({ code, lines: out })
      )
    })
  })

  // Place bets (lê data/corner-treino.json e dispara batch)
  ipcMain.handle('bot:place', async (e, inputFile = 'data/corner-treino.json') => {
    return new Promise(resolve => {
      const out = []
      runScript('src/bet/place-bets.mjs', [inputFile],
        (line, kind) => { out.push({line, kind}); win?.webContents.send('bot:log', {line, kind}) },
        code => resolve({ code, lines: out })
      )
    })
  })

  // Snapshot closing odds (T-5min)
  ipcMain.handle('bot:snapshot', async () => {
    return new Promise(resolve => {
      const out = []
      runScript('src/clv/snapshot-closing.mjs', [],
        (line, kind) => out.push({line, kind}),
        code => resolve({ code, lines: out })
      )
    })
  })

  // Settle (atualiza bet_clv via histórico KTO)
  ipcMain.handle('bot:settle', async () => {
    return new Promise(resolve => {
      const out = []
      runScript('src/clv/settle.mjs', [],
        (line, kind) => out.push({line, kind}),
        code => resolve({ code, lines: out })
      )
    })
  })

  // Report ROI + CLV
  ipcMain.handle('bot:report', async () => {
    return new Promise(resolve => {
      const out = []
      runScript('src/clv/report.mjs', [],
        (line, kind) => out.push({line, kind}),
        code => resolve({ code, lines: out })
      )
    })
  })

  // KTO login (autofill)
  ipcMain.handle('bot:kto-login', async () => {
    return new Promise(resolve => {
      const out = []
      runScript('src/casas/kto-login.mjs', [],
        (line, kind) => out.push({line, kind}),
        code => resolve({ code, lines: out })
      )
    })
  })

  // Abrir página externa
  ipcMain.handle('app:open-external', async (e, url) => shell.openExternal(url))

  // Info do app
  ipcMain.handle('app:info', async () => ({
    version: app.getVersion(),
    dataDir: DATA_DIR,
    platform: process.platform,
  }))

  // Stats agregados (Dashboard)
  ipcMain.handle('bot:stats', async () => {
    try {
      const dbPath = path.join(DATA_DIR, 'bot.db')
      if (!fs.existsSync(dbPath)) return { exists: false }
      const db = new DatabaseSync(dbPath)
      const summary = db.prepare(`SELECT
        COUNT(*) total,
        SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) wins,
        SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) losses,
        SUM(CASE WHEN result='open' THEN 1 ELSE 0 END) open_,
        SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) stake_settled,
        COALESCE(SUM(pnl), 0) pnl_total,
        AVG(CASE WHEN clv_pct IS NOT NULL THEN clv_pct END) avg_clv
        FROM bet_clv WHERE market='corners'`).get()
      const today = new Date().toISOString().substring(0, 10)
      const todayRow = db.prepare(`SELECT COALESCE(SUM(pnl), 0) pnl, COUNT(*) n
        FROM bet_clv WHERE date(settled_at)=? AND result IN ('won','lost')`).get(today)
      const recent = db.prepare(`SELECT match, side, line, odd_taken, stake, result, pnl, kickoff_at
        FROM bet_clv WHERE market='corners' ORDER BY taken_at DESC LIMIT 20`).all()
      db.close()
      const roi = summary.stake_settled > 0 ? (summary.pnl_total / summary.stake_settled * 100) : null
      return {
        exists: true,
        total: summary.total,
        wins: summary.wins,
        losses: summary.losses,
        open: summary.open_,
        stakeSettled: summary.stake_settled,
        pnl: summary.pnl_total,
        roi,
        avgClv: summary.avg_clv,
        pnlToday: todayRow.pnl,
        recent,
      }
    } catch (e) {
      return { exists: false, error: e.message }
    }
  })

  // Settings: persistir em data dir (config.json)
  ipcMain.handle('settings:get', async () => {
    const p = path.join(DATA_DIR, 'config.json')
    if (!fs.existsSync(p)) return {}
    try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} }
  })
  ipcMain.handle('settings:set', async (e, patch) => {
    const p = path.join(DATA_DIR, 'config.json')
    const cur = fs.existsSync(p) ? (() => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return {} } })() : {}
    const next = { ...cur, ...patch }
    fs.writeFileSync(p, JSON.stringify(next, null, 2))
    return next
  })
}

// ── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: true,
    backgroundColor: '#000000',
    title: 'Robô da Bet',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadFile('renderer/index.html')
  win.webContents.once('did-finish-load', () => win.maximize())
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' })
}

// ── Buffer de logs em memória (pra TamoIA ter contexto) ──────
const logBuffer = []
function pushLog(line) {
  logBuffer.push(`[${new Date().toISOString()}] ${line}`)
  if (logBuffer.length > 300) logBuffer.shift()
}

// ── Support (TamoIA chat) ────────────────────────────────────
ipcMain.handle('support:chat', async (e, { messages }) => {
  const sa = await import('./src/supportAgent.mjs')
  return sa.chatWithSupport({
    messages,
    appDir: __dirname,
    dataDir: DATA_DIR,
    recentLogs: logBuffer,
    appUptime: process.uptime(),
  })
})

// ── Window controls (titlebar customizada) ───────────────────
ipcMain.on('win:minimize', () => win?.minimize())
ipcMain.on('win:maximize', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('win:close', () => win?.close())

// ── Auto-update via GitHub Releases ──────────────────────────
function setupAutoUpdate() {
  if (!app.isPackaged) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('checking-for-update', () => console.log('[update] verificando...'))
    autoUpdater.on('update-available', (info) => {
      console.log('[update] nova versao disponivel:', info.version)
      win?.webContents.send('update:status', { state: 'downloading', version: info.version })
    })
    autoUpdater.on('update-not-available', () => console.log('[update] ja na ultima versao'))
    autoUpdater.on('error', (err) => console.error('[update] erro:', err?.message))
    autoUpdater.on('download-progress', (p) => {
      win?.webContents.send('update:status', { state: 'downloading', percent: Math.round(p.percent) })
    })
    autoUpdater.on('update-downloaded', (info) => {
      console.log('[update] baixado, sera instalado ao fechar')
      win?.webContents.send('update:status', { state: 'ready', version: info.version })
    })

    autoUpdater.checkForUpdatesAndNotify()
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 15 * 60 * 1000)
  } catch (e) {
    console.error('[update] setup falhou:', e?.message)
  }
}

ipcMain.handle('update:install', () => {
  try { require('electron-updater').autoUpdater.quitAndInstall() } catch {}
})

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDataDir()
  registerIpc()
  createWindow()
  win.webContents.once('did-finish-load', () => setupAutoUpdate())

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
