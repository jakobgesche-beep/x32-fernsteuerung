const { contextBridge, ipcRenderer } = require("electron");

const on = (channel, cb) => ipcRenderer.on(channel, (event, ...args) => cb(...args));

contextBridge.exposeInMainWorld("x32API", {
  // Verbindung
  scan: () => ipcRenderer.invoke("x32-scan"),
  connect: (ip) => ipcRenderer.invoke("x32-connect", ip),
  disconnect: () => ipcRenderer.invoke("x32-disconnect"),
  snapshot: () => ipcRenderer.invoke("x32-snapshot"),
  // Werte (ohne Antwort, damit es schnell bleibt)
  set: (path, type, value) => ipcRenderer.send("x32-set", path, type, value),
  want: (paths) => ipcRenderer.send("x32-want", paths),
  setHot: (paths) => ipcRenderer.send("x32-hot", paths),
  refresh: (paths, urgent) => ipcRenderer.send("x32-refresh", paths, urgent),
  setMeters: (streams) => ipcRenderer.send("x32-meters", streams),
  // Ereignisse vom Pult
  onBatch: (cb) => on("x32-batch", cb),
  onMeter: (cb) => on("x32-meter", cb),
  onStatus: (cb) => on("x32-status", cb),
  onLog: (cb) => on("x32-log", cb),
  // Updates
  getVersion: () => ipcRenderer.invoke("get-version"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (cb) => on("update-available", cb),
  onUpdateProgress: (cb) => on("update-progress", cb),
  onUpdateError: (cb) => on("update-error", cb),
});
