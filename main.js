const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const dgram = require("dgram");
const { execFile, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
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

// ---------- Netzwerk-Suche (aktuelles WLAN durchsuchen statt IP eintippen) ----------
function localSubnetCandidates() {
  const ifaces = os.networkInterfaces();
  for (const name in ifaces) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const base = iface.address.split(".").slice(0, 3).join(".");
        const candidates = [];
        for (let h = 1; h <= 254; h++) candidates.push(base + "." + h);
        return { localIp: iface.address, candidates };
      }
    }
  }
  return null;
}

ipcMain.handle("x32-scan", async () => {
  return new Promise((resolve) => {
    const info = localSubnetCandidates();
    if (!info) { resolve([]); return; }
    const found = new Map();
    const scanSocket = dgram.createSocket("udp4");
    scanSocket.on("message", (msg, rinfo) => {
      try {
        const { address, args } = proto.decodeMessage(msg);
        if (address === "/xinfo" && args.length >= 3) {
          found.set(rinfo.address, { ip: rinfo.address, name: args[1].value, model: args[2].value, version: args[3] ? args[3].value : "" });
        }
      } catch (e) {}
    });
    scanSocket.on("error", () => {});
    scanSocket.bind(() => {
      const buf = proto.encodeMessage("/xinfo", []);
      info.candidates.forEach((ip) => { try { scanSocket.send(buf, 0, buf.length, X32_PORT, ip); } catch (e) {} });
      setTimeout(() => { scanSocket.close(); resolve(Array.from(found.values())); }, 1800);
    });
  });
});

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

// ---------- Eigener Updater ----------
// electron-updater/Squirrel.Mac verlangt eine echte Apple-Signatur und bricht bei
// ad-hoc-signierten Apps stillschweigend ab. Deshalb: neue .zip von GitHub laden,
// entpacken, die App-Datei nach dem Beenden austauschen und neu starten.
const UPDATE_REPO = "jakobgesche-beep/x32-fernsteuerung";
const UPDATE_ASSET = "X32-Fernsteuerung.zip";
let pendingUpdate = null;

function versionParts(v) { return String(v).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0); }
function isNewer(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

function sendUpdate(channel, payload) {
  if (mainWindow) mainWindow.webContents.send(channel, payload);
}

async function findLatestRelease() {
  const res = await fetch("https://api.github.com/repos/" + UPDATE_REPO + "/releases?per_page=10", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "x32-fernsteuerung" },
  });
  if (!res.ok) throw new Error("GitHub antwortet mit Status " + res.status);
  const releases = await res.json();
  let best = null;
  for (const rel of releases) {
    if (rel.draft || rel.prerelease) continue;
    const asset = (rel.assets || []).find((a) => a.name === UPDATE_ASSET);
    if (!asset) continue;
    const version = String(rel.tag_name).replace(/^v/, "");
    if (!best || isNewer(version, best.version)) best = { version, zipUrl: asset.browser_download_url, pageUrl: rel.html_url };
  }
  return best;
}

async function checkForUpdate() {
  if (!app.isPackaged) return;
  try {
    const latest = await findLatestRelease();
    if (latest && isNewer(latest.version, app.getVersion())) {
      pendingUpdate = latest;
      sendUpdate("update-available", latest.version);
    }
  } catch (e) { log("Update-Prüfung fehlgeschlagen: " + e.message); }
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => (err ? reject(new Error(cmd + ": " + (stderr || err.message))) : resolve(stdout)));
  });
}

async function downloadAndInstall(update) {
  const bundlePath = path.resolve(app.getPath("exe"), "..", "..", "..");
  if (!bundlePath.endsWith(".app")) throw new Error("App-Pfad nicht erkannt: " + bundlePath);
  try { fs.accessSync(path.dirname(bundlePath), fs.constants.W_OK); }
  catch (e) {
    shell.openExternal(update.pageUrl);
    throw new Error("Kein Schreibzugriff auf den Ordner der App — die Download-Seite wurde geöffnet, bitte manuell installieren.");
  }

  const workDir = path.join(app.getPath("temp"), "x32-update");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const zipPath = path.join(workDir, "update.zip");
  const extractDir = path.join(workDir, "extracted");

  sendUpdate("update-progress", "Lade Update herunter... 0 %");
  const res = await fetch(update.zipUrl, { redirect: "follow" });
  if (!res.ok) throw new Error("Download fehlgeschlagen (Status " + res.status + ")");
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0, lastPercent = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    const percent = total ? Math.floor((received / total) * 100) : 0;
    if (percent !== lastPercent) { lastPercent = percent; sendUpdate("update-progress", "Lade Update herunter... " + percent + " %"); }
  });
  await pipeline(body, fs.createWriteStream(zipPath));

  sendUpdate("update-progress", "Entpacke Update...");
  await run("ditto", ["-x", "-k", zipPath, extractDir]);
  const newApp = fs.readdirSync(extractDir).find((n) => n.endsWith(".app"));
  if (!newApp) throw new Error("Im Update wurde keine App gefunden.");
  const newAppPath = path.join(extractDir, newApp);
  await run("codesign", ["--verify", "--deep", newAppPath]);

  const scriptPath = path.join(workDir, "apply-update.sh");
  const logPath = path.join(app.getPath("userData"), "update.log");
  const script = [
    "#!/bin/bash",
    'PID="$1"; NEW="$2"; TARGET="$3"; LOG="$4"',
    'exec >>"$LOG" 2>&1',
    'echo "=== Update $(date) ==="',
    "WAITED=0",
    'while kill -0 "$PID" 2>/dev/null && [ "$WAITED" -lt 120 ]; do sleep 0.5; WAITED=$((WAITED+1)); done',
    'OLD="${TARGET}.old"',
    'rm -rf "$OLD"',
    'if mv "$TARGET" "$OLD"; then',
    '  if ditto "$NEW" "$TARGET"; then',
    '    xattr -cr "$TARGET" 2>/dev/null',
    '    rm -rf "$OLD"',
    '    echo "Update ok"',
    "  else",
    '    echo "Kopieren fehlgeschlagen, Rollback"',
    '    rm -rf "$TARGET"',
    '    mv "$OLD" "$TARGET"',
    "  fi",
    "else",
    '  echo "Verschieben der alten App fehlgeschlagen"',
    "fi",
    'open "$TARGET"',
    "",
  ].join("\n");
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  sendUpdate("update-progress", "Installiere & starte neu...");
  spawn("/bin/bash", [scriptPath, String(process.pid), newAppPath, bundlePath, logPath], { detached: true, stdio: "ignore" }).unref();
  app.quit();
}

ipcMain.handle("install-update", async () => {
  if (!pendingUpdate) return { ok: false, error: "Kein Update bereit." };
  try { await downloadAndInstall(pendingUpdate); return { ok: true }; }
  catch (e) { sendUpdate("update-error", e.message); return { ok: false, error: e.message }; }
});
ipcMain.handle("get-version", async () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  checkForUpdate();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { stopKeepAlive(); if (socket) socket.close(); });
