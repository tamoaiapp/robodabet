// Auto-clica "Entrar" na tela de login do KTO depois do Chrome ter aberto.
// Funciona uma única vez — sessão fica salva no perfil dedicado e próximas vezes já abre logado.
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://localhost:9333');
const ctx = browser.contexts()[0];

// Acha a tab de login do KTO
let page = ctx.pages().find(p => p.url().includes('kto.bet.br/app/login'));
if (!page) {
  // Procura qualquer tab do KTO
  page = ctx.pages().find(p => p.url().includes('kto.bet.br'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto('https://www.kto.bet.br/app/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
}
await page.bringToFront();
await new Promise(r => setTimeout(r, 2500));

// Se já está logado (não está em /login/), encerra
if (!page.url().includes('/login')) {
  console.log('JÁ LOGADO em', page.url());
  await browser.close();
  process.exit(0);
}

// Confere se os campos têm valor (autofill do Chrome)
const state = await page.evaluate(() => {
  const email = document.querySelector('input[type="email"], input[name*="email" i], input[autocomplete*="email" i]');
  const pwd = document.querySelector('input[type="password"]');
  return {
    emailFilled: !!(email?.value),
    pwdFilled: (pwd?.value || '').length > 0,
  };
});
console.log('Campos:', state);

if (!state.emailFilled || !state.pwdFilled) {
  console.log('Autofill não preencheu — clicando nos campos pra ativar.');
  try { await page.click('input[type="email"], input[name*="email" i]', { timeout: 3000 }); } catch {}
  await new Promise(r => setTimeout(r, 800));
  try { await page.click('input[type="password"]', { timeout: 3000 }); } catch {}
  await new Promise(r => setTimeout(r, 1500));
}

// Clica "Entrar"
const clicked = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find(b => /^entrar$/i.test((b.innerText || '').trim()));
  if (!btn) return false;
  btn.click();
  return true;
});
console.log('Botão Entrar clicado:', clicked);

if (!clicked) {
  console.log('Botão Entrar não encontrado.');
  await browser.close();
  process.exit(2);
}

await new Promise(r => setTimeout(r, 5000));
console.log('URL após click:', page.url());
const loggedIn = !page.url().includes('/login');
console.log('LOGADO?', loggedIn);

await browser.close();
process.exit(loggedIn ? 0 : 3);
