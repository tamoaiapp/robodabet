# CLAUDE.md — Robô da Bet

> Instruções persistentes pra qualquer Claude trabalhando neste projeto. Leia isso antes de fazer qualquer mudança.

## O que é

**Robô da Bet** é app desktop Electron (Windows 10/11) que automatiza apostas esportivas no **mercado de Total de Escanteios** da casa **KTO** (Kambi engine). Cliente paga **R$197 pagamento único** e recebe instalador `.exe`.

- Marca/venda: **iaempresa.app**
- Source: este repo (`tamoaiapp/robodabet`)
- Releases: GitHub Releases com Setup.exe
- Auto-update: `electron-updater`
- Inspirado em **PostMaster** (mesma arquitetura/CI/release)

## Stack

| Componente | Lib | Versão |
|---|---|---|
| Runtime | Electron | 32.x |
| Empacotador | electron-builder | 25.x |
| Automação navegador | Playwright + CDP attach | 1.44 |
| DB | node:sqlite (nativo Node 22.5+) | — |
| HTTP | fetch nativo | — |

**Decisão importante:** Robô usa **CDP attach** ao Chrome do usuário (igual `bot-corners-batch.mjs` original). Cliente abre Chrome com `--remote-debugging-port=9222` + perfil próprio onde já está logado no KTO. Isso reduz detecção de anti-bot vs Playwright headless puro.

## Estrutura

```
robodabet/
├── main.js                     # Electron main process. IPC handlers + autoUpdater.
├── preload.js                  # API exposta ao renderer.
├── renderer/                   # UI HTML+CSS+JS sem framework.
├── src/
│   ├── strategy/
│   │   └── select-treino.mjs   # Sniffa Kambi API, calcula EV, filtra picks
│   ├── bet/
│   │   └── place-bets.mjs      # Loop placeOne(): tab Escanteios + Mostrar lista + click outcome + stake + confirma
│   ├── clv/
│   │   ├── snapshot-closing.mjs # Captura odd T-5min via Kambi API, calcula CLV
│   │   ├── settle.mjs           # Lê histórico KTO + atualiza bet_clv (won/lost/pnl)
│   │   └── report.mjs           # ROI + CLV por liga/linha/mercado
│   ├── casas/
│   │   ├── kto-login.mjs        # Autofill Chrome do usuário pra logar KTO
│   │   └── kto-history.mjs      # Puxa /minhas-apostas/, extrai cupons
│   ├── db/
│   │   └── schema.mjs           # Cria tabela bet_clv se não existe
│   └── supportAgent.mjs        # Chat de ajuda via VPS bridge (Claude Code)
└── electron-builder.yml
```

## Modelo estatístico (CORE do produto)

Para o mercado **Total de Escanteios**, modelo usa **distribuição normal** com `avg` e `std` por liga:

```js
function probOver(line, avg, std) {
  return 1 - normCdf((line - avg) / std);
}
function EV(odd, probReal) {
  return probReal * odd - 1; // > 0 = aposta de valor
}
```

**Avg/std calibrados** (do backtest 87k jogos europeus + análise Russia 2018):

| Liga | avg | std | Fonte |
|---|---|---|---|
| EPL | 10.9 | 3.7 | 12552 jogos |
| EFL Championship | 11.0 | 3.6 | 16607 jogos |
| Serie A IT | 10.3 | 3.4 | 3179 jogos |
| La Liga | 10.5 | 3.6 | 3190 jogos |
| Bundesliga | 10.1 | 3.6 | 3807 jogos |
| Ligue 1 | 9.5 | 3.4 | 2829 jogos |
| Copa do Mundo | 9.5 | 3.4 | Russia 2018 9.47/jogo |
| Amistoso (recalibrado) | 9.0 | 3.3 | Treino 2026-06 |

**Ligas REJEITADAS** (sem dado real ou modelo errou):
- Brasileirão (qualquer divisão) — 0/4 settled
- Sul-Am — amostra mínima, jogo a jogo

## Regras de gestão

1. **1 aposta por jogo** — NUNCA empilhar várias linhas/mercados do mesmo evento. Correlacionadas viram all-in disfarçado.
2. **EV ≥ 5%** (modo conservador) ou ≥ -5% (modo treino pra coletar dado).
3. **Stake fixo R$1-2 por pick** (modo treino) ou Kelly fracionário 0.25x (futuro).
4. **Stop-loss diário**: limite 10 picks/dia ou R$20 stake total.
5. **Anti-bot KTO**: desloga após ~5 apostas seguidas. Rodar em chunks de ≤5 + relogar.

## CLV — métrica de edge real

CLV = (odd_closing − odd_taken) / odd_taken × 100

Pra cada pick: salva odd ao apostar, captura odd 5min antes do kickoff via Kambi API, calcula CLV. **Sem CLV positivo médio comprovado, qualquer EV calculado é fé.**

## Bugs/insights conhecidos

| Item | Descrição |
|---|---|
| Iframe Kambi demora carregar | Poll 60s até tab "Escanteios" aparecer (`bet/place-bets.mjs`) |
| KTO esconde linhas extras | Clicar "Mostrar lista" antes de procurar outcome |
| Botão certo via regex strict | `^Mais\n10.5\n3.05$` evita pegar container pai |
| Slip pendente cumula | Limpar `[aria-label*="Remover desfecho"]` no início de cada aposta |
| KTO desloga ~5 apostas | Rodar em chunks pequenos + relogar |

## Pra adicionar fix

1. Identifica arquivo (`src/...`)
2. Edita
3. Bump `package.json` version (patch)
4. Commit + push pra `main`
5. CI builda + release

## Auto-fix policy

Tiago autorizou **autonomia total** pra Claude editar + commit + push direto sem PR. Igual PostMaster.

## TamoIA (suporte)

Bot tem botão "Pedir ajuda" que chama bridge no VPS Hostinger (`76.13.125.78:8901`) com contexto da app (versão, log recente, configuração). Modelo: Claude Code subscription Pro/Max.

## Convenção de versão

- Patch: bug fix ou ajuste UI → 0.1.X+1
- Minor: feature nova → 0.X+1.0
- Major: breaking → X+1.0.0

## Estado inicial (2026-06-05)

- v0.1.0: esqueleto Electron criado, módulos do `Workspace/bot-apostas/` movidos pra src/
- Modelo de cantos validado em ROI -37.3% N=15 (modo treino)
- Copa do Mundo 2026 (11/06-19/07) é a janela de validação CLV
- **AINDA NÃO RELEASED** — esperando CLV+ comprovado durante Copa antes de vender
