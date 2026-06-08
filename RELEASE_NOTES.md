## Robô da Bet v0.2.4

### Fix: banner zumbi quando o cache não tem versão

O `update-info.json` que o electron-updater grava no cache **não contém
o campo `version`**. Quando o app reabria, ele relia o cache e disparava
`update-downloaded` com `info.version === undefined`. Os filtros que
adicionei na v0.2.3 (`if (info.version === current)`) não pegavam porque
`undefined !== '0.2.3'`.

Agora:
- Main: se `!info.version || info.version === current` → ignora banner
  **e limpa o cache** (`installer.exe` + `pending/` + `current.blockmap`)
- Renderer: também filtra `version` undefined explicitamente
