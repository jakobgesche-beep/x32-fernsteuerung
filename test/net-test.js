// Tests für die Netzwerk-Schicht (Node): Adress-Rechnung, Ursachen-Diagnose, Verbinden über echte UDP-Sockets, Suche in mehreren Netzen,
// Protokolldatei, Terminal-Vergleichstest. Ausführen:  ELECTRON_RUN_AS_NODE=1 <Electron-Programm> test/net-test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const dgram = require("dgram");
const { EventEmitter } = require("events");
const OSC = require("../shared/osc");
const Net = require("../shared/netdiag");
const X32Connection = require("../shared/connection");
const MockX32 = require("./mock-console");

const out = []; let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; out.push((ok ? "OK    " : "FAIL  ") + name + (detail !== undefined ? "  " + detail : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await sleep(20); } return false; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "x32net-"));

// ---------- Attrappe für das Netzwerk (Sockets im Speicher) ----------
// model({ from, to, data }) -> { error: "CODE" } | { replies: [{ data, from: { address, port }, delay }] } | undefined (Paket verschwindet still)
class FakeNet {
  constructor(model) { this.model = model; this.sockets = []; this.sent = []; this.n = 0; }
  createSocket(opts) { const s = new FakeSocket(this); this.sockets.push(s); return s; }
}
class FakeSocket extends EventEmitter {
  constructor(net) { super(); this.net = net; this.closed = false; this.localAddr = "0.0.0.0"; this.localPort = 40000 + net.n++; }
  bind(a, b, c) { const cb = [a, b, c].find((x) => typeof x === "function"); if (typeof b === "string") this.localAddr = b; setImmediate(() => cb && cb()); }
  address() { return { address: this.localAddr, port: this.localPort, family: "IPv4" }; }
  setBroadcast() {}
  close() { this.closed = true; }
  send(msg, offset, length, port, addr, cb) {
    if (this.closed) return;
    const data = Buffer.from(msg.buffer ? new Uint8Array(msg.buffer, msg.byteOffset + (offset || 0), length !== undefined ? length : msg.byteLength) : msg);
    const pkt = { from: { address: this.localAddr, port: this.localPort }, to: { address: addr, port }, data };
    this.net.sent.push(pkt);
    const o = this.net.model(pkt, this) || {};
    if (o.error) { setImmediate(() => cb && cb(Object.assign(new Error("send " + o.error + " " + addr + ":" + port), { code: o.error }))); return; }
    setImmediate(() => cb && cb(null));
    (o.replies || []).forEach((r) => setTimeout(() => { if (!this.closed) this.emit("message", Buffer.from(r.data), { address: r.from.address, port: r.from.port, family: "IPv4", size: r.data.length }); }, r.delay || 1));
  }
}
const oscBuf = (addr, strs) => Buffer.from(OSC.encodeMessage(addr, strs.map((v) => ({ type: "s", value: v }))));
const addrOf = (pkt) => OSC.decodeMessage(new Uint8Array(pkt.data)).address;
// eine X32-Attrappe unter einer IP: beantwortet /info und /xinfo
const consoleReplies = (ip, pkt, extra) => {
  const a = addrOf(pkt), from = { address: ip, port: 10023 };
  if (a === "/xinfo") return { replies: [{ data: oscBuf("/xinfo", [ip, "X32-TEST", "X32C", "4.06"]), from }] };
  if (a === "/info") return { replies: [{ data: oscBuf("/info", ["V2.05", "osc-server", "X32C", "4.06"]), from }] };
  return {};
};
const osFake = (ifs) => ({ networkInterfaces: () => ifs, tmpdir: os.tmpdir });
const IF_HOME = { en0: [{ address: "192.168.178.81", netmask: "255.255.255.0", family: "IPv4", mac: "aa:bb", internal: false }, { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false }], lo0: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }] };

(async () => {
  // =============== A. Adressen und Netze ===============
  check("IP-Eingabe wird bereinigt: Leerzeichen, Komma statt Punkt, führende Nullen", Net.parseIPv4(" 192.168.001.050 ") === "192.168.1.50" && Net.parseIPv4("192,168,1,50") === "192.168.1.50" && Net.parseIPv4("192 . 168 . 1 . 50") === "192.168.1.50");
  check("Ungültige Eingaben werden abgelehnt (zu kurz, 256, Buchstaben, leer, zu lang)", ["192.168.1", "192.168.1.256", "abc", "", "1.2.3.4.5", null, "192.168.1.5x"].every((x) => Net.parseIPv4(x) === null));
  check("Pult-Adresse: 0.0.0.0, Rundruf und Sammel-Adressen sind keine gültigen Ziele, 127.0.0.1 gilt als eigener Mac", !Net.checkTarget("0.0.0.0").ok && !Net.checkTarget("255.255.255.255").ok && !Net.checkTarget("224.0.0.1").ok && Net.checkTarget("127.0.0.1").loopback === true && Net.checkTarget("10.0.0.7").ok);
  { const f = Net.interfaces(osFake(Object.assign({}, IF_HOME, { en5: [{ address: "169.254.3.4", netmask: "255.255.0.0", family: "IPv4", internal: false }], bridge0: [{ address: "10.1.2.3", netmask: "255.255.252.0", family: "IPv4", internal: false }] })));
    check("Netzwerke des Macs: nur echte IPv4 (kein Loopback, kein IPv6), Notadressen 169.254 ganz hinten", f.length === 3 && f[0].address === "192.168.178.81" && f[f.length - 1].linkLocal === true && f[0].prefix === 24 && f[0].network === "192.168.178.0" && f[0].broadcast === "192.168.178.255", f.map((x) => x.address + "/" + x.prefix).join(","));
    check("Netz-Rechnung /22: 10.1.2.3/22 = Netz 10.1.0.0, Rundruf 10.1.3.255", f[1].network === "10.1.0.0" && f[1].broadcast === "10.1.3.255", f[1].network + " " + f[1].broadcast);
    check("Zugehörigkeit: 192.168.178.25 liegt im WLAN-Netz, 192.168.0.64 in keinem", Net.ifaceFor("192.168.178.25", f).name === "en0" && Net.ifaceFor("192.168.0.64", f) === null); }
  { const f = Net.interfaces(osFake(IF_HOME))[0], h = Net.hostsOf(f);
    check("Suchbereich /24: 253 mögliche Geräte (ohne .0, .255 und den Mac selbst)", h.length === 253 && !h.includes("192.168.178.81") && !h.includes("192.168.178.0") && !h.includes("192.168.178.255") && h[0] === "192.168.178.1", h.length + " Adressen");
    const big = Net.interfaces(osFake({ en0: [{ address: "10.20.30.40", netmask: "255.255.0.0", family: "IPv4", internal: false }] }))[0], hb = Net.hostsOf(big);
    check("Großes Netz /16 wird auf ein Fenster von höchstens 1022 Adressen um den Mac begrenzt", hb.length <= 1022 && hb.length > 1000 && hb.includes("10.20.30.41") && !hb.includes("10.20.30.40"), hb.length + " Adressen");
    const tiny = Net.interfaces(osFake({ en0: [{ address: "10.0.0.5", netmask: "255.255.255.252", family: "IPv4", internal: false }] }))[0];
    check("Kleines Netz /30 (direktes Kabel): genau die andere nutzbare Adresse", JSON.stringify(Net.hostsOf(tiny)) === JSON.stringify(["10.0.0.6"]), JSON.stringify(Net.hostsOf(tiny)));
    check("Rundruf-Adressen: 255.255.255.255 und die gerichtete des Netzes", JSON.stringify(Net.broadcastsOf([f])) === JSON.stringify(["255.255.255.255", "192.168.178.255"]));
    check("Systembefehl (Notlösung) nennt das Netz des Pults, nicht das eines anderen", /192\.168\.178\.0\/24/.test(Net.localNetworkCommand([f], "192.168.178.60")) && /AllowedWiFiLocalNetworkAddresses/.test(Net.localNetworkCommand([f], "192.168.178.60")) && /AllowedEthernetLocalNetworkAddresses/.test(Net.localNetworkCommand([f]))); }

  // =============== B. Urteile der Diagnose (jede Ursache einzeln) ===============
  const ifs = Net.interfaces(osFake(IF_HOME)), P = (o) => Object.assign({ ping: { ok: true, rtt: 2 }, arp: { mac: "0:1d:c1:aa:bb:cc" }, udp: { reply: null, sent: 10, sendErrors: {} }, mdns: { replies: 7, devices: 5 }, gatewayUdp: { ok: true } }, o);
  const verdict = (ip, probes, extra) => Net.diagnose(Object.assign({ ip, ifaces: ifs, gateway: "192.168.178.1", route: { gateway: "192.168.178.1" }, probes }, extra || {})).verdict;
  check("Urteil: Pult antwortet -> ok, Knopf „Jetzt verbinden“", (() => { const v = verdict("192.168.178.60", P({ udp: { reply: { model: "X32C", version: "4.06", ms: 4 }, sent: 2, sendErrors: {} } })); return v.id === "ok" && v.actions[0].id === "retry"; })());
  check("Urteil: ungültige Eingabe -> bad-ip", verdict("192.168.1", P()).id === "bad-ip");
  check("Urteil: Mac ohne Netzwerk -> no-network", Net.diagnose({ ip: "192.168.178.60", ifaces: [], probes: P() }).verdict.id === "no-network");
  check("Urteil: Pult-Adresse 192.168.0.64, Mac in 192.168.178.x -> verschiedene Netze, nennt beide Netze, bietet „Pult suchen“", (() => { const v = verdict("192.168.0.64", P({ ping: { ok: false }, mdns: { replies: 7, devices: 5 } })); return v.id === "subnet" && /192\.168\.178\.0\/24/.test(v.text) && /192\.168\.0\.64/.test(v.text) && v.actions.some((a) => a.id === "scan"); })());
  check("Urteil: richtiges Netz, Ping ohne Antwort -> Pult nicht erreichbar (aus/Kabel/andere Adresse)", (() => { const v = verdict("192.168.178.60", P({ ping: { ok: false }, arp: { mac: null } })); return v.id === "unreachable" && v.steps.some((s) => /kabel/i.test(s)) && v.steps.some((s) => /NETWORK/.test(s)); })());
  check("Urteil: Ping ok, Senden schlägt fehl und Router-Test schlägt fehl -> macOS lässt die App nicht ins lokale Netz (mit Knopf zu den Einstellungen)", (() => { const v = verdict("192.168.178.60", P({ udp: { reply: null, sent: 10, sendErrors: { EHOSTUNREACH: 10 } }, gatewayUdp: { ok: false, error: "EHOSTUNREACH" } })); return v.id === "blocked-error" && v.actions.some((a) => a.id === "open-privacy"); })());
  check("Urteil: Ping ok, kein Sendefehler, aber auch keine Antwort anderer Geräte -> stumme Sperre wahrscheinlich (Einstellungen + Vergleichstest)", (() => { const v = verdict("192.168.178.60", P({ mdns: { replies: 0, devices: 0 } })); return v.id === "maybe-blocked" && v.actions.some((a) => a.id === "open-privacy") && v.actions.some((a) => a.id === "terminal-test"); })());
  check("Urteil: Ping ok, Antworten anderer Geräte kommen an, nur das Pult schweigt -> Gerät ist nicht das Pult / nicht bereit", (() => { const v = verdict("192.168.178.60", P()); return v.id === "silent-osc" && /keine X32-Antwort/.test(v.title) && v.steps.some((s) => /X32-Edit/.test(s)); })());
  check("Urteil: Terminal bekommt Antwort, App nicht -> sicher macOS (app-blocked)", verdict("192.168.178.60", P({ mdns: { replies: 0, devices: 0 } }), { terminal: { replied: true } }).id === "app-blocked");
  check("Urteil: Ping nicht messbar und keine Antwort -> allgemeine Hilfe mit Suche und Einstellungen", (() => { const v = verdict("192.168.178.60", P({ ping: { ok: null } })); return v.id === "no-reply" && v.actions.some((a) => a.id === "scan") && v.actions.some((a) => a.id === "open-privacy"); })());
  { const d = Net.diagnose({ ip: "192.168.0.64", ifaces: ifs, gateway: "192.168.178.1", route: { gateway: "192.168.178.1" }, probes: P({ ping: { ok: false } }) });
    check("Prüfliste enthält Netz des Macs, Adresse, „Gleiches Netz: nein“ mit Router-Hinweis, Ping, Pult-Antwort", d.checks.some((c) => c.id === "net" && /192\.168\.178\.81/.test(c.detail)) && d.checks.some((c) => c.id === "subnet" && c.level === "fail" && /Router 192\.168\.178\.1/.test(c.detail)) && d.checks.some((c) => c.id === "ping" && c.level === "fail") && d.checks.some((c) => c.id === "osc" && c.level === "fail")); }

  // =============== C. Verbinden über ECHTE UDP-Sockets (Loopback) ===============
  const PORT = 20023; let lastSrc = null, seen = new Set();
  const server = dgram.createSocket("udp4");
  let remote = null;
  const mock = new MockX32({ deliver: (u8) => { if (remote) server.send(u8, remote.port, remote.address); }, latency: 1 });
  server.on("message", (msg, rinfo) => { remote = rinfo; lastSrc = rinfo.port; const a = OSC.decodeMessage(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)).address; seen.add(a); mock.receive(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength)); });
  await new Promise((r) => server.bind(PORT, "127.0.0.1", r));
  { const statuses = [], logs = [], conn = new X32Connection({ port: PORT, logFile: path.join(tmp, "v.log"), handlers: { status: (s) => statuses.push(s), log: (l) => logs.push(l) }, os: osFake(IF_HOME) });
    const r = await conn.connect(" 127.0.0.1 ");
    check("Verbinden (echte Sockets): Eingabe mit Leerzeichen wird akzeptiert, Antwort ok mit bereinigter IP", r.ok && r.ip === "127.0.0.1");
    const online = await waitFor(() => statuses.some((s) => s.state === "online"), 3000);
    const last = statuses[statuses.length - 1];
    check("Pult (Attrappe) antwortet: Zustand online binnen 3 s, Modell und Firmware sind bekannt", online && last.info && last.info.model === "X32C" && last.info.version === "4.06", JSON.stringify(last && last.info));
    check("Handshake sendet /info UND /xinfo UND /xremote (das Pult hat alle drei gesehen)", seen.has("/info") && seen.has("/xinfo") && seen.has("/xremote"), Array.from(seen).join(","));
    check("Das Pult antwortet an den Absender-Port der App (nicht an Port 10023)", lastSrc !== null && lastSrc !== PORT && conn.rx > 0, "Absender-Port " + lastSrc);
    check("Status trägt Ziel und Netzwerk-Zähler (target, netRx > 0, keine Sendefehler)", last.target === "127.0.0.1" && last.netRx > 0 && Object.keys(last.sendErrors).length === 0 && last.noReply === false);
    check("Protokoll enthält Netzwerke des Macs, „Socket bereit“, erste Antwort und den Zustandswechsel", /Netzwerke des Macs: en0 192\.168\.178\.81\/24/.test(conn.logText()) && /Socket bereit/.test(conn.logText()) && /Erste Antwort von 127\.0\.0\.1/.test(conn.logText()) && /connecting → online/.test(conn.logText()));
    check("Protokolldatei wird geschrieben (gleicher Inhalt)", fs.existsSync(path.join(tmp, "v.log")) && /Erste Antwort/.test(fs.readFileSync(path.join(tmp, "v.log"), "utf8")));
    conn.disconnect(); await sleep(50);
    check("Trennen: Socket geschlossen, Zustand idle", conn.sock === null && conn.client === null && statuses[statuses.length - 1].state === "idle");
    const bad = await conn.connect("hallo");
    check("Ungültige Adresse: klare Meldung, kein Socket, Protokolleintrag", !bad.ok && /keine gültige IP/.test(bad.error) && conn.sock === null && /abgelehnt/.test(conn.logText()));
    const r2 = await conn.connect("127.0.0.1"); await waitFor(() => conn.client && conn.client.state === "online", 3000);
    check("Nach dem Trennen lässt sich erneut verbinden", r2.ok && conn.client.state === "online"); conn.disconnect(); }

  // ohne Pult: nach der Frist „keine Antwort“, mit selbständiger Ursachensuche
  { const statuses = [], fake = new FakeNet((pkt) => (pkt.to.port === 10023 ? undefined : undefined)), exec = (cmd, args, o, cb) => {
      const a = args.join(" ");
      if (/route -n get default/.test(cmd + " " + a)) return cb(null, "   route to: default\n    gateway: 192.168.178.1\n  interface: en0\n", "");
      if (/route -n get/.test(cmd + " " + a)) return cb(null, "gateway: 192.168.178.1\n interface: en0\n", "");
      if (/ping/.test(cmd)) return cb(new Error("x"), "3 packets transmitted, 0 packets received, 100.0% packet loss\n", "");
      if (/arp/.test(cmd)) return cb(null, "? (192.168.0.64) at (incomplete) on en0\n", "");
      cb(new Error("unbekannt"), "", "");
    };
    const conn = new X32Connection({ dgram: fake, os: osFake(IF_HOME), execFile: exec, port: 10023, noReplyMs: 1500, handlers: { status: (s) => statuses.push(s) } });
    const r = await conn.connect("192.168.0.64");
    check("Andere-Netz-Adresse: Verbinden wird trotzdem versucht, aber das Protokoll warnt sofort", r.ok && /WARNUNG: 192\.168\.0\.64 liegt in keinem Netz des Macs/.test(conn.logText()));
    await sleep(1250);
    const early = statuses[statuses.length - 1];
    check("Vor der Frist: Zustand „verbinde“, Wartezeit läuft, noch keine Meldung „keine Antwort“", early.state === "connecting" && early.noReply === false && early.waitMs > 500, "wait " + early.waitMs);
    const flagged = await waitFor(() => statuses.length && statuses[statuses.length - 1].noReply === true, 3000);
    check("Nach der Frist (hier 1,5 s): noReply = wahr, Anzahl Handshakes steigt (alle 0,5 s)", flagged && statuses[statuses.length - 1].handshakes >= 3, "handshakes " + statuses[statuses.length - 1].handshakes);
    const diagged = await waitFor(() => statuses.length && statuses[statuses.length - 1].diag, 8000);
    check("Die App sucht die Ursache selbst und meldet sie im Status: „subnet“ (Pult im anderen Netz)", diagged && statuses[statuses.length - 1].diag === "subnet", String(statuses[statuses.length - 1].diag));
    check("Das Protokoll enthält die Ursachensuche mit allen Prüfpunkten und dem Ergebnis", /Ursachensuche/.test(conn.logText()) && /\[fail\] Gleiches Netz wie der Mac/.test(conn.logText()) && /Ergebnis: subnet/.test(conn.logText()));
    conn.disconnect(); }

  // Sendefehler (macOS meldet EHOSTUNREACH) werden gezählt und angezeigt
  { const statuses = [], fake = new FakeNet(() => ({ error: "EHOSTUNREACH" })), conn = new X32Connection({ dgram: fake, os: osFake(IF_HOME), execFile: (c, a, o, cb) => cb(new Error("x"), "", ""), noReplyMs: 60000, handlers: { status: (s) => statuses.push(s) } });
    await conn.connect("192.168.178.60"); await sleep(1700);
    const l = statuses[statuses.length - 1];
    check("Sendefehler EHOSTUNREACH: im Status gezählt (sendErrors), im Protokoll einmalig gemeldet", l && l.sendErrors.EHOSTUNREACH >= 3 && /Sende-Fehler EHOSTUNREACH \(1×\)/.test(conn.logText()) && (conn.logText().match(/Sende-Fehler EHOSTUNREACH \(1×\)/g) || []).length === 1, JSON.stringify(l && l.sendErrors));
    conn.disconnect(); }

  // =============== D. Ursachensuche mit vollständig nachgestellten Netzen ===============
  const mkExec = (o) => (cmd, args, opt, cb) => {
    const a = cmd + " " + args.join(" ");
    if (/route -n get default/.test(a)) return cb(null, "gateway: 192.168.178.1\n interface: en0\n", "");
    if (/route -n get/.test(a)) return cb(null, o.route || "gateway: 192.168.178.1\n interface: en0\n", "");
    if (/ping/.test(cmd)) return o.pingOk ? cb(null, "3 packets transmitted, 3 packets received, 0.0% packet loss\nround-trip min/avg/max/stddev = 1.2/1.5/2.0/0.3 ms\n", "") : cb(new Error("x"), "3 packets transmitted, 0 packets received, 100.0% packet loss\n", "");
    if (/arp/.test(cmd)) return cb(null, o.pingOk ? "? (192.168.178.60) at 0:1d:c1:aa:bb:cc on en0 ifscope [ethernet]\n" : "? (192.168.178.60) at (incomplete) on en0\n", "");
    cb(new Error("unbekannt"), "", "");
  };
  const scenario = async (name, want, o) => {
    const net = new FakeNet((pkt) => {
      if (pkt.to.port === 5353) return o.mdnsError ? { error: o.mdnsError } : o.mdns ? { replies: [1, 2, 3].map((i) => ({ data: Buffer.from("mdns"), from: { address: "192.168.178." + (20 + i), port: 5353 } })) } : {};
      if (pkt.to.port === 9) return o.gwError ? { error: o.gwError } : {};
      if (pkt.to.port === 10023) { if (o.sendError) return { error: o.sendError }; return o.console ? consoleReplies("192.168.178.60", pkt) : {}; }
      return {};
    });
    const conn = new X32Connection({ dgram: net, os: osFake(IF_HOME), execFile: mkExec(o), tmpDir: tmp });
    const d = await conn.diagnose("192.168.178.60", o.opts);
    check("Ursachensuche mit Netz-Attrappe: " + name + " -> " + want, d.verdict.id === want, "war: " + d.verdict.id + " | " + d.checks.map((c) => c.id + ":" + c.level).join(" "));
    return d;
  };
  await scenario("Pult da und antwortet", "ok", { pingOk: true, mdns: true, console: true });
  await scenario("Pult schweigt, Ping ok, andere Geräte antworten", "silent-osc", { pingOk: true, mdns: true });
  await scenario("Pult schweigt, Ping ok, niemand antwortet (stumme Sperre)", "maybe-blocked", { pingOk: true, mdns: false });
  await scenario("Senden schlägt fehl (EHOSTUNREACH) und der Router ist auch nicht erreichbar", "blocked-error", { pingOk: true, mdns: false, sendError: "EHOSTUNREACH", gwError: "EHOSTUNREACH" });
  await scenario("Pult nicht erreichbar (kein Ping)", "unreachable", { pingOk: false, mdns: true });
  { const d = await scenario("Rundruf ins lokale Netz scheitert mit EHOSTUNREACH (so meldet macOS die Sperre; im echten Versuch nachgestellt), Ping ok", "blocked-error", { pingOk: true, mdnsError: "EHOSTUNREACH" });
    check("   Prüfpunkt „Zugriff der App aufs lokale Netzwerk“ steht auf FEHLT und nennt den Fehlercode", d.checks.some((c) => c.id === "access" && c.level === "fail" && /EHOSTUNREACH/.test(c.detail))); }
  await scenario("Sperre, Pult aber gerade aus (kein Ping): Die Sperre wird trotzdem zuerst genannt", "blocked-error", { pingOk: false, mdnsError: "EHOSTUNREACH" });
  check("Urteil: falsches Netz hat Vorrang vor der Sperre (erst die Adresse richten)", verdict("192.168.0.64", P({ ping: { ok: false }, mdns: { replies: 0, devices: 0, error: "EHOSTUNREACH" } })).id === "subnet");
  check("Urteil: Terminal antwortet, App nicht -> „macOS blockiert diese App“ (auch ohne Sendefehler)", verdict("192.168.178.60", P({ mdns: { replies: 0, devices: 0 } }), { terminal: { replied: true } }).id === "app-blocked");
  { const d = await scenario("Sperre, aber das Terminal erreicht das Pult", "app-blocked", { pingOk: true, mdns: false, opts: { terminal: { replied: true } } });
    check("Die Diagnose liefert den Systembefehl gleich mit", /defaults write com\.apple\.network\.local-network/.test(d.info.command) && d.info.gateway === "192.168.178.1"); }

  // =============== E. Suche in mehreren Netzen ===============
  { const ifsTwo = { en0: [{ address: "192.168.178.81", netmask: "255.255.255.0", family: "IPv4", internal: false }], en7: [{ address: "10.0.0.5", netmask: "255.255.255.0", family: "IPv4", internal: false }] };
    const net = new FakeNet((pkt, sock) => { if (pkt.to.port !== 10023) return {}; const viaEn7 = sock.localAddr === "10.0.0.5", isPult = pkt.to.address === "10.0.0.77" || (viaEn7 && pkt.to.address === "10.0.0.255"); return isPult ? consoleReplies("10.0.0.77", pkt) : {}; });
    const conn = new X32Connection({ dgram: net, os: osFake(ifsTwo), handlers: {} });
    const r = await conn.scan(500);
    check("Suche findet das Pult im ZWEITEN Netz (nicht nur im ersten), meldet Adresse, Name, Modell und den Weg (en7)", r.results.length === 1 && r.results[0].ip === "10.0.0.77" && r.results[0].model === "X32C" && r.results[0].name === "X32-TEST" && r.results[0].via === "en7", JSON.stringify(r.results));
    check("Jede Adresse beider Netze wurde abgefragt (mindestens 2 × 2 × 253 Anfragen) und ein Rundruf gesendet", r.probed >= 2 * 2 * 253 && net.sent.some((p) => p.to.address === "255.255.255.255") && net.sent.some((p) => p.to.address === "10.0.0.255"), r.probed + " Anfragen");
    check("Jedes Netz wurde von der passenden Adresse aus abgefragt (Absender-Adresse gebunden)", net.sent.some((p) => p.from.address === "10.0.0.5" && p.to.address === "10.0.0.20") && net.sent.some((p) => p.from.address === "192.168.178.81" && p.to.address === "192.168.178.20"));
    check("Nach der Suche sind alle Sockets geschlossen", net.sockets.every((s) => s.closed)); }
  { const conn = new X32Connection({ dgram: new FakeNet(() => ({})), os: osFake(IF_HOME), handlers: {} }), r = await conn.scan(300);
    check("Suche ohne Pult: leere Liste, Protokoll „kein Pult gefunden“", r.results.length === 0 && /kein Pult gefunden/.test(conn.logText())); }
  { const conn = new X32Connection({ dgram: new FakeNet(() => ({})), os: osFake({}), handlers: {} }), r = await conn.scan(300);
    check("Suche ohne Netzwerk: leere Liste, kein Absturz", r.results.length === 0 && r.ifaces.length === 0); }
  { const net = new FakeNet((pkt) => (pkt.to.port === 10023 ? { replies: [consoleReplies("192.168.178.60", pkt).replies[0], consoleReplies("192.168.178.60", pkt).replies[0]] } : {})), conn = new X32Connection({ dgram: net, os: osFake(IF_HOME), handlers: {} });
    const r = await conn.scan(400);
    check("Mehrfach-Antworten desselben Pults (Rundruf + Einzelanfrage) ergeben nur einen Eintrag", r.results.filter((x) => x.ip === "192.168.178.60").length <= 1 && r.results.length >= 1); }

  // =============== F. Start-Anfrage, Protokoll-Rotation, Terminal-Test ===============
  { const net = new FakeNet((pkt) => (pkt.to.port === 5353 ? { replies: [1, 2].map((i) => ({ data: Buffer.from("mdns"), from: { address: "192.168.178." + (20 + i), port: 5353 } })) } : {})), conn = new X32Connection({ dgram: net, os: osFake(IF_HOME), execFile: mkExec({ pingOk: true }), handlers: {} }), r = await conn.wakeLocalNetwork();
    check("Beim Start: kleine Anfrage an den Router (Port 9), damit macOS die Freigabe früh abfragt, und Test des Netzwerkzugriffs (Rundruf); erlaubt -> nicht gesperrt, im Protokoll", net.sent.some((p) => p.to.address === "192.168.178.1" && p.to.port === 9) && r.blocked === false && r.replies === 2 && /kleine Anfrage an den Router 192\.168\.178\.1 gesendet: ok/.test(conn.logText()) && /Zugriff aufs lokale Netzwerk: erlaubt \(2 Geräte/.test(conn.logText()), JSON.stringify(r)); }
  { const conn = new X32Connection({ dgram: new FakeNet((pkt) => (pkt.to.port === 5353 ? { error: "EHOSTUNREACH" } : {})), os: osFake(IF_HOME), execFile: mkExec({ pingOk: true }), handlers: {} }), r = await conn.checkLocalNetwork();
    check("Sperre beim Start erkannt: Rundruf scheitert mit EHOSTUNREACH -> blocked, im Protokoll „VERWEIGERT“", r.blocked === true && r.error === "EHOSTUNREACH" && /VERWEIGERT von macOS \(Fehler EHOSTUNREACH\)/.test(conn.logText()), JSON.stringify(r)); }
  { const conn = new X32Connection({ dgram: new FakeNet((pkt) => (pkt.to.port === 5353 ? { error: "EHOSTUNREACH" } : {})), os: osFake({}), execFile: mkExec({ pingOk: true }), handlers: {} }), r = await conn.checkLocalNetwork();
    check("Ohne Netzwerk wird der Fehler NICHT als Sperre gemeldet (kein falscher Alarm)", r.blocked === false && r.noNetwork === true); }
  { const conn = new X32Connection({ dgram: new FakeNet(() => ({})), os: osFake(IF_HOME), execFile: mkExec({ pingOk: true }), handlers: {} }), r = await conn.checkLocalNetwork();
    check("Niemand antwortet, kein Fehler: keine Sperre behauptet (unklar), Protokoll sagt es ehrlich", r.blocked === false && /keine Sperre gemeldet/.test(conn.logText())); }
  { const lf = path.join(tmp, "rot.log"), conn = new X32Connection({ logFile: lf, handlers: {}, os: osFake(IF_HOME) });
    for (let i = 0; i < 4000; i++) conn.log("Zeile " + i + " " + "x".repeat(80));
    check("Protokolldatei wird bei 300 KB umbenannt (.1.log), die neue bleibt klein; Speicher hält höchstens 500 Zeilen", fs.existsSync(path.join(tmp, "rot.1.log")) && fs.statSync(lf).size < 320 * 1024 && conn.logLines.length === 500); }
  { const scriptNames = [], exec = (cmd, args, o, cb) => { if (cmd === "/usr/bin/open") { scriptNames.push(fs.readFileSync(args[0], "utf8")); setTimeout(() => fs.writeFileSync(path.join(tmp, "x32-terminal-test-result.txt"), "REPLY 2f696e666f\n"), 300); } cb(null, "", ""); };
    const conn = new X32Connection({ dgram: new FakeNet(() => ({})), os: osFake(IF_HOME), execFile: exec, tmpDir: tmp, handlers: {} }), r = await conn.terminalTest("192.168.178.60");
    check("Terminal-Vergleichstest: Skript sendet /info per nc an die richtige Adresse, Ergebnis „Pult antwortet“ wird gelesen", r.ok && r.replied && /nc -u -w 3 "\$IP" 10023/.test(scriptNames[0]) && /IP="192\.168\.178\.60"/.test(scriptNames[0]), JSON.stringify(r));
    const exec2 = (cmd, args, o, cb) => { if (cmd === "/usr/bin/open") setTimeout(() => fs.writeFileSync(path.join(tmp, "x32-terminal-test-result.txt"), "NOREPLY\n"), 300); cb(null, "", ""); };
    const r2 = await new X32Connection({ dgram: new FakeNet(() => ({})), os: osFake(IF_HOME), execFile: exec2, tmpDir: tmp, handlers: {} }).terminalTest("192.168.178.60");
    check("Terminal-Vergleichstest ohne Antwort: „keine Antwort“", r2.ok && r2.replied === false);
    const r3 = await conn.terminalTest("abc");
    check("Terminal-Vergleichstest mit ungültiger Adresse: Fehlermeldung, kein Terminal geöffnet", !r3.ok && /keine gültige IP/.test(r3.error)); }

  server.close(); mock.shutdown();
  out.push(fails ? "==> " + fails + " FEHLER" : "==> alle Tests bestanden");
  console.log(out.join("\n"));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(out.join("\n")); console.log("FAIL  Ausnahme: " + (e && e.stack || e)); process.exit(2); });
