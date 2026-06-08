## Robô da Bet v0.2.0

### Fix CRÍTICO: auto-update agora funciona de verdade

**Antes:** cada build gerava um GUID diferente do NSIS, então o Windows
instalava cada versão lado a lado em vez de atualizar no lugar. Quem
estava na v0.1.5 ficou preso lá mesmo com novas releases publicadas.

**Agora:** GUID fixo `55519ef3-519e-4822-9f85-917014a75ee0` em
`electron-builder.yml` (mesmo padrão usado no PostMaster).

### IMPORTANTE pra quem já instalou versão < 0.2.0

A v0.2.0 não consegue atualizar a v0.1.x **dessa vez** (porque a v0.1.x
ainda tem GUID aleatório). Precisa de **uma única reinstalação manual**:

1. Desinstala "Robô da Bet" pelo Painel de Controle → Programas
2. Baixa o novo Setup em https://iaempresa.app/baixar-robodabet
3. Instala normal

A partir dessa versão (e de todas as próximas), o auto-update funciona
sozinho — não vai precisar fazer mais essa reinstalação.

### Outras melhorias acumuladas desde v0.1.5

- Botão "Atualizar saldos" no topo do dashboard
- Painel modo cassino (só ganhos em destaque, sem ROI/PNL negativos)
- Settle automático (apostas saem de "abertas" pra ganhas/perdidas)
- Diálogo "Atualizar agora?" quando uma nova versão é baixada
- Conservador sempre acha pelo menos uma pick segura
