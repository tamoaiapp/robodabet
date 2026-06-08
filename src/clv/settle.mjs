// Settle: abre Chrome → raspa histórico KTO → atualiza bet_clv → fecha Chrome.
// Marca apostas open como won/lost/void com base no que a casa registrou.
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { openChrome } from '../casas/chrome-launcher.mjs'

const DATA_DIR = process.env.BOT_DATA_DIR || 'data'
mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = join(DATA_DIR, 'bot.db')
if (!existsSync(DB_PATH)) {
  console.log('Sem bot.db ainda — nada pra settle.')
  process.exit(0)
}

const db = new DatabaseSync(DB_PATH)

// 1) Há apostas abertas pra settle?
const openBets = db.prepare(`SELECT COUNT(*) as n FROM bet_clv WHERE result='open'`).get()
if (!openBets.n) {
  console.log('Nenhuma aposta aberta. Nada pra settle.')
  process.exit(0)
}
console.log(`Apostas abertas: ${openBets.n}`)

// 2) Histórico até 10 dias atrás cobre todas
const today = new Date()
const fromDate = new Date(today.getTime() - 10 * 24 * 60 * 60 * 1000)
const dateStr = fromDate.toISOString().slice(0, 10) // 2026-05-28

console.log(`Buscando histórico KTO desde ${dateStr}...`)

// 3) Abre Chrome + raspa
const chrome = await openChrome({
  profileDir: join(DATA_DIR, 'chrome-profile-kto'),
  port: 9333,
  startMinimized: true,
  startUrl: `https://www.kto.bet.br/app/esportes/historico-de-apostas/${dateStr}`,
})

const page = await chrome.ctx.newPage()
let cupons = []

try {
  await page.goto(`https://www.kto.bet.br/app/esportes/historico-de-apostas/${dateStr}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await new Promise(r => setTimeout(r, 8000))

  // Auto-login se redirecionou
  if (page.url().includes('/app/login/')) {
    console.log('[settle] redirecionou pra login — tentando autofill...')
    try { await page.click('input[type="email"]', { timeout: 2000 }) } catch {}
    await new Promise(r => setTimeout(r, 500))
    try { await page.click('input[type="password"]') } catch {}
    await new Promise(r => setTimeout(r, 1000))
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => /^entrar$/i.test((x.innerText || '').trim()))
      if (b) b.click()
    })
    await new Promise(r => setTimeout(r, 8000))

    if (page.url().includes('/app/login/')) {
      console.log('[settle] login falhou — abre o app, faz login manual em Conta')
      await chrome.close()
      process.exit(1)
    }
    await page.goto(`https://www.kto.bet.br/app/esportes/historico-de-apostas/${dateStr}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    })
    await new Promise(r => setTimeout(r, 5000))
  }

  // Click tab "Expirado"
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button, [role="tab"], li, a'))
    for (const el of tabs) {
      const t = (el.innerText || '').trim().toLowerCase()
      if (t === 'expirado' || t === 'expiradas') { el.click(); return }
    }
  })
  await new Promise(r => setTimeout(r, 4000))

  // Mostrar mais várias vezes pra paginar
  for (let i = 0; i < 8; i++) {
    const ok = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => /mostrar mais/i.test((b.innerText || '').trim()))
      if (!b) return false
      b.click()
      return true
    })
    if (!ok) break
    await new Promise(r => setTimeout(r, 2500))
  }
  await new Promise(r => setTimeout(r, 2000))

  // Extrai cada cupom
  cupons = await page.evaluate(() => {
    const all = document.querySelectorAll('*')
    const seen = new Set()
    const items = []
    for (const el of all) {
      const txt = (el.innerText || '').trim()
      if (txt.length < 100 || txt.length > 1500) continue
      if (!/ID Do Cupom/i.test(txt)) continue
      const m = txt.match(/ID Do Cupom:\s*(\d+)/i)
      const key = m ? m[1] : null
      if (!key || seen.has(key)) continue
      seen.add(key)
      items.push(txt.substring(0, 800))
    }
    return items
  })

  console.log(`Encontrei ${cupons.length} cupons no histórico KTO.`)
  writeFileSync(join(DATA_DIR, 'bet-history-expiradas.json'), JSON.stringify(cupons, null, 2))
} catch (e) {
  console.error('[settle] erro ao raspar:', e.message)
} finally {
  await chrome.close()
}

if (!cupons.length) {
  console.log('Nenhum cupom encontrado. Sem nada pra settle.')
  process.exit(0)
}

// 4) Parseia cada cupom e atualiza bet_clv
const updateById = db.prepare(`UPDATE bet_clv SET result=?, pnl=?, settled_at=?, cupom_id=? WHERE id=?`)
let settled = 0

// Normaliza nome de jogo: lowercase, sem acentos, sem hífens/vs, trim
const norm = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s+(vs|x|-)\s+/g, ' ')
  .replace(/[^a-z0-9 ]/g, '')
  .trim()

for (const txt of cupons) {
  const cupomMatch = txt.match(/ID Do Cupom:\s*(\d+)/i)
  if (!cupomMatch) continue
  const cupomId = cupomMatch[1]

  let status = null
  if (/^\s*Ganha\s*$/im.test(txt)) status = 'won'
  else if (/^\s*Perdida\s*$/im.test(txt)) status = 'lost'
  else if (/Anulada|Void/i.test(txt)) status = 'void'

  if (!status) continue

  // Extrai jogo + linha
  // Formato típico: "Total de escanteios: Mais 8.5\nChaco For Ever - Ferro"
  const linhaMatch = txt.match(/(?:Mais|Menos|Over|Under)\s+(\d+(?:\.\d+)?)/i)
  const sideMatch = txt.match(/(Mais|Menos|Over|Under)\s+\d+(?:\.\d+)?/i)
  const matchNameMatch = txt.match(/(?:Total de escanteios|Total Corners)[^\n]*\n([^\n]+)/i)

  if (!linhaMatch || !sideMatch || !matchNameMatch) continue

  const line = parseFloat(linhaMatch[1])
  const side = /mais|over/i.test(sideMatch[1]) ? 'OVER' : 'UNDER'
  const matchName = matchNameMatch[1].trim()
  const matchNorm = norm(matchName)

  // Procura bet aberta com match name parecido + mesmo side + mesma linha
  const candidates = db.prepare(`SELECT id, match, stake, odd_taken FROM bet_clv WHERE result='open' AND side=? AND line=?`).all(side, line)
  let bet = null
  for (const c of candidates) {
    if (norm(c.match) === matchNorm) { bet = c; break }
  }
  // Fallback: match parcial (uma equipe em comum)
  if (!bet) {
    for (const c of candidates) {
      const a = norm(c.match).split(' ')
      const b = matchNorm.split(' ')
      const common = a.filter(w => w.length >= 4 && b.includes(w))
      if (common.length >= 2) { bet = c; break }
    }
  }
  if (!bet) continue

  const pnl = status === 'won' ? (bet.odd_taken - 1) * bet.stake :
              status === 'lost' ? -bet.stake : 0

  updateById.run(status, pnl, new Date().toISOString(), cupomId, bet.id)
  console.log(`  ✓ ${bet.match} ${side} ${line}: ${status} pnl=R$${pnl.toFixed(2)} cupom=${cupomId}`)
  settled++
}

console.log(`\nNovas apostas settled: ${settled}`)

// 5) Sumário
const total = db.prepare(`SELECT
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN result='open' THEN 1 ELSE 0 END) as open_count,
  SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) as stake_settled,
  SUM(pnl) as pnl_total
  FROM bet_clv WHERE market='corners'`).get()

const roi = total.stake_settled > 0 ? (total.pnl_total / total.stake_settled * 100).toFixed(1) + '%' : '—'
console.log(`\nResumo geral: W/L=${total.wins}/${total.losses} | Abertas=${total.open_count} | PNL=R$${(total.pnl_total ?? 0).toFixed(2)} | ROI=${roi}`)

db.close()
process.exit(0)
