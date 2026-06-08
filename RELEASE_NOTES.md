## Robô da Bet v0.2.5

### Fix definitivo do banner zumbi

A v0.2.4 filtrava `update-downloaded` quando a versão era undefined ou
igual à atual, mas o cache zumbi do electron-updater continuava lá. Ao
abrir o app, o updater lia o cache, achava que tinha uma atualização
pendente e disparava o evento de novo.

Agora a v0.2.5 limpa o cache zumbi **antes** de iniciar o autoUpdater:
- Lê `%LOCALAPPDATA%\robodabet-updater\pending\update-info.json`
- Se não tem campo `version` ou se a versão é igual à atual → apaga
  `pending/`, `installer.exe` e `current.blockmap`
- Aí o auto-updater começa limpo
