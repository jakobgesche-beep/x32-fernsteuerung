// Rauchtest im echten Electron (macOS): baut aus der installierten App eine Test-Kopie mit dem aktuellen Code, eigener UUID und Hinweistext,
// startet sie unsichtbar und prüft Verbinden, "Keine Antwort", Ursachensuche und Suche im echten Netz.
//   ELECTRON_RUN_AS_NODE=1 "/Applications/X32 Fernsteuerung.app/Contents/MacOS/X32 Fernsteuerung" test/smoke.js
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const ROOT = path.join(__dirname, ".."), APP = "/Applications/X32 Fernsteuerung.app";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const out = []; let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; out.push((ok ? "OK    " : "FAIL  ") + name + (detail !== undefined ? "  " + detail : "")); };
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "x32smoke-")), copy = path.join(tmp, "X32 Fernsteuerung.app"), res = path.join(copy, "Contents/Resources"), dir = path.join(res, "app");
  execFileSync("cp", ["-R", APP, copy]);
  execFileSync("rm", ["-rf", path.join(res, "app.asar"), path.join(res, "app.asar.unpacked")]);      // (fs.rmSync behandelt .asar in Electron als Archiv)
  fs.mkdirSync(path.join(dir, "test"), { recursive: true });
  ["main.js", "preload.js"].forEach((f) => fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)));
  execFileSync("cp", ["-R", path.join(ROOT, "shared"), path.join(ROOT, "renderer"), dir]);
  fs.copyFileSync(path.join(ROOT, "test/mock-console.js"), path.join(dir, "test/mock-console.js"));
  fs.copyFileSync(path.join(__dirname, "smoke/smoke-main.js"), path.join(dir, "smoke-main.js")); fs.copyFileSync(path.join(__dirname, "smoke/smoke-renderer.js"), path.join(dir, "smoke-renderer.js"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x32-smoke", version: pkg.version, main: "smoke-main.js" }));
  const outFile = path.join(tmp, "result.json");
  const gw = (/gateway:\s*([\d.]+)/.exec(spawnSync("/sbin/route", ["-n", "get", "default"]).stdout.toString()) || [])[1] || "";
  fs.writeFileSync(path.join(dir, "smoke-config.json"), JSON.stringify({ out: outFile, userData: path.join(tmp, "userdata"), gateway: gw }));
  // Hinweistexte wie electron-builder (extendInfo) in die Info.plist, dann eigene UUID + Signatur wie im echten Bau
  const plist = path.join(copy, "Contents/Info.plist");
  Object.entries(pkg.build.mac.extendInfo).forEach(([k, v]) => { spawnSync("/usr/libexec/PlistBuddy", ["-c", "Delete :" + k, plist]); execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :" + k + " string " + v, plist]); });
  await require("../scripts/afterSignAdHoc")({ electronPlatformName: "darwin", appOutDir: tmp, packager: { appInfo: { productFilename: "X32 Fernsteuerung", id: pkg.build.appId } } });
  check("Test-App: Hinweistext für das lokale Netzwerk steht in der Info.plist", /Pult/.test(execFileSync("/usr/libexec/PlistBuddy", ["-c", "Print :NSLocalNetworkUsageDescription", plist]).toString()));
  const env = Object.assign({}, process.env); delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now(), r = spawnSync("open", ["-n", "-W", copy], { env, timeout: 120000 });
  check("Test-App startet und beendet sich selbst (unsichtbares Fenster)", r.status === 0 && fs.existsSync(outFile), "Dauer " + Math.round((Date.now() - t0) / 1000) + " s");
  if (fs.existsSync(outFile)) {
    const R = JSON.parse(fs.readFileSync(outFile, "utf8"));
    if (R.error) check("Rauchtest-Skript lief ohne Fehler", false, R.error);
    else {
      check("0) Netzwerkzugriff beim Start geprüft: Warnung im Startbildschirm ist sichtbar genau dann, wenn macOS den Zugriff verweigert (hier: " + (R.netAccess.blocked ? "verweigert, Fehler " + R.netAccess.error : "erlaubt/unklar") + ")", typeof R.netAccess.blocked === "boolean" && R.warnHidden === !R.netAccess.blocked, JSON.stringify(R.netAccess) + " warnHidden=" + R.warnHidden);
      check("1) Verbinden mit der Pult-Attrappe über den ECHTEN Weg (Oberfläche → Vorlade-Skript → Hauptprozess → UDP): online, Modell bekannt", R.online && R.info && R.info.model === "X32C", JSON.stringify(R.info) + " nach " + R.onlineMs + " ms");
      check("   Statuszeile zeigt „Verbunden“ mit Modell, Adresse (bereinigt) wurde gespeichert und als funktionierend markiert, Kanalzüge werden gezeichnet", /^Verbunden/.test(R.statusText) && R.storedIp === "127.0.0.1" && R.okIp === "127.0.0.1" && R.faders > 10, R.statusText + " | Fader " + R.faders);
      check("2) Adresse in anderem Netz (10.255.255.1): nach 1,5 s „Verbinde mit 10.255.255.1 …“, nach 11 s „Keine Antwort vom Pult“ mit Banner und roter Anzeige", /Verbinde mit 10\.255\.255\.1/.test(R.waitText) && R.noReplyText === "Keine Antwort vom Pult" && R.waiting && R.badgeBad && R.bannerTitle === "Keine Antwort vom Pult", R.waitText + " | " + R.noReplyText);
      check("   Die App hat die Ursache selbst gefunden und nennt sie im Banner: verschiedene Netze", /verschiedenen Netzen/.test(R.bannerText), R.bannerText);
      check("3) Verbindungshilfe mit ECHTER Ursachensuche (Ping, Route, ARP, UDP, Netz-Zugriffs-Probe) liefert innerhalb von 12 s ein Urteil: „verschiedenen Netzen“, Schritte und Knopf „Pult im Netz suchen“", /verschiedenen Netzen/.test(R.verdict || "") && R.steps.length >= 3 && R.actions.includes("Pult im Netz suchen") && R.helpMs < 12000, (R.verdict || "").slice(0, 90) + " | " + R.helpMs + " ms");
      check("   Prüfpunkte nennen das echte Netz dieses Macs und „Gleiches Netz: nein“", R.checks.some((c) => /Netzwerk des Macs/.test(c) && /\d+\.\d+\.\d+\.\d+ \(Netz/.test(c)) && R.checks.some((c) => /Gleiches Netz wie der Mac = nein/.test(c)), R.checks.join(" || "));
      { const blocked = R.gwChecks.some((c) => /Zugriff der App aufs lokale Netzwerk = macOS verweigert/.test(c)), verdictBlocked = /macOS lässt die App nicht ins lokale Netzwerk/.test(R.gwVerdict || "");
        check("4b) Hilfe für den Router im eigenen Netz (erreichbar, aber kein Pult): Urteil passt zum Messwert (Sperre nur, wenn macOS wirklich den Fehler meldet; sonst „kein X32“/„nichts kommt zurück“)", !!R.gwVerdict && (blocked ? verdictBlocked : !verdictBlocked), "Sperre gemessen: " + blocked + " | Urteil: " + (R.gwVerdict || "").slice(0, 70) + " | " + R.gwChecks.filter((c) => /Zugriff|Ping/.test(c)).join(" || ")); }
      check("4) Suche im echten Netz läuft ohne Absturz, meldet die durchsuchten Netze dieses Macs und dauert unter 6 s", R.scan && Array.isArray(R.scan.results) && R.scan.ifaces.length >= 1 && R.scan.probed > 400 && R.scanMs < 6000, "Netze: " + (R.scan.ifaces || []).map((f) => f.network + "/" + f.prefix + " " + f.name).join(", ") + " | " + R.scan.probed + " Anfragen | " + R.scanMs + " ms | gefunden: " + R.scan.results.length);
      check("5) Ungültige und leere Adresse werden vom Hauptprogramm mit klarer Meldung abgelehnt", R.bad.ok === false && /keine gültige IP/.test(R.bad.error) && R.empty.ok === false && /noch keine IP/.test(R.empty.error), JSON.stringify([R.bad.error, R.empty.error]));
      check("Protokoll (im Hauptprogramm und als Datei): App-Start mit Versionen, Anfrage ans lokale Netz beim Start, Verbindungen, Ursachensuche", ["App gestartet: X32 Fernsteuerung", "kleine Anfrage an den Router", "Zugriff aufs lokale Netzwerk:", "=== Verbinden mit 127.0.0.1:10023", "connecting → online", "=== Verbinden mit 10.255.255.1:10023", "WARNUNG: 10.255.255.1 liegt in keinem Netz", "Ursachensuche", "Ergebnis: subnet", "Suche beendet"].every((s) => (R.fileLog || "").includes(s) && R.log.includes(s.replace("App gestartet: X32 Fernsteuerung", "App gestartet"))), (R.fileLog || "").split("\n").filter((l) => /App gestartet|angefragt/.test(l)).join(" || ").slice(0, 300));
    }
  }
  execFileSync("rm", ["-rf", tmp]);
  out.push(fails ? "==> " + fails + " FEHLER" : "==> alle Tests bestanden");
  console.log(out.join("\n")); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.log("FAIL  Ausnahme: " + (e && e.stack || e)); process.exit(2); });
