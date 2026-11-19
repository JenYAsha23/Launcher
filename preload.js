const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  versions: () => ipcRenderer.invoke('versions:list'),
  loaders: (mc) => ipcRenderer.invoke('loaders:list', mc),
  modsList: (t) => ipcRenderer.invoke('mods:list', t),
  modsAdd: (t, paths) => ipcRenderer.invoke('mods:add', t, paths),
  modsPick: (t) => ipcRenderer.invoke('mods:pick', t),
  modsRemove: (t, f) => ipcRenderer.invoke('mods:remove', t, f),
  modsToggle: (t, f) => ipcRenderer.invoke('mods:toggle', t, f),
  openFolder: (t) => ipcRenderer.invoke('folder:open', t),
  pickImage: (kind) => ipcRenderer.invoke('skin:pick', kind),
  clearImage: (kind) => ipcRenderer.invoke('skin:clear', kind),
  skinData: (kind) => ipcRenderer.invoke('skin:data', kind),
  launch: (o) => ipcRenderer.invoke('game:launch', o),
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return file.path; } },
  onLog: (cb) => ipcRenderer.on('log', (_, m) => cb(m)),
  onProgress: (cb) => ipcRenderer.on('progress', (_, p) => cb(p)),
  onStatus: (cb) => ipcRenderer.on('status', (_, m) => cb(m)),
  onState: (cb) => ipcRenderer.on('state', (_, s) => cb(s))
});
