"use strict";
// Gibt Mac-Programmen eine eigene Mach-O-UUID.
// Grund: macOS merkt sich die Freigabe für das lokale Netzwerk (und anderes) unter der UUID des Hauptprogramms. Alle Electron-Apps
// derselben Electron-Version haben dieselbe UUID; macOS verwechselt sie dann (belegt: bei zwei Apps mit gleicher UUID meldet macOS
// "found bundle id <andere App> by UUID"). Apple empfiehlt eine eindeutige UUID (TN3179). Die UUID hängt nur von einem Namen ab,
// bleibt also bei jedem Update gleich (die Freigabe geht nicht verloren).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LC_UUID = 0x1b, MH_MAGIC = 0xfeedface, MH_MAGIC_64 = 0xfeedfacf, FAT_MAGIC = 0xcafebabe;

// feste UUID (Version 5) aus einem Namen
function uuidFor(name) {
  const h = crypto.createHash("sha1").update("x32.technikag.macho-uuid:" + name).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; b[8] = (b[8] & 0x3f) | 0x80;
  return b;
}
const format = (b) => { const s = Buffer.from(b).toString("hex").toUpperCase(); return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join("-"); };

// alle UUID-Befehle einer Mach-O-Datei (dünn oder "fat") finden: [{ offset (der 16 Byte der UUID), uuid }]
function findUuids(buf, base) {
  base = base || 0;
  const out = [];
  if (base + 8 > buf.length) return out;
  const be = buf.readUInt32BE(base);
  if (be === FAT_MAGIC) {
    const n = buf.readUInt32BE(base + 4);
    for (let i = 0; i < n; i++) { const off = buf.readUInt32BE(base + 8 + i * 20 + 8); out.push(...findUuids(buf, off)); }
    return out;
  }
  const le = buf.readUInt32LE(base);
  if (le !== MH_MAGIC_64 && le !== MH_MAGIC) return out;
  const headerSize = le === MH_MAGIC_64 ? 32 : 28, ncmds = buf.readUInt32LE(base + 16);
  let off = base + headerSize;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > buf.length) break;
    const cmd = buf.readUInt32LE(off), size = buf.readUInt32LE(off + 4);
    if (size < 8) break;
    if (cmd === LC_UUID && size >= 24) out.push({ offset: off + 8, uuid: format(buf.subarray(off + 8, off + 24)) });
    off += size;
  }
  return out;
}
// setzt die UUID in allen Teilen der Datei; gibt die Anzahl geänderter Teile zurück
function patchBuffer(buf, uuidBytes) {
  const found = findUuids(buf);
  found.forEach((f) => Buffer.from(uuidBytes).copy(buf, f.offset));
  return found.length;
}
function patchFile(file, uuidBytes) {
  const buf = fs.readFileSync(file), before = findUuids(buf).map((f) => f.uuid), n = patchBuffer(buf, uuidBytes);
  if (n > 0) fs.writeFileSync(file, buf);
  return { patched: n, before, after: findUuids(buf).map((f) => f.uuid) };
}

// alle Programme einer .app: Hauptprogramm bekommt die UUID aus dem App-Namen, jedes Hilfsprogramm eine eigene aus App-Name und eigenem Namen
function patchApp(appPath, appId) {
  const results = [], plist = path.join(appPath, "Contents");
  const macos = path.join(plist, "MacOS");
  fs.readdirSync(macos).forEach((f) => { const file = path.join(macos, f); if (fs.statSync(file).isFile()) results.push(Object.assign({ file }, patchFile(file, uuidFor(appId + "/main")))); });
  const fw = path.join(plist, "Frameworks");
  if (fs.existsSync(fw)) fs.readdirSync(fw).filter((n) => n.endsWith(".app")).forEach((h) => {
    const dir = path.join(fw, h, "Contents", "MacOS");
    if (fs.existsSync(dir)) fs.readdirSync(dir).forEach((f) => results.push(Object.assign({ file: path.join(dir, f) }, patchFile(path.join(dir, f), uuidFor(appId + "/" + h)))));
  });
  return results;
}

module.exports = { uuidFor, format, findUuids, patchBuffer, patchFile, patchApp };
