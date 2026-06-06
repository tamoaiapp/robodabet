const { app, BrowserWindow, ipcMain, shell, dialog, Menu, Notification } = require('electron')
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

// ── Motor de automação ───────────────────────────────────────
// Estado em memória do "bot ligado". Persiste em config.botEnabled
// pra retomar quando o app reabrir.
const botState = {
  running: false,
  cycleInProgress: false,
  lastSelect: null,
  lastPlace: null,
  lastSnapshot: null,
  lastSettle: null,
  nextCycle: null,
  intervalsIds: [],
  picksToday: 0,
  errors: 0,
}

function notify(title, body, silent = false) {
  pushLog(`[notify] ${title}: ${body}`)
  try {
    new Notification({ title, body, silent }).show()
  } catch (e) {}
  win?.webContents.send('bot:notify', { title, body, ts: Date.now() })
}

function broadcastState() {
  win?.webContents.send('bot:state', { ...botState, intervalsIds: undefined })
}

// Executa 1 ciclo completo: select → place → broadcast
async function runCycle() {
  if (botState.cycleInProgress) return
  botState.cycleInProgress = true
  broadcastState()
  pushLog('[cycle] iniciando ciclo')
  try {
    // SELECT
    const selOut = []
    await new Promise((resolve) => {
      runScript('src/strategy/select-treino.mjs', [],
        (line, kind) => { selOut.push(line); win?.webContents.send('bot:log', { line, kind }) },
        () => resolve()
      )
    })
    botState.lastSelect = Date.now()

    // Detectar quantas picks foram selecionadas
    const treinoPath = path.join(DATA_DIR, 'corner-treino.json')
    let picks = []
    try { picks = JSON.parse(fs.readFileSync(treinoPath, 'utf8')) } catch {}
    if (picks.length === 0) {
      pushLog('[cycle] 0 picks elegíveis nesse ciclo')
      botState.cycleInProgress = false
      broadcastState()
      return
    }

    // PLACE
    notify('Robô da Bet', `Apostando ${picks.length} pick(s)…`, true)
    await new Promise((resolve) => {
      runScript('src/bet/place-bets.mjs', [treinoPath],
        (line, kind) => {
          win?.webContents.send('bot:log', { line, kind })
          if (line.includes('APOSTA CONFIRMADA') || line.includes('[PAPER]')) {
            botState.picksToday++
          }
        },
        () => resolve()
      )
    })
    botState.lastPlace = Date.now()
    notify('Robô da Bet', `${botState.picksToday} aposta(s) registradas hoje.`)
  } catch (e) {
    botState.errors++
    pushLog('[cycle] erro: ' + e.message)
  } finally {
    botState.cycleInProgress = false
    broadcastState()
  }
}

async function runSnapshot() {
  await new Promise((resolve) => {
    runScript('src/clv/snapshot-closing.mjs', [],
      (line, kind) => win?.webContents.send('bot:log', { line, kind }),
      () => resolve()
    )
  })
  botState.lastSnapshot = Date.now()
  broadcastState()
}

async function runSettle() {
  // Primeiro precisa ter histórico atualizado — get-bet-history-light grava JSON
  await new Promise((resolve) => {
    runScript('src/casas/kto-history.mjs', [],
      (line, kind) => win?.webContents.send('bot:log', { line, kind }),
      () => resolve()
    )
  })
  await new Promise((resolve) => {
    runScript('src/clv/settle.mjs', [],
      (line, kind) => {
        win?.webContents.send('bot:log', { line, kind })
        if (line.match(/won pnl=R\$([\d.]+)/i)) {
          const v = parseFloat(line.match(/won pnl=R\$([\d.]+)/i)[1])
          notify('✓ Vitória', `+R$${v.toFixed(2)} no Robô da Bet`)
        } else if (line.match(/lost pnl=R\$-?([\d.]+)/i)) {
          const v = parseFloat(line.match(/lost pnl=R\$-?([\d.]+)/i)[1])
          notify('✗ Perda', `-R$${v.toFixed(2)} no Robô da Bet`, true)
        }
      },
      () => resolve()
    )
  })
  botState.lastSettle = Date.now()
  broadcastState()
}

function startBot() {
  if (botState.running) return
  botState.running = true
  notify('Robô da Bet', 'Bot LIGADO — começando primeiro ciclo')

  // Reset contador diário às 00:00
  const resetDaily = () => {
    const now = new Date()
    const tomorrow = new Date(now)
    tomorrow.setDate(now.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)
    const msUntil = tomorrow - now
    setTimeout(() => { botState.picksToday = 0; broadcastState(); resetDaily() }, msUntil)
  }
  resetDaily()

  // Primeiro ciclo imediato
  runCycle().catch(() => {})

  // A cada 2h: select+place
  const i1 = setInterval(() => { runCycle().catch(() => {}) }, 2 * 60 * 60 * 1000)
  // A cada 30min: snapshot closing odds
  const i2 = setInterval(() => { runSnapshot().catch(() => {}) }, 30 * 60 * 1000)
  // A cada 4h: settle
  const i3 = setInterval(() => { runSettle().catch(() => {}) }, 4 * 60 * 60 * 1000)

  botState.intervalsIds = [i1, i2, i3]
  broadcastState()
}

function stopBot() {
  botState.intervalsIds.forEach(clearInterval)
  botState.intervalsIds = []
  botState.running = false
  notify('Robô da Bet', 'Bot DESLIGADO')
  broadcastState()
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

  // KTO login — abre Chrome com perfil dedicado + porta CDP + URL do KTO
  ipcMain.handle('bot:kto-login', async () => {
    try {
      // Acha o chrome.exe (Google ou Edge como fallback)
      const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        path.join(app.getPath('home'), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
      const chromePath = candidates.find(p => fs.existsSync(p))
      if (!chromePath) {
        notify('Chrome não encontrado', 'Instale o Google Chrome pra usar o robô.')
        return { code: 1, error: 'chrome_not_found' }
      }

      const profileDir = path.join(DATA_DIR, 'chrome-profile-kto')
      fs.mkdirSync(profileDir, { recursive: true })

      const args = [
        '--remote-debugging-port=9222',
        `--user-data-dir=${profileDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        'https://www.kto.bet.br/app/login/',
      ]
      pushLog(`[kto-login] abrindo ${chromePath}`)
      spawn(chromePath, args, { detached: true, stdio: 'ignore' }).unref()

      notify('Robô da Bet', 'Chrome aberto — faça login no KTO. Pode fechar essa janela do robô e voltar aqui depois.')
      return { code: 0, chromePath, profileDir }
    } catch (e) {
      pushLog(`[kto-login] erro: ${e.message}`)
      return { code: 1, error: e.message }
    }
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

  // Motor automático
  ipcMain.handle('bot:start', async () => {
    const cfg = loadConfig()
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({ ...cfg, botEnabled: true }, null, 2))
    startBot()
    return { running: true }
  })
  ipcMain.handle('bot:stop', async () => {
    const cfg = loadConfig()
    fs.writeFileSync(path.join(DATA_DIR, 'config.json'), JSON.stringify({ ...cfg, botEnabled: false }, null, 2))
    stopBot()
    return { running: false }
  })
  ipcMain.handle('bot:get-state', async () => ({ ...botState, intervalsIds: undefined }))

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
  win.webContents.once('did-finish-load', () => {
    setupAutoUpdate()
    // Auto-retomar bot se estava ligado
    const cfg = loadConfig()
    if (cfg.botEnabled && cfg.acceptedTerms) {
      setTimeout(() => startBot(), 3000) // dá 3s pra UI carregar
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
