// Rauchtest im ECHTEN Electron ohne installierte App (für GitHub Actions unter Windows, auch auf macOS/Linux mit Bildschirm möglich):
// baut aus dem Quellcode einen Test-Ordner, startet Electron mit unsichtbarem Fenster und der Pult-Attrappe auf 127.0.0.1:10023 und prüft
// Verbinden, "Keine Antwort", Ursachensuche mit den ECHTEN Systembefehlen (ping, route, arp), Suche im Netz, Protokoll.
//   node test/smoke-ci.js        (im Projektordner nach "npm install")
const fs = require("fs"), os = require("os"), path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const Sys = require("../shared/sysnet");
const out = []; let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; out.push((ok ? "OK    " : "FAIL  ") + name + (detail !== undefined ? "  " + detail : "")); };
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });
(async () => {
  const electron = require(path.join(ROOT, "node_modules", "electron"));                    // Pfad zur Electron-Programmdatei
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "x32smoke-")), dir = path.join(tmp, "app"), outFile = path.join(tmp, "result.json");
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  ["main.js", "preload.js"].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)));
  copyDir(path.join(ROOT, "shared"), path.join(dir, "shared")); copyDir(path.join(ROOT, "renderer"), path.join(dir, "renderer"));
  fs.copyFileSync(path.join(ROOT, "test/mock-console.js"), path.join(dir, "test/mock-console.js"));
  fs.copyFileSync(path.join(__dirname, "smoke/smoke-main.js"), path.join(dir, "smoke-main.js")); fs.copyFileSync(path.join(__dirname, "smoke/smoke-renderer.js"), path.join(dir, "smoke-renderer.js"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x32-smoke", version: pkg.version, main: "smoke-main.js" }));
  // Router (Standard-Gateway) dieses Rechners für die Hilfe-Prüfung eines erreichbaren Geräts
  const run = async (cmd, args) => { const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true }); return { out: r.stdout || "", err: r.error || null, errOut: r.stderr || "" }; };
  const gateway = await Sys.tools(process.platform, run).defaultGateway().catch(() => null) || "";
  fs.writeFileSync(path.join(dir, "smoke-config.json"), JSON.stringify({ out: outFile, userData: path.join(tmp, "userdata"), gateway }));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const args = [dir]; if (process.platform === "linux") args.unshift("--no-sandbox");
  const t0 = Date.now(), r = spawnSync(electron, args, { env, timeout: 150000, encoding: "utf8" });
  check("Test-App startet und beendet sich selbst (unsichtbares Fenster)", r.status === 0 && fs.existsSync(outFile), "Status " + r.status + ", Dauer " + Math.round((Date.now() - t0) / 1000) + " s" + (r.status !== 0 ? " | " + String(r.stderr || "").slice(0, 300) : ""));
  if (fs.existsSync(outFile)) {
    const R = JSON.parse(fs.readFileSync(outFile, "utf8")), mac = process.platform === "darwin", win = process.platform === "win32";
    if (R.error) check("Rauchtest-Skript lief ohne Fehler", false, R.error);
    else {
      check("Betriebssystem erkannt: Oberfläche kennt '" + process.platform + "', Version " + pkg.version, R.platform === process.platform && R.version === pkg.version && R.pcName === (mac ? "Mac" : "Computer") && new RegExp("^" + (mac ? "Mac" : "Computer") + " und X32").test(R.hintText), JSON.stringify([R.platform, R.pcName, R.version, R.hintText.slice(0, 30)]));
      check("Mikrofon-Status und REW-Suche antworten ohne Absturz (REW ist hier nicht installiert)", ["granted", "denied", "not-determined", "restricted"].includes(R.mic) && R.rew && R.rew.found === false, JSON.stringify([R.mic, R.rew]));
      if (!mac) check("0) Ohne macOS gibt es keine Sperre fürs lokale Netz: Prüfung meldet nie 'blocked', Warnung bleibt versteckt", R.netAccess.blocked === false && R.warnHidden === true, JSON.stringify(R.netAccess));
      check("1) Verbinden mit der Pult-Attrappe über den echten Weg (Oberfläche → Vorlade-Skript → Hauptprozess → UDP): online, Modell bekannt", R.online && R.info && R.info.model === "X32C", JSON.stringify(R.info) + " nach " + R.onlineMs + " ms");
      check("   Statuszeile 'Verbunden', Adresse (bereinigt) gespeichert, Kanalzüge gezeichnet", /^Verbunden/.test(R.statusText) && R.storedIp === "127.0.0.1" && R.okIp === "127.0.0.1" && R.faders > 10, R.statusText + " | Fader " + R.faders);
      check("2) Adresse in anderem Netz (10.255.255.1): nach 1,5 s 'Verbinde …', nach 11 s 'Keine Antwort vom Pult' (Banner, rote Anzeige)", /Verbinde mit 10\.255\.255\.1/.test(R.waitText) && R.noReplyText === "Keine Antwort vom Pult" && R.waiting && R.badgeBad, R.waitText + " | " + R.noReplyText);
      check("   Die App findet die Ursache selbst und nennt sie im Banner: verschiedene Netze, mit dem richtigen Wort (" + (mac ? "Mac" : "Computer") + ")", /verschiedenen Netzen/.test(R.bannerText) && R.bannerText.startsWith(mac ? "Mac und Pult" : "Computer und Pult"), R.bannerText);
      check("3) Verbindungshilfe mit ECHTER Ursachensuche (ping, route, arp, UDP) liefert innerhalb von 14 s ein Urteil: verschiedene Netze, Schritte, Knopf 'Pult im Netz suchen'", /verschiedenen Netzen/.test(R.verdict || "") && R.steps.length >= 3 && R.actions.includes("Pult im Netz suchen") && R.helpMs < 14000, (R.verdict || "").slice(0, 90) + " | " + R.helpMs + " ms");
      check("   Prüfpunkte nennen das echte Netz dieses Rechners und 'Gleiches Netz: nein'", R.checks.some((c) => /Netzwerk des (Macs|Computers) = \d+\.\d+\.\d+\.\d+ \(Netz/.test(c)) && R.checks.some((c) => /Gleiches Netz wie der (Mac|Computer) = nein/.test(c)), R.checks.join(" || "));
      check("   Der echte 'route'-Befehl liefert diesem Rechner einen Weg zur Adresse (über den Router), sichtbar im Prüfpunkt 'Gleiches Netz' (Hinweis auf den Router)", R.checks.some((c) => /Router \d+\.\d+\.\d+\.\d+/.test(c)) || !gateway, R.checks.join(" || "));
      check("4b) Hilfe für den Router im eigenen Netz liefert ein Urteil" + (win ? " ohne macOS-Wörter" : ""), !!R.gwVerdict && (!win || !/macOS|Terminal/.test(R.gwVerdict)), (R.gwVerdict || "(kein Router gefunden)").slice(0, 100) + " | " + R.gwChecks.filter((c) => /Ping|Antworten/.test(c)).join(" || "));
      check("4) Suche im echten Netz läuft ohne Absturz, meldet die durchsuchten Netze und dauert unter 8 s", R.scan && Array.isArray(R.scan.results) && R.scan.ifaces.length >= 1 && R.scan.probed > 400 && R.scanMs < 8000, "Netze: " + (R.scan.ifaces || []).map((f) => f.network + "/" + f.prefix + " " + f.name).join(", ") + " | " + R.scan.probed + " Anfragen | " + R.scanMs + " ms | Fehler " + JSON.stringify(R.scan.errors || {}));
      check("5) Ungültige und leere Adresse werden vom Hauptprogramm mit klarer Meldung abgelehnt", R.bad.ok === false && /keine gültige IP/.test(R.bad.error) && R.empty.ok === false && /noch keine IP/.test(R.empty.error));
      check("Protokoll (Hauptprogramm und Datei): App-Start mit System und Electron-Version, Verbindungen, Ursachensuche", ["App gestartet: X32 Fernsteuerung", mac ? "macOS" : win ? "Windows" : process.platform, "=== Verbinden mit 127.0.0.1:10023", "connecting → online", "=== Verbinden mit 10.255.255.1:10023", "Ursachensuche", "Ergebnis: subnet", "Suche beendet"].every((x) => (R.fileLog || "").includes(x) && R.log.includes(x)), (R.fileLog || "").split("\n").filter((l) => /App gestartet/.test(l)).join(" || ").slice(0, 200));
      if (win) check("Windows: die Systembefehle liefen ohne sichtbares Fenster und wurden ausgewertet (Ping/ARP/Route stehen im Protokoll)", /Ping/.test(R.fileLog) && /Ergebnis: subnet/.test(R.fileLog));
    }
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  out.push(fails ? "==> " + fails + " FEHLER" : "==> alle Tests bestanden");
  console.log(out.join("\n")); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.log("FAIL  Ausnahme: " + (e && e.stack || e)); process.exit(2); });
