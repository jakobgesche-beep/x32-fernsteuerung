"use strict";
// Verbindung zum X32/M32 über UDP (Hauptprozess): verbinden, Pult im Netz suchen, Fehlersuche, Protokolldatei.
// Alle Systemzugriffe (Sockets, Programme wie ping, Dateien) kommen von außen herein (Standard: echte), damit sich jedes Verhalten testen lässt.
const fs = require("fs");
const path = require("path");
const OSC = require("./osc");
const X32Client = require("./client");
const Net = require("./netdiag");

const PORT = 10023;
const LOG_KEEP = 500;                // Zeilen im Speicher
const LOG_FILE_MAX = 300 * 1024;     // danach wird die Datei umbenannt (.1.log)

class X32Connection {
  // opts: dgram, os, execFile, logFile, tmpDir, port, noReplyMs, handlers { status, batch, meter, log }, appName
  constructor(opts) {
    this.dgram = opts.dgram || require("dgram");
    this.os = opts.os || require("os");
    this.execFile = opts.execFile || require("child_process").execFile;
    this.logFile = opts.logFile || null;
    this.tmpDir = opts.tmpDir || require("os").tmpdir();
    this.port = opts.port || PORT;
    this.noReplyMs = opts.noReplyMs || 6000;
    this.h = Object.assign({ status() {}, batch() {}, meter() {}, log() {} }, opts.handlers || {});
    this.now = opts.now || (() => Date.now());
    this.logLines = [];
    this.sock = null; this.client = null; this.target = null; this.watch = null;
    this.stateSince = 0; this.lastState = "idle"; this.rx = 0; this.sent = 0; this.sendErrors = {};
    this.autoDiagDone = false; this.lastDiag = null; this.netAccess = null;
    this.connectId = 0;
  }

  // ---------- Protokoll ----------
  log(msg) {
    const line = new Date(this.now()).toISOString().replace("T", " ").slice(0, 23) + "  " + msg;
    this.logLines.push(line);
    if (this.logLines.length > LOG_KEEP) this.logLines.shift();
    if (this.logFile) {
      try {
        fs.mkdirSync(path.dirname(this.logFile), { recursive: true });
        try { if (fs.statSync(this.logFile).size > LOG_FILE_MAX) fs.renameSync(this.logFile, this.logFile.replace(/\.log$/, "") + ".1.log"); } catch (e) {}
        fs.appendFileSync(this.logFile, line + "\n");
      } catch (e) { /* Protokoll darf nie stören */ }
    }
    this.h.log(line);
  }
  logText() { return this.logLines.join("\n"); }

  // ---------- Verbinden ----------
  async connect(ipText) {
    this.disconnect();
    const chk = Net.checkTarget(ipText);
    if (!chk.ok) { this.log("Verbinden abgelehnt: " + chk.reason); return { ok: false, error: chk.reason }; }
    const ip = chk.ip, id = ++this.connectId, ifaces = Net.interfaces(this.os);
    this.target = ip; this.rx = 0; this.sent = 0; this.sendErrors = {}; this.autoDiagDone = false; this.lastDiag = null; this.stateSince = this.now(); this.lastState = "connecting";
    this.log("=== Verbinden mit " + ip + ":" + this.port + " ===");
    this.log("Netzwerke des Macs: " + (ifaces.length ? ifaces.map((f) => f.name + " " + f.address + "/" + f.prefix).join(", ") : "keine (kein aktives Netzwerk!)"));
    if (!chk.loopback && !Net.ifaceFor(ip, ifaces)) this.log("WARNUNG: " + ip + " liegt in keinem Netz des Macs. Die Pakete gehen über den Router und erreichen das Pult wahrscheinlich nie.");
    return new Promise((resolve) => {
      let ready = false;
      const sock = this.dgram.createSocket("udp4");
      this.sock = sock;
      sock.on("error", (err) => {
        this.noteError(err && err.code);
        this.log("Netzwerkfehler: " + (err && err.code ? err.code + " " : "") + (err && err.message));
        if (!ready) { ready = true; resolve({ ok: false, error: "Das Netzwerk meldet einen Fehler: " + (err && err.message) }); }
      });
      sock.on("message", (msg, rinfo) => {
        this.rx++;
        if (this.rx === 1) this.log("Erste Antwort von " + rinfo.address + ":" + rinfo.port + " (" + msg.length + " Byte)");
        if (this.rx === 1 && rinfo.address !== ip) this.log("HINWEIS: Die Antwort kam von " + rinfo.address + ", eingetragen ist " + ip);
        if (this.client && id === this.connectId) this.client.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
      });
      sock.bind(() => {
        if (id !== this.connectId) { try { sock.close(); } catch (e) {} return resolve({ ok: false, error: "abgebrochen" }); }
        ready = true;
        let local = ""; try { const a = sock.address(); local = a.address + ":" + a.port; } catch (e) {}
        this.log("Socket bereit (lokal " + local + "). Sende /info und /xinfo alle 0,5 s.");
        this.client = new X32Client({
          send: (u8) => this.transmit(sock, u8, ip),
          onBatch: (entries) => this.h.batch(entries),
          onMeter: (mid, floats) => this.h.meter(mid, floats),
          onStatus: (s) => this.forwardStatus(s),
          onLog: (m) => this.log(m),
        });
        this.client.start();
        this.watch = setInterval(() => this.tickWatch(), 1000);
        resolve({ ok: true, ip });
      });
    });
  }
  transmit(sock, u8, ip) {
    try {
      sock.send(u8, 0, u8.length, this.port, ip, (err) => {
        if (err) this.noteError(err.code); else this.sent++;
      });
    } catch (e) { this.noteError(e.code || "THROW"); }
  }
  noteError(code) {
    code = code || "UNBEKANNT";
    const n = (this.sendErrors[code] = (this.sendErrors[code] || 0) + 1);
    if (n === 1 || n === 10 || n % 100 === 0) this.log("Sende-Fehler " + code + " (" + n + "×)");
  }
  disconnect() {
    this.connectId++;
    if (this.watch) { clearInterval(this.watch); this.watch = null; }
    if (this.client) { try { this.client.stop(); } catch (e) {} this.client = null; }
    if (this.sock) { try { this.sock.close(); } catch (e) {} this.sock = null; }
    if (this.lastState !== "idle") this.log("Getrennt.");
    this.lastState = "idle";
  }

  // Zustand für die Oberfläche: Pult-Zustand plus Netzwerk-Angaben (wohin, wie lange, Fehler)
  netInfo(s) {
    const t = this.now(), waiting = s.state === "connecting" || s.state === "lost", since = waiting ? t - this.stateSince : 0;
    return { target: this.target, waitMs: since, noReply: waiting && since >= this.noReplyMs && (s.stats ? s.stats.received : 0) === 0, sendErrors: Object.assign({}, this.sendErrors), sentOk: this.sent, netRx: this.rx, diag: this.lastDiag ? this.lastDiag.verdict.id : null };
  }
  forwardStatus(s) {
    if (s.state !== this.lastState) { this.log("Zustand: " + this.lastState + " → " + s.state + (s.info && s.info.model ? " (" + [s.info.model, s.info.name, s.info.version].filter(Boolean).join(" · ") + ")" : "")); this.lastState = s.state; this.stateSince = this.now(); if (s.state === "online") { this.autoDiagDone = false; } }
    this.h.status(Object.assign({}, s, this.netInfo(s)));
  }
  // jede Sekunde: Wartezeit anzeigen und nach einigen Sekunden ohne Antwort selbständig die Ursache suchen (ins Protokoll)
  tickWatch() {
    const c = this.client;
    if (!c) return;
    if (c.state === "connecting" || c.state === "lost") {
      c.emitStatus(true);
      const since = this.now() - this.stateSince;
      if (!this.autoDiagDone && since >= this.noReplyMs && this.rx === 0) {
        this.autoDiagDone = true;
        this.log("Seit " + Math.round(since / 1000) + " s keine Antwort vom Pult. Suche die Ursache …");
        this.diagnose(this.target, { auto: true }).then((d) => { this.lastDiag = d; if (this.client) this.client.emitStatus(true); }).catch((e) => this.log("Ursachensuche fehlgeschlagen: " + e.message));
      }
    }
  }

  // ---------- Pult im Netz suchen ----------
  // Sucht in ALLEN Netzen des Macs (WLAN, LAN, ...): Einzelanfragen an jede mögliche Adresse plus Rundruf. Antworten: /xinfo bzw. /info.
  async scan(ms) {
    ms = ms || 2200;
    const ifaces = Net.interfaces(this.os), found = new Map(), errors = {}, info = { probed: 0 };
    this.log("Suche im Netz: " + (ifaces.length ? ifaces.map((f) => f.name + " " + Net.ifaceFor(f.address, [f]).network + "/" + f.prefix).join(", ") : "kein Netzwerk"));
    if (!ifaces.length) return { results: [], ifaces, probed: 0, errors };
    const msgs = [OSC.encodeMessage("/xinfo", []), OSC.encodeMessage("/info", [])];
    const socks = [];
    const open = (bindAddr, hosts, bcast, iface) => new Promise((resolve) => {
      const s = this.dgram.createSocket("udp4");
      socks.push(s);
      s.on("error", (e) => { errors[e.code || "FEHLER"] = (errors[e.code || "FEHLER"] || 0) + 1; });
      s.on("message", (m, r) => {
        try {
          const d = OSC.decodeMessage(new Uint8Array(m.buffer, m.byteOffset, m.byteLength));
          const a = d.args.map((x) => x.value);
          if (d.address === "/xinfo" && a.length >= 3) found.set(r.address, { ip: r.address, name: a[1] || "", model: a[2] || "", version: a[3] || "", via: iface ? iface.name : "" });
          else if (d.address === "/info" && a.length >= 3 && !found.has(r.address)) found.set(r.address, { ip: r.address, name: "", model: a[2] || "", version: a[3] || "", via: iface ? iface.name : "" });
        } catch (e) { /* kein OSC */ }
      });
      const start = () => {
        try { s.setBroadcast(true); } catch (e) {}
        const targets = bcast.concat(hosts), send = (round) => {
          let i = 0;
          const chunk = () => {
            const end = Math.min(targets.length, i + 80);
            for (; i < end; i++) msgs.forEach((b) => { info.probed++; try { s.send(b, 0, b.length, this.port, targets[i], (err) => { if (err) errors[err.code || "FEHLER"] = (errors[err.code || "FEHLER"] || 0) + 1; }); } catch (e) { /* weiter */ } });
            if (i < targets.length) setImmediate(chunk);
          };
          chunk();
        };
        send(1);
        setTimeout(() => send(2), Math.floor(ms / 2));                       // zweite Runde: einzelne verlorene Pakete ausgleichen
        resolve();
      };
      if (bindAddr) s.bind(0, bindAddr, start); else s.bind(start);
    });
    await Promise.all(ifaces.map((f) => open(f.address, Net.hostsOf(f), Net.broadcastsOf([f]).filter((b) => b !== "255.255.255.255" || true), f)));
    await open(null, [], ["255.255.255.255"], null);                          // dazu ein allgemeiner Rundruf über die Standard-Verbindung
    await new Promise((r) => setTimeout(r, ms));
    socks.forEach((s) => { try { s.close(); } catch (e) {} });
    const results = Array.from(found.values());
    this.log("Suche beendet: " + (results.length ? results.map((r) => r.ip + " " + (r.model || "") + " " + (r.name || "")).join("; ") : "kein Pult gefunden") + " (" + info.probed + " Anfragen" + (Object.keys(errors).length ? ", Fehler: " + JSON.stringify(errors) : "") + ")");
    return { results, ifaces, probed: info.probed, errors };
  }

  // ---------- Messungen für die Fehlersuche ----------
  run(cmd, args, timeout) {
    return new Promise((resolve) => {
      try { this.execFile(cmd, args, { timeout: timeout || 8000 }, (err, stdout, stderr) => resolve({ err, out: String(stdout || ""), errOut: String(stderr || "") })); }
      catch (e) { resolve({ err: e, out: "", errOut: "" }); }
    });
  }
  async defaultGateway() { const r = await this.run("/sbin/route", ["-n", "get", "default"], 3000); const m = /gateway:\s*([\d.]+)/.exec(r.out); return m ? m[1] : null; }
  async routeTo(ip) {
    const r = await this.run("/sbin/route", ["-n", "get", ip], 3000), g = /gateway:\s*([\d.]+)/.exec(r.out), i = /interface:\s*(\S+)/.exec(r.out);
    return r.out ? { gateway: g ? g[1] : null, interface: i ? i[1] : null, onLink: !g } : null;
  }
  async ping(ip) {
    const r = await this.run("/sbin/ping", ["-c", "3", "-W", "1000", "-t", "5", ip], 9000);
    const rec = /(\d+)\s+packets received/.exec(r.out), tx = /(\d+)\s+packets transmitted/.exec(r.out);
    if (!tx) return { ok: null };
    const loss = /([\d.]+)%\s+packet loss/.exec(r.out), rtt = /=\s*[\d.]+\/([\d.]+)\//.exec(r.out);
    return { ok: !!rec && parseInt(rec[1], 10) > 0, lossPct: loss ? parseFloat(loss[1]) : null, rtt: rtt ? parseFloat(rtt[1]) : null };
  }
  async arp(ip) { const r = await this.run("/usr/sbin/arp", ["-n", ip], 3000), m = /at\s+((?:[0-9a-f]{1,2}:){5}[0-9a-f]{1,2})/i.exec(r.out); return { mac: m ? m[1] : null }; }
  udpProbe(ip) {
    return new Promise((resolve) => {
      const s = this.dgram.createSocket("udp4"), res = { reply: null, sent: 0, sendErrors: {} }, t0 = this.now(), msgs = [OSC.encodeMessage("/info", []), OSC.encodeMessage("/xinfo", [])];
      let done = false, timers = [];
      const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); try { s.close(); } catch (e) {} resolve(res); };
      s.on("error", (e) => { res.sendErrors[e.code || "FEHLER"] = (res.sendErrors[e.code || "FEHLER"] || 0) + 1; });
      s.on("message", (m) => {
        try {
          const d = OSC.decodeMessage(new Uint8Array(m.buffer, m.byteOffset, m.byteLength)), a = d.args.map((x) => x.value);
          if (d.address === "/xinfo") res.reply = { ip: a[0], name: a[1], model: a[2], version: a[3], ms: this.now() - t0 };
          else if (d.address === "/info") res.reply = res.reply || { name: a[1], model: a[2], version: a[3], ms: this.now() - t0 };
          if (res.reply) finish();
        } catch (e) { /* ignorieren */ }
      });
      s.bind(() => {
        [0, 500, 1000, 1500, 2000].forEach((d) => timers.push(setTimeout(() => msgs.forEach((b) => { res.sent++; try { s.send(b, 0, b.length, this.port, ip, (err) => { if (err) res.sendErrors[err.code || "FEHLER"] = (res.sendErrors[err.code || "FEHLER"] || 0) + 1; }); } catch (e) { res.sendErrors.THROW = 1; } }), d)));
        timers.push(setTimeout(finish, 3000));
      });
    });
  }
  // Ein Netzwerk-Zugriffs-Test ohne Pult: Multicast-Anfrage (mDNS) an alle Geräte im Netz. Kommen Antworten, darf die App ins lokale Netz.
  mdnsProbe() {
    return new Promise((resolve) => {
      const s = this.dgram.createSocket({ type: "udp4", reuseAddr: true }), from = new Set();
      let n = 0, done = false;
      const finish = (extra) => { if (done) return; done = true; try { s.close(); } catch (e) {} resolve(Object.assign({ replies: n, devices: from.size }, extra || {})); };
      s.on("message", (m, r) => { n++; from.add(r.address); });
      s.on("error", (e) => finish({ error: e.code }));
      s.bind(0, () => {
        const parts = [Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
        "_services._dns-sd._udp.local".split(".").forEach((l) => parts.push(Buffer.from([l.length]), Buffer.from(l)));
        parts.push(Buffer.from([0, 0, 12, 0x80, 1]));                        // PTR-Anfrage, Antwort direkt an uns ("unicast response")
        try { s.send(Buffer.concat(parts), 0, Buffer.concat(parts).length, 5353, "224.0.0.251", (err) => { if (err) finish({ error: err.code }); }); } catch (e) { finish({ error: e.code || "THROW" }); }
      });
      setTimeout(() => finish(), 1600);
    });
  }
  gatewayProbe(gw) {
    return new Promise((resolve) => {
      const s = this.dgram.createSocket("udp4");
      let done = false;
      const finish = (r) => { if (done) return; done = true; try { s.close(); } catch (e) {} resolve(r); };
      s.on("error", (e) => finish({ ok: false, error: e.code }));
      s.bind(() => { try { s.send(Buffer.from("x"), 0, 1, 9, gw, (err) => finish(err ? { ok: false, error: err.code } : { ok: true })); } catch (e) { finish({ ok: false, error: e.code || "THROW" }); } });
      setTimeout(() => finish({ ok: true }), 800);
    });
  }
  // Darf die App ins lokale Netz? Ein Rundruf (Multicast) scheitert mit EHOSTUNREACH & Co., wenn macOS den Zugriff verweigert (so im Versuch nachgestellt).
  // Einzelne Pakete an Geräte werden dagegen ohne Fehler still verworfen; deshalb taugt nur dieser Test als Nachweis.
  async checkLocalNetwork() {
    const r = await this.mdnsProbe(), denied = ["EHOSTUNREACH", "EPERM", "EACCES", "EPIPE", "ENETUNREACH"], blocked = !!r.error && denied.includes(r.error), noNet = Net.interfaces(this.os).length === 0;
    this.netAccess = { blocked: blocked && !noNet, error: r.error || null, replies: r.replies || 0, devices: r.devices || 0, noNetwork: noNet, at: this.now() };
    this.log("Zugriff aufs lokale Netzwerk: " + (noNet ? "kein Netzwerk vorhanden" : blocked ? "VERWEIGERT von macOS (Fehler " + r.error + ")" : r.replies > 0 ? "erlaubt (" + r.devices + " Geräte haben geantwortet)" : "keine Sperre gemeldet (kein anderes Gerät hat geantwortet)"));
    return this.netAccess;
  }
  // Beim Start der App: kleine Anfrage an den Router (löst bei "noch nicht entschieden" die macOS-Abfrage aus) und Test, ob der Zugriff erlaubt ist
  async wakeLocalNetwork() {
    const gw = await this.defaultGateway();
    if (gw) { const r = await this.gatewayProbe(gw); this.log("Start: kleine Anfrage an den Router " + gw + " gesendet: " + (r.ok ? "ok" : "Fehler " + r.error)); }
    else this.log("Start: kein Router gefunden (Netzwerk?)");
    return this.checkLocalNetwork();
  }

  async diagnose(ipText, opts) {
    opts = opts || {};
    const ifaces = Net.interfaces(this.os), chk = Net.checkTarget(ipText || this.target || ""), ip = chk.ok ? chk.ip : null;
    this.log("--- Ursachensuche für " + (ipText || this.target || "(keine Adresse)") + " ---");
    const [gateway, route, ping, udp, mdns] = await Promise.all([this.defaultGateway(), ip ? this.routeTo(ip) : null, ip ? this.ping(ip) : null, ip ? this.udpProbe(ip) : null, this.mdnsProbe()]);
    const arp = ip ? await this.arp(ip) : null, gatewayUdp = gateway ? await this.gatewayProbe(gateway) : null;
    const res = Net.diagnose({ ip: ipText || this.target || "", ifaces, gateway, route, probes: { ping, arp, udp, mdns, gatewayUdp }, terminal: opts.terminal || null });
    res.info = { ifaces, gateway, route, command: Net.localNetworkCommand(ifaces, ip) };
    this.lastDiag = res;
    res.checks.forEach((c) => this.log("  [" + c.level + "] " + c.title + ": " + c.detail));
    this.log("Ergebnis: " + res.verdict.id + " – " + res.verdict.title);
    return res;
  }

  // Vergleichstest: dieselbe Anfrage aus dem Terminal (dort erlaubt macOS den Netzwerkzugriff). Bekommt das Terminal Antwort, die App aber nicht: macOS blockiert die App.
  async terminalTest(ipText) {
    const chk = Net.checkTarget(ipText || this.target || "");
    if (!chk.ok) return { ok: false, error: chk.reason };
    const script = path.join(this.tmpDir, "x32-terminal-test.command"), out = path.join(this.tmpDir, "x32-terminal-test-result.txt");
    try { fs.rmSync(out, { force: true }); } catch (e) {}
    const body = ["#!/bin/bash", 'IP="' + chk.ip + '"', 'OUT="' + out + '"', "clear", 'echo "=== X32 Verbindungstest über das Terminal ==="', 'echo "Ziel: $IP, Port 10023"', "echo",
      "REPLY=$(printf '/info\\0\\0\\0' | /usr/bin/nc -u -w 3 \"$IP\" 10023 2>/dev/null | /usr/bin/xxd -p | tr -d '\\n' | head -c 400)",
      'if [ -n "$REPLY" ]; then echo "ANTWORT VOM PULT ERHALTEN"; echo "REPLY $REPLY" > "$OUT.tmp"; else echo "KEINE ANTWORT"; echo "NOREPLY" > "$OUT.tmp"; fi',
      'mv "$OUT.tmp" "$OUT"', "echo", 'echo "Dieses Fenster kann geschlossen werden."', ""].join("\n");
    try { fs.writeFileSync(script, body, { mode: 0o755 }); fs.chmodSync(script, 0o755); } catch (e) { return { ok: false, error: "Test-Datei konnte nicht angelegt werden: " + e.message }; }
    this.log("Vergleichstest über Terminal gestartet (" + chk.ip + ")");
    const opened = await this.run("/usr/bin/open", [script], 5000);
    if (opened.err) return { ok: false, error: "Das Terminal ließ sich nicht öffnen." };
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      let txt = null; try { txt = fs.readFileSync(out, "utf8"); } catch (e) {}
      if (txt !== null) { const replied = /^REPLY /.test(txt); this.log("Vergleichstest Terminal: " + (replied ? "Pult antwortet" : "keine Antwort")); return { ok: true, replied, text: txt.trim().slice(0, 200) }; }
    }
    return { ok: false, error: "Keine Rückmeldung vom Terminal-Test (Fenster geschlossen?)." };
  }
}

module.exports = X32Connection;
X32Connection.PORT = PORT;
