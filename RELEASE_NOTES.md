## Robô da Bet v0.3.1

### 🌐 Aprendizado federado (em conjunto)

Antes: cada cliente aprendia sozinho — bot do João tinha que perder R$10
em Uruguay antes de pausar a liga.

Agora: todo cliente envia suas apostas settled (anônimo) pra um servidor
agregador, e baixa as calibrações da rede inteira.

**Como funciona:**
1. Quando settle marca won/lost, envia `(liga, side, line, odd, result)` pro VPS
2. VPS agrega tudo num arquivo JSONL
3. VPS calcula λ por liga via método dos momentos
4. Liga com ROI ≤ -30% e N ≥ 10 vira **blacklist global**
5. Cliente baixa o JSON agregado no startup (cache 6h)
6. `select-treino.mjs` aplica blacklist global ANTES de selecionar picks

**O que isso muda na prática:**
- Cliente novo já entra com calibrações de toda a rede
- Quando 100 clientes apostam, modelo aprende 100× mais rápido
- Blacklist propaga: se Uruguay foi ruim pra rede, é ruim pra todos

**Privacidade:** envia só `(liga, side, line, odd, result)` — nenhum dado
que identifique o cliente. Endpoint `/robodabet/calibrations` é público
(qualquer um pode baixar) e `/robodabet/learn` usa o mesmo bearer token
do TamoIA.

### Nova seção na aba Inteligência

Card "🌐 Rede federada" mostra:
- Total de apostas agregadas pela rede
- λ por liga calculado pelo agregado
- Ligas pausadas globalmente
- Última sincronização

### Endpoints VPS

- `POST http://76.13.125.78:8901/robodabet/learn`
- `GET http://76.13.125.78:8901/robodabet/calibrations`
