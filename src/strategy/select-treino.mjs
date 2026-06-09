// SELECT TREINO v3 — USA KAMBI API DIRETO (sem Playwright/Chrome)
//
// Antes: connectOverCDP no Chrome → ctx.request.get(kambi)
// Agora: fetch direto da Kambi API. ~1s em vez de 5-15s, sem RAM, sem CDP bug.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { listFootballEvents, getEventBetOffers } from '../casas/kambi-api.mjs';
import { calibrateLambdas, loadCalibrations } from './calibrate.mjs';
import { fetchFederatedCalibrations, loadCachedCalibrations } from './federated.mjs';

// Recalibra LOCAL ao iniciar (idempotente, só faz algo se >=30 settled)
calibrateLambdas();
const LOCAL_CALIB = loadCalibrations();

// Calibrações da REDE (cache 6h, refetch em background sem bloquear)
const NET_CALIB_DATA = loadCachedCalibrations();
fetchFederatedCalibrations().catch(() => {});  // fire and forget

// Merge: rede ganha se N >= 30, senão local. Blacklist da rede sempre vale.
const CALIBRATIONS = {};
const NET_BLACKLIST = new Set();
for (const [lg, info] of Object.entries(NET_CALIB_DATA.leagues || {})) {
  if (info.blacklist) NET_BLACKLIST.add(lg);
  if (info.lambda && info.n >= 30) CALIBRATIONS[lg] = info;
}
for (const [lg, info] of Object.entries(LOCAL_CALIB)) {
  if (!CALIBRATIONS[lg]) CALIBRATIONS[lg] = info;  // local só se rede ainda não tem
}
if (NET_BLACKLIST.size) console.log(`Blacklist rede: ${[...NET_BLACKLIST].join(', ')}`);
console.log(`Calibrações ativas: ${Object.keys(CALIBRATIONS).length} (rede ${NET_CALIB_DATA.n_total || 0} jogos)`);

// ── Config via env ─────────────────────────────────────────────
const RISK_LEVEL = Math.max(1, Math.min(10, +(process.env.BOT_RISK_LEVEL || 5)));
const BANKROLL = +(process.env.BOT_BANKROLL || 100);
const MAX_PICKS = +(process.env.BOT_MAX_PICKS || 5);
const MAX_PICKS_PER_DAY = +(process.env.BOT_MAX_PICKS_PER_DAY || 10);
const MODE = process.env.BOT_MODE || 'treino';
const DATA_DIR = process.env.BOT_DATA_DIR || 'data';
const FORCE_STAKE = process.env.BOT_FORCE_STAKE ? +process.env.BOT_FORCE_STAKE : null;
const MARKETS = (process.env.BOT_MARKETS || 'corners').toLowerCase().split(',').map(s => s.trim());

const RISK_PROFILE = (() => {
  // Conservador: "pega o mais SEGURO disponível" — prefere linhas baixas (alta prob),
  // sempre devolve pelo menos 1 pick se houver jogo elegível (prob ≥ 70%)
  // lowConf=false: só aposta em ligas medium/high (após perdas em Uruguay/Colombia/Chile)
  if (RISK_LEVEL <= 3) return {
    evMin: 0, kellyFrac: 0.125, stakeMax: 1, lowConf: false, label: 'Conservador',
    sortBy: 'prob', minProb: 0.70, fallbackAcceptAnyEV: true, preferLowLines: true,
  };
  // Equilibrado: balanceado — EV ≥ 5%, linhas médias
  if (RISK_LEVEL <= 6) return {
    evMin: 5, kellyFrac: 0.25, stakeMax: 2, lowConf: false, label: 'Equilibrado',
    sortBy: 'ev', minProb: 0.35, fallbackAcceptAnyEV: false, preferLowLines: false,
  };
  // Agressivo: corre atrás de odd grande — aceita azarões
  return {
    evMin: -5, kellyFrac: 0.5, stakeMax: 5, lowConf: true, label: 'Agressivo',
    sortBy: 'ev', minProb: 0.15, fallbackAcceptAnyEV: false, preferLowLines: false,
  };
})();

console.log(`Risco ${RISK_LEVEL} (${RISK_PROFILE.label}) | EV≥${RISK_PROFILE.evMin}% | Kelly ${RISK_PROFILE.kellyFrac}× | stake≤R$${RISK_PROFILE.stakeMax}`);
console.log(`Bankroll R$${BANKROLL} | max ${MAX_PICKS} picks | modo ${MODE}${FORCE_STAKE ? ` | stake forçada R$${FORCE_STAKE}` : ''}`);

// ── Poisson PMF / CDF ──────────────────────────────────────────
function poissonCdf(k, lambda) {
  if (k < 0) return 0;
  let sum = 0, term = Math.exp(-lambda);
  sum += term;
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term; }
  return sum;
}
function probOver(line, lambda) {
  const k = Math.floor(line);
  return 1 - poissonCdf(k, lambda);
}

// ── Stats por liga (avg de cantos = λ do Poisson) ─────────────
function inferStats(pathArr) {
  const flat = pathArr.map(p => (p.englishName || '')).join(' ').toLowerCase();
  const stats = _inferStatsRaw(flat);
  // Aplica calibração aprendida se houver
  if (stats) {
    const cal = CALIBRATIONS[stats.league];
    if (cal && cal.lambda) {
      stats.lambda = cal.lambda;
      stats.calibrated = true;
    }
  }
  return stats;
}

function _inferStatsRaw(flat) {
  // lambda_goals: média de gols por jogo (avg histórico). Usado pra OVER 2.5 etc.
  if (/world cup/.test(flat) && !/club/.test(flat) && !/qualif|elimin/.test(flat)) return { lambda: 9.5, lambda_goals: 2.5, league: 'World Cup', conf: 'high' };
  if (/premier league/.test(flat) && /england/.test(flat)) return { lambda: 10.9, lambda_goals: 2.8, league: 'EPL', conf: 'high' };
  if (/championship/.test(flat) && /england/.test(flat)) return { lambda: 11.0, lambda_goals: 2.5, league: 'EFL Championship', conf: 'high' };
  if (/serie a/.test(flat) && /italy/.test(flat)) return { lambda: 10.3, lambda_goals: 2.6, league: 'Serie A IT', conf: 'high' };
  if (/la liga|primera division/.test(flat) && /spain/.test(flat)) return { lambda: 10.5, lambda_goals: 2.5, league: 'La Liga', conf: 'high' };
  if (/bundesliga/.test(flat) && /germany/.test(flat) && !/2\./.test(flat)) return { lambda: 10.1, lambda_goals: 3.1, league: 'Bundesliga', conf: 'high' };
  if (/ligue 1/.test(flat) && /france/.test(flat)) return { lambda: 9.5, lambda_goals: 2.7, league: 'Ligue 1', conf: 'high' };
  if (/premiership/.test(flat) && /scotland/.test(flat)) return { lambda: 10.4, lambda_goals: 2.8, league: 'Scotland Prem', conf: 'high' };
  if (/friendly/.test(flat)) {
    if (/maldivas|maldives|afeganist|paquist|pakistan|bangladesh|nepal|sri lanka|butao|bhutan|mongolia|brunei/i.test(flat)) return null;
    return { lambda: 9.0, lambda_goals: 2.6, league: 'Friendly', conf: 'medium' };
  }
  if (/argentina.*primera division|copa argentina|primera nacional|primera b nacional/.test(flat)) return { lambda: 9.5, lambda_goals: 2.2, league: 'Argentina', conf: 'medium' };
  if (/campeonato uruguayo|uruguay.*primera/.test(flat)) return { lambda: 9.5, lambda_goals: 2.3, league: 'Uruguay', conf: 'low' };
  if (/primera chile|primera b chile/.test(flat)) return { lambda: 9.5, lambda_goals: 2.4, league: 'Chile', conf: 'low' };
  if (/liga dimayor|colombia.*dimayor/.test(flat)) return { lambda: 9.5, lambda_goals: 2.2, league: 'Colombia', conf: 'low' };
  return null;
}

// ── AUTO-BLACKLIST: ligas que perderam dinheiro de verdade ────
// Lê o histórico real e bane ligas com ROI ≤ -30% e N ≥ 3.
// É o "treino" — o bot aprende dos próprios resultados.
function loadLeagueBlacklist() {
  const dbPath = join(DATA_DIR, 'bot.db');
  if (!existsSync(dbPath)) return new Set();
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(`SELECT league, COUNT(*) n,
    SUM(CASE WHEN result IN ('won','lost') THEN stake ELSE 0 END) stake_settled,
    SUM(pnl) pnl
    FROM bet_clv WHERE market='corners' AND result IN ('won','lost')
    GROUP BY league HAVING n >= 3`).all();
  db.close();
  const blacklist = new Set();
  for (const r of rows) {
    if (r.stake_settled <= 0) continue;
    const roi = r.pnl / r.stake_settled * 100;
    if (roi <= -30) {
      blacklist.add(r.league);
      console.log(`  ⛔ Liga PAUSADA: ${r.league} (N=${r.n}, ROI=${roi.toFixed(1)}%)`);
    }
  }
  return blacklist;
}

// ── Kelly fracionário ──────────────────────────────────────────
function kellyStake(prob, odd, bankroll, fraction, maxStake) {
  const fStar = (prob * odd - 1) / (odd - 1);
  if (fStar <= 0) return 0;
  const raw = bankroll * fStar * fraction;
  return Math.min(maxStake, Math.max(0.5, Math.round(raw * 2) / 2));
}

// ── Stop-loss diário ───────────────────────────────────────────
function checkStopLoss() {
  const dbPath = join(DATA_DIR, 'bot.db');
  if (!existsSync(dbPath)) return { blocked: false, pnlToday: 0 };
  const db = new DatabaseSync(dbPath);
  const today = new Date().toISOString().substring(0, 10);
  const r = db.prepare(`SELECT COALESCE(SUM(pnl), 0) as pnl FROM bet_clv WHERE date(settled_at) = ? AND result IN ('won','lost')`).get(today);
  db.close();
  const pnlPct = (r.pnl / BANKROLL) * 100;
  return { blocked: pnlPct < -10, pnlToday: r.pnl, pnlPct };
}

// ── Main ───────────────────────────────────────────────────────
function checkDailyLimit() {
  const dbPath = join(DATA_DIR, 'bot.db');
  if (!existsSync(dbPath)) return { count: 0, blocked: false };
  const db = new DatabaseSync(dbPath);
  const today = new Date().toISOString().substring(0, 10);
  // Lê reset overrides — se BOT_DAILY_RESET_AT > apostas do dia, o user "liberou mais"
  const resetPath = join(DATA_DIR, 'daily-reset.json');
  let resetAt = null;
  if (existsSync(resetPath)) {
    try { resetAt = JSON.parse(readFileSync(resetPath, 'utf8'))[today] || null; } catch {}
  }
  const where = resetAt
    ? `date(taken_at) = ? AND taken_at > ?`
    : `date(taken_at) = ?`;
  const params = resetAt ? [today, resetAt] : [today];
  const r = db.prepare(`SELECT COUNT(*) as n FROM bet_clv WHERE ${where}`).get(...params);
  db.close();
  return { count: r.n, blocked: r.n >= MAX_PICKS_PER_DAY };
}

async function main() {
  const stopLoss = checkStopLoss();
  console.log(`PNL hoje: R$${stopLoss.pnlToday.toFixed(2)} (${stopLoss.pnlPct?.toFixed(1)}%)`);
  if (stopLoss.blocked) {
    console.log(`✗ STOP-LOSS ATIVO (-10% bankroll). Bot pausado hoje.`);
    writeFileSync(join(DATA_DIR, 'corner-treino.json'), '[]');
    return;
  }

  const daily = checkDailyLimit();
  console.log(`Apostas hoje: ${daily.count}/${MAX_PICKS_PER_DAY}`);
  if (daily.blocked) {
    console.log(`✗ LIMITE DIÁRIO ATINGIDO (${MAX_PICKS_PER_DAY}). Use "Liberar mais apostas" pra continuar hoje.`);
    writeFileSync(join(DATA_DIR, 'corner-treino.json'), '[]');
    return;
  }

  console.log('Buscando jogos via Kambi API...');
  const t0 = Date.now();
  const preGame = await listFootballEvents();
  console.log(`Pre-game KTO: ${preGame.length} (${Date.now() - t0}ms)`);

  // Excluir jogos já apostados (banco + arquivo de exclusão manual)
  const jaApostados = new Set();
  const dbPath = join(DATA_DIR, 'bot.db');
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath);
    const rows = db.prepare('SELECT evt_id FROM bet_clv').all();
    for (const r of rows) jaApostados.add(r.evt_id);
    db.close();
  }
  const exclPath = join(DATA_DIR, 'excluded-evt-ids.json');
  if (existsSync(exclPath)) {
    try {
      const arr = JSON.parse(readFileSync(exclPath, 'utf8'));
      for (const id of arr) jaApostados.add(Number(id));
    } catch {}
  }
  console.log(`Já apostados (skip): ${jaApostados.size}`);

  // Auto-blacklist: ligas que perderam dinheiro no histórico real
  const blacklist = loadLeagueBlacklist();

  // Filtra elegíveis + chama API só pros eventos que valem (paralelo)
  const now = Date.now();
  const elegiveis = [];
  for (const w of preGame) {
    const ev = w.event;
    const horasAte = (new Date(ev.start).getTime() - now) / 3600000;
    if (horasAte < 0.5 || horasAte > 48) continue;
    if (jaApostados.has(ev.id)) continue;
    const stats = inferStats(ev.path ?? []);
    if (!stats) continue;
    if (stats.conf === 'low' && !RISK_PROFILE.lowConf) continue;
    if (blacklist.has(stats.league)) continue;
    if (NET_BLACKLIST.has(stats.league)) continue;  // blacklist global da rede
    elegiveis.push({ ev, horasAte, stats });
  }
  console.log(`Elegíveis: ${elegiveis.length}`);

  // Pega bet offers em paralelo (limitado a 8 simultâneos pra não floodar)
  const opportunities = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < elegiveis.length; i += CONCURRENCY) {
    const batch = elegiveis.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async ({ ev, horasAte, stats }) => {
      try {
        const offers = await getEventBetOffers(ev.id);
        const opps = [];
        for (const o of offers) {
          // Identifica mercado (corners / goals)
          const labelBR = (o.criterion?.label ?? '').toLowerCase();
          const labelEN = (o.criterion?.englishLabel ?? '').toLowerCase();
          let market = null;
          let lambda = null;
          if (/^total de escanteios$/.test(labelBR) || /^total corners$/.test(labelEN)) {
            market = 'corners';
            lambda = stats.lambda;
          } else if ((/^total de gols$/.test(labelBR) || /^total goals$/.test(labelEN)) && stats.lambda_goals) {
            market = 'goals';
            lambda = stats.lambda_goals;
          }
          if (!market || !MARKETS.includes(market)) continue;

          for (const out of o.outcomes ?? []) {
            const line = out.line / 1000;
            const oddDecimal = out.odds / 1000;
            // Limites por mercado
            if (market === 'corners' && (line < 7 || line > 13)) continue;
            if (market === 'goals' && (line < 1.5 || line > 4.5)) continue;
            const isOver = out.type === 'OT_OVER' || /mais/i.test(out.label);
            const isUnder = out.type === 'OT_UNDER' || /menos/i.test(out.label);
            if (!isOver && !isUnder) continue;
            // Amistoso só OVER ≤ 9.5 em cantos
            if (market === 'corners' && stats.league === 'Friendly' && !RISK_PROFILE.preferLowLines) {
              if (!isOver) continue;
              if (line > 9.5) continue;
            }
            const probReal = isOver ? probOver(line, lambda) : 1 - probOver(line, lambda);
            const ev_pct = (probReal * oddDecimal - 1) * 100;
            const passEv = RISK_PROFILE.fallbackAcceptAnyEV
              ? (probReal >= RISK_PROFILE.minProb && ev_pct >= 0)
              : ev_pct >= RISK_PROFILE.evMin;
            if (!passEv) continue;
            if (probReal < RISK_PROFILE.minProb) continue;
            const stake = FORCE_STAKE != null ? FORCE_STAKE : kellyStake(probReal, oddDecimal, BANKROLL, RISK_PROFILE.kellyFrac, RISK_PROFILE.stakeMax);
            if (stake < 0.5) continue;
            opps.push({
              match: `${ev.homeName} vs ${ev.awayName}`,
              league: stats.league,
              confidence: stats.conf,
              market,
              side: isOver ? 'OVER' : 'UNDER',
              line, odd: oddDecimal,
              prob_real: probReal,
              ev_pct, stake,
              kickoff: ev.start,
              horas_ate: Number(horasAte.toFixed(1)),
              evt_id: ev.id,
              path: ev.path?.map(p => p.termKey).join('/'),
              lambda,
              model: 'poisson',
            });
          }
        }
        return opps;
      } catch (e) {
        return [];
      }
    }));
    for (const opps of results) opportunities.push(...opps);
  }

  // Dedup por jogo: 1 por evt_id, maior <métrica> (prob pra Conservador, EV pra resto)
  const porJogo = new Map();
  const isBetter = (a, b) => RISK_PROFILE.sortBy === 'prob'
    ? a.prob_real > b.prob_real
    : a.ev_pct > b.ev_pct;
  for (const op of opportunities) {
    const cur = porJogo.get(op.evt_id);
    if (!cur || isBetter(op, cur)) porJogo.set(op.evt_id, op);
  }

  const sorted = [...porJogo.values()].sort((a, b) =>
    RISK_PROFILE.sortBy === 'prob' ? b.prob_real - a.prob_real : b.ev_pct - a.ev_pct
  );
  const TOP = [];
  let stakeTotal = 0;
  const stakeMaxDay = BANKROLL * 0.10;
  for (const op of sorted) {
    if (TOP.length >= MAX_PICKS) break;
    if (stakeTotal + op.stake > stakeMaxDay && FORCE_STAKE == null) continue;
    TOP.push(op);
    stakeTotal += op.stake;
  }

  console.log(`\n========== PICKS (${MODE.toUpperCase()}) ==========`);
  if (TOP.length === 0) {
    console.log('ZERO picks. Sem oportunidades com seu perfil de risco.');
  } else {
    TOP.forEach((op, i) => {
      console.log(`[${i + 1}] ${op.side} ${op.line} | ${op.match} | ${op.league} [${op.confidence}]`);
      console.log(`    λ=${op.lambda} odd=${op.odd.toFixed(2)} prob=${(op.prob_real * 100).toFixed(1)}% EV=${op.ev_pct.toFixed(1)}% stake=R$${op.stake} em ${op.horas_ate}h`);
    });
    console.log(`\nStake total: R$${stakeTotal.toFixed(2)} (${((stakeTotal / BANKROLL) * 100).toFixed(1)}% bankroll)`);
  }

  writeFileSync(join(DATA_DIR, 'corner-treino.json'), JSON.stringify(TOP, null, 2));
  console.log(`Salvo em ${DATA_DIR}/corner-treino.json`);
}

await main();
