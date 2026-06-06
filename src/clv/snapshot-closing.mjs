// Captura odd de fechamento (T-5min) das bet_clv abertas
// Roda em loop ou pode ser chamado manualmente perto do kickoff
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/bot.db');

const WINDOW_BEFORE_MIN = 30; // captura se kickoff ∈ [-30min .. +0min] de agora
const WINDOW_AFTER_MIN  = 5;  // após +5min do kickoff, desiste (jogo começou)

async function captureClosingOdd(bet) {
  const url = `https://us.offering-api.kambicdn.com/offering/v2018/ktobr/betoffer/event/${bet.evt_id}.json?lang=pt_BR&market=BR&client_id=200&channel_id=1`;
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', Origin: 'https://www.kto.bet.br', Referer: 'https://www.kto.bet.br/' }
    });
    if (!r.ok) return { ok: false, err: `HTTP ${r.status}` };
    const data = await r.json();
    // Procurar betoffer "Total de escanteios" com mesma linha
    for (const o of data.betOffers ?? []) {
      const label = (o.criterion?.label ?? '') + ' ' + (o.criterion?.englishLabel ?? '');
      if (!/total de escanteios|total corners/i.test(label)) continue;
      for (const out of o.outcomes ?? []) {
        const line = out.line / 1000;
        if (Math.abs(line - bet.line) > 0.01) continue;
        const isOver = out.type === 'OT_OVER' || /mais|over/i.test(out.label);
        const isUnder = out.type === 'OT_UNDER' || /menos|under/i.test(out.label);
        if (bet.side === 'OVER' && !isOver) continue;
        if (bet.side === 'UNDER' && !isUnder) continue;
        return { ok: true, odd: out.odds / 1000 };
      }
    }
    return { ok: false, err: 'outcome não encontrado (mercado fechado?)' };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

async function main() {
  const now = Date.now();
  const tMin = new Date(now - WINDOW_AFTER_MIN * 60_000).toISOString();
  const tMax = new Date(now + WINDOW_BEFORE_MIN * 60_000).toISOString();

  // Apostas que: ainda não tem closing E kickoff conhecido E kickoff na janela
  const candidates = db.prepare(`
    SELECT id, evt_id, match, side, line, odd_taken, kickoff_at
    FROM bet_clv
    WHERE odd_closing IS NULL
      AND kickoff_at IS NOT NULL
      AND kickoff_at BETWEEN ? AND ?
  `).all(tMin, tMax);

  console.log(`Candidatos T-${WINDOW_BEFORE_MIN}min: ${candidates.length}`);

  const update = db.prepare(`UPDATE bet_clv
    SET odd_closing = ?, closing_captured_at = ?, clv_pct = ?
    WHERE id = ?`);

  for (const bet of candidates) {
    const res = await captureClosingOdd(bet);
    if (!res.ok) {
      console.log(`  [${bet.id}] ${bet.match} ${bet.side} ${bet.line}: SKIP (${res.err})`);
      continue;
    }
    const clv = (res.odd - bet.odd_taken) / bet.odd_taken * 100;
    update.run(res.odd, new Date().toISOString(), clv, bet.id);
    const sign = clv >= 0 ? '+' : '';
    console.log(`  [${bet.id}] ${bet.match} ${bet.side} ${bet.line}: taken=${bet.odd_taken} closing=${res.odd} CLV=${sign}${clv.toFixed(2)}%`);
    await new Promise(r => setTimeout(r, 300));
  }

  // Sumário CLV
  const stats = db.prepare(`SELECT
    COUNT(*) as n,
    AVG(clv_pct) as avg_clv,
    SUM(CASE WHEN clv_pct > 0 THEN 1 ELSE 0 END) as positive_count
  FROM bet_clv WHERE clv_pct IS NOT NULL`).get();
  if (stats.n > 0) {
    console.log(`\nCLV acumulado (N=${stats.n}): avg ${stats.avg_clv.toFixed(2)}% | positivos: ${stats.positive_count}/${stats.n}`);
    console.log(`  CLV+ médio > 0 → edge real | CLV+ médio < 0 → modelo é fé`);
  }
}

await main();
db.close();
