const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('bot', {
  select: () => ipcRenderer.invoke('bot:select'),
  place: (inputFile) => ipcRenderer.invoke('bot:place', inputFile),
  snapshot: () => ipcRenderer.invoke('bot:snapshot'),
  settle: () => ipcRenderer.invoke('bot:settle'),
  report: () => ipcRenderer.invoke('bot:report'),
  ktoLogin: () => ipcRenderer.invoke('bot:kto-login'),
  ktoStatus: () => ipcRenderer.invoke('bot:kto-status'),
  stats: () => ipcRenderer.invoke('bot:stats'),
  start: () => ipcRenderer.invoke('bot:start'),
  stop: () => ipcRenderer.invoke('bot:stop'),
  getState: () => ipcRenderer.invoke('bot:get-state'),
  resetDaily: () => ipcRenderer.invoke('bot:reset-daily'),
  onLog: (cb) => ipcRenderer.on('bot:log', (_, payload) => cb(payload)),
  onState: (cb) => ipcRenderer.on('bot:state', (_, s) => cb(s)),
  onNotify: (cb) => ipcRenderer.on('bot:notify', (_, n) => cb(n)),
})

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
})

contextBridge.exposeInMainWorld('support', {
  chat: (messages) => ipcRenderer.invoke('support:chat', { messages }),
})

contextBridge.exposeInMainWorld('appApi', {
  info: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
})

contextBridge.exposeInMainWorld('winApi', {
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
})

contextBridge.exposeInMainWorld('updateApi', {
  onStatus: (cb) => ipcRenderer.on('update:status', (_, payload) => cb(payload)),
  install: () => ipcRenderer.invoke('update:install'),
})
