## Robô da Bet v0.1.6

### Fix crítico: Settle automático

Antes: apostas ficavam "abertas" pra sempre. ROI, ganhos, perdas, PNL ficavam zerados mesmo quando os jogos terminavam.

Agora: o settle roda automaticamente a cada 4h. Abre Chrome minimizado, lê o histórico da casa, atualiza cada aposta como `won` / `lost` / `void` e calcula o PNL real.

### Como funciona

1. Lê todas apostas com status `open` no banco
2. Abre Chrome minimizado com seu perfil (sessão já logada)
3. Vai pra `/historico-de-apostas` da casa, clica em "Expirado"
4. Raspa cada cupom (status + total de cantos + nome do jogo)
5. Faz match com as apostas abertas por **nome do jogo + linha** (resiliente)
6. Atualiza `result` + `pnl` + `settled_at` + `cupom_id`
7. Fecha Chrome

### Auto-update

Versões anteriores pegam essa atualização sozinhas em até 1h após abrir o app.
