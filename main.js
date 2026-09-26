const { app, BrowserWindow, ipcMain, shell, powerSaveBlocker, session, systemPreferences, dialog } = require("electron");
const IS_MAC = process.platform === "darwin", IS_WIN = process.platform === "win32";
const path = require("path");
const os = require("os");
const fs = require("fs");
const { execFile, spawn } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const X32Connection = require("./shared/connection");
const REW = require("./shared/rew");

// Live-Betrieb: macOS ("App Nap"), Windows und Chromium drosseln Programme mit verdecktem/minimiertem Fenster,
// dann laufen Timer viel langsamer und Mute/Fader kämen verzögert an. Das schalten wir ab.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
let sleepBlockerId = null;
function keepAwake(on) {
  // solange mit dem Pult verbunden: weder der Rechner noch der Bildschirm gehen schlafen (Touch-Monitor am FOH soll nicht dunkel werden)
  if (on && sleepBlockerId === null) sleepBlockerId = powerSaveBlocker.start("prevent-display-sleep");
  else if (!on && sleepBlockerId !== null) { powerSaveBlocker.stop(sleepBlockerId); sleepBlockerId = null; }
}

let mainWindow = null;

// Nur ein Programmfenster: ein zweiter Start (Doppelklick, Update) holt das vorhandene nach vorn, statt ein zweites zu öffnen, das denselben UDP-Port braucht
const GOT_LOCK = app.requestSingleInstanceLock();
if (!GOT_LOCK) app.quit();
else app.on("second-instance", () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });

function toRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}
function log(msg) { toRenderer("x32-log", msg); }

// ---------- Verbindung zum Pult ----------
// Alles rund um UDP, Suche, Fehlersuche und Protokolldatei steckt in shared/connection.js (testbar ohne Electron).
const conn = new X32Connection({
  logFile: path.join(app.getPath("userData"), "verbindung.log"),
  tmpDir: os.tmpdir(),
  handlers: {
    status: (s) => toRenderer("x32-status", s),
    batch: (entries) => toRenderer("x32-batch", entries),
    meter: (id, floats) => toRenderer("x32-meter", id, floats),
    log: (line) => toRenderer("x32-log", line),
  },
});
const clientOf = () => conn.client;

ipcMain.handle("x32-scan", async () => { keepAwakeBrief(); return conn.scan(); });
ipcMain.handle("x32-connect", async (event, ip) => { keepAwake(true); const r = await conn.connect(String(ip == null ? "" : ip)); if (!r.ok) keepAwake(false); return r; });
ipcMain.handle("x32-disconnect", async () => { disconnect(); return { ok: true }; });
function disconnect() { keepAwake(false); conn.disconnect(); }
function keepAwakeBrief() { /* die Suche dauert nur ein paar Sekunden: kein Schlaf-Sperre nötig */ }
ipcMain.handle("x32-diagnose", async (event, ip, opts) => conn.diagnose(String(ip == null ? "" : ip), { terminal: opts && opts.terminal ? { replied: !!opts.terminal.replied } : null }));
ipcMain.handle("x32-terminal-test", async (event, ip) => conn.terminalTest(String(ip == null ? "" : ip)));
ipcMain.handle("x32-net-access", async (event, force) => { const a = conn.netAccess; if (!force && a && Date.now() - a.at < 3000) return a; return conn.checkLocalNetwork(); });
ipcMain.handle("x32-get-log", async () => conn.logText());
ipcMain.handle("x32-open-log", async () => { const f = path.join(app.getPath("userData"), "verbindung.log"); if (fs.existsSync(f)) shell.showItemInFolder(f); else shell.openPath(app.getPath("userData")); return true; });
// macOS: Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk
ipcMain.handle("x32-open-privacy", async () => {
  if (!IS_MAC) return false;
  try { await shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_LocalNetwork"); } catch (e) { await shell.openExternal("x-apple.systempreferences:com.apple.preference.security"); }
  return true;
});
// Windows: "Eine App durch die Windows-Firewall zulassen" (Systemsteuerung), sonst die Seite "Firewall & Netzwerkschutz" der Windows-Sicherheit
ipcMain.handle("x32-open-firewall", async () => {
  if (!IS_WIN) return false;
  const opened = await new Promise((resolve) => execFile("control.exe", ["/name", "Microsoft.WindowsFirewall", "/page", "pnlFlags"], { windowsHide: false }, (err) => resolve(!err)));
  if (!opened) { try { await shell.openExternal("windowsdefender://network"); } catch (e) { return false; } }
  return true;
});

// Netzwerk-Test: nur lesend (32 Einzelanfragen + 32 auf einmal), ändert nichts am Pult
ipcMain.handle("x32-network-test", () => new Promise((resolve) => {
  const client = clientOf();
  if (!client || !client.runNetworkTest((result) => resolve(result))) resolve(null);
}));

const validPath = (p) => typeof p === "string" && p.startsWith("/") && p.length < 120;
const validPaths = (list) => Array.isArray(list) && list.every(validPath);

ipcMain.handle("x32-snapshot", async () => (clientOf() ? clientOf().snapshot() : []));
// Häufige, schnelle Aufrufe ohne Antwort (ipcRenderer.send), damit die Übertragung so kurz wie möglich bleibt
ipcMain.on("x32-set", (event, oscPath, type, value, sentAt) => {
  const client = clientOf();
  if (client && typeof sentAt === "number") client.noteAppLatency(Date.now() - sentAt);
  const okValue = type === "s" ? typeof value === "string" && value.length <= 24 : typeof value === "number" && Number.isFinite(value);
  if (client && validPath(oscPath) && ["f", "i", "s"].includes(type) && okValue) client.set(oscPath, type, value);
});
ipcMain.on("x32-want", (event, paths) => { const client = clientOf(); if (client && validPaths(paths)) client.want(paths); });
const SUB_PATTERN = /^\/(?:(?:ch|auxin|fxrtn|bus|mtx)\/\*\*\/mix\/(?:on|fader)|dca\/\*\/(?:on|fader))$/;
ipcMain.on("x32-subs", (event, specs) => {
  const client = clientOf();
  if (!client || !Array.isArray(specs) || specs.length > 12) return;
  const ok = specs.every((s) => s && /^\/x[mf]_[a-z]{2,4}$/.test(s.alias) && SUB_PATTERN.test(s.pattern) && Number.isInteger(s.i0) && Number.isInteger(s.i1)
    && s.i0 >= 1 && s.i1 <= 32 && s.i0 <= s.i1 && (s.kind === "int" || s.kind === "float") && Number.isInteger(s.tf) && s.tf >= 0 && s.tf <= 99);
  if (ok) client.setSubs(specs);
});
ipcMain.on("x32-hot", (event, paths) => { const client = clientOf(); if (client && validPaths(paths)) client.setHot(paths); });
ipcMain.on("x32-refresh", (event, paths, urgent) => { const client = clientOf(); if (client && validPaths(paths)) client.refresh(paths, !!urgent); });
ipcMain.on("x32-meters", (event, streams) => {
  const client = clientOf();
  if (client && Array.isArray(streams) && streams.every((x) => /^[0-9]+(:[0-9]+)?$/.test(String(x)))) client.setMeters(streams.map(String));
});

// ---------- Messung: Mikrofon-Zugriff und REW ----------
// Mikrofon (nur Audio, nur für unser eigenes Fenster). Kamera wird nie freigegeben.
function trustedContents(wc) { return !!mainWindow && !mainWindow.isDestroyed() && wc === mainWindow.webContents; }
function setupMediaPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const types = (details && details.mediaTypes) || [];
    callback(permission === "media" && trustedContents(wc) && !types.includes("video"));
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    const types = (details && details.mediaType) ? [details.mediaType] : [];
    return permission === "media" && (wc === null || trustedContents(wc)) && !types.includes("video");
  });
}
function micStatus() {
  if (!IS_MAC && !IS_WIN) return "granted";
  try { const s = systemPreferences.getMediaAccessStatus("microphone"); return s === "unknown" ? "granted" : s; } catch (e) { return "granted"; }
}
ipcMain.handle("mic-status", async () => micStatus());
// fragt bei "noch nicht entschieden" den macOS-Dialog an, liefert danach den Status
ipcMain.handle("mic-request", async () => {
  if (IS_MAC && micStatus() === "not-determined") {
    try { await systemPreferences.askForMediaAccess("microphone"); } catch (e) { log("Mikrofon-Anfrage fehlgeschlagen: " + e.message); }
  }
  return micStatus();
});
ipcMain.handle("mic-open-settings", async () => {
  await shell.openExternal(IS_WIN ? "ms-settings:privacy-microphone" : "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
  return true;
});

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), "utf8")); } catch (e) { return {}; } }
function writeSettings(patch) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch })); } catch (e) { log("Einstellungen nicht gespeichert: " + e.message); }
}
function findRew() {
  const env = process.env, list = (d) => { try { return fs.readdirSync(d); } catch (e) { return []; } };
  if (IS_WIN) {
    return REW.findRew({
      platform: "win32", saved: readSettings().rewPath, home: os.homedir(), join: path.win32.join,
      exists: (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } },
      list,
      programDirs: [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs"), env.ProgramW6432].filter(Boolean),
      startMenuDirs: [env.ProgramData && path.win32.join(env.ProgramData, "Microsoft", "Windows", "Start Menu", "Programs"), env.APPDATA && path.win32.join(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")].filter(Boolean),
    });
  }
  return REW.findRew({
    saved: readSettings().rewPath,
    home: os.homedir(),
    exists: (p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } },
    list,
  });
}
ipcMain.handle("rew-status", async () => { const r = findRew(); return { found: !!r, path: r ? r.path : null }; });
ipcMain.handle("rew-open", async () => {
  const r = findRew();
  if (!r) return { ok: false, notFound: true };
  const err = await shell.openPath(r.path);            // startet das Programm (leerer Text = geklappt)
  return err ? { ok: false, error: err } : { ok: true, path: r.path };
});
// Programm von Hand wählen, falls REW an einem anderen Ort liegt
ipcMain.handle("rew-choose", async () => {
  const res = await dialog.showOpenDialog(mainWindow, IS_WIN
    ? { title: "REW auswählen", defaultPath: process.env.ProgramFiles || "C:\\Program Files", properties: ["openFile"], filters: [{ name: "Programme", extensions: ["exe", "lnk"] }] }
    : { title: "REW auswählen", defaultPath: "/Applications", properties: ["openFile"], filters: [{ name: "Programme", extensions: ["app"] }] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const p = res.filePaths[0];
  let isApp = false;
  try { isApp = IS_WIN ? /\.(exe|lnk)$/i.test(p) && fs.statSync(p).isFile() : p.toLowerCase().endsWith(".app") && fs.statSync(p).isDirectory(); } catch (e) {}
  if (!isApp) return { ok: false, error: IS_WIN ? "Das ist kein Programm (.exe)." : "Das ist kein Programm (.app)." };
  writeSettings({ rewPath: p });
  return { ok: true, path: p };
});
// Textdatei (z. B. CSV-Protokoll) über den Speichern-Dialog ablegen: Ort wählt der Nutzer
ipcMain.handle("save-text-file", async (event, name, text) => {
  if (typeof name !== "string" || typeof text !== "string" || text.length > 5000000) return { ok: false, error: "Ungültige Daten." };
  const safe = path.basename(name).replace(/[^\w.\- äöüÄÖÜß]/g, "_").slice(0, 80) || "Protokoll.csv";
  const res = await dialog.showSaveDialog(mainWindow, { title: "Protokoll speichern", defaultPath: path.join(app.getPath("documents"), safe) });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(res.filePath, "\ufeff" + text, "utf8"); return { ok: true, path: res.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});
// Vollbild ein/aus (für den Touch-Monitor ohne Tastatur)
ipcMain.handle("toggle-fullscreen", async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});
ipcMain.handle("rew-download", async () => { await shell.openExternal("https://www.roomeqwizard.com/"); return true; });

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    backgroundColor: "#0D1117",
    autoHideMenuBar: !IS_MAC,                                   // Windows: keine Menüleiste (mit Alt einblendbar); F11 = Vollbild
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  if (!IS_MAC) mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on("before-input-event", (event, input) => { if (input.type === "keyDown" && input.key === "F11") { mainWindow.setFullScreen(!mainWindow.isFullScreen()); event.preventDefault(); } });
  mainWindow.webContents.setVisualZoomLevelLimits(1, 1);          // kein Zoomen mit zwei Fingern (Fader nicht versehentlich verstellen)
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// ---------- Eigener Updater ----------
// Mac: electron-updater/Squirrel.Mac verlangt eine echte Apple-Signatur und bricht bei
// ad-hoc-signierten Apps stillschweigend ab. Deshalb: neue .zip von GitHub laden,
// entpacken, die App-Datei nach dem Beenden austauschen und neu starten.
// Windows: das Installationsprogramm (Setup.exe) von GitHub laden und starten; es ersetzt die App und öffnet sie wieder.
const UPDATE_REPO = "jakobgesche-beep/x32-fernsteuerung";
const UPDATE_ASSET = IS_WIN ? "X32-Fernsteuerung-Setup.exe" : "X32-Fernsteuerung.zip";
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
    if (!best || isNewer(version, best.version)) best = { version, assetUrl: asset.browser_download_url, pageUrl: rel.html_url };
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

// Datei laden, dabei den Fortschritt melden
async function downloadTo(url, file) {
  sendUpdate("update-progress", "Lade Update herunter... 0 %");
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error("Download fehlgeschlagen (Status " + res.status + ")");
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0, lastPercent = -1;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    received += chunk.length;
    const percent = total ? Math.floor((received / total) * 100) : 0;
    if (percent !== lastPercent) { lastPercent = percent; sendUpdate("update-progress", "Lade Update herunter... " + percent + " %"); }
  });
  await pipeline(body, fs.createWriteStream(file));
  if (total && received < total) throw new Error("Der Download ist unvollständig (" + received + " von " + total + " Byte).");
}
function freshWorkDir() {
  const workDir = path.join(app.getPath("temp"), "x32-update");
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  return workDir;
}

// Windows: Installationsprogramm laden und starten, dann beenden. Es ist ein "Ein-Klick"-Installer für den eigenen Benutzer (kein Administrator nötig),
// beendet die laufende App selbst, ersetzt sie und öffnet sie danach wieder.
async function downloadAndInstallWin(update) {
  const exe = path.join(freshWorkDir(), UPDATE_ASSET);
  await downloadTo(update.assetUrl, exe);
  if (fs.statSync(exe).size < 10 * 1024 * 1024) throw new Error("Die heruntergeladene Datei ist zu klein und wird nicht gestartet.");
  sendUpdate("update-progress", "Starte die Installation...");
  const child = spawn(exe, ["--updated"], { detached: true, stdio: "ignore" });
  await new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  setTimeout(() => app.quit(), 500);
}

async function downloadAndInstall(update) {
  if (IS_WIN) return downloadAndInstallWin(update);
  const bundlePath = path.resolve(app.getPath("exe"), "..", "..", "..");
  if (!bundlePath.endsWith(".app")) throw new Error("App-Pfad nicht erkannt: " + bundlePath);
  try { fs.accessSync(path.dirname(bundlePath), fs.constants.W_OK); }
  catch (e) {
    shell.openExternal(update.pageUrl);
    throw new Error("Kein Schreibzugriff auf den Ordner der App — die Download-Seite wurde geöffnet, bitte manuell installieren.");
  }

  const workDir = freshWorkDir();
  const zipPath = path.join(workDir, "update.zip");
  const extractDir = path.join(workDir, "extracted");
  await downloadTo(update.assetUrl, zipPath);

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
  if (!GOT_LOCK) return;
  setupMediaPermissions();
  createWindow();
  checkForUpdate();
  conn.log("=== App gestartet: X32 Fernsteuerung " + app.getVersion() + ", " + (IS_MAC ? "macOS " + os.release() + " (Darwin)" : IS_WIN ? "Windows " + os.release() + " (" + process.arch + ")" : process.platform + " " + os.release()) + ", Electron " + process.versions.electron + " ===");
  conn.wakeLocalNetwork().then((a) => toRenderer("x32-net-access", a)).catch(() => {});       // macOS soll die Freigabe für das lokale Netzwerk jetzt abfragen, nicht erst beim Verbinden
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on("before-quit", () => { disconnect(); });
