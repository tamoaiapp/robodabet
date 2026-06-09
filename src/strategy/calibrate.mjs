// Auto-calibração de λ por liga.
//
// Quando uma liga acumula >=30 jogos settled, recalculamos a média
// (λ do Poisson) usando a taxa de acerto OBSERVADA vs a linha apostada.
//
// Método: pra cada aposta settled OVER L com prob estimada p e resultado r,
//   - se acertou: o jogo teve > L cantos
//   - se perdeu:  o jogo teve <= L cantos
// Com isso podemos inferir um λ que melhor explica os dados via
// método dos momentos simplificado (taxa de OVER em cada linha).
//
// Fórmula: λ_real = média ponderada de L+0.5 onde a taxa de acerto OVER
// se aproxima de 50% (mediana). Pra simplificar: usamos win_rate × line.
//
// Salva em DATA_DIR/leagues-calibrated.json.

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

const DATA_DIR = process.env.BOT_DATA_DIR || 'data'
const MIN_SAMPLES = 30
const OUT_PATH = join(DATA_DIR, 'leagues-calibrated.json')

function recalibrateLeague(rows) {
  // Para cada (side, line) calcula taxa observada
  const buckets = new Map()
  for (const r of rows) {
    if (r.side !== 'OVER') continue
    const key = r.line
    if (!buckets.has(key)) buckets.set(key, { n: 0, wins: 0 })
    const b = buckets.get(key)
    b.n += 1
    if (r.result === 'won') b.wins += 1
  }

  // Estima λ: linha onde win_rate cruza 50% é a mediana, próxima da média do Poisson.
  // Heurística: λ ≈ Σ(line × win_rate × n) / Σ(win_rate × n)
  let num = 0, den = 0
  for (const [line, b] of buckets) {
    const wr = b.wins / b.n
    num += line * wr * b.n
    den += wr * b.n
  }
  if (den === 0) return null
  return Math.round((num / den) * 10) / 10
}

export function calibrateLambdas() {
  const dbPath = join(DATA_DIR, 'bot.db')
  if (!existsSync(dbPath)) return {}
  const db = new DatabaseSync(dbPath)

  const leagues = db.prepare(`SELECT league, COUNT(*) n
    FROM bet_clv WHERE market='corners' AND result IN ('won','lost')
    GROUP BY league HAVING n >= ?`).all(MIN_SAMPLES)

  const calibrations = existsSync(OUT_PATH)
    ? JSON.parse(readFileSync(OUT_PATH, 'utf8'))
    : {}

  for (const lg of leagues) {
    const rows = db.prepare(`SELECT side, line, result FROM bet_clv
      WHERE league=? AND market='corners' AND result IN ('won','lost')`).all(lg.league)
    const lambda = recalibrateLeague(rows)
    if (lambda && lambda > 4 && lambda < 16) {
      calibrations[lg.league] = {
        lambda,
        n: lg.n,
        updated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      }
    }
  }

  db.close()
  writeFileSync(OUT_PATH, JSON.stringify(calibrations, null, 2))
  return calibrations
}

export function loadCalibrations() {
  if (!existsSync(OUT_PATH)) return {}
  try { return JSON.parse(readFileSync(OUT_PATH, 'utf8')) } catch { return {} }
}

// CLI: node src/strategy/calibrate.mjs
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  const c = calibrateLambdas()
  console.log('Calibrações recalculadas:')
  console.log(JSON.stringify(c, null, 2))
}
