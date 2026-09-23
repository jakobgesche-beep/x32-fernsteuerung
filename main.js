const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const dgram = require("dgram");
const { autoUpdater } = require("electron-updater");
const proto = require("./x32-protocol");

const X32_PORT = 10023;

let mainWindow = null;
let socket = null;
let targetIp = null;
let xremoteTimer = null;
let metersTimer = null;

const channelState = {};
for (let i = 1; i <= 32; i++) {
  channelState[i] = { name: "CH " + String(i).padStart(2, "0"), fader: 0, muted: false, eq: [{}, {}, {}, {}], dyn: {} };
}

function log(msg) {
  if (mainWindow) mainWindow.webContents.send("x32-log", msg);
}

function chAddr(ch) { return "/ch/" + String(ch).padStart(2, "0"); }

const FIELD_SPECS = {
  eq: {
    f: { kind: "logf", min: 20, max: 20000 },
    g: { kind: "linf", min: -15, max: 15 },
    q: { kind: "logf", min: 10.0, max: 0.3 },
    type: { kind: "enum" },
  },
  dyn: {
    on: { kind: "enum" },
    thr: { kind: "linf", min: -60, max: 0 },
    ratio: { kind: "enum" },
    mgain: { kind: "linf", min: 0, max: 24 },
    attack: { kind: "linf", min: 0, max: 120 },
    hold: { kind: "logf", min: 0.02, max: 2000 },
    release: { kind: "logf", min: 5, max: 4000 },
    knee: { kind: "linf", min: 0, max: 5 },
    mix: { kind: "linf", min: 0, max: 100 },
  },
};
function normToActual(spec, norm) {
  if (spec.kind === "linf") return proto.linfToActual(norm, spec.min, spec.max);
  if (spec.kind === "logf") return proto.logfToActual(norm, spec.min, spec.max);
  return norm;
}
function actualToNorm(spec, actual) {
  if (spec.kind === "linf") return proto.actualToLinf(actual, spec.min, spec.max);
  if (spec.kind === "logf") return proto.actualToLogf(actual, spec.min, spec.max);
  return actual;
}

function send(address, args = []) {
  if (!socket || !targetIp) return;
  const buf = proto.encodeMessage(address, args);
  socket.send(buf, 0, buf.length, X32_PORT, targetIp);
}

function requestChannelBasics(ch) {
  const base = chAddr(ch);
  send(base + "/config/name");
  send(base + "/mix/fader");
  send(base + "/mix/on");
}

function requestChannelDetail(ch) {
  const base = chAddr(ch);
  for (let b = 1; b <= 4; b++) {
    send(base + "/eq/" + b + "/type");
    send(base + "/eq/" + b + "/f");
    send(base + "/eq/" + b + "/g");
    send(base + "/eq/" + b + "/q");
  }
  ["on", "thr", "ratio", "mgain", "attack", "hold", "release", "knee", "mix"].forEach((f) => send(base + "/dyn/" + f));
}

function pushChannel(ch) {
  const s = channelState[ch];
  if (mainWindow) mainWindow.webContents.send("x32-channel", { ch, name: s.name, fader: s.fader, faderDb: proto.faderToDb(s.fader), muted: s.muted });
}
function pushChannelDetail(ch) {
  const s = channelState[ch];
  if (mainWindow) mainWindow.webContents.send("x32-channel-detail", { ch, eq: s.eq, dyn: s.dyn });
}

function handleMessage(msg) {
  let address, args;
  try { ({ address, args } = proto.decodeMessage(msg)); } catch (e) { return; }

  const chMatch = address.match(/^\/ch\/(\d\d)\/(.+)$/);
  if (chMatch) {
    const ch = parseInt(chMatch[1], 10);
    const sub = chMatch[2];
    const s = channelState[ch];
    if (!s || !args.length) return;
    if (sub === "config/name") { s.name = args[0].value || s.name; pushChannel(ch); }
    else if (sub === "mix/fader") { s.fader = args[0].value; pushChannel(ch); }
    else if (sub === "mix/on") { s.muted = args[0].value === 0; pushChannel(ch); }
    else {
      const eqMatch = sub.match(/^eq\/(\d)\/(type|f|g|q)$/);
      if (eqMatch) {
        const field = eqMatch[2];
        const spec = FIELD_SPECS.eq[field];
        const raw = args[0].value;
        s.eq[parseInt(eqMatch[1], 10) - 1][field] = spec.kind === "enum" ? raw : normToActual(spec, raw);
        pushChannelDetail(ch);
      } else if (sub.startsWith("dyn/")) {
        const field = sub.slice(4);
        const spec = FIELD_SPECS.dyn[field];
        if (spec) {
          const raw = args[0].value;
          s.dyn[field] = spec.kind === "enum" ? raw : normToActual(spec, raw);
          pushChannelDetail(ch);
        }
      }
    }
    return;
  }

  if (address === "/meters/1") {
    const blobArg = args.find((a) => a.type === "b");
    if (blobArg) {
      const values = proto.parseMeterBlob(blobArg.value);
      if (mainWindow) mainWindow.webContents.send("x32-meters", Array.from(values.slice(0, 32)));
    }
  }
}

function startKeepAlive() {
  stopKeepAlive();
  xremoteTimer = setInterval(() => send("/xremote"), 8000);
  metersTimer = setInterval(() => send("/meters", [{ type: "s", value: "/meters/1" }]), 8000);
}
function stopKeepAlive() {
  clearInterval(xremoteTimer); clearInterval(metersTimer);
  xremoteTimer = null; metersTimer = null;
}

ipcMain.handle("x32-connect", async (event, ip) => {
  return new Promise((resolve) => {
    try {
      if (socket) { socket.close(); socket = null; }
      targetIp = ip;
      socket = dgram.createSocket("udp4");
      socket.on("message", handleMessage);
      socket.on("error", (err) => log("Netzwerkfehler: " + err.message));
      socket.bind(() => {
        send("/xremote");
        send("/meters", [{ type: "s", value: "/meters/1" }]);
        for (let ch = 1; ch <= 32; ch++) requestChannelBasics(ch);
        startKeepAlive();
        resolve({ ok: true });
      });
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
});

ipcMain.handle("x32-disconnect", async () => {
  stopKeepAlive();
  if (socket) { socket.close(); socket = null; }
  targetIp = null;
  return { ok: true };
});

ipcMain.handle("x32-set-fader", async (event, ch, value) => { send(chAddr(ch) + "/mix/fader", [{ type: "f", value }]); });
ipcMain.handle("x32-set-mute", async (event, ch, muted) => { send(chAddr(ch) + "/mix/on", [{ type: "i", value: muted ? 0 : 1 }]); });
ipcMain.handle("x32-select-channel", async (event, ch) => { requestChannelDetail(ch); });
ipcMain.handle("x32-set-eq", async (event, ch, band, field, value) => {
  if (field === "type") { send(chAddr(ch) + "/eq/" + (band + 1) + "/type", [{ type: "i", value }]); return; }
  const spec = FIELD_SPECS.eq[field];
  send(chAddr(ch) + "/eq/" + (band + 1) + "/" + field, [{ type: "f", value: actualToNorm(spec, value) }]);
});
ipcMain.handle("x32-set-dyn", async (event, ch, field, value) => {
  if (field === "on" || field === "ratio") { send(chAddr(ch) + "/dyn/" + field, [{ type: "i", value }]); return; }
  const spec = FIELD_SPECS.dyn[field];
  send(chAddr(ch) + "/dyn/" + field, [{ type: "f", value: actualToNorm(spec, value) }]);
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#0D1117",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on("checking-for-update", () => log("Suche nach Updates..."));
autoUpdater.on("update-available", (info) => log("Update gefunden: Version " + info.version + " wird heruntergeladen..."));
autoUpdater.on("update-not-available", () => log("Kein Update verfügbar."));
autoUpdater.on("error", (err) => log("Update-Fehler: " + err.message));
autoUpdater.on("update-downloaded", (info) => {
  log("Update " + info.version + " heruntergeladen — wird beim nächsten Beenden installiert.");
  if (mainWindow) mainWindow.webContents.send("update-ready", info.version);
});
ipcMain.handle("check-for-updates", async () => {
  if (!app.isPackaged) return { ok: false, reason: "not-packaged" };
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { return { ok: false, reason: e.message }; }
});
ipcMain.handle("install-update-now", async () => { autoUpdater.quitAndInstall(); });

app.whenReady().then(() => {
  createWindow();
  if (app.isPackaged) autoUpdater.checkForUpdates().catch((e) => log("Update-Prüfung fehlgeschlagen: " + e.message));
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { stopKeepAlive(); if (socket) socket.close(); });
