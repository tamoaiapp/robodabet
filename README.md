# Robô da Bet

Bot desktop (Electron) que automatiza apostas no mercado de **Total de Escanteios** no KTO. Baseado em modelo estatístico calibrado em 87k jogos europeus + CLV tracking.

## Estado atual: v0.1.0 (esqueleto)

- Esqueleto Electron pronto (`main.js`, `preload.js`, `renderer/`).
- Módulos do bot funcional já em `src/{strategy,bet,clv,db,casas}/`.
- Modelo: `avg/std` por liga (EPL, Championship, Serie A, La Liga, Bundesliga, Ligue 1, Copa do Mundo, amistoso recalibrado).
- **AINDA NÃO RELEASED.** Aguarda Copa do Mundo (11/06-19/07) pra validar CLV.

## Rodar dev

```
npm install
npm start
```

Pré-requisito: Chrome aberto com `--remote-debugging-port=9222` e perfil logado no KTO.

## Scripts standalone

```
npm run select    # sniff Kambi + filtros + lista picks
npm run place     # batch (apostas REAIS)
npm run snapshot  # captura odd T-5min
npm run settle    # atualiza bet_clv via histórico KTO
npm run report    # ROI + CLV
```

## Documentação interna

Ver [CLAUDE.md](CLAUDE.md).
