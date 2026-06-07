## Robô da Bet v0.1.5

### Novo

- **Conservador inteligente**: agora sempre acha uma aposta segura
  - Prob ≥ 70%, EV ≥ 0%, ordena por probabilidade
  - Aceita todas as ligas, prioriza linhas baixas
  - Stake máximo R$1 (Kelly 1/8)

- **Nova arquitetura "abre / aposta / fecha"**
  - Chrome só abre durante a aposta (minimizado), depois fecha
  - Tab Escanteios via Kambi API direto (1.2s pra 156 jogos)
  - Auto-login: detecta tela de login da casa e entra sozinho

- **Dashboard reformado**
  - Hero "SE TUDO DER CERTO" com lucro potencial em destaque
  - 3 stat cards: EM JOGO · HOJE · STREAK
  - Filtros: Todas / Abertas / Ganhas / Perdidas
  - Cards de aposta com indicador pulsante de estado

- **Limite diário configurável + cycle hours**
  - Stepper "X apostas por dia"
  - Dropdown frequência (1×, 2×, 4×, 6× por dia)
  - Botão "Liberar mais apostas hoje" pra estender o limite

### Correções

- IA do TamoIA dentro do app responde como Robô da Bet (era PostMaster)
- Onboarding mais acolhedor, sem citar casas específicas
- Modo simulação carrega sem pedir login
- Fix: `place-bets.mjs` lê o arquivo de picks do DATA_DIR correto
- Fix: porta CDP do Chrome trocada (9333) — porta antiga ficava zumbi

### Auto-update

Versões anteriores pegam essa atualização sozinhas em até 1h após abrir o app.
