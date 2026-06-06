import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.BOT_DATA_DIR || 'data';
const MODE = process.env.BOT_MODE || 'treino'; // 'real' | 'treino' | 'paper'
const PAPER = MODE === 'paper';
const LIVE = !PAPER; // só clica "Apostar" se NÃO for paper
const CDP_PORT = process.env.BOT_CDP_PORT || '9222';

const clvDb = new DatabaseSync(join(DATA_DIR, 'bot.db'));
const insertClv = clvDb.prepare(`INSERT INTO bet_clv
  (evt_id, match, league, market, side, line, stake, odd_taken, prob_real, ev_pct_estimated, taken_at, kickoff_at, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const INPUT_FILE = process.argv[2] || join(DATA_DIR, 'corner-treino.json');
const TOP20 = JSON.parse(readFileSync(INPUT_FILE, 'utf8'));
console.log(`Modo: ${MODE.toUpperCase()} ${PAPER ? '(sem clicar Apostar)' : '(apostas REAIS)'}`);
console.log(`Input: ${INPUT_FILE}`);
const stakeTotal = TOP20.reduce((a, p) => a + (p.stake || 2), 0);
console.log(`Total apostas: ${TOP20.length} | Stake total: R$${stakeTotal.toFixed(2)}`);

const slugify = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const ptKey = { football: 'futebol', international_friendly_matches: 'international-friendly-matches', brazil: 'brasil', brasileirao_serie_b: 'brasileirao-serie-b' };

function buildUrl(op) {
  const parts = op.path.split('/');
  const ptPath = parts.map(p => (ptKey[p] ?? p).replace(/_/g, '-')).join('/');
  const [home, away] = op.match.split(' vs ');
  const matchSlug = `${slugify(home)}---${slugify(away)}`;
  return `https://www.kto.bet.br/app/esportes/${ptPath}/${matchSlug}/${op.evt_id}/tab/all`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sleepH = (a, b) => new Promise(r => setTimeout(r, a + Math.random() * (b - a)));

async function dumpDebug(page, tag) {
  const dir = 'data/bet-debug';
  mkdirSync(dir, { recursive: true });
  const stamp = Date.now();
  try {
    await page.screenshot({ path: join(dir, `${stamp}_${tag}.png`), fullPage: true });
    writeFileSync(join(dir, `${stamp}_${tag}.html`), await page.content());
  } catch {}
}

async function placeOne(ctx, op, i, total) {
  const page = await ctx.newPage();
  const result = { op, status: 'pending', reason: '' };
  try {
    const url = buildUrl(op);
    console.log(`\n[${i+1}/${total}] ${op.side} ${op.line} ${op.match}`);
    console.log(`  URL: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleepH(5_000, 7_000);

    if (page.url().includes('/app/login/')) {
      result.status = 'failed';
      result.reason = 'login_redirect';
      await page.close();
      return result;
    }

    // POLL até a tab "Escanteios" aparecer (Kambi iframe pode demorar carregar)
    let tabClicked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const clicked = await page.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('li, a, button, [role="tab"]'));
        const tab = tabs.find(el => /^escanteios$/i.test((el.innerText || '').trim()));
        if (!tab) return false;
        tab.click();
        return true;
      });
      if (clicked) { tabClicked = true; console.log(`  Tab Escanteios OK (poll ${attempt+1}/30)`); break; }
      await sleepH(1_800, 2_200);
    }
    if (!tabClicked) {
      console.log(`  ✗ Tab Escanteios NÃO carregou em 60s`);
      await dumpDebug(page, `no_tab_${op.evt_id}`);
      result.status = 'failed';
      result.reason = 'tab_escanteios_not_found';
      await page.close();
      return result;
    }
    await sleepH(3_000, 5_000);

    // LIMPAR BET SLIP: remover qualquer seleção pendente antes de adicionar a nova
    const cleared = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button[aria-label*="emover desfecho" i], button.mod-KambiBC-betslip-outcome__close-btn'));
      let n = 0;
      for (const b of candidates) { b.click(); n++; }
      return n;
    });
    if (cleared > 0) console.log(`  Limpou ${cleared} seleção(ões) do slip`);
    await sleepH(800, 1200);

    // Esperar tab Escanteios carregar
    await page.locator('text="Total de escanteios"').first().waitFor({ timeout: 20_000 }).catch(() => null);
    await sleepH(1_500, 2_500);

    // EXPANDIR: clicar em TODOS os botões "Mostrar lista" dentro de seções "Total de escanteios"
    // O KTO mostra só a linha principal por padrão; outras linhas (7.5, 8.5, 12.5) ficam atrás desse botão
    const expanded = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      let clicked = 0;
      for (const btn of buttons) {
        const txt = (btn.innerText || '').trim();
        if (!/^mostrar lista$/i.test(txt)) continue;
        // Verificar se está num contexto "Total de escanteios"
        let parent = btn.parentElement;
        let context = '';
        for (let depth = 0; depth < 8 && parent; depth++) {
          context = parent.innerText || '';
          if (/total de escanteios/i.test(context)) break;
          parent = parent.parentElement;
        }
        if (/total de escanteios/i.test(context)) {
          btn.click();
          clicked++;
        }
      }
      return clicked;
    });
    console.log(`  Expandiu ${expanded} listas`);
    await sleepH(2_000, 3_000);

    const sideLabel = op.side === 'OVER' ? 'Mais' : 'Menos';
    const lineStr = String(op.line);
    const targetMarker = `auto-bet-${op.evt_id}-${Date.now()}`;

    // Marca o botão alvo com data-attribute pra usar Playwright locator depois (que faz auto-scroll)
    const found = await page.evaluate(({ sideLabel, lineStr, marker }) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const candidates = [];
      const re = new RegExp(`^${sideLabel}\\s*\\n\\s*${lineStr.replace('.', '\\.')}\\s*\\n\\s*\\d+\\.\\d{2}\\s*$`);
      for (const el of buttons) {
        const txt = (el.innerText || '').trim();
        if (!re.test(txt)) continue;
        let parent = el.parentElement;
        let marketTitle = '';
        for (let depth = 0; depth < 12 && parent; depth++) {
          const ctx = (parent.innerText || '').trim();
          const lines = ctx.split('\n').map(l => l.trim()).filter(Boolean);
          for (const ln of lines) {
            if (/^total de escanteios$/i.test(ln) || /escanteios.*1º|escanteios.*2º|escanteios por|handicap.*escanteios|escanteios alternativ/i.test(ln)) {
              marketTitle = ln;
              break;
            }
          }
          if (marketTitle) break;
          parent = parent.parentElement;
        }
        if (/^total de escanteios$/i.test(marketTitle)) {
          candidates.push({ text: txt, marketTitle });
          // Marca o primeiro candidato encontrado
          if (candidates.length === 1) el.setAttribute('data-auto-bet', marker);
        }
      }
      return candidates;
    }, { sideLabel, lineStr, marker: targetMarker });

    console.log(`  Candidatos encontrados: ${found.length}`);

    if (found.length === 0) {
      await dumpDebug(page, `no_outcome_${op.evt_id}`);
      result.status = 'failed';
      result.reason = 'outcome_not_found';
      await page.close();
      return result;
    }

    const target = found[0];
    console.log(`  Clicando em: ${target.text.replace(/\n/g, '|')}`);
    // Click via Playwright locator (faz auto-scroll + auto-wait)
    const targetLocator = page.locator(`[data-auto-bet="${targetMarker}"]`).first();
    await targetLocator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => null);
    await sleepH(500, 800);
    await targetLocator.click({ timeout: 5000 });
    await sleepH(2_000, 3_000);

    // Procurar stake input
    const stakeInputs = ['input.KambiBC-bet-amount-input__input', 'input[class*="stake-input" i]', 'input[class*="KambiBC-bet-amount" i]', 'input[type="text"][inputmode="decimal"]'];
    let stakeInput = null;
    for (const sel of stakeInputs) {
      const l = page.locator(sel).first();
      if (await l.isVisible({ timeout: 2500 }).catch(() => false)) {
        stakeInput = l;
        break;
      }
    }
    if (!stakeInput) {
      await dumpDebug(page, `no_stake_${op.evt_id}`);
      result.status = 'failed';
      result.reason = 'stake_input_not_found';
      await page.close();
      return result;
    }

    // VALIDAÇÃO: confirmar que o bet slip contém o pick certo
    const slipText = await page.locator('[class*="betslip" i], [class*="bet-slip" i]').first().innerText().catch(() => '');
    console.log(`  Bet slip preview: ${slipText.substring(0, 200)}`);
    const containsLine = slipText.includes(lineStr);
    const containsSide = slipText.toLowerCase().includes(sideLabel.toLowerCase());
    if (!containsLine || !containsSide) {
      await dumpDebug(page, `slip_mismatch_${op.evt_id}`);
      result.status = 'aborted';
      result.reason = `slip_mismatch (line:${containsLine} side:${containsSide})`;
      await page.close();
      return result;
    }

    const stakeStr = String(op.stake || 2);
    await stakeInput.click({ timeout: 3000 });
    await sleepH(200, 400);
    await stakeInput.fill('');
    await sleepH(150, 300);
    await stakeInput.type(stakeStr, { delay: 80 });
    await sleepH(1000, 1500);

    if (!LIVE) {
      console.log(`  [PAPER] Aposta simulada — odd capturada, NÃO confirmada.`);
      try {
        insertClv.run(
          op.evt_id, op.match, op.league ?? null, 'corners',
          op.side, op.line, Number(stakeStr), op.odd ?? null,
          op.prob_real ?? null, op.ev_pct ?? null,
          new Date().toISOString(), op.kickoff ?? null, 'paper'
        );
      } catch (e) { console.log(`  CLV insert err: ${e.message}`); }
      result.status = 'paper';
      result.reason = 'paper_mode';
      await page.close();
      return result;
    }

    await dumpDebug(page, `before_${op.evt_id}`);

    // Confirmar Apostar
    const confirmSelectors = ['button[aria-label="Apostar"]', 'button.mod-KambiBC-betslip__place-bet-btn', 'button[class*="mod-KambiBC-betslip__place-bet"]', 'button[class*="place-bet-btn"]'];
    let confirmed = false;
    for (const sel of confirmSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          const enabled = await btn.isEnabled({ timeout: 1000 }).catch(() => false);
          if (!enabled) continue;
          await btn.click({ timeout: 3000 });
          confirmed = true;
          break;
        }
      } catch {}
    }
    if (!confirmed) {
      await dumpDebug(page, `no_confirm_${op.evt_id}`);
      result.status = 'failed';
      result.reason = 'confirm_btn_not_clicked';
      await page.close();
      return result;
    }

    await sleepH(2500, 4000);
    await dumpDebug(page, `after_${op.evt_id}`);
    result.status = 'placed';
    console.log(`  ✓ APOSTA CONFIRMADA`);
    // CLV: registrar pick recém confirmada
    try {
      insertClv.run(
        op.evt_id, op.match, op.league ?? null, 'corners',
        op.side, op.line, Number(op.stake || 2), op.odd ?? null,
        op.prob_real ?? null, op.ev_pct ?? null,
        new Date().toISOString(), op.kickoff ?? null, 'real'
      );
    } catch (e) { console.log(`  CLV insert err: ${e.message}`); }
  } catch (e) {
    result.status = 'failed';
    result.reason = e.message;
    console.log(`  ✗ ERRO: ${e.message}`);
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

const browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);
const ctx = browser.contexts()[0];

const results = [];
for (let i = 0; i < TOP20.length; i++) {
  const r = await placeOne(ctx, TOP20[i], i, TOP20.length);
  results.push(r);
  await sleepH(3_000, 5_000);
}

// Sumário
const placed = results.filter(r => r.status === 'placed');
const failed = results.filter(r => r.status === 'failed' || r.status === 'aborted');
console.log('\n=========== SUMÁRIO ===========');
console.log(`✓ placed: ${placed.length}`);
console.log(`✗ failed/aborted: ${failed.length}`);
console.log(`Stake total: R$${placed.length * 2}`);

if (failed.length > 0) {
  console.log('\nFALHAS:');
  failed.forEach(r => console.log(`  ${r.op.match} ${r.op.side} ${r.op.line}: ${r.reason}`));
}

writeFileSync('data/corner-batch-result.json', JSON.stringify(results, null, 2));
console.log('\nResultado salvo em data/corner-batch-result.json');
