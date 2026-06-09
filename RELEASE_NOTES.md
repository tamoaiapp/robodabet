## Robô da Bet v0.2.8

### Treino: bot aprende com os próprios resultados

Análise dos primeiros 13 jogos settled mostrou que **77% das perdas**
vieram de 3 ligas sem histórico calibrado (Uruguay, Colombia, La Liga 2).

Três mudanças no Conservador:

**1. Não aposta mais em ligas low confidence**
Antes: aceitava Uruguay, Colombia, Chile (todas `conf: 'low'`).
Agora: só Friendly, EPL, Bundesliga, Serie A IT, La Liga (top),
Ligue 1, Argentina, Copa do Mundo.

**2. Argentina promovida a 'medium'**
Após 5 jogos com PNL próximo de break-even (-R$0,32), foi promovida
de `low` pra `medium`. Continua sendo apostada.

**3. Auto-blacklist por liga (treino real)**
Toda vez que o bot vai selecionar picks, ele lê o histórico SQLite
e bane automaticamente ligas com ROI ≤ -30% e N ≥ 3 settled.

Isso é o "treino" no sentido literal: a cada novo resultado, a estratégia
ajusta. Quanto mais o bot roda, mais cirúrgico ele fica.

### Próximo nível (v0.3.0 — futuro)

- Aba "Inteligência" no app mostrando ROI por liga em tempo real
- Auto-calibração do `lambda` (média de cantos) por liga com base em ≥30 settled
- Suporte a múltiplos mercados (gols, 1X2)
