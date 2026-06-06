// Report final: ROI + CLV por liga, mercado e linha
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/bot.db');

console.log('===== RESUMO GERAL bet_clv =====\n');
const overall = db.prepare(`SELECT
  market, COUNT(*) as n,
  SUM(stake) as stake,
  SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) as stake_settled,
  SUM(pnl) as pnl,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN result='open' THEN 1 ELSE 0 END) as open_count,
  AVG(CASE WHEN clv_pct IS NOT NULL THEN clv_pct END) as avg_clv
FROM bet_clv GROUP BY market`).all();

for (const r of overall) {
  console.log(`Market: ${r.market}`);
  console.log(`  Total picks: ${r.n} | Open: ${r.open_count} | W/L: ${r.wins}/${r.losses}`);
  if (r.stake_settled > 0) {
    const roi = (r.pnl / r.stake_settled * 100).toFixed(1);
    console.log(`  Settled stake: R$${r.stake_settled.toFixed(2)} | PNL: R$${r.pnl.toFixed(2)} | ROI: ${roi}%`);
  }
  if (r.avg_clv !== null) {
    console.log(`  CLV médio (N=${db.prepare('SELECT COUNT(*) as n FROM bet_clv WHERE clv_pct IS NOT NULL AND market=?').get(r.market).n}): ${r.avg_clv.toFixed(2)}%`);
  }
  console.log('');
}

console.log('\n===== POR LIGA (cantos) =====\n');
const byLeague = db.prepare(`SELECT
  league, COUNT(*) as n,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) as losses,
  SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) as stake_settled,
  SUM(pnl) as pnl,
  AVG(odd_taken) as avg_odd
FROM bet_clv WHERE market='corners' GROUP BY league
ORDER BY n DESC`).all();
for (const r of byLeague) {
  const roi = r.stake_settled > 0 ? (r.pnl / r.stake_settled * 100).toFixed(1) + '%' : '—';
  console.log(`  ${(r.league||'?').padEnd(20)} N=${r.n} W/L=${r.wins}/${r.losses} odd_avg=${(r.avg_odd ?? 0).toFixed(2)} ROI=${roi}`);
}

console.log('\n===== POR SIDE/LINHA (cantos) =====\n');
const byThreshold = db.prepare(`SELECT
  side, line, COUNT(*) as n,
  SUM(CASE WHEN result='won' THEN 1 ELSE 0 END) as wins,
  SUM(CASE WHEN result='lost' THEN 1 ELSE 0 END) as losses,
  AVG(odd_taken) as avg_odd
FROM bet_clv WHERE market='corners' GROUP BY side, line ORDER BY side, line`).all();
for (const r of byThreshold) {
  console.log(`  ${r.side} ${r.line}: N=${r.n} W/L=${r.wins}/${r.losses} avg_odd=${(r.avg_odd ?? 0).toFixed(2)}`);
}

console.log('\n===== CLV (após snapshot-closing rodar) =====');
const clvRows = db.prepare(`SELECT id, match, side, line, odd_taken, odd_closing, clv_pct, result
  FROM bet_clv WHERE clv_pct IS NOT NULL ORDER BY clv_pct DESC`).all();
if (clvRows.length === 0) {
  console.log('  Nenhum CLV registrado ainda. Rode snapshot-closing T-5min antes de cada kickoff.');
} else {
  clvRows.forEach(r => {
    const sign = r.clv_pct >= 0 ? '+' : '';
    console.log(`  [${r.id}] ${r.match} ${r.side} ${r.line}: ${r.odd_taken} → ${r.odd_closing} (CLV ${sign}${r.clv_pct.toFixed(2)}%) ${r.result}`);
  });
  const avgClv = clvRows.reduce((a, b) => a + b.clv_pct, 0) / clvRows.length;
  const posCount = clvRows.filter(r => r.clv_pct > 0).length;
  console.log(`\n  AVG CLV: ${avgClv >= 0 ? '+' : ''}${avgClv.toFixed(2)}% | positivos: ${posCount}/${clvRows.length}`);
  console.log(`  Interpretação: CLV+ médio > 2% = edge real. CLV- = modelo é fé.`);
}

db.close();
