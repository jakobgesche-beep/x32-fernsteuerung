const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const dgram = require("dgram");
const { execFile, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const OSC = require("./shared/osc");
const X32Client = require("./shared/client");

const X32_PORT = 10023;

let mainWindow = null;
let socket = null;
let client = null;

function toRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}
function log(msg) { toRenderer("x32-log", msg); }

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
        const { address, args } = OSC.decodeMessage(msg);
        if (address === "/xinfo" && args.length >= 3) {
          found.set(rinfo.address, { ip: rinfo.address, name: args[1].value, model: args[2].value, version: args[3] ? args[3].value : "" });
        }
      } catch (e) {}
    });
    scanSocket.on("error", () => {});
    scanSocket.bind(() => {
      const buf = OSC.encodeMessage("/xinfo", []);
      info.candidates.forEach((ip) => { try { scanSocket.send(buf, 0, buf.length, X32_PORT, ip); } catch (e) {} });
      setTimeout(() => { scanSocket.close(); resolve(Array.from(found.values())); }, 1800);
    });
  });
});

// ---------- Verbindung zum Pult ----------
function disconnect() {
  if (client) { client.stop(); client = null; }
  if (socket) { try { socket.close(); } catch (e) {} socket = null; }
}

function connect(ip) {
  return new Promise((resolve) => {
    disconnect();
    const sock = dgram.createSocket("udp4");
    socket = sock;
    let ready = false;
    sock.on("error", (err) => {
      log("Netzwerkfehler: " + err.message);
      if (!ready) resolve({ ok: false, error: err.message });
    });
    sock.on("message", (msg) => {
      if (client) client.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
    });
    sock.bind(() => {
      ready = true;
      client = new X32Client({
        send: (u8) => { try { sock.send(u8, X32_PORT, ip); } catch (e) {} },
        onBatch: (entries) => toRenderer("x32-batch", entries),
        onMeter: (id, floats) => toRenderer("x32-meter", id, floats),
        onStatus: (status) => toRenderer("x32-status", status),
        onLog: log,
      });
      client.start();
      resolve({ ok: true });
    });
  });
}

const validPath = (p) => typeof p === "string" && p.startsWith("/") && p.length < 120;
const validPaths = (list) => Array.isArray(list) && list.every(validPath);

ipcMain.handle("x32-connect", (event, ip) => connect(String(ip)));
ipcMain.handle("x32-disconnect", async () => { disconnect(); return { ok: true }; });
ipcMain.handle("x32-snapshot", async () => (client ? client.snapshot() : []));
// Häufige, schnelle Aufrufe ohne Antwort (ipcRenderer.send), damit die Übertragung so kurz wie möglich bleibt
ipcMain.on("x32-set", (event, oscPath, type, value) => {
  const okValue = type === "s" ? typeof value === "string" && value.length <= 24 : typeof value === "number" && Number.isFinite(value);
  if (client && validPath(oscPath) && ["f", "i", "s"].includes(type) && okValue) client.set(oscPath, type, value);
});
ipcMain.on("x32-want", (event, paths) => { if (client && validPaths(paths)) client.want(paths); });
ipcMain.on("x32-hot", (event, paths) => { if (client && validPaths(paths)) client.setHot(paths); });
ipcMain.on("x32-refresh", (event, paths, urgent) => { if (client && validPaths(paths)) client.refresh(paths, !!urgent); });
ipcMain.on("x32-meters", (event, streams) => {
  if (client && Array.isArray(streams) && streams.every((x) => /^[0-9]+(:[0-9]+)?$/.test(String(x)))) client.setMeters(streams.map(String));
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
app.on("before-quit", () => { disconnect(); });
