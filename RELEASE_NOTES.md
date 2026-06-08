## Robô da Bet v0.2.3

### Fixes do banner de atualização

**1. Banner aparecia mesmo já estando na última versão**
O electron-updater dispara `update-downloaded` reaproveitando o cache do
installer anterior, mesmo quando você já tá na versão atual.
Agora o banner só aparece se `info.version !== app.getVersion()`.

**2. Botão "Reiniciar agora" travava em "Reiniciando..."**
O `quitAndInstall` falhava silencioso em alguns casos. Agora:
- Log explícito no console quando o handler é chamado
- Fallback: se `quitAndInstall` der erro, força `app.quit()` pra disparar
  o auto-install on quit
- Timeout no renderer: se o app não fechar em 6 segundos, mostra
  "Falhou — fechar o app manualmente" pra o user saber o que fazer.
