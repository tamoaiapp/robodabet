// SELECT TREINO v2 — modelo POISSON + slider de risco + Kelly fracionário
//
// Mudanças vs v1:
//   - probOver agora usa Poisson (matematicamente correto pra eventos contáveis)
//   - parâmetros vêm de env: BOT_RISK_LEVEL, BOT_BANKROLL, BOT_MAX_PICKS, BOT_MODE
//   - stake calculada via Kelly fracionário (não mais R$2 fixo)
//   - stop-loss diário: se PNL hoje < -X% bankroll, NÃO seleciona picks
//
// Risk levels (1-10):
//   1-3 Conservador: EV ≥ 10%, Kelly 1/8, stake max R$1, só ligas high conf
//   4-6 Equilibrado: EV ≥ 5%,  Kelly 1/4, stake max R$2, sem low conf
//   7-10 Agressivo:  EV ≥ -5%, Kelly 1/2, stake max R$5, todas ligas

import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

// ── Config via env ─────────────────────────────────────────────
const RISK_LEVEL = Math.max(1, Math.min(10, +(process.env.BOT_RISK_LEVEL || 5)));
const BANKROLL = +(process.env.BOT_BANKROLL || 100);
const MAX_PICKS = +(process.env.BOT_MAX_PICKS || 5);
const MODE = process.env.BOT_MODE || 'treino'; // 'real' | 'treino' | 'paper'
const DATA_DIR = process.env.BOT_DATA_DIR || 'data';

const RISK_PROFILE = (() => {
  if (RISK_LEVEL <= 3) return { evMin: 10, kellyFrac: 0.125, stakeMax: 1, lowConf: false, label: 'Conservador' };
  if (RISK_LEVEL <= 6) return { evMin: 5, kellyFrac: 0.25, stakeMax: 2, lowConf: false, label: 'Equilibrado' };
  return { evMin: -5, kellyFrac: 0.5, stakeMax: 5, lowConf: true, label: 'Agressivo' };
})();

console.log(`Risco ${RISK_LEVEL} (${RISK_PROFILE.label}) | EV≥${RISK_PROFILE.evMin}% | Kelly ${RISK_PROFILE.kellyFrac}× | stake≤R$${RISK_PROFILE.stakeMax}`);
console.log(`Bankroll R$${BANKROLL} | max ${MAX_PICKS} picks | modo ${MODE}`);

// ── Poisson PMF / CDF ──────────────────────────────────────────
// P(X = k | λ) = λ^k * e^-λ / k!
function poissonCdf(k, lambda) {
  // P(X ≤ k)
  if (k < 0) return 0;
  let sum = 0;
  let term = Math.exp(-lambda); // P(X=0)
  sum += term;
  for (let i = 1; i <= k; i++) {
    term *= lambda / i;
    sum += term;
  }
  return sum;
}
function probOver(line, lambda) {
  // X > line. Pra linha .5 (10.5), X >= ceil(11) = 11, então prob = 1 - P(X ≤ 10)
  const k = Math.floor(line);
  return 1 - poissonCdf(k, lambda);
}

// ── Stats por liga (avg de cantos = λ do Poisson) ─────────────
function inferStats(pathArr) {
  const flat = pathArr.map(p => (p.englishName || '')).join(' ').toLowerCase();
  if (/world cup/.test(flat) && !/club/.test(flat) && !/qualif|elimin/.test(flat)) return { lambda: 9.5, league: 'World Cup', conf: 'high', src: '2018 9.47/jogo' };
  if (/premier league/.test(flat) && /england/.test(flat)) return { lambda: 10.9, league: 'EPL', conf: 'high', src: '12552 jogos' };
  if (/championship/.test(flat) && /england/.test(flat)) return { lambda: 11.0, league: 'EFL Championship', conf: 'high', src: '16607 jogos' };
  if (/serie a/.test(flat) && /italy/.test(flat)) return { lambda: 10.3, league: 'Serie A IT', conf: 'high', src: '3179 jogos' };
  if (/la liga|primera division/.test(flat) && /spain/.test(flat)) return { lambda: 10.5, league: 'La Liga', conf: 'high', src: '3190 jogos' };
  if (/bundesliga/.test(flat) && /germany/.test(flat) && !/2\./.test(flat)) return { lambda: 10.1, league: 'Bundesliga', conf: 'high', src: '3807 jogos' };
  if (/ligue 1/.test(flat) && /france/.test(flat)) return { lambda: 9.5, league: 'Ligue 1', conf: 'high', src: '2829 jogos' };
  if (/premiership/.test(flat) && /scotland/.test(flat)) return { lambda: 10.4, league: 'Scotland Prem', conf: 'high', src: '3050 jogos' };
  if (/friendly/.test(flat)) {
    if (/maldivas|maldives|afeganist|paquist|pakistan|bangladesh|nepal|sri lanka|butao|bhutan|mongolia|brunei/i.test(flat)) return null;
    return { lambda: 9.0, league: 'Friendly', conf: 'medium', src: 'recalibrado pós-treino' };
  }
  if (/argentina.*primera division|copa argentina|primera nacional|primera b nacional/.test(flat)) return { lambda: 9.5, league: 'Argentina', conf: 'low', src: 'treino N=1' };
  if (/campeonato uruguayo|uruguay.*primera/.test(flat)) return { lambda: 9.5, league: 'Uruguay', conf: 'low', src: 'treino N=1' };
  if (/primera chile|primera b chile/.test(flat)) return { lambda: 9.5, league: 'Chile', conf: 'low', src: 'treino N=0' };
  if (/liga dimayor|colombia.*dimayor/.test(flat)) return { lambda: 9.5, league: 'Colombia', conf: 'low', src: 'treino N=0' };
  return null;
}

// ── Kelly fracionário ──────────────────────────────────────────
function kellyStake(prob, odd, bankroll, fraction, maxStake) {
  // f* = (p*o - 1) / (o - 1)
  const fStar = (prob * odd - 1) / (odd - 1);
  if (fStar <= 0) return 0;
  const raw = bankroll * fStar * fraction;
  return Math.min(maxStake, Math.max(0.5, Math.round(raw * 2) / 2)); // arredonda 0.5
}

// ── Stop-loss diário ───────────────────────────────────────────
function checkStopLoss() {
  const dbPath = join(DATA_DIR, 'bot.db');
  if (!existsSync(dbPath)) return { blocked: false, pnlToday: 0 };
  const db = new DatabaseSync(dbPath);
  const today = new Date().toISOString().substring(0, 10);
  const r = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as pnl, COUNT(*) as n
    FROM bet_clv WHERE date(settled_at) = ? AND result IN ('won','lost')`).get(today);
  db.close();
  const pnlPct = (r.pnl / BANKROLL) * 100;
  const blocked = pnlPct < -10;
  return { blocked, pnlToday: r.pnl, pnlPct };
}

// ── Main ───────────────────────────────────────────────────────
const stopLoss = checkStopLoss();
console.log(`PNL hoje: R$${stopLoss.pnlToday.toFixed(2)} (${stopLoss.pnlPct?.toFixed(1)}%)`);
if (stopLoss.blocked) {
  console.log(`✗ STOP-LOSS ATIVO (-10% bankroll). Bot pausado hoje.`);
  writeFileSync(join(DATA_DIR, 'corner-treino.json'), '[]');
  process.exit(0);
}

const browser = await chromium.connectOverCDP('http://localhost:9222');
const ctx = browser.contexts()[0];

const r = await ctx.request.get('https://us.offering-api.kambicdn.com/offering/v2018/ktobr/listView/football.json?lang=pt_BR&market=BR&client_id=200&channel_id=1&useCombined=true&useCombinedLive=true', {
  headers: { Accept: 'application/json', Origin: 'https://www.kto.bet.br', Referer: 'https://www.kto.bet.br/' }
});
const data = await r.json();
const events = data.events ?? [];
const preGame = events.filter(w => w.event?.state !== 'STARTED' && w.event?.tags?.includes('MATCH'));
console.log(`Pre-game KTO: ${preGame.length}`);

// Excluir jogos já apostados
const jaApostados = new Set();
const dbPath = join(DATA_DIR, 'bot.db');
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare('SELECT evt_id FROM bet_clv').all();
  for (const r of rows) jaApostados.add(r.evt_id);
  db.close();
}
console.log(`Já apostados (skip): ${jaApostados.size}`);

const now = Date.now();
const opportunities = [];

for (const w of preGame) {
  const ev = w.event;
  const kickoffMs = new Date(ev.start).getTime();
  const horasAte = (kickoffMs - now) / 3600000;
  if (horasAte < 0.5 || horasAte > 48) continue;
  if (jaApostados.has(ev.id)) continue;

  const stats = inferStats(ev.path ?? []);
  if (!stats) continue;
  if (stats.conf === 'low' && !RISK_PROFILE.lowConf) continue;

  const deepUrl = `https://us.offering-api.kambicdn.com/offering/v2018/ktobr/betoffer/event/${ev.id}.json?lang=pt_BR&market=BR&client_id=200&channel_id=1&includeParticipants=true`;
  const dr = await ctx.request.get(deepUrl, {
    headers: { Accept: 'application/json', Origin: 'https://www.kto.bet.br', Referer: 'https://www.kto.bet.br/' }
  });
  if (!dr.ok()) continue;
  const dd = await dr.json();

  for (const o of dd.betOffers ?? []) {
    if (!/^total de escanteios$/i.test(o.criterion?.label ?? '') && !/^total corners$/i.test(o.criterion?.englishLabel ?? '')) continue;
    for (const out of o.outcomes ?? []) {
      const line = out.line / 1000;
      const oddDecimal = out.odds / 1000;
      if (line < 7 || line > 13) continue;
      const isOver = out.type === 'OT_OVER' || /mais/i.test(out.label);
      const isUnder = out.type === 'OT_UNDER' || /menos/i.test(out.label);
      if (!isOver && !isUnder) continue;
      // Insight: amistoso só OVER ≤ 9.5
      if (stats.league === 'Friendly') {
        if (!isOver) continue;
        if (line > 9.5) continue;
      }
      const probReal = isOver ? probOver(line, stats.lambda) : 1 - probOver(line, stats.lambda);
      const ev_pct = (probReal * oddDecimal - 1) * 100;
      if (ev_pct < RISK_PROFILE.evMin) continue;

      const stake = kellyStake(probReal, oddDecimal, BANKROLL, RISK_PROFILE.kellyFrac, RISK_PROFILE.stakeMax);
      if (stake < 0.5) continue;

      opportunities.push({
        match: `${ev.homeName} vs ${ev.awayName}`,
        league: stats.league,
        confidence: stats.conf,
        side: isOver ? 'OVER' : 'UNDER',
        line,
        odd: oddDecimal,
        prob_real: probReal,
        ev_pct,
        stake,
        kickoff: ev.start,
        horas_ate: Number(horasAte.toFixed(1)),
        evt_id: ev.id,
        path: ev.path?.map(p => p.termKey).join('/'),
        model: 'poisson',
        lambda: stats.lambda,
      });
    }
  }
  await new Promise(r => setTimeout(r, 200));
}

// Dedup por jogo: 1 por evt_id, maior EV
const porJogo = new Map();
for (const op of opportunities) {
  const cur = porJogo.get(op.evt_id);
  if (!cur || op.ev_pct > cur.ev_pct) porJogo.set(op.evt_id, op);
}

// Ordena por EV desc, corta em MAX_PICKS, e respeita bankroll total
const sorted = [...porJogo.values()].sort((a, b) => b.ev_pct - a.ev_pct);
const TOP = [];
let stakeTotal = 0;
const stakeMaxDay = BANKROLL * 0.10; // máximo 10% bankroll por dia
for (const op of sorted) {
  if (TOP.length >= MAX_PICKS) break;
  if (stakeTotal + op.stake > stakeMaxDay) continue;
  TOP.push(op);
  stakeTotal += op.stake;
}

console.log(`\n========== PICKS (${MODE.toUpperCase()}) ==========`);
if (TOP.length === 0) {
  console.log('ZERO picks. Sem oportunidades com seu perfil de risco.');
} else {
  TOP.forEach((op, i) => {
    console.log(`[${i+1}] ${op.side} ${op.line} | ${op.match} | ${op.league} [${op.confidence}]`);
    console.log(`    λ=${op.lambda} odd=${op.odd.toFixed(2)} prob=${(op.prob_real*100).toFixed(1)}% EV=${op.ev_pct.toFixed(1)}% stake=R$${op.stake} | em ${op.horas_ate}h`);
  });
  console.log(`\nStake total: R$${stakeTotal.toFixed(2)} (${((stakeTotal/BANKROLL)*100).toFixed(1)}% bankroll)`);
}

writeFileSync(join(DATA_DIR, 'corner-treino.json'), JSON.stringify(TOP, null, 2));
console.log(`Salvo em ${DATA_DIR}/corner-treino.json`);
await browser.close();
