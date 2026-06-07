import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const browser = await chromium.connectOverCDP('http://localhost:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();

await page.goto('https://www.kto.bet.br/app/esportes/historico-de-apostas/2026-06-01', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 10000));

if (page.url().includes('login')) { console.log('SESSAO EXPIROU'); process.exit(1); }

// Click tab Expirado
await page.evaluate(() => {
  const tabs = Array.from(document.querySelectorAll('button, [role="tab"], li, a'));
  for (const el of tabs) {
    const t = (el.innerText || '').trim().toLowerCase();
    if (t === 'expirado' || t === 'expiradas') { el.click(); return; }
  }
});
await new Promise(r => setTimeout(r, 5000));

// Mostrar mais 3x
for (let i = 0; i < 5; i++) {
  const ok = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(b => /mostrar mais/i.test((b.innerText || '').trim()));
    if (!b) return false;
    b.click(); return true;
  });
  if (!ok) break;
  await new Promise(r => setTimeout(r, 2500));
}

await new Promise(r => setTimeout(r, 2000));

const bets = await page.evaluate(() => {
  const all = document.querySelectorAll('*');
  const seen = new Set(); const items = [];
  for (const el of all) {
    const txt = (el.innerText || '').trim();
    if (txt.length < 100 || txt.length > 1500) continue;
    if (!/ID Do Cupom/i.test(txt)) continue;
    const m = txt.match(/ID Do Cupom:\s*(\d+)/i);
    const key = m ? m[1] : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(txt.substring(0, 800));
  }
  return items;
});

writeFileSync('data/bet-history-expiradas.json', JSON.stringify(bets, null, 2));
console.log(`Salvos ${bets.length} cupons em data/bet-history-expiradas.json`);
await page.close();
await browser.close();
