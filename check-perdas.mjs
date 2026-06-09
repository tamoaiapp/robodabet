import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const DATA_DIR = process.env.BOT_DATA_DIR || 'data'
const db = new DatabaseSync(join(DATA_DIR, 'bot.db'))

console.log('====== RESUMO GERAL ======')
const s = db.prepare(`SELECT result, COUNT(*) n, ROUND(SUM(stake),2) stake, ROUND(SUM(pnl),2) pnl
  FROM bet_clv GROUP BY result`).all()
console.table(s)

const tot = db.prepare(`SELECT
  COUNT(*) total,
  ROUND(SUM(stake),2) stake_total,
  ROUND(SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END),2) stake_settled,
  ROUND(SUM(pnl),2) pnl_total,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) wins,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) losses,
  SUM(CASE WHEN result='open' THEN 1 ELSE 0 END) open_
  FROM bet_clv`).get()
console.log(tot)
const roi = tot.stake_settled > 0 ? (tot.pnl_total / tot.stake_settled * 100).toFixed(1) + '%' : '—'
console.log('ROI:', roi)

console.log('\n====== POR LIGA ======')
const byLeague = db.prepare(`SELECT league, COUNT(*) n,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) w,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) l,
  ROUND(AVG(odd_taken),2) avg_odd,
  ROUND(SUM(pnl),2) pnl
  FROM bet_clv WHERE result IN ('won','lost')
  GROUP BY league ORDER BY pnl`).all()
console.table(byLeague)

console.log('\n====== POR SIDE/LINHA ======')
const byLine = db.prepare(`SELECT side, line, COUNT(*) n,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) w,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) l,
  ROUND(AVG(odd_taken),2) avg_odd,
  ROUND(SUM(pnl),2) pnl
  FROM bet_clv WHERE result IN ('won','lost')
  GROUP BY side, line ORDER BY pnl`).all()
console.table(byLine)

console.log('\n====== ÚLTIMAS 15 APOSTAS SETTLED ======')
const recent = db.prepare(`SELECT match, league, side, line, odd_taken, stake, result, ROUND(pnl,2) pnl, kickoff_at
  FROM bet_clv WHERE result IN ('won','lost') ORDER BY settled_at DESC LIMIT 15`).all()
console.table(recent)

db.close()
