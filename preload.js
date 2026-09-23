const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("x32API", {
  connect: (ip) => ipcRenderer.invoke("x32-connect", ip),
  disconnect: () => ipcRenderer.invoke("x32-disconnect"),
  setFader: (ch, value) => ipcRenderer.invoke("x32-set-fader", ch, value),
  setMute: (ch, muted) => ipcRenderer.invoke("x32-set-mute", ch, muted),
  selectChannel: (ch) => ipcRenderer.invoke("x32-select-channel", ch),
  setEq: (ch, band, field, value) => ipcRenderer.invoke("x32-set-eq", ch, band, field, value),
  setDyn: (ch, field, value) => ipcRenderer.invoke("x32-set-dyn", ch, field, value),
  onChannel: (cb) => ipcRenderer.on("x32-channel", (event, data) => cb(data)),
  onChannelDetail: (cb) => ipcRenderer.on("x32-channel-detail", (event, data) => cb(data)),
  onMeters: (cb) => ipcRenderer.on("x32-meters", (event, levels) => cb(levels)),
  onLog: (cb) => ipcRenderer.on("x32-log", (event, msg) => cb(msg)),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  installUpdateNow: () => ipcRenderer.invoke("install-update-now"),
  onUpdateReady: (cb) => ipcRenderer.on("update-ready", (event, version) => cb(version)),
});
