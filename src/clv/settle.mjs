// Settle automático: lê data/bet-history-expiradas.json (gerado por get-bet-history-v3)
// e atualiza bet_clv com result/pnl baseado no status do KTO
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';

if (!existsSync('data/bet-history-expiradas.json')) {
  console.log('Rode primeiro: node get-bet-history-v3.mjs');
  process.exit(1);
}

const history = JSON.parse(readFileSync('data/bet-history-expiradas.json', 'utf8'));
const db = new DatabaseSync('data/bot.db');

const updateById = db.prepare(`UPDATE bet_clv SET result=?, pnl=?, settled_at=? WHERE cupom_id=?`);

let settled = 0;
for (const txt of history) {
  // Parsear cada cupom
  const cupomMatch = txt.match(/ID Do Cupom:\s*(\d+)/i);
  if (!cupomMatch) continue;
  const cupomId = cupomMatch[1];

  let status = null;
  if (/^\s*Ganha\s*$/im.test(txt) || /Ganha\n/i.test(txt.split('Cupom:')[0] || '')) status = 'won';
  else if (/^\s*Perdida\s*$/im.test(txt) || /Perdida\n/i.test(txt.split('Cupom:')[0] || '')) status = 'lost';
  else if (/Anulada|Void/i.test(txt)) status = 'void';
  // Heurística secundária: linha logo após odd costuma ser status
  if (!status) {
    const m = txt.match(/@\s*\n?\s*\d+\.\d+\s*\n?\s*(Aberta|Ganha|Perdida|Anulada)/i);
    if (m) {
      const s = m[1].toLowerCase();
      status = s === 'ganha' ? 'won' : s === 'perdida' ? 'lost' : s === 'anulada' ? 'void' : null;
    }
  }
  if (!status || status === 'open') continue;

  // Encontrar bet_clv pelo cupom_id
  const bet = db.prepare('SELECT id, stake, odd_taken, result FROM bet_clv WHERE cupom_id=?').get(cupomId);
  if (!bet) { continue; }
  if (bet.result !== 'open') continue;

  const pnl = status === 'won' ? (bet.odd_taken - 1) * bet.stake :
              status === 'lost' ? -bet.stake :
              0; // void
  updateById.run(status, pnl, new Date().toISOString(), cupomId);
  console.log(`  ✓ Cupom ${cupomId}: ${status} pnl=R$${pnl.toFixed(2)}`);
  settled++;
}

console.log(`\nSettled novos: ${settled}`);

// Sumário
const rows = db.prepare(`SELECT result, COUNT(*) as n, SUM(stake) as stake, SUM(pnl) as pnl
  FROM bet_clv WHERE market='corners' GROUP BY result`).all();
console.log('\nSumário bet_clv (cantos):');
console.table(rows);

const total = db.prepare(`SELECT SUM(stake) as stake, SUM(pnl) as pnl, COUNT(*) as n
  FROM bet_clv WHERE market='corners' AND result IN ('won','lost')`).get();
if (total.n > 0) {
  console.log(`\nN=${total.n} settled | Stake R$${total.stake.toFixed(2)} | PNL R$${total.pnl.toFixed(2)} | ROI ${(total.pnl/total.stake*100).toFixed(1)}%`);
}

db.close();
