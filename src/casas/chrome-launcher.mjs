// Chrome launcher — abre Chrome MINIMIZADO com perfil dedicado, retorna Playwright browser.
// Quando termina, mata os processos pra Chrome não envelhecer (bug 148 do CDP).
import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

function findChromePath() {
  for (const p of CHROME_CANDIDATES) { if (existsSync(p)) return p }
  return null
}

function killExistingChromes() {
  // Mata todos chrome.exe vinculados ao perfil dedicado robodabet
  try { execSync('wmic process where "name=\'chrome.exe\' and CommandLine like \'%robodabet%\'" delete', { stdio: 'ignore' }) } catch {}
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/**
 * Abre Chrome MINIMIZADO + perfil dedicado + porta CDP 9333.
 * Retorna { browser, ctx, close() }.
 *
 * Estratégia: a cada chamada mata Chromes antigos e abre fresh.
 * Evita o bug do Chrome 148 (CDP degrada após algumas horas).
 */
export async function openChrome({ profileDir, port = 9333, headless = false, startMinimized = true, startUrl = 'https://www.kto.bet.br/app/esportes/', cdpTimeout = 15000 }) {
  const chromePath = findChromePath()
  if (!chromePath) throw new Error('Chrome/Edge não encontrado nos paths padrão')
  mkdirSync(profileDir, { recursive: true })

  console.log(`[chrome] matando processos antigos do perfil`)
  killExistingChromes()
  await sleep(3000)

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]
  if (startMinimized) args.push('--start-minimized')
  if (headless) args.push('--headless=new')
  args.push(startUrl)

  console.log(`[chrome] abrindo ${chromePath} minimized=${startMinimized}`)
  const proc = spawn(chromePath, args, { detached: true, stdio: 'ignore' })
  proc.unref()

  // Aguarda CDP responder
  let cdpUp = false
  for (let i = 0; i < cdpTimeout / 1000; i++) {
    await sleep(1000)
    try {
      const r = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(2000) })
      if (r.ok) { cdpUp = true; console.log(`[chrome] CDP UP em ${i + 1}s`); break }
    } catch {}
  }
  if (!cdpUp) throw new Error(`CDP não respondeu em ${cdpTimeout / 1000}s na porta ${port}`)

  // Connect Playwright
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`, { timeout: 15000 })
  const ctx = browser.contexts()[0]
  console.log(`[chrome] Playwright conectado: ${ctx.pages().length} pages`)

  return {
    browser,
    ctx,
    async close() {
      try { await browser.close() } catch {}
      await sleep(500)
      killExistingChromes()
      console.log(`[chrome] fechado e processos terminados`)
    },
  }
}
