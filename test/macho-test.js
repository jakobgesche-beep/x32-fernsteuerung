// Tests für die eigene Mach-O-UUID (scripts/macho-uuid.js und der Bau-Schritt). Ausführen mit Node:
//   ELECTRON_RUN_AS_NODE=1 <Electron-Programm> test/macho-test.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");
const M = require("../scripts/macho-uuid");
const hook = require("../scripts/afterSignAdHoc");

const out = []; let fails = 0;
const check = (name, ok, detail) => { if (!ok) fails++; out.push((ok ? "OK    " : "FAIL  ") + name + (detail !== undefined ? "  " + detail : "")); };

// künstliche Mach-O-Datei (arm64, 64 Bit) mit einem Segment, einer UUID und einem Startbefehl
function thin(uuidBytes) {
  const cmds = [];
  const seg = Buffer.alloc(72); seg.writeUInt32LE(0x19, 0); seg.writeUInt32LE(72, 4); seg.write("__TEXT", 8); cmds.push(seg);
  const u = Buffer.alloc(24); u.writeUInt32LE(0x1b, 0); u.writeUInt32LE(24, 4); Buffer.from(uuidBytes).copy(u, 8); cmds.push(u);
  const main = Buffer.alloc(24); main.writeUInt32LE(0x80000028, 0); main.writeUInt32LE(24, 4); cmds.push(main);
  const size = cmds.reduce((a, c) => a + c.length, 0), h = Buffer.alloc(32);
  h.writeUInt32LE(0xfeedfacf, 0); h.writeUInt32LE(0x0100000c, 4); h.writeUInt32LE(2, 12); h.writeUInt32LE(cmds.length, 16); h.writeUInt32LE(size, 20);
  return Buffer.concat([h].concat(cmds, [Buffer.alloc(64, 7)]));
}
const U1 = Buffer.from("00112233445566778899aabbccddeeff", "hex"), U2 = Buffer.from("ffeeddccbbaa99887766554433221100", "hex");

{
  const b = thin(U1), before = Buffer.from(b);
  check("Findet die UUID in einer künstlichen Mach-O-Datei und liest sie richtig", M.findUuids(b).length === 1 && M.findUuids(b)[0].uuid === "00112233-4455-6677-8899-AABBCCDDEEFF", JSON.stringify(M.findUuids(b)));
  const n = M.patchBuffer(b, U2), diff = []; for (let i = 0; i < b.length; i++) if (b[i] !== before[i]) diff.push(i);
  check("Ändert nur die 16 Bytes der UUID, sonst kein Byte der Datei", n === 1 && diff.length === 16 && diff[0] === 32 + 72 + 8 && M.findUuids(b)[0].uuid === "FFEEDDCC-BBAA-9988-7766-554433221100", diff.length + " Bytes");
  check("Zweites Mal dieselbe UUID setzen ändert nichts mehr (wiederholbar)", (() => { const c = Buffer.from(b); M.patchBuffer(c, U2); return c.equals(b); })());
}
{
  const a = thin(U1), b = thin(U1), fatHead = Buffer.alloc(8 + 40); fatHead.writeUInt32BE(0xcafebabe, 0); fatHead.writeUInt32BE(2, 4);
  const off1 = 256, off2 = 256 + Math.ceil(a.length / 16) * 16 + 16;
  fatHead.writeUInt32BE(0x01000007, 8); fatHead.writeUInt32BE(3, 12); fatHead.writeUInt32BE(off1, 16); fatHead.writeUInt32BE(a.length, 20); fatHead.writeUInt32BE(4, 24);
  fatHead.writeUInt32BE(0x0100000c, 28); fatHead.writeUInt32BE(0, 32); fatHead.writeUInt32BE(off2, 36); fatHead.writeUInt32BE(b.length, 40); fatHead.writeUInt32BE(4, 44);
  const file = Buffer.alloc(off2 + b.length); fatHead.copy(file, 0); a.copy(file, off1); b.copy(file, off2);
  check("Universal-Datei (Intel + Apple Silicon): beide Teile werden gefunden und geändert", M.findUuids(file).length === 2 && M.patchBuffer(file, U2) === 2 && M.findUuids(file).every((f) => f.uuid === "FFEEDDCC-BBAA-9988-7766-554433221100"));
}
{
  const junk = Buffer.from("das ist keine Programmdatei"), copy = Buffer.from(junk);
  check("Datei ohne Mach-O (Text, zu kurz, leer): nichts gefunden, nichts geändert, kein Absturz", M.patchBuffer(junk, U2) === 0 && junk.equals(copy) && M.findUuids(Buffer.alloc(0)).length === 0 && M.findUuids(Buffer.alloc(3)).length === 0);
  const nou = thin(U1); nou.writeUInt32LE(0x2, 32 + 72);                 // Befehl "UUID" in einen anderen Befehl umbenannt
  check("Mach-O ohne UUID-Befehl bleibt unberührt", M.patchBuffer(nou, U2) === 0);
}
{
  const a = M.uuidFor("de.technikag.x32fernsteuerung/main"), b = M.uuidFor("de.technikag.x32fernsteuerung/main"), c = M.uuidFor("de.technikag.dmxsteuerung/main");
  check("Eigene UUID aus dem App-Namen: immer dieselbe (bleibt bei Updates gleich), für jede App eine andere, gültiges Format (Version 5)", a.equals(b) && !a.equals(c) && /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/.test(M.format(a)), M.format(a) + " / " + M.format(c));
  check("Die eigene UUID ist nicht die bekannte gemeinsame Electron-UUID", M.format(a) !== "4C4C44F8-5555-3144-A1B8-270B7145EDA0");
}

// ---- mit der echten Electron-App ----
const APP = "/Applications/X32 Fernsteuerung.app";
if (fs.existsSync(APP) && process.platform === "darwin") {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "macho-")), copy = path.join(tmp, "X32 Fernsteuerung.app");
  execFileSync("cp", ["-R", APP, copy]);
  const exe = path.join(copy, "Contents/MacOS/X32 Fernsteuerung"), uuidOf = (f) => (/UUID:\s*([0-9A-F-]+)/.exec(execFileSync("dwarfdump", ["--uuid", f]).toString()) || [])[1];
  const before = uuidOf(exe);
  (async () => {
    await hook({ electronPlatformName: "darwin", appOutDir: tmp, packager: { appInfo: { productFilename: "X32 Fernsteuerung", id: "de.technikag.x32fernsteuerung" } } });
    const after = uuidOf(exe), helpers = ["X32 Fernsteuerung Helper", "X32 Fernsteuerung Helper (GPU)", "X32 Fernsteuerung Helper (Renderer)", "X32 Fernsteuerung Helper (Plugin)"].map((n) => uuidOf(path.join(copy, "Contents/Frameworks", n + ".app/Contents/MacOS", n)));
    check("Echte App: Hauptprogramm hat danach eine andere UUID als vorher (vorher " + before + ")", !!after && after !== before && after === M.format(M.uuidFor("de.technikag.x32fernsteuerung/main")), after);
    check("Echte App: jedes Hilfsprogramm hat eine eigene UUID (alle voneinander und vom Hauptprogramm verschieden)", new Set(helpers.concat([after])).size === 5, helpers.join(" "));
    const v = spawnSync("codesign", ["--verify", "--deep", "--strict", copy]);
    check("Echte App: Signatur ist nach dem Ändern wieder gültig (codesign --verify --deep --strict)", v.status === 0, v.stderr.toString().slice(0, 120));
    const info = spawnSync(exe, ["-e", "console.log('start ' + process.versions.electron)"], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }) });
    check("Echte App: startet mit der neuen UUID normal (Electron meldet seine Version)", /start \d+\.\d+/.test(info.stdout.toString()), info.stdout.toString().trim() + info.stderr.toString().slice(0, 80));
    execFileSync("rm", ["-rf", tmp]);
    out.push(fails ? "==> " + fails + " FEHLER" : "==> alle Tests bestanden");
    console.log(out.join("\n")); process.exit(fails ? 1 : 0);
  })().catch((e) => { console.log(out.join("\n")); console.log("FAIL  Ausnahme: " + (e && e.stack || e)); process.exit(2); });
} else {
  out.push("(echte App nicht gefunden: Tests mit der installierten App übersprungen)");
  out.push(fails ? "==> " + fails + " FEHLER" : "==> alle Tests bestanden");
  console.log(out.join("\n")); process.exit(fails ? 1 : 0);
}
