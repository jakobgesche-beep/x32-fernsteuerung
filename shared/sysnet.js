"use strict";
// Systembefehle für die Fehlersuche im Netz, je Betriebssystem (macOS und Windows): welcher Befehl, und Auswertung seiner Ausgabe.
// Die Auswertung ist reine Textverarbeitung und lässt sich mit echten Ausgaben prüfen (test/net-test.js).
// Windows-Ausgaben sind je nach Sprache verschieden (Deutsch/Englisch: "Sent/Gesendet", "On-link/Auf Verbindung"). Deshalb werden dort
// nur Zahlen und feste Muster ausgewertet (TTL=..., IP-Adressen, MAC-Adressen), keine Wörter.
const IP = "(\\d{1,3}(?:\\.\\d{1,3}){3})";
const ipToInt = (ip) => ip.split(".").reduce((a, x) => a * 256 + parseInt(x, 10), 0);

// ---------- Windows: "route print -4" ----------
// Zeilen: Ziel  Maske  Gateway (oder "On-link" / "Auf Verbindung")  Schnittstelle(IP)  Metrik
function parseRoutePrint(text) {
  const rows = [], re = new RegExp("^\\s*" + IP + "\\s+" + IP + "\\s+(.+?)\\s+" + IP + "\\s+(\\d+)\\s*$");
  String(text || "").split(/\r?\n/).forEach((line) => {
    const m = re.exec(line);
    if (!m) return;
    const gw = new RegExp("^" + IP + "$").exec(m[3].trim());
    rows.push({ dest: m[1], mask: m[2], gateway: gw ? gw[1] : null, iface: m[4], metric: parseInt(m[5], 10) });
  });
  return rows;
}
// Beste Route zu ip: längste Maske, dann kleinste Metrik. -> { gateway|null, interface, onLink } oder null
function bestRoute(rows, ip) {
  const n = ipToInt(ip);
  let best = null;
  rows.forEach((r) => {
    const mask = ipToInt(r.mask);
    if (((n & mask) >>> 0) !== (ipToInt(r.dest) >>> 0)) return;
    if (r.dest === "255.255.255.255" || r.dest.startsWith("224.")) return;            // Rundruf-/Multicast-Zeilen sind keine Wege
    if (!best || mask > best.mask || (mask === best.mask && r.metric < best.r.metric)) best = { mask, r };
  });
  return best ? { gateway: best.r.gateway, interface: best.r.iface, onLink: !best.r.gateway } : null;
}
// Standard-Gateway (Router): Zeile 0.0.0.0/0.0.0.0 mit kleinster Metrik
function defaultGatewayFromRoutes(rows) {
  const d = rows.filter((r) => r.dest === "0.0.0.0" && r.mask === "0.0.0.0" && r.gateway).sort((a, b) => a.metric - b.metric)[0];
  return d ? d.gateway : null;
}

// ---------- Windows: "ping -n 3 -w 1000 IP" ----------
// Wichtig: Windows meldet auch "Zielhost nicht erreichbar" als Antwort (vom eigenen Rechner). Echte Antworten erkennt man nur an "TTL=".
function parsePingWin(text, count) {
  const t = String(text || ""), lines = t.split(/\r?\n/);
  const replyLines = lines.filter((l) => /\bTTL=\d+/i.test(l));
  const hasStats = /=\s*\d+\s*,\s*[^=,\n]+?=\s*\d+/.test(t) || /\d+\s*%/.test(t);
  if (!replyLines.length && !hasStats) return { ok: null };
  const times = [];
  replyLines.forEach((l) => { const m = /[=<]\s*(\d+)\s*ms\b/i.exec(l); if (m) times.push(parseInt(m[1], 10)); });
  const sent = count || 3;
  return { ok: replyLines.length > 0, lossPct: Math.max(0, Math.round((1 - replyLines.length / sent) * 100)), rtt: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null };
}

// ---------- Windows: "arp -a IP" ----------
function parseArpWin(text, ip) {
  const re = new RegExp("^\\s*" + String(ip).replace(/\./g, "\\.") + "\\s+((?:[0-9a-f]{2}-){5}[0-9a-f]{2})\\b", "im"), m = re.exec(String(text || ""));
  return { mac: m && m[1].toLowerCase() !== "ff-ff-ff-ff-ff-ff" ? m[1].toLowerCase().replace(/-/g, ":") : null };
}

// ---------- macOS ----------
const parseRouteGetGateway = (text) => { const m = /gateway:\s*([\d.]+)/.exec(text || ""); return m ? m[1] : null; };
function parseRouteGetMac(text) {
  const g = /gateway:\s*([\d.]+)/.exec(text || ""), i = /interface:\s*(\S+)/.exec(text || "");
  return text ? { gateway: g ? g[1] : null, interface: i ? i[1] : null, onLink: !g } : null;
}
function parsePingMac(text) {
  const rec = /(\d+)\s+packets received/.exec(text || ""), tx = /(\d+)\s+packets transmitted/.exec(text || "");
  if (!tx) return { ok: null };
  const loss = /([\d.]+)%\s+packet loss/.exec(text), rtt = /=\s*[\d.]+\/([\d.]+)\//.exec(text);
  return { ok: !!rec && parseInt(rec[1], 10) > 0, lossPct: loss ? parseFloat(loss[1]) : null, rtt: rtt ? parseFloat(rtt[1]) : null };
}
function parseArpMac(text) { const m = /at\s+((?:[0-9a-f]{1,2}:){5}[0-9a-f]{1,2})/i.exec(text || ""); return { mac: m ? m[1] : null }; }

// ---------- Zugriff: run(cmd, args, timeoutMs) -> Promise<{ err, out, errOut }> kommt von außen ----------
function tools(platform, run) {
  if (platform === "win32") {
    const table = async () => parseRoutePrint((await run("route", ["print", "-4"], 4000)).out);
    return {
      async defaultGateway() { return defaultGatewayFromRoutes(await table()); },
      async routeTo(ip) { const rows = await table(); return rows.length ? bestRoute(rows, ip) : null; },
      async ping(ip) { return parsePingWin((await run("ping", ["-n", "3", "-w", "1000", ip], 12000)).out, 3); },
      async arp(ip) { return parseArpWin((await run("arp", ["-a", ip], 4000)).out, ip); },
    };
  }
  return {
    async defaultGateway() { return parseRouteGetGateway((await run("/sbin/route", ["-n", "get", "default"], 3000)).out); },
    async routeTo(ip) { return parseRouteGetMac((await run("/sbin/route", ["-n", "get", ip], 3000)).out); },
    async ping(ip) { return parsePingMac((await run("/sbin/ping", ["-c", "3", "-W", "1000", "-t", "5", ip], 9000)).out); },
    async arp(ip) { return parseArpMac((await run("/usr/sbin/arp", ["-n", ip], 3000)).out); },
  };
}

module.exports = { parseRoutePrint, bestRoute, defaultGatewayFromRoutes, parsePingWin, parseArpWin, parseRouteGetGateway, parseRouteGetMac, parsePingMac, parseArpMac, tools };
