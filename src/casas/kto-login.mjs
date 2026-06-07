// Tenta logar no KTO usando autofill do Chrome (credenciais salvas no navegador)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const browser = await chromium.connectOverCDP('http://localhost:9333');
const ctx = browser.contexts()[0];

// Achar uma tab já existente em /app/login/ ou abrir nova
let page = ctx.pages().find(p => p.url().includes('/app/login/'));
if (!page) {
  page = await ctx.newPage();
  await page.goto('https://www.kto.bet.br/app/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
}
await page.bringToFront();
await new Promise(r => setTimeout(r, 3000));

console.log('URL:', page.url());

// Verificar se já está logado (redirect pra dashboard ou homepage)
if (!page.url().includes('/app/login/')) {
  console.log('JA LOGADO');
  await browser.close();
  process.exit(0);
}

// Conferir o estado dos campos
const fieldState = await page.evaluate(() => {
  const email = document.querySelector('input[type="email"], input[name*="email" i], input[autocomplete*="email" i]');
  const pwd = document.querySelector('input[type="password"]');
  return {
    emailVal: email?.value || '',
    pwdLen: (pwd?.value || '').length,
    emailExists: !!email,
    pwdExists: !!pwd,
  };
});
console.log('Campos:', fieldState);

if (!fieldState.emailExists || !fieldState.pwdExists) {
  console.log('Campos email/senha não encontrados — abortando');
  mkdirSync('data/bet-debug', { recursive: true });
  await page.screenshot({ path: `data/bet-debug/${Date.now()}_login_fail.png`, fullPage: true });
  await browser.close();
  process.exit(1);
}

if (fieldState.pwdLen === 0) {
  console.log('⚠️  Senha NÃO preenchida pelo autofill. Vou clicar nos campos pra ver se Chrome preenche.');
  await page.click('input[type="email"], input[name*="email" i]');
  await new Promise(r => setTimeout(r, 1500));
  await page.click('input[type="password"]');
  await new Promise(r => setTimeout(r, 1500));

  const after = await page.evaluate(() => ({
    emailVal: document.querySelector('input[type="email"], input[name*="email" i]')?.value || '',
    pwdLen: (document.querySelector('input[type="password"]')?.value || '').length,
  }));
  console.log('Após clicar:', after);

  if (after.pwdLen === 0) {
    console.log('Senha ainda vazia — autofill não disparou. PRECISA preencher manualmente.');
    mkdirSync('data/bet-debug', { recursive: true });
    await page.screenshot({ path: `data/bet-debug/${Date.now()}_no_autofill.png`, fullPage: true });
    await browser.close();
    process.exit(2);
  }
}

console.log('Clicando em Entrar...');
const clicked = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find(b => /^entrar$/i.test((b.innerText || '').trim()));
  if (!btn) return false;
  btn.click();
  return true;
});
console.log('Botão Entrar clicado:', clicked);

// Esperar redirect ou erro
await new Promise(r => setTimeout(r, 8000));
console.log('URL final:', page.url());
const loggedIn = !page.url().includes('/app/login/');
console.log('LOGADO?', loggedIn);

mkdirSync('data/bet-debug', { recursive: true });
await page.screenshot({ path: `data/bet-debug/${Date.now()}_post_login.png`, fullPage: true });

await browser.close();
process.exit(loggedIn ? 0 : 3);
