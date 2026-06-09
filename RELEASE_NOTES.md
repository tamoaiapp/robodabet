## Robô da Bet v0.3.0

### Nova aba "Inteligência" 🧠

Mostra **em tempo real** o que o bot está aprendendo:

- **Por liga:** N, W/L, taxa de acerto, odd média, ROI, PNL, status (ativa/pausada)
- **Por linha:** detalhamento OVER/UNDER por linha (7.5, 8.5, 9.5...)
- **Calibrações ativas:** quando uma liga passa de 30 jogos settled, o bot
  recalcula o λ (média de cantos) com base nos dados reais e mostra aqui

Ligas pausadas (ROI ≤ -30% com N ≥ 3) aparecem em vermelho — o bot **não
aposta mais nelas** até você zerar dados.

### Auto-calibração

Novo módulo `src/strategy/calibrate.mjs`:
- Lê histórico settled por liga
- Quando ≥ 30 settled: recalcula λ usando o método dos momentos
  (média ponderada de linhas × win rate observado)
- Salva em `leagues-calibrated.json`
- `select-treino.mjs` usa o λ calibrado em vez do hardcoded

É o bot **aprendendo com seus próprios resultados**.

### Suporte preliminar a Goals e 1X2

API Kambi agora extrai outcomes de:
- **Total de gols** (OVER/UNDER 2.5 etc) — modelo Poisson igual cantos
- **Resultado 1X2** — outcomes HOME/DRAW/AWAY

`select-treino.mjs` aceita `BOT_MARKETS=corners,goals` (env var)
e detecta picks de gols com λ por liga.

**Importante:** o `place-bets.mjs` ainda só executa cantos. Picks de gols
são detectadas mas não apostadas automaticamente nesta versão.
Execução completa de gols/1X2 vem na v0.3.1.
