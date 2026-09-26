"use strict";
// Netzwerk-Hilfen und Verbindungs-Diagnose für die Verbindung zum X32/M32.
// Reine Rechnung ohne eigenen Netzwerkzugriff: die Messungen (Ping, UDP-Probe, ...) kommen von außen (connection.js) herein,
// deshalb lässt sich jede Ursache mit Attrappen prüfen.

// ---------- IPv4 ----------
const ipToInt = (ip) => { const p = ip.split("."); return (((+p[0]) * 256 + (+p[1])) * 256 + (+p[2])) * 256 + (+p[3]); };
const intToIp = (n) => [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join(".");

// Eingabe des Bedieners -> saubere Adresse "a.b.c.d" oder null (Leerzeichen, Komma statt Punkt, führende Nullen werden bereinigt)
function parseIPv4(text) {
  const s = String(text == null ? "" : text).trim().replace(/\s*[.,]\s*/g, ".");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map((x) => parseInt(x, 10));
  return o.every((x) => x >= 0 && x <= 255) ? o.join(".") : null;
}
// Ist das überhaupt eine sinnvolle Pult-Adresse?
function checkTarget(ip) {
  if (!String(ip == null ? "" : ip).trim()) return { ok: false, reason: "Es ist noch keine IP-Adresse eingetragen. Sie steht am Pult unter SETUP → NETWORK. Oder auf „Pult suchen“ drücken." };
  const a = parseIPv4(ip);
  if (!a) return { ok: false, reason: "Die Adresse „" + String(ip).trim() + "“ ist keine gültige IP-Adresse. Sie besteht aus vier Zahlen von 0 bis 255, zum Beispiel 192.168.1.50." };
  const first = parseInt(a.split(".")[0], 10);
  if (a === "0.0.0.0" || first === 0) return { ok: false, reason: "0.0.0.0 ist keine Pult-Adresse. Die IP-Adresse steht am Pult unter SETUP → NETWORK." };
  if (a === "255.255.255.255" || first >= 224) return { ok: false, reason: "Diese Adresse ist eine Sammel-Adresse, keine einzelne Pult-Adresse. Die IP-Adresse steht am Pult unter SETUP → NETWORK." };
  return { ok: true, ip: a, loopback: first === 127 };
}
const maskPrefix = (mask) => { const n = ipToInt(mask); let bits = 0; for (let i = 31; i >= 0 && Math.floor(n / 2 ** i) % 2 === 1; i--) bits++; return bits; };

// Aktive IPv4-Netzwerke dieses Rechners: [{ name, address, netmask, prefix, network, broadcast, networkInt, broadcastInt, mac, linkLocal }]
function interfaces(osModule) {
  const all = (osModule.networkInterfaces && osModule.networkInterfaces()) || {}, out = [];
  Object.keys(all).forEach((name) => (all[name] || []).forEach((a) => {
    if (!(a.family === "IPv4" || a.family === 4) || a.internal || !a.address || !a.netmask) return;
    const prefix = maskPrefix(a.netmask), size = 2 ** (32 - prefix), ip = ipToInt(a.address), networkInt = Math.floor(ip / size) * size, broadcastInt = networkInt + size - 1;
    out.push({ name, address: a.address, netmask: a.netmask, prefix, network: intToIp(networkInt), broadcast: intToIp(broadcastInt), networkInt, broadcastInt, mac: a.mac || "", linkLocal: a.address.startsWith("169.254.") });
  }));
  return out.sort((a, b) => Number(a.linkLocal) - Number(b.linkLocal));                      // echte Netze vor Notadressen (169.254.x.x)
}
function ifaceFor(ip, ifaces) { const n = ipToInt(ip); return ifaces.find((f) => n >= f.networkInt && n <= f.broadcastInt) || null; }
const cidr = (f) => f.network + "/" + f.prefix;
const label = (f) => f.address + " (Netz " + cidr(f) + ", " + f.name + ")";

// Alle möglichen Geräte-Adressen im Netz (ohne Netz-/Rundruf-Adresse und ohne den Rechner selbst); bei großen Netzen ein Fenster von höchstens max Adressen
function hostsOf(f, max) {
  max = max || 1022;
  const prefix = Math.max(f.prefix, 32 - Math.floor(Math.log2(max + 2))), size = 2 ** (32 - prefix), self = ipToInt(f.address), start = Math.floor(self / size) * size, out = [];
  for (let n = start + (size > 2 ? 1 : 0); n <= start + size - (size > 2 ? 2 : 1); n++) if (n !== self) out.push(intToIp(n));
  return out;
}
// Rundruf-Adressen aller Netze (gerichtet + allgemein)
function broadcastsOf(ifaces) { const s = new Set(["255.255.255.255"]); ifaces.forEach((f) => { if (f.prefix < 31) s.add(f.broadcast); }); return Array.from(s); }

// ---------- Befehl für die Systemfreigabe (Notlösung, braucht Administrator-Passwort und Neustart) ----------
function localNetworkCommand(ifaces, ip) {
  const f = (ip && ifaceFor(ip, ifaces)) || ifaces[0];
  const net = f ? f.network + "/" + f.prefix : "192.168.0.0/24";
  return ['sudo defaults write com.apple.network.local-network AllowedWiFiLocalNetworkAddresses -array "' + net + '"',
    'sudo defaults write com.apple.network.local-network AllowedEthernetLocalNetworkAddresses -array "' + net + '"'].join("\n");
}

// ---------- Diagnose ----------
// Wörter je Betriebssystem: "Mac" (macOS) oder "Computer" (Windows)
const words = (platform) => (platform === "win32" ? { mac: false, dev: "Computer", of: "des Computers", ofThis: "dieses Computers" } : { mac: true, dev: "Mac", of: "des Macs", ofThis: "dieses Macs" });

const PULT_STEPS = [
  "Am Pult die Taste SETUP drücken und mit den Seitentasten zur Seite NETWORK wechseln. Dort stehen die IP-Adresse und die Subnetzmaske.",
  "Meistens ist DHCP an (Taste leuchtet). Dann vergibt der Router die Adresse. Sie kann sich ändern: immer die Adresse ablesen, die gerade am Pult steht.",
];
const PRIVACY_STEPS = [
  "Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk öffnen (Knopf unten).",
  "Dort „X32 Fernsteuerung“ einschalten (der Schalter steht auf „aus“, wenn früher einmal „Nicht erlauben“ gewählt wurde). Steht sie nicht in der Liste: App beenden, neu öffnen und einmal auf „Verbinden“ drücken, dann erscheint sie (oder macOS fragt nach: „Erlauben“).",
  "Danach die App beenden und neu öffnen.",
];
const FIREWALL_STEPS = [
  "Beim ersten Start fragt Windows, ob „X32 Fernsteuerung“ auf das Netzwerk zugreifen darf. Dort „Zugriff zulassen“ wählen (mit Haken bei „Private Netzwerke“). Wurde „Abbrechen“ gewählt, sperrt Windows die App.",
  "Windows-Sicherheit → Firewall & Netzwerkschutz → „Eine App durch die Firewall zulassen“ (Knopf unten). Oben „Einstellungen ändern“, dann „X32 Fernsteuerung“ suchen und bei „Privat“ (und „Öffentlich“, falls das Netz als öffentlich gilt) einen Haken setzen. Fehlt die App in der Liste: „Andere App zulassen …“ und die Programmdatei wählen.",
  "Das Netz des Pults sollte als „Privat“ eingestellt sein: Einstellungen → Netzwerk und Internet → WLAN bzw. Ethernet → Eigenschaften → Netzwerkprofiltyp „Privat“.",
  "Ein Virenprogramm mit eigener Firewall (zum Beispiel Norton oder Kaspersky) kann die App ebenfalls sperren: dort die App erlauben.",
  "Danach auf „Verbinden“ drücken.",
];

// ctx: { ip, platform, ifaces, gateway, route, probes: { ping, arp, udp, mdns, gatewayUdp }, terminal }
//   platform "darwin" (Standard) oder "win32"
//   ping   { ok: bool|null, lossPct, rtt } (null = nicht messbar)      arp   { mac|null }
//   udp    { reply: { model, name, version, ip, ms } | null, sent, sendErrors: { CODE: n } }
//   mdns   { replies, devices }                                      gatewayUdp { ok, error }
//   terminal { replied: bool } (Test über das Terminal, nur macOS, falls gemacht)
function diagnose(ctx) {
  const { ip, ifaces, probes } = ctx, W = words(ctx.platform), checks = [], add = (id, level, title, detail) => checks.push({ id, level, title, detail: detail || "" });
  const target = checkTarget(ip), p = probes || {}, udp = p.udp || {}, ping = p.ping || {}, mdns = p.mdns || {};
  const iface = target.ok ? ifaceFor(target.ip, ifaces) : null;

  // --- einzelne Prüfpunkte ---
  add("net", ifaces.length ? "ok" : "fail", "Netzwerk " + W.of, ifaces.length ? ifaces.map(label).join("; ") : "kein aktives WLAN/LAN mit IPv4-Adresse gefunden");
  add("target", target.ok ? "ok" : "fail", "Adresse des Pults", target.ok ? target.ip : target.reason);
  if (target.ok && !target.loopback) add("subnet", iface ? "ok" : "fail", "Gleiches Netz wie der " + W.dev, iface ? "ja, über " + iface.name : "nein: die Adresse liegt in keinem der Netze " + W.ofThis + (ctx.route && ctx.route.gateway ? " (Pakete gehen über den Router " + ctx.route.gateway + " ins Nirgendwo)" : ""));
  if (ping.ok !== undefined && ping.ok !== null) add("ping", ping.ok ? "ok" : "fail", "Ping (Gerät erreichbar?)", ping.ok ? "Antwort" + (ping.rtt != null ? " nach " + Math.round(ping.rtt) + " ms" : "") + (ping.lossPct ? ", " + Math.round(ping.lossPct) + " % Verlust" : "") : "keine Antwort");
  if (p.arp) add("arp", p.arp.mac ? "ok" : "info", "Geräte-Adresse im Netz (ARP)", p.arp.mac ? p.arp.mac : "noch kein Eintrag");
  const denied = ["EHOSTUNREACH", "EPERM", "EACCES", "EPIPE", "ENETUNREACH"], mdnsBlocked = W.mac && !!mdns.error && denied.includes(mdns.error);
  if (W.mac && (mdns.replies !== undefined || mdns.error)) add("access", mdnsBlocked ? "fail" : mdns.replies > 0 ? "ok" : "info", "Zugriff der App aufs lokale Netzwerk", mdnsBlocked ? "macOS verweigert der App das Senden ins lokale Netz (Fehler " + mdns.error + " beim Rundruf an alle Geräte)" : mdns.replies > 0 ? "Antworten von " + mdns.devices + " Geräten im Netz erhalten: die App darf ins lokale Netz" : "keine Antworten von anderen Geräten (unklar, ob macOS blockiert oder nur nichts antwortet)");
  if (!W.mac && mdns.replies !== undefined) add("access", mdns.replies > 0 ? "ok" : "info", "Antworten anderer Geräte im Netz", mdns.replies > 0 ? "Antworten von " + mdns.devices + " Geräten erhalten: Windows lässt Antworten zur App durch" : "keine Antworten von anderen Geräten (unklar, ob die Windows-Firewall blockiert oder nur nichts antwortet)");
  const errCodes = Object.keys(udp.sendErrors || {});
  if (errCodes.length) add("senderr", "warn", "Fehler beim Senden", errCodes.map((c) => c + " (" + udp.sendErrors[c] + "×)").join(", "));
  add("osc", udp.reply ? "ok" : "fail", "Antwort des Pults (OSC, Port 10023)", udp.reply ? [udp.reply.model, udp.reply.name, udp.reply.version].filter(Boolean).join(" · ") + (udp.reply.ms != null ? " (nach " + Math.round(udp.reply.ms) + " ms)" : "") : (udp.sent ? udp.sent + " Anfragen gesendet, keine Antwort" : "keine Antwort"));
  if (W.mac && ctx.terminal) add("terminal", ctx.terminal.replied ? "ok" : "fail", "Vergleichstest über das Terminal", ctx.terminal.replied ? "Das Pult antwortet dem Terminal" : "auch das Terminal bekommt keine Antwort");

  // --- Urteil ---
  const gwFail = W.mac && p.gatewayUdp && p.gatewayUdp.ok === false;
  const firewallAction = { id: "open-firewall", label: "Firewall-Einstellungen öffnen" };
  let v;
  if (udp.reply) {
    v = { id: "ok", level: "ok", title: "Das Pult antwortet", text: "Die Verbindung zum Pult ist möglich (" + [udp.reply.model, udp.reply.version].filter(Boolean).join(" ") + "). Bitte noch einmal auf „Verbinden“ drücken.", steps: [], actions: [{ id: "retry", label: "Jetzt verbinden" }] };
  } else if (!target.ok) {
    v = { id: "bad-ip", level: "fail", title: "Die IP-Adresse stimmt nicht", text: target.reason, steps: PULT_STEPS.slice(0, 1), actions: [{ id: "scan", label: "Pult im Netz suchen" }] };
  } else if (!ifaces.length) {
    v = { id: "no-network", level: "fail", title: "Der " + W.dev + " ist mit keinem Netzwerk verbunden", text: "Es gibt kein aktives WLAN oder LAN mit einer IP-Adresse. Ohne Netzwerk kann die App das Pult nicht erreichen.", steps: ["WLAN einschalten und mit dem Netz verbinden, in dem auch das Pult hängt (oder das Netzwerkkabel anstecken).", "Bei direktem Kabel zwischen " + W.dev + " und Pult: beiden Geräten feste Adressen im selben Netz geben (zum Beispiel " + W.dev + " 192.168.1.10, Pult 192.168.1.20, Subnetzmaske 255.255.255.0)."], actions: [{ id: "retry", label: "Nochmal prüfen" }] };
  } else if (!target.loopback && !iface) {
    const near = ifaces[0];
    v = { id: "subnet", level: "fail", title: W.dev + " und Pult sind in verschiedenen Netzen", text: "Der " + W.dev + " hängt im Netz " + cidr(near) + " (seine Adresse: " + near.address + "). Die Pult-Adresse " + target.ip + " liegt nicht in diesem Netz. Die Pakete kommen deshalb nie beim Pult an.",
      steps: [W.dev + " und Pult müssen am selben Router oder Switch hängen und Adressen im selben Netz haben. Beim " + W.dev + " passt zum Beispiel " + near.network.replace(/\.0$/, ".") + "x mit einer freien Zahl statt x.", ...PULT_STEPS, "Stimmt die Adresse am Pult schon, dann ist der " + W.dev + " im falschen WLAN. Im richtigen WLAN anmelden oder den " + W.dev + " mit einem Kabel an den Router des Pults anschließen.", "Oder auf „Pult im Netz suchen“ drücken: die App findet das Pult im aktuellen Netz und trägt die richtige Adresse selbst ein."],
      actions: [{ id: "scan", label: "Pult im Netz suchen" }] };
  } else if (W.mac && ctx.terminal && ctx.terminal.replied) {
    v = { id: "app-blocked", level: "fail", title: "macOS blockiert diese App", text: "Das Pult antwortet dem Terminal, aber nicht dieser App. Damit ist sicher: macOS erlaubt der App den Zugriff aufs lokale Netzwerk nicht.", steps: PRIVACY_STEPS, actions: [{ id: "open-privacy", label: "Systemeinstellungen öffnen" }, { id: "copy-command", label: "Notlösung: Befehl kopieren" }] };
  } else if (W.mac && (mdnsBlocked || gwFail || (errCodes.length && ping.ok === true))) {
    v = { id: "blocked-error", level: "fail", title: "macOS lässt die App nicht ins lokale Netzwerk", text: "Schon das Senden ins lokale Netz schlägt fehl (" + (mdnsBlocked ? mdns.error + " beim Rundruf" : errCodes.join(", ") || "Router-Test") + "). Das macht macOS, wenn der App der Zugriff aufs lokale Netzwerk nicht erlaubt ist (zum Beispiel weil einmal „Nicht erlauben“ gewählt wurde). Das Pult selbst kann in Ordnung sein.", steps: PRIVACY_STEPS, actions: [{ id: "open-privacy", label: "Systemeinstellungen öffnen" }, { id: "copy-command", label: "Notlösung: Befehl kopieren" }] };
  } else if (ping.ok === false) {
    v = { id: "unreachable", level: "fail", title: "Das Pult ist im Netz nicht erreichbar", text: "Die Adresse " + target.ip + " liegt im richtigen Netz, aber dort antwortet kein Gerät (auch nicht auf Ping). Das Pult ist aus, nicht im Netz, oder die Adresse gehört einem anderen Gerät.",
      steps: ["Pult einschalten und prüfen, ob das Netzwerkkabel steckt (Lämpchen an der Buchse) oder das Pult im WLAN ist.", ...PULT_STEPS, "Die Adresse dort ablesen und in der App genau so eintragen.", "Gäste-WLAN oder „Geräteisolierung“ im Router verhindern, dass Geräte einander sehen. Ein normales Heim-/Schul-WLAN ohne Isolierung nutzen.", "Oder auf „Pult im Netz suchen“ drücken."],
      actions: [{ id: "scan", label: "Pult im Netz suchen" }, { id: "retry", label: "Nochmal prüfen" }] };
  } else if (ping.ok === true && mdns.replies > 0) {
    v = { id: "silent-osc", level: "warn", title: "Das Gerät ist da, sendet aber keine X32-Antwort", text: "Unter " + target.ip + " antwortet ein Gerät auf Ping, aber nicht auf die X32-Fernsteuerung (UDP Port 10023). " + (W.mac ? "Die App darf ins lokale Netz (sie hat Antworten anderer Geräte bekommen). " : "Die Antworten anderer Geräte kommen bei der App an. ") + "Es ist also entweder nicht das Pult, oder das Pult ist gerade nicht bereit.",
      steps: ["Stimmt die IP-Adresse wirklich? Am Pult unter SETUP → NETWORK ablesen (die Adresse kann sich nach einem Neustart ändern, wenn der Router sie vergibt).", "Pult einmal aus- und wieder einschalten und 1 Minute warten.", "Läuft gleichzeitig X32-Edit oder eine andere Fernsteuerung? Das Pult schafft nur wenige gleichzeitige Verbindungen: andere Programme beenden.", "Router: UDP-Verkehr zwischen den Geräten darf nicht gefiltert werden (keine Geräteisolierung, kein Gäste-Netz).", "Auf „Pult im Netz suchen“ drücken: die App sucht das Pult im ganzen Netz."],
      actions: [{ id: "scan", label: "Pult im Netz suchen" }].concat(W.mac ? [{ id: "terminal-test", label: "Vergleichstest über Terminal" }] : [firewallAction]) };
  } else if (ping.ok === true) {
    v = W.mac
      ? { id: "maybe-blocked", level: "warn", title: "Das Gerät ist erreichbar, aber es kommt nichts zurück", text: "Der Ping klappt, doch auf die Anfragen der App kommt keine Antwort, und auch andere Geräte im Netz antworten der App nicht. Sehr wahrscheinlich blockiert macOS den Zugriff der App aufs lokale Netzwerk (das geschieht ohne Fehlermeldung).", steps: PRIVACY_STEPS.concat(["Zur Sicherheit kann der „Vergleichstest über Terminal“ zeigen, ob das Pult dem Terminal antwortet. Dann ist es sicher macOS."]), actions: [{ id: "open-privacy", label: "Systemeinstellungen öffnen" }, { id: "terminal-test", label: "Vergleichstest über Terminal" }, { id: "copy-command", label: "Notlösung: Befehl kopieren" }] }
      : { id: "maybe-blocked", level: "warn", title: "Das Gerät ist erreichbar, aber es kommt nichts zurück", text: "Der Ping klappt, doch auf die Anfragen der App kommt keine Antwort, und auch andere Geräte im Netz antworten der App nicht. Sehr wahrscheinlich blockiert die Windows-Firewall die Antworten (oder ein Virenprogramm). Das Pult selbst kann in Ordnung sein.", steps: FIREWALL_STEPS, actions: [firewallAction, { id: "scan", label: "Pult im Netz suchen" }] };
  } else {
    v = W.mac
      ? { id: "no-reply", level: "warn", title: "Keine Antwort vom Pult", text: "Das Pult antwortet nicht (auch nicht auf Ping, falls messbar). Mögliche Gründe: falsche IP-Adresse, Pult aus, anderes Netz, oder macOS blockiert die App im lokalen Netzwerk.", steps: ["Pult einschalten, Netzwerkkabel/WLAN prüfen.", ...PULT_STEPS, "Systemeinstellungen → Datenschutz & Sicherheit → Lokales Netzwerk: „X32 Fernsteuerung“ einschalten.", "Auf „Pult im Netz suchen“ drücken."], actions: [{ id: "scan", label: "Pult im Netz suchen" }, { id: "open-privacy", label: "Systemeinstellungen öffnen" }] }
      : { id: "no-reply", level: "warn", title: "Keine Antwort vom Pult", text: "Das Pult antwortet nicht (auch nicht auf Ping, falls messbar). Mögliche Gründe: falsche IP-Adresse, Pult aus, anderes Netz, oder die Windows-Firewall blockiert die App.", steps: ["Pult einschalten, Netzwerkkabel/WLAN prüfen.", ...PULT_STEPS, "Windows-Firewall: die App muss im privaten Netzwerk erlaubt sein (Knopf unten zeigt, wo).", "Auf „Pult im Netz suchen“ drücken."], actions: [{ id: "scan", label: "Pult im Netz suchen" }, firewallAction] };
  }
  return { checks, verdict: v };
}

module.exports = { ipToInt, intToIp, parseIPv4, checkTarget, maskPrefix, interfaces, ifaceFor, hostsOf, broadcastsOf, localNetworkCommand, diagnose, PULT_STEPS, PRIVACY_STEPS, FIREWALL_STEPS };
