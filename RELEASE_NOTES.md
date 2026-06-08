## Robô da Bet v0.2.1

### Fix CRÍTICO: Place falhava em produção

Em produção, `Place: exit 1` com erro:
```
Cannot find package 'playwright-core' imported from chrome-launcher.mjs
```

Causa: `electron-builder.yml` excluía `node_modules` do empacotamento.
Em dev (com node_modules na pasta) funcionava; o instalador NSIS não tinha.

Fix:
- `files:` agora inclui `node_modules`
- `asarUnpack:` extrai `src/` + `playwright-core` + `playwright` pro Node
  externo (system node.exe) conseguir importar
- `main.js` aponta `cwd` pra `resources/app.asar.unpacked` quando packaged

### Auto-update

Versões >= 0.2.0 atualizam sozinhas (GUID fixo). Quando essa v0.2.1
baixar, vai aparecer "Atualizar agora?" — clica e pronto.
