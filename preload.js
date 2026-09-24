const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("x32API", {
  scan: () => ipcRenderer.invoke("x32-scan"),
  connect: (ip) => ipcRenderer.invoke("x32-connect", ip),
  disconnect: () => ipcRenderer.invoke("x32-disconnect"),
  setFader: (ch, value) => ipcRenderer.invoke("x32-set-fader", ch, value),
  setMute: (ch, muted) => ipcRenderer.invoke("x32-set-mute", ch, muted),
  selectChannel: (ch) => ipcRenderer.invoke("x32-select-channel", ch),
  setEq: (ch, band, field, value) => ipcRenderer.invoke("x32-set-eq", ch, band, field, value),
  setDyn: (ch, field, value) => ipcRenderer.invoke("x32-set-dyn", ch, field, value),
  setMisc: (ch, key, value) => ipcRenderer.invoke("x32-set-misc", ch, key, value),
  onChannel: (cb) => ipcRenderer.on("x32-channel", (event, data) => cb(data)),
  onChannelDetail: (cb) => ipcRenderer.on("x32-channel-detail", (event, data) => cb(data)),
  onMeters: (cb) => ipcRenderer.on("x32-meters", (event, levels) => cb(levels)),
  onLog: (cb) => ipcRenderer.on("x32-log", (event, msg) => cb(msg)),
  getVersion: () => ipcRenderer.invoke("get-version"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (cb) => ipcRenderer.on("update-available", (event, version) => cb(version)),
  onUpdateProgress: (cb) => ipcRenderer.on("update-progress", (event, text) => cb(text)),
  onUpdateError: (cb) => ipcRenderer.on("update-error", (event, msg) => cb(msg)),
});
